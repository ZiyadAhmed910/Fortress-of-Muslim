import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const IMPORTER_VERSION = '3.0.0';
const COLLECTIONS = ['hisn', 'bukhari', 'muslim', 'tirmidhi'];
const EXPECTED_COUNTS = { hisn: 268, bukhari: 7277, muslim: 3098, tirmidhi: 3982 };
const COLLECTION_META = {
  hisn: { title: 'Hisn al-Muslim', titleArabic: 'حصن المسلم', contentType: 'dua' },
  bukhari: { title: 'Sahih al-Bukhari', titleArabic: null, contentType: 'hadith' },
  muslim: { title: 'Sahih Muslim', titleArabic: null, contentType: 'hadith' },
  tirmidhi: { title: 'Jami at-Tirmidhi', titleArabic: null, contentType: 'hadith' },
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const command = process.argv[2] ?? 'build';
const sourceRoot = resolve(readArg('--source') ?? join(projectRoot, 'sunnah-data-fast-do-not-deploy'));
const outputRoot = resolve(readArg('--output') ?? join(projectRoot, '.fortress-import'));
const environment = readArg('--env') ?? 'test';

if (command === 'build') build();
else if (command === 'apply') apply();
else if (command === 'verify-remote') verifyRemote();
else throw new Error(`Unknown command: ${command}`);

function build() {
  assertLocalSource();
  mkdirSync(outputRoot, { recursive: true });

  const domRecords = loadDomRecords();
  const records = [];
  const issues = [];
  const artifacts = new Map();
  const providerIds = new Set();

  for (const slug of COLLECTIONS) {
    const lines = readFileSync(join(sourceRoot, 'canonical', `${slug}.jsonl`), 'utf8').trim().split(/\r?\n/);
    if (lines.length !== EXPECTED_COUNTS[slug]) {
      issues.push(issue('error', 'record_count_mismatch', `${slug} has ${lines.length} records; expected ${EXPECTED_COUNTS[slug]}.`));
    }
    lines.forEach((line, index) => {
      const source = JSON.parse(line);
      const providerRecordId = resolveProviderRecordIds(slug, source).find((candidate) => domRecords.has(candidate))
        ?? resolveProviderRecordIds(slug, source)[0];
      const dom = domRecords.get(providerRecordId);
      if (!dom) {
        issues.push(issue('error', 'missing_dom_record', `No raw HTML record matched ${providerRecordId}.`, source.canonicalId));
        return;
      }
      if (providerIds.has(providerRecordId)) {
        issues.push(issue('error', 'duplicate_provider_identity', `Provider identity ${providerRecordId} is not unique.`, source.canonicalId));
        return;
      }
      providerIds.add(providerRecordId);
      const normalized = normalizeRecord(slug, source, dom, index + 1, issues, providerRecordId);
      records.push(normalized);
      if (!artifacts.has(dom.artifact.sha256)) artifacts.set(dom.artifact.sha256, dom.artifact);
    });
  }

  const errors = issues.filter((entry) => entry.severity === 'error');
  const counts = Object.fromEntries(COLLECTIONS.map((slug) => [slug, records.filter((record) => record.collectionSlug === slug).length]));
  if (records.length !== Object.values(EXPECTED_COUNTS).reduce((sum, value) => sum + value, 0)) {
    errors.push(issue('error', 'total_count_mismatch', `Built ${records.length} records.`));
  }
  if (errors.length > 0) {
    writeReport({ status: 'failed', counts, artifacts: artifacts.size, issues });
    throw new Error(`Corpus validation failed with ${errors.length} error(s). See ${join(outputRoot, 'validation-report.json')}.`);
  }

  const normalizedHash = sha256(records.map(stableRecordLine).join('\n'));
  const datasetId = `dataset.sunnah.approved.2026-07-20-${normalizedHash.slice(0, 12)}`;
  const importRunId = `import.sunnah.${normalizedHash.slice(0, 16)}`;
  for (const record of records) {
    record.physicalId = `record.${normalizedHash.slice(0, 12)}.${record.collectionSlug}.${safeId(record.providerRecordId.slice(record.collectionSlug.length + 1))}`;
  }
  const sql = generateSql({ datasetId, importRunId, normalizedHash, records, artifacts: [...artifacts.values()], issues });
  const sqlPath = join(outputRoot, 'sunnah-corpus.sql');
  writeFileSync(sqlPath, sql, 'utf8');
  const report = {
    status: 'validated', importerVersion: IMPORTER_VERSION, datasetId, importRunId,
    normalizedHash, sqlSha256: sha256(sql), sqlBytes: Buffer.byteLength(sql),
    counts, totalRecords: records.length, artifacts: artifacts.size,
    warnings: issues.filter((entry) => entry.severity === 'warning').length,
    issues,
  };
  writeReport(report);
  console.log(JSON.stringify({ ...report, issues: undefined }, null, 2));
}

function apply() {
  if (environment !== 'test' && environment !== 'production') throw new Error('--env must be test or production.');
  const reportPath = join(outputRoot, 'validation-report.json');
  const sqlPath = join(outputRoot, 'sunnah-corpus.sql');
  if (!existsSync(reportPath) || !existsSync(sqlPath)) throw new Error('Run the build command before apply.');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const sql = readFileSync(sqlPath, 'utf8');
  if (report.status !== 'validated' || report.sqlSha256 !== sha256(sql)) throw new Error('Generated SQL does not match its validated report.');
  if (environment === 'production' && readArg('--confirm-production') !== report.datasetId) {
    throw new Error(`Production import requires --confirm-production=${report.datasetId}.`);
  }
  const database = environment === 'test' ? 'fortress-platform-test' : 'fortress-platform-production';
  runWrangler(['d1', 'migrations', 'apply', database, '--remote', '--env', environment]);
  runWrangler(['d1', 'execute', database, '--remote', '--env', environment, '--file', sqlPath, '--yes']);
  verifyRemote();
}

function verifyRemote() {
  const report = JSON.parse(readFileSync(join(outputRoot, 'validation-report.json'), 'utf8'));
  const database = environment === 'test' ? 'fortress-platform-test' : 'fortress-platform-production';
  const query = `SELECT id, record_count AS recordCount, publication_status AS status FROM dataset_versions WHERE id='${report.datasetId}'; SELECT content_type AS type, COUNT(*) AS count FROM content_records WHERE dataset_id='${report.datasetId}' GROUP BY content_type ORDER BY type;`;
  runWrangler(['d1', 'execute', database, '--remote', '--env', environment, '--command', query, '--json']);
}

function loadDomRecords() {
  const records = new Map();
  for (const slug of COLLECTIONS) {
    const directory = join(sourceRoot, 'raw', slug);
    const files = slug === 'hisn'
      ? [join(directory, 'collection.html')]
      : readdirSync(join(directory, 'books')).filter((name) => name.endsWith('.html')).map((name) => join(directory, 'books', name));
    for (const file of files) {
      const bytes = readFileSync(file);
      const html = bytes.toString('utf8');
      const $ = cheerio.load(html);
      const artifact = {
        id: `artifact.sunnah.${slug}.${sha256(bytes).slice(0, 20)}`,
        slug,
        sha256: sha256(bytes),
        byteSize: bytes.length,
        sourceUrl: sourceUrlForFile(slug, file),
        retrievedAt: retrievalTime(slug, file),
        locatorHash: sha256(relative(sourceRoot, file).replaceAll('\\', '/')),
      };
      $('.actualHadithContainer').each((_index, element) => {
        const container = $(element);
        const href = container.find(`.hadith_reference a[href^="/${slug}:"]`).first().attr('href');
        if (!href) return;
        const providerId = href.slice(1);
        const chapter = container.prevAll('.chapter').first();
        records.set(providerId, {
          artifact,
          chapterNumber: cleanChapterNumber(chapter.find('.echapno').first().text()),
          chapterTitle: cleanChapterTitle(chapter.find('.englishchapter').first().text()),
          chapterTitleArabic: cleanText(chapter.find('.arabicchapter').first().text()) || null,
          chapterAnchor: container.prevAll('a[name^="C"]').first().attr('name') ?? null,
          transliteration: slug === 'hisn' ? cleanMultiline(container.find('.transliteration').first().text()) : null,
          translation: slug === 'hisn' ? cleanMultiline(container.find('.translation').first().text()) : null,
        });
      });
    }
  }
  return records;
}

function normalizeRecord(slug, source, dom, collectionSequence, issues, providerRecordId) {
  const meta = COLLECTION_META[slug];
  const displayNumber = cleanText(source.record.displayNumber);
  const arabic = cleanMultiline(source.record.arabic);
  const translation = slug === 'hisn' ? dom.translation : cleanMultiline(source.record.englishTranslation);
  const transliteration = slug === 'hisn' ? dom.transliteration : null;
  const narrator = slug === 'hisn' ? null : cleanMultiline(source.record.narrator) || null;
  const chapterTitle = dom.chapterTitle || null;
  if (!arabic) issues.push(issue('error', 'missing_arabic', 'Arabic text is missing.', providerRecordId, 'record.arabic'));
  if (!translation) issues.push(issue('error', 'missing_translation', 'English translation is missing.', providerRecordId, 'record.englishTranslation'));
  if (!chapterTitle) issues.push(issue('warning', 'missing_chapter_title', 'The source has no English chapter title.', providerRecordId, 'chapter.titleEnglish'));
  if (slug === 'hisn' && !transliteration) issues.push(issue('warning', 'missing_transliteration', 'The source has no transliteration field.', providerRecordId, 'record.transliteration'));
  if (slug === 'muslim' && !narrator) issues.push(issue('warning', 'missing_narrator', 'The source has no narrator field.', providerRecordId, 'record.narrator'));

  const bookNumber = source.book?.number ? cleanText(source.book.number) : inferBookNumber(slug, dom.artifact.sourceUrl);
  const bookTitle = source.book?.titleEnglish ? cleanText(source.book.titleEnglish) : meta.title;
  const references = (source.references ?? [])
    .filter((reference) => !/^grade\s*$/i.test(reference.type))
    .map((reference) => ({ type: cleanText(reference.type), value: cleanText(reference.value).replace(/^:\s*/, '') }))
    .filter((reference) => reference.value);
  const grades = slug === 'tirmidhi' && Array.isArray(source.grading)
    ? source.grading.map((grade) => ({ raw: cleanText(grade.grade), normalized: normalizeGrade(grade.grade), authority: cleanText(grade.authority) || null }))
    : [];
  for (const grade of grades) if (!grade.normalized) issues.push(issue('warning', 'unmapped_grade', `Unmapped grade: ${grade.raw}`, providerRecordId, 'grading'));

  return {
    collectionSlug: slug,
    contentType: meta.contentType,
    collectionSequence,
    providerRecordId,
    importerCanonicalId: source.canonicalId,
    displayNumber,
    logicalId: `${meta.contentType}.${slug}.${logicalSuffix(slug, providerRecordId.slice(slug.length + 1))}`,
    legacyId: meta.contentType === 'dua' ? `dua-${logicalSuffix(slug, providerRecordId.slice(slug.length + 1))}` : providerRecordId,
    title: meta.contentType === 'dua' ? (chapterTitle ?? `${meta.title} ${displayNumber}`) : `${meta.title} ${displayNumber}`,
    bookNumber: bookNumber || null,
    bookTitle,
    bookTitleArabic: cleanText(source.book?.titleArabic) || null,
    chapterNumber: dom.chapterNumber,
    chapterTitle,
    chapterTitleArabic: dom.chapterTitleArabic,
    chapterAnchor: dom.chapterAnchor,
    arabic,
    transliteration,
    translation,
    narrator,
    references,
    grades,
    sourceUrl: source.provenance.sourceUrl,
    rawSha256: source.provenance.rawSha256,
    retrievedAt: source.provenance.retrievedAt,
    artifactId: dom.artifact.id,
  };
}

function generateSql({ datasetId, importRunId, normalizedHash, records, artifacts, issues }) {
  const now = new Date().toISOString();
  const acquisitionId = 'acquisition.sunnah.permission.2026-07-20';
  const statements = ['PRAGMA foreign_keys = ON;'];
  statements.push(insert('source_acquisitions', {
    id: acquisitionId, provider: 'Sunnah.com', acquisition_method: 'approved offline source capture', rights_status: 'approved',
    permission_reference: 'Permission evidence retained privately by the Fortress Platform owner',
    permitted_uses_json: JSON.stringify(['D1 storage', 'Fortress REST API', 'Fortress MCP', 'Fortress PWA API consumption']),
    reviewed_by: 'Fortress Platform owner', reviewed_at: now,
    notes: 'Raw source artifacts and generated SQL are intentionally excluded from Git.', created_at: now,
  }, true));
  for (const slug of COLLECTIONS) {
    const meta = COLLECTION_META[slug];
    statements.push(insert('source_materials', {
      id: `source.sunnah.approved.${slug}`, source_type: 'digital_library', title: meta.title,
      original_title: meta.titleArabic, publisher: 'Sunnah.com', source_url: `https://sunnah.com/${slug}`,
      license_name: 'Direct permission for Fortress Platform use', license_status: 'approved',
      authenticity_status: 'unreviewed', machine_format: 'HTML',
      notes: 'Reuse permission approved; textual and scholarly verification remain independent and pending.',
      created_at: now, updated_at: now,
    }, true));
  }
  for (const artifact of artifacts) statements.push(insert('source_artifacts', {
    id: artifact.id, acquisition_id: acquisitionId, source_id: `source.sunnah.approved.${artifact.slug}`,
    source_url: artifact.sourceUrl, media_type: 'text/html', byte_size: artifact.byteSize,
    sha256: artifact.sha256, retrieved_at: artifact.retrievedAt, importer_version: IMPORTER_VERSION,
    local_locator_hash: artifact.locatorHash,
  }));
  statements.push(insert('dataset_versions', {
    id: datasetId, source_name: 'Approved Sunnah corpus', source_version: '2026-07-20',
    generated_from: `approved local artifacts (${artifacts.length} files)`, publication_status: 'draft',
    verification_status: 'pending', record_count: records.length, content_hash: normalizedHash, imported_at: now,
  }));
  statements.push(insert('import_runs', {
    id: importRunId, acquisition_id: acquisitionId, dataset_id: datasetId, importer_version: IMPORTER_VERSION,
    input_hash: sha256(artifacts.map((artifact) => artifact.sha256).sort().join('\n')), output_hash: normalizedHash,
    status: 'validated', expected_record_count: records.length, imported_record_count: 0,
    started_at: now, validation_report_json: JSON.stringify({ warnings: issues.filter((entry) => entry.severity === 'warning').length }),
  }));
  for (const slug of COLLECTIONS) {
    const meta = COLLECTION_META[slug];
    statements.push(insert('dataset_sources', {
      dataset_id: datasetId, source_id: `source.sunnah.approved.${slug}`, source_role: 'primary',
      import_locator: `local-approved-corpus:${slug}`, source_hash: sha256(records.filter((record) => record.collectionSlug === slug).map(stableRecordLine).join('\n')),
      imported_by: 'contributor.fortress.legacy-importer', imported_at: now,
    }));
    statements.push(insert('collections', {
      id: `collection.sunnah.${slug}`, slug, content_type: meta.contentType, title: meta.title,
      title_arabic: meta.titleArabic, source_id: `source.sunnah.approved.${slug}`,
      default_language_code: 'en', verification_status: 'pending', created_at: now, updated_at: now,
    }, true));
  }

  const books = uniqueBy(records.map((record) => ({
    id: bookId(record), collection_id: `collection.sunnah.${record.collectionSlug}`,
    book_number: record.bookNumber, title: record.bookTitle, title_arabic: record.bookTitleArabic,
  })), (book) => book.id);
  const bookPositions = new Map();
  for (const slug of COLLECTIONS) {
    books.filter((book) => book.collection_id.endsWith(`.${slug}`)).forEach((book, index) => bookPositions.set(book.id, index + 1));
  }
  const chapters = uniqueBy(records.filter((record) => record.chapterNumber || record.chapterTitle).map((record) => ({
    id: chapterId(record), book_id: bookId(record), chapter_number: record.chapterNumber,
    title: record.chapterTitle ?? `Chapter ${record.chapterNumber}`,
    title_arabic: record.chapterTitleArabic,
  })), (chapter) => chapter.id);
  const chapterPositions = new Map();
  for (const book of books) {
    chapters.filter((chapter) => chapter.book_id === book.id).forEach((chapter, index) => chapterPositions.set(chapter.id, index + 1));
  }
  for (const book of books) statements.push(insert('books', { ...book, position: bookPositions.get(book.id) }, true));
  for (const chapter of chapters) statements.push(insert('chapters', { ...chapter, position: chapterPositions.get(chapter.id) }, true));

  let globalHadithSequence = 0;
  for (const record of records) {
    const sequence = record.contentType === 'hadith' ? ++globalHadithSequence : record.collectionSequence;
    statements.push(insert('content_records', {
      id: record.physicalId, dataset_id: datasetId, content_type: record.contentType,
      legacy_id: record.legacyId, sequence, title: record.title, verification_status: 'pending',
      created_at: now, updated_at: now, logical_id: record.logicalId,
    }));
    const partId = `${record.physicalId}.part.1`;
    statements.push(insert('content_parts', { id: partId, record_id: record.physicalId, position: 1 }));
    const segments = [
      ['arabic', 'ar', 'Arab', record.arabic],
      ['transliteration', 'ar-Latn', 'Latn', record.transliteration],
      ['translation', 'en', 'Latn', record.translation],
    ].filter((segment) => segment[3]);
    segments.forEach(([kind, language_code, script_code, text], index) => statements.push(insert('content_segments', {
      id: `${partId}.segment.${index + 1}`, part_id: partId, position: index + 1,
      kind, language_code, script_code, text,
    })));
    statements.push(insert('record_placements', {
      record_id: record.physicalId, collection_id: `collection.sunnah.${record.collectionSlug}`,
      book_id: bookId(record), chapter_id: record.chapterNumber || record.chapterTitle ? chapterId(record) : null,
      source_number: record.displayNumber,
      alternative_numbering_json: JSON.stringify(Object.fromEntries(record.references.map((reference) => [reference.type, reference.value]))),
    }));
    if (record.contentType === 'dua') statements.push(insert('dua_metadata', { record_id: record.physicalId }));
    else statements.push(insert('hadith_metadata', {
      record_id: record.physicalId, hadith_number: record.displayNumber,
      alternative_numbering_json: JSON.stringify(Object.fromEntries(record.references.map((reference) => [reference.type, reference.value]))),
      narrator: record.narrator, grade: record.grades[0]?.normalized ?? record.grades[0]?.raw ?? null,
      grading_authority: record.grades[0]?.authority ?? null, reference_edition: record.bookTitle,
      translator: null, license_name: 'Direct permission for Fortress Platform use',
    }));
    statements.push(insert('source_record_identities', {
      id: `identity.${normalizedHash.slice(0, 12)}.${record.collectionSlug}.${safeId(record.providerRecordId)}`,
      acquisition_id: acquisitionId, provider: 'Sunnah.com', collection_slug: record.collectionSlug,
      provider_record_id: record.providerRecordId, record_id: record.physicalId,
      artifact_id: record.artifactId, source_url: record.sourceUrl, raw_content_hash: record.rawSha256,
    }));
    statements.push(insert('record_numberings', {
      id: `numbering.${record.collectionSlug}.${safeId(record.providerRecordId)}.provider`, record_id: record.physicalId,
      scheme: 'provider', value: record.displayNumber, label: COLLECTION_META[record.collectionSlug].title, position: 1,
    }));
    if (record.importerCanonicalId !== record.providerRecordId) statements.push(insert('record_numberings', {
      id: `numbering.${record.collectionSlug}.${safeId(record.providerRecordId)}.importer`, record_id: record.physicalId,
      scheme: 'importer_canonical_id', value: record.importerCanonicalId, label: 'Importer v2 canonical ID', position: 2,
    }));
    record.references.forEach((reference, index) => {
      statements.push(insert('source_references', {
        id: `reference.${record.collectionSlug}.${safeId(record.providerRecordId)}.${index + 1}`,
        record_id: record.physicalId, source_id: `source.sunnah.approved.${record.collectionSlug}`,
        reference_type: index === 0 ? 'primary' : 'supporting', locator: reference.value,
        canonical_url: record.sourceUrl, notes: reference.type, verification_status: 'pending', created_at: now,
      }));
      statements.push(insert('record_numberings', {
        id: `numbering.${record.collectionSlug}.${safeId(record.providerRecordId)}.${index + 2}`,
        record_id: record.physicalId, scheme: numberingScheme(reference.type), value: reference.value,
        label: reference.type, position: index + 2,
      }));
    });
    record.grades.forEach((grade, index) => statements.push(insert('hadith_grades', {
      id: `grade.${record.collectionSlug}.${safeId(record.providerRecordId)}.${index + 1}`,
      record_id: record.physicalId, raw_grade: grade.raw, normalized_grade: grade.normalized,
      authority: grade.authority, source_id: `source.sunnah.approved.${record.collectionSlug}`,
      verification_status: 'pending',
    })));
    statements.push(insert('record_search_metadata', {
      record_id: record.physicalId, normalized_title: record.title.toLocaleLowerCase(),
      keywords_text: [record.bookTitle, record.chapterTitle, record.narrator].filter(Boolean).join(' '),
      language_codes: record.transliteration ? 'ar,ar-Latn,en' : 'ar,en', indexed_at: now,
    }));
    statements.push(insert('content_search_fts', {
      logical_id: record.logicalId, dataset_id: datasetId, content_type: record.contentType,
      collection_slug: record.collectionSlug, title: [record.title, record.bookTitle, record.chapterTitle].filter(Boolean).join(' '),
      body: [record.arabic, record.transliteration, record.translation].filter(Boolean).join('\n'), narrator: record.narrator ?? '',
    }));
    statements.push(insert('verification_records', {
      id: `verification.${record.physicalId}.import`, target_type: 'record', target_id: record.physicalId,
      status: 'pending', verifier_contributor_id: 'contributor.fortress.legacy-importer', method: 'approved_source_import',
      notes: 'Reuse permission is approved. Textual, reference, and scholarly verification remain pending.',
      content_hash: sha256(stableRecordLine(record)), reviewed_at: now,
    }));
  }
  issues.forEach((entry, index) => statements.push(insert('import_issues', {
    id: `${importRunId}.issue.${index + 1}`, import_run_id: importRunId,
    source_record_id: entry.sourceRecordId ?? null, field_path: entry.fieldPath ?? null,
    severity: entry.severity, issue_code: entry.code, message: entry.message,
    evidence_hash: sha256(JSON.stringify(entry)), resolution_status: entry.severity === 'warning' ? 'accepted' : 'open',
  })));
  statements.push(insert('verification_records', {
    id: `verification.${datasetId}.import`, target_type: 'dataset', target_id: datasetId,
    status: 'pending', verifier_contributor_id: 'contributor.fortress.legacy-importer', method: 'approved_source_import',
    notes: 'Rights and structural validation passed; scholarly verification remains pending.', content_hash: normalizedHash, reviewed_at: now,
  }));
  statements.push(insert('publication_history', {
    id: `publication.${datasetId}.validated`, dataset_id: datasetId, event_type: 'validated',
    actor_contributor_id: 'contributor.fortress.legacy-importer', notes: 'Importer v3 structural validation passed.', occurred_at: now,
  }));
  statements.push(`UPDATE import_runs SET status='completed', imported_record_count=${records.length}, completed_at=${sql(now)} WHERE id=${sql(importRunId)};`);
  statements.push(`UPDATE dataset_versions SET publication_status='deprecated' WHERE publication_status='active';`);
  statements.push(`UPDATE dataset_versions SET publication_status='active' WHERE id=${sql(datasetId)};`);
  statements.push(insert('publication_history', {
    id: `publication.${datasetId}.published`, dataset_id: datasetId, event_type: 'published',
    actor_contributor_id: 'contributor.fortress.legacy-importer',
    notes: 'Published for API and MCP access. Verification status remains pending.', occurred_at: now,
  }));
  return `${statements.join('\n')}\n`;
}

function insert(table, values, upsert = false) {
  const columns = Object.keys(values);
  const action = upsert ? 'INSERT OR REPLACE' : 'INSERT';
  return `${action} INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => sql(values[column])).join(', ')});`;
}

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableRecordLine(record) {
  const { physicalId: _physicalId, ...stable } = record;
  return JSON.stringify(stable);
}

function issue(severity, code, message, sourceRecordId, fieldPath) {
  return { severity, code, message, sourceRecordId, fieldPath };
}

function writeReport(report) {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, 'validation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function assertLocalSource() {
  if (!existsSync(sourceRoot)) throw new Error(`Source directory not found: ${sourceRoot}`);
  const relativePath = relative(projectRoot, sourceRoot).replaceAll('\\', '/');
  if (!relativePath.startsWith('sunnah-data-fast-do-not-deploy')) throw new Error('The source must use the ignored local-only corpus directory.');
  execFileSync('node', [join(projectRoot, 'tools', 'verify-local-data-boundary.mjs')], { cwd: projectRoot, stdio: 'inherit' });
}

function retrievalTime(slug, file) {
  const candidates = findMetadataFiles(join(sourceRoot, 'metadata', slug));
  const fileBase = basename(file, '.html');
  const metadata = candidates.find((entry) => basename(entry, '.json') === fileBase || readJson(entry)?.sha256 === sha256(readFileSync(file)));
  const value = metadata ? readJson(metadata) : null;
  return value?.retrievedAt ?? value?.retrieved_at ?? statSync(file).mtime.toISOString();
}

function sourceUrlForFile(slug, file) {
  if (basename(file) === 'collection.html') return `https://sunnah.com/${slug}`;
  const match = basename(file).match(/__(.+)\.html$/);
  return `https://sunnah.com/${slug}/${match?.[1] ?? ''}`;
}

function findMetadataFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...findMetadataFiles(path));
    else if (entry.name.endsWith('.json')) result.push(path);
  }
  return result;
}

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function readArg(name) { const prefix = `${name}=`; return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function cleanText(value) { return typeof value === 'string' ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function cleanMultiline(value) { return typeof value === 'string' ? value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : ''; }
function cleanChapterNumber(value) { return cleanText(value).replace(/^\(/, '').replace(/\)$/, '') || null; }
function cleanChapterTitle(value) { return cleanText(value).replace(/^Chapter:\s*/i, '') || null; }
function safeId(value) { return String(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''); }
function logicalSuffix(slug, value) {
  if (slug !== 'hisn') return value;
  const match = String(value).match(/^(\d+)([a-z]*)$/i);
  return match ? `${match[1].padStart(3, '0')}${match[2].toLocaleLowerCase()}` : value;
}
function inferBookNumber(slug, url) { const match = String(url).match(new RegExp(`/${slug}/([^/?#]+)`)); return match?.[1] ?? (slug === 'hisn' ? '1' : null); }
function bookId(record) { return `book.sunnah.${record.collectionSlug}.${safeId(record.bookNumber ?? sha256(record.bookTitle).slice(0, 8))}`; }
function chapterId(record) { return `${bookId(record)}.chapter.${safeId(record.chapterAnchor ?? record.chapterNumber ?? sha256(record.chapterTitle ?? '').slice(0, 8))}`; }
function uniqueBy(items, key) { return [...new Map(items.map((item) => [key(item), item])).values()]; }
function numberingScheme(type) { return cleanText(type).toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'reference'; }
function normalizeGrade(value) {
  const grade = cleanText(value).replace(/[’‘]/g, "'").replace(/[.,;:]+$/g, '');
  const key = grade.toLocaleLowerCase().replace(/[^a-z]+/g, '');
  const mapping = { sahih: 'Sahih', hasan: 'Hasan', daif: "Da'if", mawdu: "Mawdu'", maudu: "Mawdu'", hasansahih: 'Hasan Sahih', sahihgharib: 'Sahih Gharib', hasangharib: 'Hasan Gharib' };
  return mapping[key] ?? null;
}

function resolveProviderRecordIds(slug, source) {
  const reference = (source.references ?? []).find((entry) => cleanText(entry.type).toLocaleLowerCase() === 'reference');
  const value = cleanText(reference?.value).replace(/^:\s*/, '');
  const prefixes = {
    hisn: /^Hisn al-Muslim\s+/i,
    bukhari: /^Sahih al-Bukhari\s+/i,
    muslim: /^Sahih Muslim\s+/i,
    tirmidhi: /^Jami[`'’]? at-Tirmidhi\s+/i,
  };
  const identifier = value.replace(prefixes[slug], '').split(',')[0].replace(/\s+/g, '');
  const derived = identifier && identifier !== value.replace(/\s+/g, '') ? `${slug}:${identifier}` : source.canonicalId;
  return [...new Set([derived, source.canonicalId])];
}

function runWrangler(args) {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    cwd: join(projectRoot, 'apps', 'api'), stdio: 'inherit', env: process.env,
  });
}
