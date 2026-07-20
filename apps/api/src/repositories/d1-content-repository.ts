import type { CollectionSummary, ContentSegment, Dua, DuaSummary, Hadith, HadithSummary } from '@fortress/contracts';
import { rankDuaTitles } from '../lib/fuzzy-title';
import type { ContentRepository, DatasetSummary, DuaTitleMatch, RecordEvidence } from './content-repository';

type DatasetRow = {
  id: string;
  source_name: string;
  source_version: string;
  publication_status: DatasetSummary['publicationStatus'];
  verification_status: DatasetSummary['verificationStatus'];
  record_count: number;
  content_hash: string;
  imported_at: string;
};

type SummaryRow = {
  id: string;
  legacy_id: string;
  sequence: number;
  title: string;
  verification_status: DuaSummary['verificationStatus'];
  part_count: number;
};

type HadithRow = {
  id: string;
  sequence: number;
  display_number: string;
  title: string;
  verification_status: HadithSummary['verificationStatus'];
  collection_slug: string;
  collection_title: string;
  book_number: string | null;
  book_title: string | null;
  chapter_number: string | null;
  chapter_title: string | null;
  narrator: string | null;
  grade: string | null;
  grading_authority: string | null;
};

type SegmentRow = {
  part_position: number;
  segment_position: number | null;
  kind: ContentSegment['kind'] | null;
  text: string | null;
};

export class D1ContentRepository implements ContentRepository {
  constructor(private readonly database: D1Database) {}

  async getCurrentDataset(): Promise<DatasetSummary> {
    const row = await this.database.prepare(`
      SELECT id, source_name, source_version, publication_status, verification_status,
             record_count, content_hash, imported_at
      FROM dataset_versions
      WHERE publication_status = 'active'
      LIMIT 1
    `).first<DatasetRow>();

    if (!row) throw new Error('No active dataset is available.');

    return {
      id: row.id,
      sourceName: row.source_name,
      sourceVersion: row.source_version,
      publicationStatus: row.publication_status,
      verificationStatus: row.verification_status,
      recordCount: row.record_count,
      contentHash: row.content_hash,
      importedAt: row.imported_at,
    };
  }

  async listCollections(contentType?: 'dua' | 'hadith'): Promise<CollectionSummary[]> {
    const result = await this.database.prepare(`
      SELECT collection.id, collection.slug, collection.content_type AS contentType,
             collection.title, collection.title_arabic AS titleArabic,
             collection.verification_status AS verificationStatus,
             COUNT(DISTINCT record.id) AS recordCount,
             COUNT(DISTINCT book.id) AS bookCount,
             COUNT(DISTINCT chapter.id) AS chapterCount
      FROM collections collection
      JOIN record_placements placement ON placement.collection_id = collection.id
      JOIN content_records record ON record.id = placement.record_id
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      LEFT JOIN books book ON book.collection_id = collection.id
      LEFT JOIN chapters chapter ON chapter.book_id = book.id
      WHERE dataset.publication_status = 'active'
        AND (? IS NULL OR collection.content_type = ?)
      GROUP BY collection.id
      ORDER BY collection.content_type, collection.title
    `).bind(contentType ?? null, contentType ?? null).all<CollectionSummary>();
    return result.results;
  }

  async countDuas(): Promise<number> {
    const row = await this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      WHERE dataset.publication_status = 'active' AND record.content_type = 'dua'
    `).first<{ count: number }>();

    return row?.count ?? 0;
  }

  async listDuas(offset: number, limit: number): Promise<DuaSummary[]> {
    const result = await this.database.prepare(`
      SELECT COALESCE(record.logical_id, record.id) AS id, record.legacy_id, record.sequence, record.title,
             record.verification_status, COUNT(part.id) AS part_count
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      LEFT JOIN content_parts part ON part.record_id = record.id
      WHERE dataset.publication_status = 'active' AND record.content_type = 'dua'
      GROUP BY record.id
      ORDER BY record.sequence
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all<SummaryRow>();

    return result.results.map(toSummary);
  }

