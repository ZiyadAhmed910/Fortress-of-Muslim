import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// 0022 publishes 14,357 hadith nobody has verified into the corpus Ask answers from. Two things
// have to hold for that to be defensible, and both are tested here: the records must carry their
// real verification status all the way through, and the previous dataset must survive so a
// rollback is one Admin Console action rather than a restore.
const MIGRATIONS = resolve(__dirname, '../migrations');
const HADITH_MIGRATION = '0022_publish_hadith_corpus.sql';
const VECTOR_DIMENSIONS = 1024;
const PAID_INCLUDED_DIMENSIONS = 10_000_000;

const SEED_BEFORE_0006 = `
  INSERT INTO dataset_versions (
    id, source_name, source_version, publication_status, verification_status,
    record_count, content_hash, imported_at
  ) VALUES (
    'dataset.candidate.overlap', 'Candidate overlap test', '1',
    'deprecated', 'pending', 1, 'overlap-hash', '2026-07-22T00:00:00.000Z'
  );
  INSERT INTO content_records (
    id, dataset_id, content_type, legacy_id, sequence, title,
    verification_status, created_at, updated_at, logical_id
  ) VALUES (
    'candidate.overlap.dua.1', 'dataset.candidate.overlap', 'dua', 'candidate-dua-1',
    1, 'Overlapping candidate revision', 'pending',
    '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', 'dua.hisn.001'
  );
  INSERT INTO content_parts (id, record_id, position)
    VALUES ('candidate.overlap.dua.1.part.1', 'candidate.overlap.dua.1', 1);
  INSERT INTO content_segments (
    id, part_id, position, kind, language_code, script_code, text
  ) VALUES (
    'candidate.overlap.dua.1.part.1.segment.1',
    'candidate.overlap.dua.1.part.1', 1, 'translation', 'en', 'Latn',
    'Candidate overlap verification text.'
  );
`;

/** A hadith record as the platform holds them today: current, unverified, unpublished. */
function seedHadith(
  database: Database.Database,
  slug: string,
  number: number,
  narrator: string,
  body: string,
) {
  const id = `hadith.${slug}.${number}`;
  const revision = `revision.${id}.1`;
  const record = `record.${id}`;
  const sequence = number + 100 + slug.length * 1000;
  database.exec(`
    INSERT INTO content_records (
      id, dataset_id, content_type, legacy_id, sequence, title,
      verification_status, created_at, updated_at, logical_id
    ) VALUES (
      '${record}', 'dataset.candidate.overlap', 'hadith', '${slug}-${number}', ${sequence},
      '${slug} ${number}', 'pending', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', '${id}'
    );
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES ('${id}', 'hadith', '${revision}');
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, legacy_id, sequence, title)
      VALUES ('${revision}', '${id}', '${record}', 1, '${slug}-${number}', ${sequence}, '${slug} ${number}');
    INSERT INTO revision_metadata (revision_id, collection_id, book_id, narrator)
      VALUES ('${revision}', 'collection.sunnah.${slug}', 'book.sunnah.${slug}.1', '${narrator}');
    INSERT INTO revision_parts (id, revision_id, position) VALUES ('${revision}.part.1', '${revision}', 1);
    INSERT INTO revision_segments (id, revision_part_id, position, kind, language_code, script_code, text)
      VALUES ('${revision}.part.1.segment.1', '${revision}.part.1', 1, 'translation', 'en', 'Latn', '${body}');
    INSERT INTO editorial_record_state (canonical_id, revision_id, workflow_state)
      VALUES ('${id}', '${revision}', 'pending_review');
  `);
}

let db: Database.Database;

