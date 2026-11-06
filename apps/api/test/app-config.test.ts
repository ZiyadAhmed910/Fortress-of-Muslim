import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

// GET /v1/app-config is what the PWA reads once per launch to learn, among other things, where Quran
// recitation comes from. It runs here against the real migrated schema (CLAUDE.md section 7): the
// default must be the owner's own media host, and the route must never hand the app an error it has
// to deal with.

function contentDatabase() {
  const database = new Database(':memory:');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, name), 'utf8'));
  }
  return database;
}

class Statement {
  constructor(private readonly statement: Database.Statement, private readonly parameters: unknown[] = []) {}
  bind(...parameters: unknown[]) { return new Statement(this.statement, parameters); }
  async first<T>() { return (this.statement.get(...this.parameters) as T | undefined) ?? null; }
  async all<T>() { return { results: this.statement.all(...this.parameters) as T[] }; }
  async run() { this.statement.run(...this.parameters); return { success: true }; }
}
const d1 = (database: Database.Database) => ({ prepare: (sql: string) => new Statement(database.prepare(sql)) }) as unknown as D1Database;

const app = createApp(() => ({ getCurrentDataset: async () => ({ id: 'dataset.test' }) }) as never);
const envWith = (CONTENT_DB: unknown) => ({
  PLATFORM_ENV: 'test',
  CONTENT_DB,
  AUTH: { getServiceState: async () => ({ serviceKey: 'api', status: 'active', message: '', enforcement: 'worker' }) },
}) as never;

const read = async (CONTENT_DB: unknown) => {
  const response = await app.request('/v1/app-config', {}, envWith(CONTENT_DB));
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() as { data: { audioSource: string } } };
};

describe('GET /v1/app-config', () => {
  it('defaults to the platform\'s own media host', async () => {
    const { status, body, cache } = await read(d1(contentDatabase()));
    expect(status).toBe(200);
    expect(body.data).toEqual({ audioSource: 'own' });
    expect(cache).toBe('public, max-age=300');
  });

  it('reports the external source once the Admin Console chooses it', async () => {
    const database = contentDatabase();
    database.prepare("UPDATE app_settings SET audio_source = 'external' WHERE id = 1").run();
    expect((await read(d1(database))).body.data.audioSource).toBe('external');
  });

  it('only ever stores one of the two sources', () => {
    const database = contentDatabase();
    expect(() => database.prepare("UPDATE app_settings SET audio_source = 'somewhere' WHERE id = 1").run()).toThrow();
    expect(() => database.prepare("INSERT INTO app_settings (id) VALUES (2)").run()).toThrow();
  });

  it('answers with the default rather than an error if the setting cannot be read', async () => {
    const broken = { prepare: () => { throw new Error('D1 down'); } };
    const { status, body } = await read(broken);
    expect(status).toBe(200);
    expect(body.data.audioSource).toBe('own');
  });
});
