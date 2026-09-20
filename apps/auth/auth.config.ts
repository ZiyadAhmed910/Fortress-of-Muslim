import { createAuth } from './src/auth';
import Database from 'better-sqlite3';

// Better Auth's CLI needs a concrete SQLite driver while deriving the D1 SQL.
const schemaDatabase = new Database(':memory:') as unknown as D1Database;

export const auth = createAuth({
  IDENTITY_DB: schemaDatabase,
  PLATFORM_ENV: 'test',
  AUTH_BASE_URL: 'http://localhost:8788',
  DEVELOPERS_URL: 'http://localhost:8789',
  ADMIN_URL: 'http://localhost:8790',
  API_AUDIENCE: 'http://localhost:8787',
  MCP_AUDIENCE: 'http://localhost:8791',
  BETTER_AUTH_SECRET: 'local-schema-generation-secret-at-least-32-characters',
});

export default auth;
