import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const document = parse(await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8'));
const requiredPaths = [
  '/datasets/current',
  '/duas',
  '/duas/search',
  '/duas/random',
  '/duas/{id}',
  '/duas/{id}/evidence',
  '/duas/{id}/parts',
  '/duas/{id}/parts/{position}',
  '/collections',
  '/hadith',
  '/hadith/search',
  '/hadith/{id}',
  '/ask',
  '/queries/{id}',
];

if (document.openapi !== '3.0.3') throw new Error('OpenAPI version must remain 3.0.3.');
if (document.info?.['x-platform-version'] !== '0.16.0') {
  throw new Error('OpenAPI platform version is not synchronized with the release.');
}
if (!document.components?.securitySchemes?.fortressApiKey || !document.components?.securitySchemes?.fortressOAuth) {
  throw new Error('OpenAPI must describe both Fortress API key and OAuth security.');
}
for (const header of ['RequestId', 'PlatformVersion', 'ServerTiming', 'DatasetVersion']) {
  if (!document.components?.headers?.[header]) throw new Error(`OpenAPI operational header is missing: ${header}`);
}

for (const path of requiredPaths) {
  const method = path === '/ask' ? 'post' : 'get';
  if (!document.paths?.[path]?.[method]) throw new Error(`OpenAPI ${method.toUpperCase()} operation is missing: ${path}`);
}
if (document.security) throw new Error('Public read endpoints must not inherit global authentication.');
if (!document.paths?.['/queries/{id}']?.get?.security) throw new Error('Owner-scoped named queries must remain authenticated.');

console.log(`Verified OpenAPI document with ${requiredPaths.length - 1} public operations and one protected named-query path.`);
