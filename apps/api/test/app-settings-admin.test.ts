import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appSettings, updateAppSettings } from '../../auth/src/admin-plane';

// The Admin Console's audio-source switch (apps/auth), against the real migrated content schema.
// Every change is audited; anything but the two sources is refused before it reaches the database.

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
  async run() { const result = this.statement.run(...this.parameters); return { success: true, meta: { changes: result.changes } }; }
}
const d1 = (database: Database.Database) => ({ prepare: (sql: string) => new Statement(database.prepare(sql)) }) as unknown as D1Database;

function admin() {
  const audits: unknown[][] = [];
  const identity = { prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { audits.push(values); } }) }) } as unknown as D1Database;
  const database = contentDatabase();
  const context = {
    env: { CONTENT_DB: d1(database), IDENTITY_DB: identity },
    user: { id: 'admin-user' },
    grant: { role: 'admin' },
    requestId: 'request-1',
  } as never;
  return { context, audits, database };
}

describe('the audio-source switch', () => {
  it('starts on the platform\'s own media host', async () => {
    const { context } = admin();
    const body = await (await appSettings(context)).json() as { data: { settings: { audioSource: string }; audioSources: string[] } };
    expect(body.data.settings.audioSource).toBe('own');
    expect(body.data.audioSources).toEqual(['own', 'external']);
  });

  it('switches, records who did it, and audits the change', async () => {
    const { context, audits, database } = admin();
    const response = await updateAppSettings(context, { audioSource: 'external' });
    expect(response.status).toBe(200);
    expect(database.prepare('SELECT audio_source AS source, updated_by_external_id AS by FROM app_settings').get()).toEqual({ source: 'external', by: 'admin-user' });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toContain('app.settings_changed');
    expect(String(audits[0]?.at(-1))).toContain('"audioSource":"external"');
  });

  it('refuses anything but the two sources, and audits nothing', async () => {
    const { context, audits, database } = admin();
    for (const audioSource of ['somewhere', '', undefined, 1]) {
      expect((await updateAppSettings(context, { audioSource })).status).toBe(400);
    }
    expect(audits).toHaveLength(0);
    expect(database.prepare('SELECT audio_source AS source FROM app_settings').get()).toEqual({ source: 'own' });
  });
});
