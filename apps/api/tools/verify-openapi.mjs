import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const document = parse(await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8'));
const requiredPaths = [
  '/datasets/current',
  '/duas',
  '/duas/search',
  '/duas/random',
  '/duas/{id}',
  '/duas/{id}/parts',
  '/duas/{id}/parts/{position}',
  '/queries/{id}',
];

if (document.openapi !== '3.0.3') throw new Error('OpenAPI version must remain 3.0.3.');
if (document.info?.['x-platform-version'] !== '0.8.1') {
  throw new Error('OpenAPI platform version is not synchronized with the release.');
}
if (!document.components?.securitySchemes?.fortressApiKey || !document.components?.securitySchemes?.fortressOAuth) {
  throw new Error('OpenAPI must describe both Fortress API key and OAuth security.');
}

for (const path of requiredPaths) {
  if (!document.paths?.[path]?.get) throw new Error(`OpenAPI GET operation is missing: ${path}`);
}

console.log(`Verified OpenAPI document with ${requiredPaths.length} public read paths.`);
