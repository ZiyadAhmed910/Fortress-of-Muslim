import { readFile } from 'node:fs/promises';

const snapshotUrl = new URL('../data/duas.json', import.meta.url);
const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8'));

if (snapshot.schemaVersion !== 4) {
  throw new Error(`Expected PWA snapshot schema 4, received ${snapshot.schemaVersion}.`);
}
if (!Array.isArray(snapshot.entries) || snapshot.entries.length !== 132 || snapshot.count !== 132) {
  throw new Error('The local Hisn snapshot must contain exactly 132 chapters.');
}
if (snapshot.verificationStatus !== 'verified') {
  throw new Error('The local Hisn snapshot must be explicitly verified.');
}
for (const [index, entry] of snapshot.entries.entries()) {
  const sequence = index + 1;
  if (entry.sequence !== sequence || entry.uid !== `dua-${String(sequence).padStart(3, '0')}`) {
    throw new Error(`Hisn chapter sequence is invalid at ${sequence}.`);
  }
  if (!entry.title || !Array.isArray(entry.parts) || entry.parts.length === 0) {
    throw new Error(`Hisn chapter ${sequence} is incomplete.`);
  }
}

console.log(`Verified ${snapshot.entries.length} local Hisn chapters for offline PWA use.`);
