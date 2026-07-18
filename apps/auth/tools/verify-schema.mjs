import { readFile } from 'node:fs/promises';

const identity = await readFile(new URL('../migrations/0001_identity.sql', import.meta.url), 'utf8');
const control = await readFile(new URL('../migrations/0002_control_plane.sql', import.meta.url), 'utf8');
const consoleMigration = await readFile(new URL('../migrations/0003_developer_console.sql', import.meta.url), 'utf8');

for (const table of ['user', 'session', 'organization', 'apikey', 'oauthClient', 'oauthAccessToken', 'oauthRefreshToken']) {
  if (!identity.includes(`create table "${table}"`)) throw new Error(`Identity migration is missing ${table}.`);
}

for (const table of ['developer_profiles', 'access_requests', 'mcp_server_registrations', 'mcp_tool_definitions', 'usage_events', 'audit_events']) {
  if (!control.includes(`CREATE TABLE ${table}`)) throw new Error(`Control-plane migration is missing ${table}.`);
}

for (const table of ['deviceCode', 'device_registrations', 'named_queries']) {
  const declaration = table === 'deviceCode' ? `CREATE TABLE "${table}"` : `CREATE TABLE ${table}`;
  if (!consoleMigration.includes(declaration)) throw new Error(`Developer Console migration is missing ${table}.`);
}

console.log('Verified identity and control-plane migrations.');