function databaseBefore0022() {
  const database = new Database(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files.filter((name) => name < HADITH_MIGRATION)) {
    if (file === '0006_canonical_editorial.sql') database.exec(SEED_BEFORE_0006);
    database.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
  for (const [slug, title] of [['muslim', 'Sahih Muslim'], ['bukhari', 'Sahih al-Bukhari'], ['tirmidhi', 'Jami at-Tirmidhi']]) {
    database.exec(`
      INSERT OR IGNORE INTO collections (id, slug, content_type, title, default_language_code, verification_status)
        VALUES ('collection.sunnah.${slug}', '${slug}', 'hadith', '${title}', 'en', 'pending');
      INSERT OR IGNORE INTO books (id, collection_id, book_number, title, position)
        VALUES ('book.sunnah.${slug}.1', 'collection.sunnah.${slug}', '1', 'The first book', 1);
    `);
  }
  // All three collections, because 0022 publishes the whole corpus rather than one collection.
  seedHadith(database, 'muslim', 1, 'Narrated Umar bin Al-Khattab:', 'Actions are judged by intentions.');
  seedHadith(database, 'muslim', 2, 'Narrated Abu Hurairah:', 'Whoever believes in Allah should speak good or keep silent.');
  seedHadith(database, 'bukhari', 1, 'Narrated Aisha:', 'The most beloved deeds are those done consistently.');
  seedHadith(database, 'tirmidhi', 1, 'Narrated Ibn Umar:', 'Prayer is not accepted without purification.');
  // One withdrawn record: taken out of public service, and it must stay out.
  seedHadith(database, 'muslim', 4, 'Narrated Anas:', 'A record that was withdrawn from service.');
  database.exec("INSERT INTO canonical_withdrawals (canonical_id, reason) VALUES ('hadith.muslim.4', 'Withdrawn before 0022.')");
  return database;
}

beforeAll(() => {
  db = databaseBefore0022();
  // CR LF: what a Windows checkout hands to `wrangler d1 migrations apply`.
  db.exec(readFileSync(resolve(MIGRATIONS, HADITH_MIGRATION), 'utf8').replace(/\r?\n/g, '\r\n'));
});

const one = <T>(sql: string, ...binds: unknown[]) => db.prepare(sql).get(...binds) as T;

describe('migration 0022: Sahih Muslim enters the Ask corpus', () => {
  it('publishes every collection that was sitting unpublished, not just one', () => {
    const published = db.prepare(`
      SELECT collection.slug AS slug, COUNT(*) AS n
      FROM canonical_publications publication
      JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
      JOIN revision_metadata metadata ON metadata.revision_id = publication.revision_id
      JOIN collections collection ON collection.id = metadata.collection_id
      WHERE canonical.content_type = 'hadith' AND publication.publication_status = 'published'
      GROUP BY collection.slug ORDER BY collection.slug
    `).all() as Array<{ slug: string; n: number }>;
    expect(published).toEqual([
      { slug: 'bukhari', n: 1 },
      { slug: 'muslim', n: 2 },
      { slug: 'tirmidhi', n: 1 },
    ]);
  });

  it('leaves a withdrawn record out of it', () => {
    // Withdrawal is how a record leaves public service without deleting its history. Publishing a
    // collection wholesale must not quietly undo one.
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM canonical_publications WHERE canonical_id = 'hadith.muslim.4'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM canonical_search_fts WHERE canonical_id = 'hadith.muslim.4'").n).toBe(0);
  });

  it('records the dataset as unverified, because that is what it is', () => {
    // The one thing this migration must not do is launder unverified content into something that
    // reads as reviewed.
    const dataset = one<{ status: string; verification: string }>(`
      SELECT publication_status AS status, verification_status AS verification
      FROM canonical_dataset_versions WHERE id = 'canonical.hadith-corpus.2026-09-13'
    `);
    expect(dataset).toEqual({ status: 'published', verification: 'pending' });
  });

  it('serves every published hadith as unverified, which is what it is', () => {
    // This is the whole basis for publishing unreviewed content: the API says so on every record.
    // Verification is derived from editorial_record_state, and this migration does not touch it --
    // publishing a record and reviewing a record stay separate acts.
    const served = db.prepare(`
      SELECT canonical_id AS id, verification_status AS verification, workflow_state AS workflow,
             published_at AS publishedAt
      FROM api_current_content WHERE canonical_id LIKE 'hadith.muslim.%'
    `).all() as Array<{ id: string; verification: string; workflow: string; publishedAt: string | null }>;
    // Two, not three: the withdrawn record is absent from every public view by design.
    expect(served.map((row) => row.id)).toEqual(['hadith.muslim.1', 'hadith.muslim.2']);
    expect(served.every((row) => row.verification === 'unverified')).toBe(true);
    expect(served.every((row) => row.workflow === 'pending_review')).toBe(true);
    // Published, and still unverified -- both facts travel together to the reader.
    expect(served.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it('supersedes the previous dataset instead of destroying it, so a rollback is one action', () => {
    const previous = db.prepare(`
      SELECT id, publication_status AS status FROM canonical_dataset_versions
      WHERE id != 'canonical.hadith-corpus.2026-09-13'
    `).all() as Array<{ id: string; status: string }>;
    expect(previous.length).toBeGreaterThan(0);
    expect(previous.every((row) => row.status === 'superseded')).toBe(true);
    // Its membership snapshot has to survive too -- that is what a rollback restores from.
    const snapshots = one<{ n: number }>(`
      SELECT COUNT(DISTINCT dataset_version_id) AS n FROM canonical_dataset_items
    `);
    expect(snapshots.n).toBeGreaterThan(1);
  });

  it('finds a hadith by its words and by its narrator', () => {
    const find = (term: string) => db.prepare(
      'SELECT canonical_id FROM canonical_search_fts WHERE canonical_search_fts MATCH ?',
    ).all(term) as Array<{ canonical_id: string }>;
    expect(find('"intentions"').map((row) => row.canonical_id)).toEqual(['hadith.muslim.1']);
    expect(find('narrator: "Hurairah"').map((row) => row.canonical_id)).toEqual(['hadith.muslim.2']);
  });

  it('keeps the duas searchable alongside the hadith', () => {
    // 0022 rebuilds only the hadith rows; the dua rows carry the aliases 0020 put there and must
    // not be collateral damage.
    const duaRows = one<{ n: number }>("SELECT COUNT(*) AS n FROM canonical_search_fts WHERE content_type = 'dua'");
    expect(duaRows.n).toBeGreaterThan(0);
  });

  it('queues the new dataset for embedding, counting every record in it', () => {
    const state = one<{ status: string; expected: number; indexed: number }>(`
      SELECT status, expected_count AS expected, indexed_count AS indexed
      FROM rag_index_state WHERE dataset_version_id = 'canonical.hadith-corpus.2026-09-13'
    `);
    expect(state.status).toBe('pending');
    expect(state.indexed).toBe(0);
    const members = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM canonical_dataset_items WHERE dataset_version_id = 'canonical.hadith-corpus.2026-09-13'",
    );
    expect(state.expected).toBe(members.n);
  });

  it('costs what a paid plan absorbs at the real corpus size', () => {
    // 14,625 records at 1,024 dimensions is ~14.98M stored dimensions against the 10M the paid plan
    // includes, so about 5M is billable at $0.05 per 100M -- a quarter of a cent a month. A
    // production index later needs its own copy, which doubles that and changes nothing.
    const corpus = (14_357 + 268) * VECTOR_DIMENSIONS;
    const billable = Math.max(corpus - PAID_INCLUDED_DIMENSIONS, 0);
    expect(billable / 1e8 * 0.05).toBeLessThan(0.01);
    // The free allowance was 5M, which is why this used to be one collection.
    expect(corpus).toBeGreaterThan(5_000_000);
  });
});
