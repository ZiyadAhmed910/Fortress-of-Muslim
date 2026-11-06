import Database from 'better-sqlite3';
import { getAuthTables } from 'better-auth/db';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth';

// Better Auth reads and writes its own tables, and each release can expect columns the last one did
// not. The identity database is built from hand-written migrations, so nothing else would notice a
// new expected column until sign-in failed in production. This asks Better Auth -- configured exactly
// as the platform configures it, every plugin included -- for every table and column it needs, and
// checks them against the database the migrations actually build.
//
// Added for the 1.7.0-rc.1 -> 1.7.18 upgrade (security: the release candidate pulled in vitest, and
// with it vite and tinypool, as runtime dependencies). Keep it for every upgrade after.

const env = {
  DEVELOPERS_URL: 'https://developers-test.fortressofmuslim.org',
  ADMIN_URL: 'https://admin-test.fortressofmuslim.org',
  AUTH_BASE_URL: 'https://auth-test.fortressofmuslim.org',
  API_AUDIENCE: 'https://api-test.fortressofmuslim.org',
  MCP_AUDIENCE: 'https://mcp-test.fortressofmuslim.org',
  BETTER_AUTH_SECRET: 'schema-check-secret-that-is-long-enough-0123456789',
  PLATFORM_ENV: 'test',
};

function identityDatabase() {
  const database = new Database(':memory:');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, name), 'utf8'));
  }
  return database;
}

describe('Better Auth against the identity schema', () => {
  const database = identityDatabase();
  // The migrated database itself, which Better Auth accepts as a SQLite connection.
  const auth = createAuth({ ...env, IDENTITY_DB: database } as unknown as Parameters<typeof createAuth>[0]);
  const tables = getAuthTables(auth.options);
  const columnsOf = (table: string) => new Set(
    (database.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((column) => column.name),
  );

  it('is actually checking the platform\'s tables, plugins included', () => {
    // An empty list would make the checks below pass without checking anything.
    const names = Object.values(tables).map((table) => table.modelName);
    for (const name of ['user', 'session', 'account', 'apikey', 'passkey', 'twoFactor', 'organization', 'oauthClient', 'deviceCode']) {
      expect(names, name).toContain(name);
    }
  });

  it('finds every table Better Auth needs', () => {
    const missing = Object.values(tables).map((table) => table.modelName).filter((name) => columnsOf(name).size === 0);
    expect(missing).toEqual([]);
  });

  it('finds every column Better Auth needs, in every table', () => {
    const missing: string[] = [];
    for (const table of Object.values(tables)) {
      const columns = columnsOf(table.modelName);
      for (const [key, field] of Object.entries(table.fields)) {
        const name = (field as { fieldName?: string }).fieldName ?? key;
        if (!columns.has(name)) missing.push(`${table.modelName}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
