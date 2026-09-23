import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tally } from '../../media/src/index';
import { mediaStats } from '../../auth/src/admin-plane';

// The media Worker writes media_daily_stats and the Admin console reads it back as the usage report
// for the audio's provider. Both sides are unit-tested against mocks in their own workspaces; this
// runs the real SQL of each against the real migrated schema, so a column renamed in one place and
// not the other fails here rather than as an empty report. See CLAUDE.md section 7.

function contentDatabase() {
  const database = new Database(':memory:');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, name), 'utf8'));
  }
  return database;
}

class Statement {
  constructor(readonly statement: Database.Statement, readonly parameters: unknown[] = []) {}
  bind(...parameters: unknown[]) { return new Statement(this.statement, parameters); }
  async all() { return { results: this.statement.all(...this.parameters) }; }
  async run() { this.statement.run(...this.parameters); return { success: true }; }
}

function d1(database: Database.Database) {
  return {
    prepare: (sql: string) => new Statement(database.prepare(sql)),
    batch: async (statements: Statement[]) => Promise.all(statements.map((statement) => statement.all())),
  } as unknown as D1Database;
}

const report = async (db: D1Database, query: string) => {
  const response = await mediaStats({ env: { CONTENT_DB: db } as never }, new URL(`https://auth.test/v1/admin/media-stats?${query}`));
  return { status: response.status, body: await response.json() as any };
};

describe('media usage stats against the real schema', () => {
  it('counts what the media Worker tallies, by day and by file', async () => {
    const db = d1(contentDatabase());
    const day1 = new Date('2026-09-20T08:00:00Z');
    const day2 = new Date('2026-09-21T23:59:00Z');
    await tally(db, 'duas/v1/dua-001/1.mp3', 'play', day1);
    await tally(db, 'duas/v1/dua-001/1.mp3', 'play', day1);
    await tally(db, 'duas/v1/dua-001/1.mp3', 'download', day1);
    await tally(db, 'duas/v1/dua-027/5-1.mp3', 'play', day2);

    const { status, body } = await report(db, 'from=2026-09-20&to=2026-09-21');
    expect(status).toBe(200);
    expect(body.meta).toMatchObject({ from: '2026-09-20', to: '2026-09-21', plays: 3, downloads: 1, files: 2 });
    expect(body.data.byDay).toEqual([
      { day: '2026-09-20', plays: 2, downloads: 1 },
      { day: '2026-09-21', plays: 1, downloads: 0 },
    ]);
    expect(body.data.byFile[0]).toEqual({ path: 'duas/v1/dua-001/1.mp3', plays: 2, downloads: 1 });
  });

  it('keeps to the dates asked for', async () => {
    const db = d1(contentDatabase());
    await tally(db, 'duas/v1/dua-001/1.mp3', 'play', new Date('2026-08-31T12:00:00Z'));
    await tally(db, 'duas/v1/dua-001/1.mp3', 'play', new Date('2026-09-01T12:00:00Z'));
    const { body } = await report(db, 'from=2026-09-01&to=2026-09-30');
    expect(body.meta.plays).toBe(1);
  });

  it('refuses dates it cannot read, backwards ranges and ranges over a year', async () => {
    const db = d1(contentDatabase());
    expect((await report(db, 'from=yesterday')).status).toBe(400);
    expect((await report(db, 'from=2026-09-10&to=2026-09-01')).status).toBe(400);
    expect((await report(db, 'from=2025-01-01&to=2026-09-01')).status).toBe(400);
  });

  it('rejects a kind the table does not allow', () => {
    const database = contentDatabase();
    expect(() => database.prepare("INSERT INTO media_daily_stats (day, path, kind, count) VALUES ('2026-09-01', 'x', 'stream', 1)").run()).toThrow();
  });
});
