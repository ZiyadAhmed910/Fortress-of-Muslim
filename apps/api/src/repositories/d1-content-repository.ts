import type { CollectionSummary, ContentSegment, Dua, DuaSummary, Hadith, HadithSummary } from '@fortress/contracts';
import { rankDuaTitles } from '../lib/fuzzy-title';
import type { ContentRepository, DatasetSummary, DuaTitleMatch, RagFilters, RagRecordMatch, RecordEvidence } from './content-repository';

type DatasetRow = {
  id: string;
  version_label: string;
  verification_status: DatasetSummary['verificationStatus'];
  record_count: number;
  canonical_hash: string | null;
  published_at: string;
};

type SummaryRow = {
  id: string;
  legacy_id: string;
  sequence: number;
  title: string;
  part_count: number;
  revision_number: number;
  published_at: string | null;
  workflow_state: DuaSummary['workflowState'];
  verification_status: DuaSummary['verificationStatus'];
  verified_by_external_id: string | null;
  verified_at: string | null;
};

type HadithRow = {
  id: string;
  sequence: number;
  display_number: string;
  title: string;
  revision_number: number;
  published_at: string | null;
  workflow_state: HadithSummary['workflowState'];
  verification_status: HadithSummary['verificationStatus'];
  verified_by_external_id: string | null;
  verified_at: string | null;
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
      SELECT id, version_label, verification_status, record_count, canonical_hash,
             COALESCE(published_at, created_at) AS published_at
      FROM canonical_dataset_versions
      WHERE publication_status = 'published'
      ORDER BY published_at DESC, created_at DESC
      LIMIT 1
    `).first<DatasetRow>();
    if (!row) throw new Error('No canonical dataset is published.');
    return {
      id: row.id,
      sourceName: 'Fortress Platform',
      sourceVersion: row.version_label,
      publicationStatus: 'active',
      verificationStatus: row.verification_status,
      recordCount: row.record_count,
      contentHash: row.canonical_hash ?? '',
      importedAt: row.published_at,
    };
  }

  async listCollections(contentType?: 'dua' | 'hadith'): Promise<CollectionSummary[]> {
    const result = await this.database.prepare(`
      SELECT collection.id, collection.slug, canonical.content_type AS contentType,
             collection.title, collection.title_arabic AS titleArabic,
             CASE WHEN SUM(CASE WHEN publication.verification_status = 'unverified' THEN 1 ELSE 0 END) > 0
               THEN 'pending' ELSE 'verified' END AS verificationStatus,
             COUNT(DISTINCT publication.canonical_id) AS recordCount,
             COUNT(DISTINCT metadata.book_id) AS bookCount,
             COUNT(DISTINCT metadata.chapter_id) AS chapterCount
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN revision_metadata metadata ON metadata.revision_id = publication.revision_id
      JOIN collections collection ON collection.id = metadata.collection_id
      WHERE (? IS NULL OR canonical.content_type = ?)
      GROUP BY collection.id
      ORDER BY canonical.content_type, collection.title
    `).bind(contentType ?? null, contentType ?? null).all<CollectionSummary>();
    return result.results;
  }

  async countDuas(): Promise<number> {
    return this.countRecords('dua');
  }

  async listDuas(offset: number, limit: number): Promise<DuaSummary[]> {
    const rows = await this.database.prepare(`${duaSummarySql()}
      WHERE canonical.content_type = 'dua'
      GROUP BY publication.canonical_id
      ORDER BY revision.sequence
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all<SummaryRow>();
    return rows.results.map(toDuaSummary);
  }

  async searchDuas(query: string, offset: number, limit: number): Promise<{ items: DuaSummary[]; total: number }> {
    const pattern = `%${escapeLike(query)}%`;
    const predicate = `
      canonical.content_type = 'dua'
      AND (
        revision.title LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM revision_parts search_part
          JOIN revision_segments search_segment ON search_segment.revision_part_id = search_part.id
          WHERE search_part.revision_id = revision.id
            AND search_segment.text LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )
    `;
    const [rows, count] = await Promise.all([
      this.database.prepare(`${duaSummarySql()}
        WHERE ${predicate}
        GROUP BY publication.canonical_id
        ORDER BY revision.sequence
        LIMIT ? OFFSET ?
      `).bind(pattern, pattern, limit, offset).all<SummaryRow>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM api_current_content publication
        JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
        JOIN content_revisions revision ON revision.id = publication.revision_id
        WHERE ${predicate}
      `).bind(pattern, pattern).first<{ count: number }>(),
    ]);
    return { items: rows.results.map(toDuaSummary), total: count?.count ?? 0 };
  }

  async searchForRag(query: string, limit: number, filters?: RagFilters): Promise<RagRecordMatch[]> {
    const result = await this.database.prepare(`
      SELECT search.canonical_id AS id, search.content_type AS contentType,
             search.title, search.body, search.narrator,
             bm25(canonical_search_fts) AS rank
      FROM canonical_search_fts search
      JOIN canonical_publications publication
        ON publication.canonical_id = search.canonical_id
       AND publication.revision_id = search.revision_id
      WHERE publication.publication_status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM canonical_withdrawals withdrawal
          WHERE withdrawal.canonical_id = search.canonical_id
        )
        AND canonical_search_fts MATCH ?
        AND (? IS NULL OR search.content_type = ?)
        AND (? IS NULL OR search.collection_slug = ?)
      ORDER BY bm25(canonical_search_fts), search.canonical_id
      LIMIT ?
    `).bind(
      toRagFtsQuery(query),
      filters?.contentType ?? null, filters?.contentType ?? null,
      filters?.collection ?? null, filters?.collection ?? null,
      limit,
    ).all<{
      id: string;
      contentType: 'dua' | 'hadith';
      title: string;
      body: string;
      narrator: string;
      rank: number;
    }>();
    return result.results.map((row) => ({
      id: row.id,
      contentType: row.contentType,
      score: lexicalRagScore(query, row),
    }));
  }

  // Ask's primary retrieval (searchForRag above) only ever considers published/verified content by
  // design. This is the supplementary fallback for when that comes up thin: a plain LIKE search
  // over api_current_content, which already includes unverified candidates. No FTS index needed --
  // canonical_search_fts only ever gets populated at publish time, and this is a low-frequency
  // fallback path, not the primary search, so a scan-based match is an acceptable tradeoff.
  async searchCurrentForRag(query: string, limit: number, filters?: RagFilters): Promise<RagRecordMatch[]> {
    const tokens = meaningfulTokens(query).slice(0, 6);
    if (tokens.length === 0) return [];
    const likeConditions = tokens.map(() => `(
      LOWER(revision.title) LIKE ? OR LOWER(COALESCE(metadata.narrator, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM revision_parts part
        JOIN revision_segments segment ON segment.revision_part_id = part.id
        WHERE part.revision_id = revision.id AND LOWER(segment.text) LIKE ?
      )
    )`).join(' OR ');
    const bindings = tokens.flatMap((token) => [`%${token}%`, `%${token}%`, `%${token}%`]);
    const result = await this.database.prepare(`
      SELECT publication.canonical_id AS id, canonical.content_type AS contentType,
             revision.title, COALESCE(metadata.narrator, '') AS narrator,
             COALESCE((
               SELECT GROUP_CONCAT(segment.text, ' ') FROM revision_parts part
               JOIN revision_segments segment ON segment.revision_part_id = part.id
               WHERE part.revision_id = revision.id
             ), '') AS body
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN content_revisions revision ON revision.id = publication.revision_id
      LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      WHERE (${likeConditions})
        AND (? IS NULL OR canonical.content_type = ?)
        AND (? IS NULL OR collection.slug = ?)
      LIMIT ?
    `).bind(
      ...bindings,
      filters?.contentType ?? null, filters?.contentType ?? null,
      filters?.collection ?? null, filters?.collection ?? null,
      limit,
    ).all<{
      id: string; contentType: 'dua' | 'hadith'; title: string; narrator: string; body: string;
    }>();
    return result.results.map((row) => ({
      id: row.id,
      contentType: row.contentType,
      score: lexicalRagScore(query, { title: row.title, body: row.body, narrator: row.narrator, rank: 0 }),
    }));
  }

  async findDuasByTitle(query: string, limit: number): Promise<DuaTitleMatch[]> {
    const result = await this.database.prepare(`
      SELECT publication.canonical_id AS id, revision.title, revision.sequence
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN content_revisions revision ON revision.id = publication.revision_id
      WHERE canonical.content_type = 'dua'
      ORDER BY revision.sequence
    `).all<{ id: string; title: string; sequence: number }>();
    const ranked = rankDuaTitles(result.results, query, limit);
    const duas = await Promise.all(ranked.map((match) => this.getDua(match.id)));
    return duas.flatMap((dua, index) => dua ? [{ ...dua, matchScore: ranked[index]!.score }] : []);
  }

  async getRandomDua(): Promise<Dua | undefined> {
    const row = await this.database.prepare(`
      SELECT publication.canonical_id AS id
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      WHERE canonical.content_type = 'dua'
      ORDER BY RANDOM() LIMIT 1
    `).first<{ id: string }>();
    return row ? this.getDua(row.id) : undefined;
  }

  async getDua(id: string): Promise<Dua | undefined> {
    return this.getDuaFromSource(id, 'api_current_content');
  }

  async getPublishedDua(id: string): Promise<Dua | undefined> {
    return this.getDuaFromSource(id, 'api_published_content');
  }

  private async getDuaFromSource(id: string, source: 'api_current_content' | 'api_published_content'): Promise<Dua | undefined> {
    const record = await this.database.prepare(`${duaSummarySql(source)}
      WHERE canonical.content_type = 'dua'
        AND (publication.canonical_id = ? OR revision.legacy_id = ?)
      GROUP BY publication.canonical_id
      LIMIT 1
    `).bind(id, id).first<SummaryRow>();
    if (!record) return undefined;

    const segments = await this.database.prepare(`
      SELECT part.position AS part_position, segment.position AS segment_position,
             segment.kind, segment.text
      FROM ${source} publication
      JOIN revision_parts part ON part.revision_id = publication.revision_id
      LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
      WHERE publication.canonical_id = ?
      ORDER BY part.position, segment.position
    `).bind(record.id).all<SegmentRow>();
    const parts: ContentSegment[][] = Array.from({ length: record.part_count }, () => []);
    for (const segment of segments.results) {
      if (segment.kind && segment.text !== null) {
        parts[segment.part_position - 1]!.push({ kind: segment.kind, text: segment.text });
      }
    }
    return { ...toDuaSummary(record), parts };
  }

  async getDuaEvidence(id: string): Promise<RecordEvidence | undefined> {
    const record = await this.database.prepare(`
      SELECT publication.canonical_id AS id, publication.revision_id AS revisionId,
             publication.revision_number AS revisionNumber, publication.published_at AS publishedAt,
             publication.workflow_state AS workflowState,
             publication.verification_status AS verificationStatus,
             publication.verified_by_external_id AS verifiedBy,
             publication.verified_at AS verifiedAt,
             publication.record_id AS recordId, revision.sequence,
             collection.id AS collectionId, collection.title AS collectionTitle
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN content_revisions revision ON revision.id = publication.revision_id
      LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      WHERE canonical.content_type = 'dua'
        AND (publication.canonical_id = ? OR revision.legacy_id = ?)
      LIMIT 1
    `).bind(id, id).first<{
      id: string;
      revisionId: string;
      revisionNumber: number;
      publishedAt: string | null;
      workflowState: string;
      verificationStatus: 'unverified' | 'verified';
      verifiedBy: string | null;
      verifiedAt: string | null;
      recordId: string;
      sequence: number;
      collectionId: string | null;
      collectionTitle: string | null;
    }>();
    if (!record) return undefined;

    const [references, taxonomy, verification, corrections] = await Promise.all([
      this.database.prepare(`
        SELECT id, reference_type AS referenceType, locator,
               verification_status AS verificationStatus
        FROM canonical_references
        WHERE canonical_id = ? AND revision_id = ?
        ORDER BY reference_type, locator
      `).bind(record.id, record.revisionId).all<RecordEvidence['references'][number]>(),
      this.database.prepare(`
        SELECT term.taxonomy_type AS type, term.slug, term.label,
               term.language_code AS languageCode
        FROM record_taxonomy assignment
        JOIN taxonomy_terms term ON term.id = assignment.term_id
        WHERE assignment.record_id = ?
        ORDER BY term.taxonomy_type, term.label
      `).bind(record.recordId).all<RecordEvidence['taxonomy'][number]>(),
      this.database.prepare(`
        SELECT CASE decision WHEN 'approved' THEN 'verified' ELSE 'rejected' END AS status,
               review_stage AS method, notes, decided_at AS reviewedAt
        FROM review_decisions WHERE revision_id = ?
        ORDER BY decided_at DESC
      `).bind(record.revisionId).all<RecordEvidence['verificationHistory'][number]>(),
      this.database.prepare(`
        SELECT field_path AS fieldPath, reason, created_at AS createdAt
        FROM correction_history WHERE record_id = ? ORDER BY created_at DESC
      `).bind(record.recordId).all<RecordEvidence['corrections'][number]>(),
    ]);
    return {
      recordId: record.id,
      canonicalUrl: canonicalDuaUrl(record.sequence),
      revisionNumber: record.revisionNumber,
      verificationStatus: record.verificationStatus,
      workflowState: record.workflowState,
      verifiedBy: record.verifiedBy,
      verifiedAt: record.verifiedAt,
      publishedAt: record.publishedAt,
      collection: record.collectionId
        ? { id: record.collectionId, title: record.collectionTitle ?? '', verificationStatus: record.verificationStatus }
        : null,
      references: references.results,
      taxonomy: taxonomy.results,
      verificationHistory: verification.results,
      corrections: corrections.results,
    };
  }

  async countHadith(collection?: string): Promise<number> {
    if (!collection) return this.countRecords('hadith');
    const row = await this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN revision_metadata metadata ON metadata.revision_id = publication.revision_id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      WHERE canonical.content_type = 'hadith'
        AND (? IS NULL OR collection.slug = ?)
    `).bind(collection ?? null, collection ?? null).first<{ count: number }>();
    return row?.count ?? 0;
  }

  async listHadith(collection: string | undefined, offset: number, limit: number): Promise<HadithSummary[]> {
    const rows = await this.database.prepare(`${hadithSummarySql()}
      WHERE canonical.content_type = 'hadith'
        AND (? IS NULL OR collection.slug = ?)
      ORDER BY collection.title, revision.sequence
      LIMIT ? OFFSET ?
    `).bind(collection ?? null, collection ?? null, limit, offset).all<HadithRow>();
    return rows.results.map(toHadithSummary);
  }

  async searchHadith(query: string, collection: string | undefined, offset: number, limit: number): Promise<{ items: HadithSummary[]; total: number }> {
    const pattern = `%${escapeLike(query)}%`;
    const predicate = `
      canonical.content_type = 'hadith'
      AND (
        revision.title LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR metadata.narrator LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR metadata.display_number LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM revision_parts search_part
          JOIN revision_segments search_segment ON search_segment.revision_part_id = search_part.id
          WHERE search_part.revision_id = revision.id
            AND search_segment.text LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )
    `;
    const [rows, count] = await Promise.all([
      this.database.prepare(`${hadithSummarySql()}
        WHERE ${predicate}
          AND (? IS NULL OR collection.slug = ?)
        ORDER BY collection.title, revision.sequence
        LIMIT ? OFFSET ?
      `).bind(pattern, pattern, pattern, pattern, collection ?? null, collection ?? null, limit, offset).all<HadithRow>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM api_current_content publication
        JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
        JOIN content_revisions revision ON revision.id = publication.revision_id
        JOIN revision_metadata metadata ON metadata.revision_id = revision.id
        JOIN collections collection ON collection.id = metadata.collection_id
        WHERE ${predicate}
          AND (? IS NULL OR collection.slug = ?)
      `).bind(pattern, pattern, pattern, pattern, collection ?? null, collection ?? null).first<{ count: number }>(),
    ]);
    return { items: rows.results.map(toHadithSummary), total: count?.count ?? 0 };
  }

  async getHadith(id: string): Promise<Hadith | undefined> {
    return this.getHadithFromSource(id, 'api_current_content');
  }

  async getPublishedHadith(id: string): Promise<Hadith | undefined> {
    return this.getHadithFromSource(id, 'api_published_content');
  }

  private async getHadithFromSource(id: string, source: 'api_current_content' | 'api_published_content'): Promise<Hadith | undefined> {
    const row = await this.database.prepare(`${hadithSummarySql(source)}
      WHERE canonical.content_type = 'hadith'
        AND (publication.canonical_id = ? OR revision.legacy_id = ?)
      LIMIT 1
    `).bind(id, id).first<HadithRow>();
    if (!row) return undefined;
    const [segments, references] = await Promise.all([
      this.database.prepare(`
        SELECT segment.kind, segment.text
        FROM ${source} publication
        JOIN revision_parts part ON part.revision_id = publication.revision_id
        JOIN revision_segments segment ON segment.revision_part_id = part.id
        WHERE publication.canonical_id = ?
        ORDER BY part.position, segment.position
      `).bind(row.id).all<ContentSegment>(),
      this.database.prepare(`
        SELECT reference_type AS type, locator
        FROM canonical_references
        WHERE canonical_id = ? AND revision_id = (
          SELECT revision_id FROM ${source}
          WHERE canonical_id = ?
        )
        ORDER BY reference_type, locator
      `).bind(row.id, row.id).all<{ type: string; locator: string }>(),
    ]);
    return { ...toHadithSummary(row), segments: segments.results, references: references.results };
  }

  async resolveHadithPath(collection: string, book: string, number: string): Promise<Hadith | undefined> {
    const row = await this.database.prepare(`
      SELECT publication.canonical_id AS id
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN revision_metadata metadata ON metadata.revision_id = publication.revision_id
      JOIN collections collection ON collection.id = metadata.collection_id
      LEFT JOIN books book ON book.id = metadata.book_id
      WHERE canonical.content_type = 'hadith'
        AND collection.slug = ?
        AND COALESCE(book.book_number, 'unassigned') = ?
        AND COALESCE(metadata.display_number, CAST((
          SELECT revision.sequence FROM content_revisions revision
          WHERE revision.id = publication.revision_id
        ) AS TEXT)) = ?
      LIMIT 1
    `).bind(collection, book, number).first<{ id: string }>();
    return row ? this.getHadith(row.id) : undefined;
  }

  // Backs Ask's exact-reference fast path (see rag-reference.ts) for things like "Bukhari 52" --
  // collections are editor-created with no fixed enum, so the hint is matched fuzzily in JS against
  // the small set of real hadith collections rather than hardcoding known collection names in SQL.
  async findHadithByReference(collectionHint: string, number: string): Promise<Hadith | undefined> {
    const collections = await this.database.prepare(`
      SELECT id, slug, title FROM collections WHERE content_type = 'hadith'
    `).all<{ id: string; slug: string; title: string }>();
    const collectionId = matchHadithCollection(collectionHint, collections.results);
    if (!collectionId) return undefined;
    const row = await this.database.prepare(`
      SELECT publication.canonical_id AS id
      FROM api_current_content publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN content_revisions revision ON revision.id = publication.revision_id
      JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      WHERE canonical.content_type = 'hadith'
        AND metadata.collection_id = ?
        AND (metadata.display_number = ? OR CAST(revision.sequence AS TEXT) = ?)
      ORDER BY CASE WHEN metadata.display_number = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).bind(collectionId, number, number, number).first<{ id: string }>();
    return row ? this.getHadith(row.id) : undefined;
  }

  private async countRecords(contentType: 'dua' | 'hadith') {
    const row = await this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM canonical_records
      WHERE content_type = ?
        AND NOT EXISTS (
          SELECT 1 FROM canonical_withdrawals withdrawal
          WHERE withdrawal.canonical_id = canonical_records.canonical_id
        )
    `).bind(contentType).first<{ count: number }>();
    return row?.count ?? 0;
  }
}

function lexicalRagScore(
  query: string,
  row: { title: string; body: string; narrator: string; rank: number },
) {
  const queryTokens = meaningfulTokens(query);
  if (queryTokens.length === 0) return 0.5;
  const title = normalizeSearchText(row.title);
  const body = normalizeSearchText(`${row.body} ${row.narrator}`);
  const titleMatches = queryTokens.filter((token) => title.includes(token)).length;
  const bodyMatches = queryTokens.filter((token) => body.includes(token)).length;
  const titleCoverage = titleMatches / queryTokens.length;
  const bodyCoverage = bodyMatches / queryTokens.length;
  const phrase = queryTokens.join(' ');
  const phraseBonus = phrase.length > 3 && title.includes(phrase) ? 0.12 : 0;
  const rankBonus = Math.min(0.05, Math.log1p(Math.abs(Number(row.rank) || 0)) / 20);
  return Math.min(0.99, 0.42 + (titleCoverage * 0.38) + (bodyCoverage * 0.12) + phraseBonus + rankBonus);
}

function meaningfulTokens(value: string) {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'do', 'for', 'i', 'in', 'is', 'it', 'of', 'on',
    'say', 'should', 'the', 'to', 'what', 'when',
  ]);
  return normalizeSearchText(value).split(' ').filter((token) => token.length > 1 && !stopWords.has(token));
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase().normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function duaSummarySql(source = 'api_current_content') {
  return `
    SELECT publication.canonical_id AS id, revision.legacy_id, revision.sequence, revision.title,
           publication.revision_number, publication.published_at,
           publication.workflow_state, publication.verification_status,
           publication.verified_by_external_id, publication.verified_at,
           COUNT(part.id) AS part_count
    FROM ${source} publication
    JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
    JOIN content_revisions revision ON revision.id = publication.revision_id
    LEFT JOIN revision_parts part ON part.revision_id = revision.id`;
}

function hadithSummarySql(source = 'api_current_content') {
  return `
    SELECT publication.canonical_id AS id, revision.sequence,
           COALESCE(metadata.display_number, CAST(revision.sequence AS TEXT)) AS display_number,
           revision.title, publication.revision_number, publication.published_at,
           publication.workflow_state, publication.verification_status,
           publication.verified_by_external_id, publication.verified_at,
           collection.slug AS collection_slug, collection.title AS collection_title,
           book.book_number, book.title AS book_title,
           chapter.chapter_number, chapter.title AS chapter_title,
           metadata.narrator, metadata.grade, metadata.grading_authority
    FROM ${source} publication
    JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
    JOIN content_revisions revision ON revision.id = publication.revision_id
    JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN books book ON book.id = metadata.book_id
    LEFT JOIN chapters chapter ON chapter.id = metadata.chapter_id`;
}

function toDuaSummary(row: SummaryRow): DuaSummary {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    sequence: row.sequence,
    title: row.title,
    partCount: row.part_count,
    verificationStatus: row.verification_status,
    workflowState: row.workflow_state,
    verifiedBy: row.verified_by_external_id,
    verifiedAt: row.verified_at,
    revisionNumber: row.revision_number,
    publishedAt: row.published_at,
    canonicalUrl: canonicalDuaUrl(row.sequence),
  };
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
    workflowState: row.workflow_state,
    verifiedBy: row.verified_by_external_id,
    verifiedAt: row.verified_at,
    revisionNumber: row.revision_number,
    publishedAt: row.published_at,
    canonicalUrl: canonicalHadithUrl(row),
  };
}

function canonicalDuaUrl(sequence: number) {
  return `https://fortressofmuslim.org/hisn/chapter${sequence}`;
}

function canonicalHadithUrl(row: HadithRow) {
  const collection = encodeURIComponent(row.collection_slug);
  const book = encodeURIComponent(row.book_number || 'unassigned');
  const number = encodeURIComponent(row.display_number);
  return `https://fortressofmuslim.org/${collection}/book${book}/${number}`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// Editors title collections inconsistently ("Bukhari", "Sahih al-Bukhari", "Sahih Bukhari"), so an
// exact-reference hint like "Bukhari" needs to match a collection titled "Sahih al-Bukhari" without
// a hardcoded name list. Strip common honorific/connector words and non-letters from both sides,
// then require an exact or substring match -- deliberately conservative (no fuzzy/edit-distance
// matching) so an ambiguous hint returns no match rather than the wrong collection.
const COLLECTION_NAME_NOISE_WORDS = new Set([
  'sahih', 'al', 'el', 'at', 'an', 'jami', 'sunan', 'musnad', 'imam', 'collection', 'hadith',
]);

function normalizeCollectionText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !COLLECTION_NAME_NOISE_WORDS.has(token))
    .join('');
}

function matchHadithCollection(
  hint: string,
  collections: Array<{ id: string; slug: string; title: string }>,
): string | undefined {
  const normalizedHint = normalizeCollectionText(hint);
  if (normalizedHint.length < 3) return undefined;
  let best: { id: string; score: number } | undefined;
  for (const collection of collections) {
    for (const candidate of [normalizeCollectionText(collection.slug), normalizeCollectionText(collection.title)]) {
      if (!candidate) continue;
      const score = candidate === normalizedHint ? 2
        : candidate.includes(normalizedHint) || normalizedHint.includes(candidate) ? 1
        : 0;
      if (score > 0 && (!best || score > best.score)) best = { id: collection.id, score };
    }
  }
  return best?.id;
}

// Arabic diacritics (tashkeel) and tatweel don't change a word's meaning or spelling for search
// purposes, and the same word is commonly written with different alef-hamza forms (أ إ آ) across
// sources -- without normalizing both the indexed text (see the matching SQL-side normalization
// applied wherever canonical_search_fts is populated) and the search query the same way, FTS5's
// exact-token matching means a diacritic or alef-form mismatch alone silently returns nothing.
// Verified empirically, not assumed: FTS5's default tokenizer does not normalize Arabic
// diacritics on its own (a word stored with a diacritic does not match a query without one).
function normalizeArabic(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/g, '').replace(/[آأإٱ]/g, 'ا');
}

function toFtsQuery(value: string) {
  const terms = normalizeArabic(value).match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  if (terms.length === 0) throw new Error('Search requires letters or numbers.');
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ');
}

function toRagFtsQuery(value: string) {
  const stopWords = new Set([
    'about', 'after', 'before', 'could', 'does', 'from', 'have', 'islam', 'please',
    'say', 'should', 'sources', 'teach', 'that', 'their', 'there', 'these', 'this',
    'what', 'when', 'where', 'which', 'with', 'would',
  ]);
  const terms = normalizeArabic(value).toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((term) => term.length >= 3 && !stopWords.has(term))
    .sort((left, right) => right.length - left.length)
    .slice(0, 8) ?? [];
  if (terms.length === 0) return toFtsQuery(value);
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}
