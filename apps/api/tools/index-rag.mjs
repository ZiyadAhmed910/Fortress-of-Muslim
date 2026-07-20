import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const environment = process.argv[2];
if (!['test', 'production'].includes(environment)) {
  throw new Error('Usage: node tools/index-rag.mjs <test|production> [--confirm-production=<dataset-id>]');
}

const endpoint = environment === 'test'
  ? 'https://api-test.fortressofmuslim.org'
  : 'https://api.fortressofmuslim.org';
const secretPath = resolve(process.cwd(), '..', '..', '.fortress-import', `indexing-secret-${environment}.txt`);
const secret = process.env.FORTRESS_INDEXING_SECRET?.trim()
  || (existsSync(secretPath) ? readFileSync(secretPath, 'utf8').trim() : '');
if (!secret) throw new Error(`Set FORTRESS_INDEXING_SECRET or create ${secretPath}.`);

const datasetResponse = await fetch(`${endpoint}/v1/datasets/current`, { headers: { Accept: 'application/json' } });
if (!datasetResponse.ok) throw new Error(`Could not read the active ${environment} dataset (${datasetResponse.status}).`);
const dataset = await datasetResponse.json();
if (environment === 'production') {
  const confirmation = process.argv.find((argument) => argument.startsWith('--confirm-production='))?.split('=')[1];
  if (confirmation !== dataset.id) throw new Error(`Production indexing requires --confirm-production=${dataset.id}`);
}

let cursor = Number(process.argv.find((argument) => argument.startsWith('--cursor='))?.split('=')[1] ?? 0);
if (!Number.isInteger(cursor) || cursor < 0) throw new Error('--cursor must be a non-negative integer.');
let indexed = cursor;
for (;;) {
  const body = await requestBatch(cursor);
  indexed += body.data.indexed;
  if (indexed % 500 === 0 || body.data.complete) console.log(`Indexed through record ${indexed} from ${dataset.id}.`);
  if (body.data.complete) break;
  cursor = body.data.nextCursor;
}

console.log(`Vector indexing complete for ${environment}: ${indexed} records.`);

async function requestBatch(batchCursor) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`${endpoint}/v1/internal/vector-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fortress-Index-Key': secret },
      body: JSON.stringify({ cursor: batchCursor, limit: 50 }),
    });
    const body = await response.json();
    if (response.ok) return body;
    if (attempt === 6 || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`Indexing failed at cursor ${batchCursor}: ${body.error?.message ?? response.status}`);
    }
    const delay = Math.min(30_000, 1_000 * (2 ** attempt));
    console.warn(`Transient ${response.status} at cursor ${batchCursor}; retrying in ${delay / 1_000}s (${attempt}/6).`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`Indexing failed at cursor ${batchCursor}.`);
}
