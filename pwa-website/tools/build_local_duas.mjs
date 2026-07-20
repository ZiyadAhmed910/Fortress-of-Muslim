import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const CATEGORY_CHAPTERS = {
  morning: [1, 27],
  evening: [27],
  sleep: [28, 29, 30, 31],
  salah: [...range(8, 26), 32, 33, 42],
  travel: [...range(95, 105), ...range(115, 121)],
  ruqyah: [30, 34, 35, 36, 37, 38, 39, 40, 43, 45, 46, 48, 49, 50, 51, 53, 61, 88, 92, 110, 111, 124, 125, 126, 128],
};

const MOOD_CHAPTERS = {
  anxious: [30, 34, 35, 40, 41, 43, 46, 53, 82],
  afraid: [30, 36, 37, 38, 39, 45, 88, 92, 125, 126, 128],
  sad: [34, 35, 46, 53, 57, 106],
  grateful: [47, 63, 64, 65, 70, 71, 76, 87, 89, 90, 93, 106, 122, 123, 130, 132],
  protection: [30, 36, 37, 38, 39, 45, 48, 61, 88, 92, 94, 110, 111, 124, 125, 128],
};

const pwaRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(pwaRoot, '..');
const sourceRoot = resolve(projectRoot, 'sunnah-data-fast-do-not-deploy');
const sourceLines = readFileSync(resolve(sourceRoot, 'canonical', 'hisn.jsonl'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
const sourceById = new Map(sourceLines.map((record) => [record.canonicalId, record]));
const sourceHtml = readFileSync(resolve(sourceRoot, 'raw', 'hisn', 'collection.html'), 'utf8');
const $ = cheerio.load(sourceHtml);
const chapters = new Map();

$('.actualHadithContainer').each((_index, element) => {
  const container = $(element);
  const href = container.find('.hadith_reference a[href^="/hisn:"]').first().attr('href');
  if (!href) return;
  const providerId = href.slice(1);
  const source = sourceById.get(providerId);
  if (!source) throw new Error(`No canonical source record matched ${providerId}.`);
  const chapter = container.prevAll('.chapter').first();
  const chapterNumber = Number(clean(chapter.find('.echapno').first().text()).replace(/[()]/g, ''));
  if (!Number.isInteger(chapterNumber)) throw new Error(`Invalid chapter for ${providerId}.`);
  const entry = chapters.get(chapterNumber) ?? {
    id: chapterNumber,
    title: clean(chapter.find('.englishchapter').first().text()).replace(/^Chapter:\s*/i, ''),
    titleArabic: clean(chapter.find('.arabicchapter').first().text()),
    uid: `dua-${String(chapterNumber).padStart(3, '0')}`,
    sequence: chapterNumber,
    duplicateId: false,
    categories: [],
    moods: [],
    tags: [],
    parts: [],
    sources: [],
  };
  const reference = source.references.find((item) => item.type === 'Source citation')?.value ?? '';
  const segments = [
    segment('arabic', source.record.arabic),
    segment('transliteration', clean(container.find('.transliteration').first().text()) || source.record.transliteration),
    segment('translation', clean(container.find('.translation').first().text()) || source.record.englishTranslation),
    segment('reference', reference ? `Source: ${reference}` : `Source: Hisn al-Muslim ${source.record.displayNumber}`),
  ].filter(Boolean);
  entry.parts.push(segments);
  entry.sources.push({
    provider: source.provenance.provider,
    providerId,
    displayNumber: source.record.displayNumber,
    sourceUrl: source.provenance.sourceUrl,
    references: source.references,
    verificationStatus: source.verification.status,
  });
  chapters.set(chapterNumber, entry);
});

const entries = [...chapters.values()].sort((a, b) => a.sequence - b.sequence);
for (const entry of entries) {
  entry.categories = assignedGroups(entry.id, CATEGORY_CHAPTERS);
  entry.moods = assignedGroups(entry.id, MOOD_CHAPTERS);
  entry.tags = [...new Set([
    ...entry.categories,
    ...entry.moods,
    ...entry.title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3).slice(0, 8),
  ])];
}

validate(entries);
const sourceHash = createHash('sha256').update(sourceHtml).digest('hex');
const output = {
  schemaVersion: 3,
  generatedFrom: 'Approved Hisn al-Muslim source corpus',
  generatedAt: sourceLines[0].provenance.retrievedAt,
  sourceHash,
  count: entries.length,
  sourceRecordCount: sourceLines.length,
  entries,
};
writeFileSync(resolve(pwaRoot, 'data', 'duas.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Built ${entries.length} local chapters from ${sourceLines.length} approved source records.`);

function segment(kind, text) {
  const value = clean(text);
  return value ? { kind, text: value } : null;
}

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function assignedGroups(chapterId, groups) {
  return Object.entries(groups)
    .filter(([, chapterIds]) => chapterIds.includes(chapterId))
    .map(([name]) => name);
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_value, index) => start + index);
}

function validate(items) {
  if (items.length !== 132) throw new Error(`Expected 132 chapters, received ${items.length}.`);
  if (items.reduce((count, item) => count + item.parts.length, 0) !== 268) throw new Error('Expected 268 source-backed parts.');
  for (const [index, item] of items.entries()) {
    if (item.id !== index + 1 || item.uid !== `dua-${String(index + 1).padStart(3, '0')}`) throw new Error(`Chapter sequence failed at ${index + 1}.`);
    if (!item.title || !item.titleArabic || item.parts.length !== item.sources.length) throw new Error(`Chapter ${item.id} is incomplete.`);
    for (const part of item.parts) {
      for (const kind of ['arabic', 'transliteration', 'translation', 'reference']) {
        if (!part.some((item) => item.kind === kind)) throw new Error(`Chapter ${item.id} has a part without ${kind}.`);
      }
    }
  }
}