  async searchDuas(query: string, offset: number, limit: number): Promise<{ items: DuaSummary[]; total: number }> {
    const pattern = `%${escapeLike(query)}%`;
    const predicate = `
      dataset.publication_status = 'active'
      AND record.content_type = 'dua'
      AND (
        record.title LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1
          FROM content_parts search_part
          JOIN content_segments search_segment ON search_segment.part_id = search_part.id
          WHERE search_part.record_id = record.id
            AND search_segment.text LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )
    `;
    const [rows, countRow] = await Promise.all([
      this.database.prepare(`
        SELECT COALESCE(record.logical_id, record.id) AS id, record.legacy_id, record.sequence, record.title,
               record.verification_status, COUNT(part.id) AS part_count
        FROM content_records record
        JOIN dataset_versions dataset ON dataset.id = record.dataset_id
        LEFT JOIN content_parts part ON part.record_id = record.id
        WHERE ${predicate}
        GROUP BY record.id
        ORDER BY record.sequence
        LIMIT ? OFFSET ?
      `).bind(pattern, pattern, limit, offset).all<SummaryRow>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM content_records record
        JOIN dataset_versions dataset ON dataset.id = record.dataset_id
        WHERE ${predicate}
      `).bind(pattern, pattern).first<{ count: number }>(),
    ]);

    return { items: rows.results.map(toSummary), total: countRow?.count ?? 0 };
  }

  async findDuasByTitle(query: string, limit: number): Promise<DuaTitleMatch[]> {
    const result = await this.database.prepare(`
      SELECT COALESCE(record.logical_id, record.id) AS id, record.title, record.sequence
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      WHERE dataset.publication_status = 'active' AND record.content_type = 'dua'
      ORDER BY record.sequence
    `).all<{ id: string; title: string; sequence: number }>();
    const ranked = rankDuaTitles(result.results, query, limit);
    const duas = await Promise.all(ranked.map((match) => this.getDua(match.id)));
    return duas.flatMap((dua, index) => dua ? [{ ...dua, matchScore: ranked[index]!.score }] : []);
  }

  async getRandomDua(): Promise<Dua | undefined> {
    const row = await this.database.prepare(`
      SELECT COALESCE(record.logical_id, record.id) AS id
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      WHERE dataset.publication_status = 'active' AND record.content_type = 'dua'
      ORDER BY RANDOM()
      LIMIT 1
    `).first<{ id: string }>();

    return row ? this.getDua(row.id) : undefined;
  }

  async getDua(id: string): Promise<Dua | undefined> {
    const record = await this.database.prepare(`
      SELECT record.id AS physical_id, COALESCE(record.logical_id, record.id) AS id,
             record.legacy_id, record.sequence, record.title,
             record.verification_status,
             (SELECT COUNT(*) FROM content_parts part WHERE part.record_id = record.id) AS part_count
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      WHERE dataset.publication_status = 'active'
        AND record.content_type = 'dua'
        AND (record.id = ? OR record.logical_id = ? OR record.legacy_id = ?
          OR EXISTS (SELECT 1 FROM source_record_identities identity
            WHERE identity.record_id = record.id AND identity.provider_record_id = ?))
      LIMIT 1
    `).bind(id, id, id, id).first<SummaryRow & { physical_id: string }>();

    if (!record) return undefined;

    const segmentResult = await this.database.prepare(`
      SELECT part.position AS part_position, segment.position AS segment_position,
             segment.kind, segment.text
      FROM content_parts part
      LEFT JOIN content_segments segment ON segment.part_id = part.id
      WHERE part.record_id = ?
      ORDER BY part.position, segment.position
    `).bind(record.physical_id).all<SegmentRow>();

    const parts: ContentSegment[][] = Array.from({ length: record.part_count }, () => []);
    for (const segment of segmentResult.results) {
      if (segment.kind && segment.text !== null) {
        parts[segment.part_position - 1]!.push({ kind: segment.kind, text: segment.text });
      }
    }

    return { ...toSummary(record), parts };
  }

  async getDuaEvidence(id: string): Promise<RecordEvidence | undefined> {
    const record = await this.database.prepare(`
      SELECT record.id AS physicalId, COALESCE(record.logical_id, record.id) AS id,
             record.dataset_id AS datasetId
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      WHERE dataset.publication_status = 'active'
        AND record.content_type = 'dua'
        AND (record.id = ? OR record.logical_id = ? OR record.legacy_id = ?
          OR EXISTS (SELECT 1 FROM source_record_identities identity
            WHERE identity.record_id = record.id AND identity.provider_record_id = ?))
      LIMIT 1
    `).bind(id, id, id, id).first<{ physicalId: string; id: string; datasetId: string }>();
    if (!record) return undefined;

    const [dataset, collection, sources, datasetSources, taxonomy, verificationHistory, corrections] = await Promise.all([
      this.getCurrentDataset(),
      this.database.prepare(`
        SELECT collection.id, collection.title, collection.verification_status AS verificationStatus
        FROM record_placements placement
        JOIN collections collection ON collection.id = placement.collection_id
        WHERE placement.record_id = ?
      `).bind(record.physicalId).first<{ id: string; title: string; verificationStatus: string }>(),
      this.database.prepare(`
        SELECT source.id, source.title, source.publisher, source.edition, source.source_url AS sourceUrl,
               source.license_name AS licenseName, source.license_status AS licenseStatus,
               source.authenticity_status AS authenticityStatus, reference.reference_type AS referenceType,
               reference.locator, reference.verification_status AS verificationStatus
        FROM source_references reference
        JOIN source_materials source ON source.id = reference.source_id
        WHERE reference.record_id = ?
        ORDER BY reference.reference_type, reference.locator
      `).bind(record.physicalId).all<RecordEvidence['sources'][number]>(),
      this.database.prepare(`
        SELECT source.id, source.title, dataset_source.import_locator AS importLocator,
               source.license_status AS licenseStatus, source.authenticity_status AS authenticityStatus
        FROM dataset_sources dataset_source
        JOIN source_materials source ON source.id = dataset_source.source_id
        WHERE dataset_source.dataset_id = ?
        ORDER BY dataset_source.source_role, source.title
      `).bind(record.datasetId).all<RecordEvidence['datasetSources'][number]>(),
      this.database.prepare(`
        SELECT term.taxonomy_type AS type, term.slug, term.label, term.language_code AS languageCode
        FROM record_taxonomy assignment
        JOIN taxonomy_terms term ON term.id = assignment.term_id
        WHERE assignment.record_id = ?
        ORDER BY term.taxonomy_type, term.label
      `).bind(record.physicalId).all<RecordEvidence['taxonomy'][number]>(),
      this.database.prepare(`
        SELECT status, method, notes, reviewed_at AS reviewedAt
        FROM verification_records
        WHERE target_type = 'record' AND target_id = ?
        ORDER BY reviewed_at DESC
      `).bind(record.physicalId).all<RecordEvidence['verificationHistory'][number]>(),
      this.database.prepare(`
        SELECT field_path AS fieldPath, reason, created_at AS createdAt
        FROM correction_history WHERE record_id = ? ORDER BY created_at DESC
      `).bind(record.physicalId).all<RecordEvidence['corrections'][number]>(),
    ]);

    return {
      recordId: record.id,
      dataset,
      collection: collection ?? null,
      sources: sources.results,
      datasetSources: datasetSources.results,
      taxonomy: taxonomy.results,
      verificationHistory: verificationHistory.results,
      corrections: corrections.results,
    };
  }

  async countHadith(collection?: string): Promise<number> {
    const row = await this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      JOIN record_placements placement ON placement.record_id = record.id
      JOIN collections collection ON collection.id = placement.collection_id
      WHERE dataset.publication_status = 'active' AND record.content_type = 'hadith'
        AND (? IS NULL OR collection.slug = ?)
    `).bind(collection ?? null, collection ?? null).first<{ count: number }>();
    return row?.count ?? 0;
  }

  async listHadith(collection: string | undefined, offset: number, limit: number): Promise<HadithSummary[]> {
    const result = await this.database.prepare(`${hadithSummarySql()}
      WHERE dataset.publication_status = 'active' AND record.content_type = 'hadith'
        AND (? IS NULL OR collection.slug = ?)
      ORDER BY collection.title, record.sequence
      LIMIT ? OFFSET ?
    `).bind(collection ?? null, collection ?? null, limit, offset).all<HadithRow>();
    return result.results.map(toHadithSummary);
  }

  async searchHadith(query: string, collection: string | undefined, offset: number, limit: number): Promise<{ items: HadithSummary[]; total: number }> {
    const ftsQuery = toFtsQuery(query);
    const [rows, count] = await Promise.all([
      this.database.prepare(`${hadithSummarySql()}
        JOIN content_search_fts search ON search.logical_id = COALESCE(record.logical_id, record.id)
          AND search.dataset_id = record.dataset_id
        WHERE dataset.publication_status = 'active' AND record.content_type = 'hadith'
          AND content_search_fts MATCH ?
          AND (? IS NULL OR collection.slug = ?)
        ORDER BY bm25(content_search_fts), collection.title, record.sequence
        LIMIT ? OFFSET ?
      `).bind(ftsQuery, collection ?? null, collection ?? null, limit, offset).all<HadithRow>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count FROM content_search_fts search
        JOIN dataset_versions dataset ON dataset.id = search.dataset_id
        WHERE dataset.publication_status = 'active' AND search.content_type = 'hadith'
          AND content_search_fts MATCH ?
          AND (? IS NULL OR search.collection_slug = ?)
      `).bind(ftsQuery, collection ?? null, collection ?? null).first<{ count: number }>(),
    ]);
    return { items: rows.results.map(toHadithSummary), total: count?.count ?? 0 };
  }

  async getHadith(id: string): Promise<Hadith | undefined> {
    const row = await this.database.prepare(`${hadithSummarySql()}
      WHERE dataset.publication_status = 'active' AND record.content_type = 'hadith'
        AND (record.id = ? OR record.logical_id = ? OR record.legacy_id = ?
          OR EXISTS (SELECT 1 FROM source_record_identities identity
            WHERE identity.record_id = record.id AND identity.provider_record_id = ?))
      LIMIT 1
    `).bind(id, id, id, id).first<HadithRow & { physical_id: string }>();
    if (!row) return undefined;
    const [segments, references] = await Promise.all([
      this.database.prepare(`
        SELECT segment.kind, segment.text
        FROM content_parts part JOIN content_segments segment ON segment.part_id = part.id
        WHERE part.record_id = ? ORDER BY part.position, segment.position
      `).bind(row.physical_id).all<ContentSegment>(),
      this.database.prepare(`
        SELECT reference.reference_type AS type, reference.locator
        FROM source_references reference WHERE reference.record_id = ?
        ORDER BY reference.reference_type, reference.locator
      `).bind(row.physical_id).all<{ type: string; locator: string }>(),
    ]);
    return { ...toHadithSummary(row), segments: segments.results, references: references.results };
  }
}

function toSummary(row: SummaryRow): DuaSummary {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    sequence: row.sequence,
    title: row.title,
    partCount: row.part_count,
    verificationStatus: row.verification_status,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function hadithSummarySql() {
  return `
    SELECT record.id AS physical_id, COALESCE(record.logical_id, record.id) AS id,
           record.sequence, placement.source_number AS display_number, record.title,
           record.verification_status, collection.slug AS collection_slug,
           collection.title AS collection_title, book.book_number, book.title AS book_title,
           chapter.chapter_number, chapter.title AS chapter_title, metadata.narrator,
           COALESCE(grade.normalized_grade, grade.raw_grade, metadata.grade) AS grade,
           COALESCE(grade.authority, metadata.grading_authority) AS grading_authority
    FROM content_records record
    JOIN dataset_versions dataset ON dataset.id = record.dataset_id
    JOIN record_placements placement ON placement.record_id = record.id
    JOIN collections collection ON collection.id = placement.collection_id
    LEFT JOIN books book ON book.id = placement.book_id
    LEFT JOIN chapters chapter ON chapter.id = placement.chapter_id
    LEFT JOIN hadith_metadata metadata ON metadata.record_id = record.id
    LEFT JOIN hadith_grades grade ON grade.id = (
      SELECT candidate.id FROM hadith_grades candidate
      WHERE candidate.record_id = record.id ORDER BY candidate.id LIMIT 1
    )`;
}

function toHadithSummary(row: HadithRow): HadithSummary {
  return {
    id: row.id,
    sequence: row.sequence,
    displayNumber: row.display_number,
    title: row.title,
    collection: { slug: row.collection_slug, title: row.collection_title },
    book: row.book_title ? { number: row.book_number, title: row.book_title } : null,
    chapter: row.chapter_title ? { number: row.chapter_number, title: row.chapter_title } : null,
    narrator: row.narrator,
    grade: row.grade ? { value: row.grade, authority: row.grading_authority } : null,
    verificationStatus: row.verification_status,
  };
}

function toFtsQuery(value: string) {
  const terms = value.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  if (terms.length === 0) throw new Error('Search query must contain letters or numbers.');
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}
