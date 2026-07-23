import { writeFile } from 'node:fs/promises';

const apiBase = (process.env.FORTRESS_API_URL || 'https://api-test.fortressofmuslim.org').replace(/\/$/, '');
const outputUrl = new URL('../data/duas.json', import.meta.url);
const dataset = await request('/v1/datasets/current');
const summaries = [];
let cursor = null;

do {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', cursor);
  const page = await request(`/v1/duas?${params}`);
  summaries.push(...page.data.filter((dua) =>
    dua.verificationStatus === 'verified'
    && dua.workflowState === 'published'
    && dua.publishedAt
  ));
  cursor = page.pagination.nextCursor;
} while (cursor);

const entries = [];
for (const summary of summaries) {
  const detail = await request(`/v1/duas/${encodeURIComponent(summary.id)}`);
  entries.push(toLocalEntry(detail.data));
}

const snapshot = {
  schemaVersion: 4,
  canonicalDataset: dataset.id,
  publicationStatus: dataset.publicationStatus,
  verificationStatus: dataset.verificationStatus,
  count: entries.length,
  entries,
};
await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`Wrote ${entries.length} published canonical duas from ${dataset.id}.`);

async function request(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}.`);
  return response.json();
}

function toLocalEntry(dua) {
  return {
    uid: dua.id,
    id: dua.sequence,
    sequence: dua.sequence,
    title: dua.title,
    category: 'all',
    tags: [],
    moods: [],
    verificationStatus: dua.verificationStatus,
    revisionNumber: dua.revisionNumber,
    canonicalUrl: dua.canonicalUrl,
    parts: dua.parts.map((segments, index) => ({
      id: `${dua.id}.part.${index + 1}`,
      segments,
    })),
  };
}
