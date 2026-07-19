import type { ContentSegment, Dua, DuaSummary } from '@fortress/contracts';
import { rankDuaTitles } from '../lib/fuzzy-title';
import type { ContentRepository, DatasetSummary, DuaTitleMatch } from './content-repository';

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
      SELECT record.id, record.legacy_id, record.sequence, record.title,
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
        SELECT record.id, record.legacy_id, record.sequence, record.title,
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
      SELECT record.id, record.title, record.sequence
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
      SELECT record.id
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
      SELECT record.id, record.legacy_id, record.sequence, record.title,
             record.verification_status,
             (SELECT COUNT(*) FROM content_parts part WHERE part.record_id = record.id) AS part_count
      FROM content_records record
      JOIN dataset_versions dataset ON dataset.id = record.dataset_id
      WHERE dataset.publication_status = 'active'
        AND record.content_type = 'dua'
        AND (record.id = ? OR record.legacy_id = ?)
      LIMIT 1
    `).bind(id, id).first<SummaryRow>();

    if (!record) return undefined;

    const segmentResult = await this.database.prepare(`
      SELECT part.position AS part_position, segment.position AS segment_position,
             segment.kind, segment.text
      FROM content_parts part
      LEFT JOIN content_segments segment ON segment.part_id = part.id
      WHERE part.record_id = ?
      ORDER BY part.position, segment.position
    `).bind(record.id).all<SegmentRow>();

    const parts: ContentSegment[][] = Array.from({ length: record.part_count }, () => []);
    for (const segment of segmentResult.results) {
      if (segment.kind && segment.text !== null) {
        parts[segment.part_position - 1]!.push({ kind: segment.kind, text: segment.text });
      }
    }

    return { ...toSummary(record), parts };
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
