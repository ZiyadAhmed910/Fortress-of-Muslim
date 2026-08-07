import { describe, expect, it } from 'vitest';
import { PLATFORM_VERSION, type Dua, type DuaSummary, type Hadith } from '@fortress/contracts';
import { createApp } from '../src/app';
import type { ContentRepository, DatasetSummary } from '../src/repositories/content-repository';

const envConfig = {
  PLATFORM_ENV: 'test' as const,
  AUTH: {
    getServiceState: async () => ({ serviceKey: 'api', status: 'active', message: '', enforcement: 'worker' }),
    verifyApiKey: async () => ({ valid: true, key: { id: 'key-test', referenceId: 'user-test' }, error: null }),
    verifyBearerToken: async (token: string) => ({
      valid: token === 'test-token',
      subject: token === 'test-token' ? 'user-test' : undefined,
      scopes: ['content:read', 'content:search', 'dataset:read'],
    }),
    getNamedQuery: async (id: string, ownerUserId: string) => id === 'qry-test' && ownerUserId === 'user-test' ? ({
      id, ownerUserId, operation: 'search' as const, parameters: { query: 'waking', limit: 5 },
    }) : null,
    checkRateLimit: async () => ({
      valid: true as const,
      principalId: 'user-test',
      planCode: 'basic',
      allowed: true,
      limit: { perMinute: 100, perDay: 5000 },
      remaining: { perMinute: 99, perDay: 4999 },
    }),
  },
};
const env = envConfig as never;
const authenticated = { headers: { Authorization: 'Bearer test-token' } };
const records: Dua[] = [
  {
    id: 'dua.hisn.001', legacyId: 'dua-001', sequence: 1, title: 'When waking up',
    partCount: 1, verificationStatus: 'verified', workflowState: 'verified',
    verifiedBy: 'reviewer-1', verifiedAt: '2026-07-22T00:00:00.000Z', revisionNumber: 1,
    publishedAt: '2026-07-23T00:00:00.000Z',
    canonicalUrl: 'https://fortressofmuslim.org/hisn/chapter1',
    parts: [[{ kind: 'arabic', text: 'Arabic text' }, { kind: 'translation', text: 'Translation' }]],
  },
  {
    id: 'dua.hisn.002', legacyId: 'dua-002', sequence: 2, title: 'Upon wearing clothes',
    partCount: 1, verificationStatus: 'verified', workflowState: 'verified',
    verifiedBy: 'reviewer-1', verifiedAt: '2026-07-22T00:00:00.000Z', revisionNumber: 1,
    publishedAt: '2026-07-23T00:00:00.000Z',
    canonicalUrl: 'https://fortressofmuslim.org/hisn/chapter2',
    parts: [[{ kind: 'translation', text: 'Translation' }]],
  },
  {
    id: 'dua.hisn.003', legacyId: 'dua-003', sequence: 3, title: 'Upon wearing new clothes',
    partCount: 1, verificationStatus: 'unverified', workflowState: 'pending_review',
    verifiedBy: null, verifiedAt: null, revisionNumber: 1,
    publishedAt: null,
    canonicalUrl: 'https://fortressofmuslim.org/hisn/chapter3',
    parts: [[{ kind: 'translation', text: 'Translation' }]],
  },
];
const hadith: Hadith = {
  id: 'hadith.bukhari.1', sequence: 1, displayNumber: '1', title: 'Sahih al-Bukhari 1',
  collection: { slug: 'bukhari', title: 'Sahih al-Bukhari' },
  book: { number: '1', title: 'Revelation' }, chapter: { number: '1', title: 'How revelation began' },
  narrator: 'Umar bin Al-Khattab', grade: null, verificationStatus: 'verified',
  workflowState: 'verified', verifiedBy: 'reviewer-1', verifiedAt: '2026-07-22T00:00:00.000Z',
  revisionNumber: 1, publishedAt: '2026-07-23T00:00:00.000Z',
  canonicalUrl: 'https://fortressofmuslim.org/bukhari/book1/1',
  segments: [{ kind: 'arabic', text: 'Arabic Hadith' }, { kind: 'translation', text: 'Actions are by intentions.' }],
  references: [{ type: 'primary', locator: 'Sahih al-Bukhari 1' }],
};

const repository: ContentRepository = {
  async getCurrentDataset(): Promise<DatasetSummary> {
    return {
      id: 'dataset.hisn.legacy.2026-07-11-v2', sourceName: 'Test dataset', sourceVersion: 'test',
      publicationStatus: 'active', verificationStatus: 'verified', recordCount: records.length,
      contentHash: 'test-hash', importedAt: '2026-07-18T00:00:00.000Z',
    };
  },
  async listCollections(contentType) {
    return [
      { id: 'collection.hisn', slug: 'hisn', contentType: 'dua' as const, title: 'Hisn al-Muslim', titleArabic: null, recordCount: 3, bookCount: 1, chapterCount: 2, verificationStatus: 'verified' as const },
      { id: 'collection.bukhari', slug: 'bukhari', contentType: 'hadith' as const, title: 'Sahih al-Bukhari', titleArabic: null, recordCount: 1, bookCount: 1, chapterCount: 1, verificationStatus: 'verified' as const },
    ].filter((collection) => !contentType || collection.contentType === contentType);
  },
  async countDuas() { return records.length; },
  async listDuas(offset, limit): Promise<DuaSummary[]> {
    return records.slice(offset, offset + limit).map(({ parts: _parts, ...summary }) => summary);
  },
  async searchDuas(query, offset, limit) {
    const normalized = query.toLocaleLowerCase();
    const matches = records.filter((record) =>
      record.title.toLocaleLowerCase().includes(normalized)
      || record.parts.some((part) => part.some((segment) => segment.text.toLocaleLowerCase().includes(normalized))),
    );
    const items = matches.slice(offset, offset + limit).map(({ parts: _parts, ...summary }) => summary);
    return { items, total: matches.length };
  },
  async searchForRag(query, limit) {
    const terms = query.toLocaleLowerCase().match(/[a-z]+/g)?.filter((term) => term.length >= 5) ?? [];
    const matches = (text: string) => terms.some((term) => text.toLocaleLowerCase().includes(term));
    const candidates = [
      ...records.filter((record) => matches(`${record.title} ${record.parts.flat().map((segment) => segment.text).join(' ')}`))
        .map((record) => ({ id: record.id, contentType: 'dua' as const, score: 0.8 })),
      ...(matches(`${hadith.title} ${hadith.segments.map((segment) => segment.text).join(' ')}`)
        ? [{ id: hadith.id, contentType: 'hadith' as const, score: 0.8 }]
        : []),
    ];
    return candidates.slice(0, limit);
  },
  async searchCurrentForRag(query, limit) {
    const terms = query.toLocaleLowerCase().match(/[a-z]+/g)?.filter((term) => term.length >= 5) ?? [];
    const matches = (text: string) => terms.some((term) => text.toLocaleLowerCase().includes(term));
    const candidates = [
      ...records.filter((record) => matches(`${record.title} ${record.parts.flat().map((segment) => segment.text).join(' ')}`))
        .map((record) => ({ id: record.id, contentType: 'dua' as const, score: 0.5 })),
      ...(matches(`${hadith.title} ${hadith.segments.map((segment) => segment.text).join(' ')}`)
        ? [{ id: hadith.id, contentType: 'hadith' as const, score: 0.5 }]
        : []),
    ];
    return candidates.slice(0, limit);
  },
  async findDuasByTitle(query, limit) {
    const normalized = query.toLocaleLowerCase();
    return records.filter((record) => record.title.toLocaleLowerCase().includes(normalized))
      .slice(0, limit).map((record) => ({ ...record, matchScore: 1 }));
  },
  async getRandomDua() { return records[0]; },
  async getDua(id) { return records.find((record) => record.id === id || record.legacyId === id); },
  async getPublishedDua(id) {
    return records.find((record) =>
      (record.id === id || record.legacyId === id) && record.workflowState === 'verified' && record.publishedAt);
  },
  async getDuaEvidence(id) {
    const record = records.find((item) => item.id === id || item.legacyId === id);
    if (!record) return undefined;
    return {
      recordId: record.id,
      canonicalUrl: record.canonicalUrl,
      revisionNumber: record.revisionNumber,
      verificationStatus: record.verificationStatus,
      workflowState: record.workflowState,
      verifiedBy: record.verifiedBy,
      verifiedAt: record.verifiedAt,
      publishedAt: record.publishedAt,
      collection: { id: 'collection.hisn', title: 'Fortress of Muslim', verificationStatus: 'verified' },
      references: [{ id: 'reference.1', referenceType: 'primary', locator: 'Hisn al-Muslim 1', verificationStatus: 'verified' }],
      taxonomy: [], verificationHistory: [], corrections: [],
    };
  },
  async countHadith(collection) { return !collection || collection === 'bukhari' ? 1 : 0; },
  async listHadith(collection, offset, limit) {
    return (!collection || collection === 'bukhari' ? [hadith] : []).slice(offset, offset + limit)
      .map(({ segments: _segments, references: _references, ...summary }) => summary);
  },
  async searchHadith(query, collection, offset, limit) {
    const text = `${hadith.title} ${hadith.narrator} ${hadith.segments.map((segment) => segment.text).join(' ')}`.toLocaleLowerCase();
    const matches = (!collection || collection === 'bukhari') && text.includes(query.toLocaleLowerCase()) ? [hadith] : [];
    return { items: matches.slice(offset, offset + limit).map(({ segments: _segments, references: _references, ...summary }) => summary), total: matches.length };
  },
  async resolveHadithPath(collection, book, number) {
    return collection === 'bukhari' && book === '1' && number === '1' ? hadith : undefined;
  },
  async findHadithByReference(collectionHint, number) {
    const hint = collectionHint.toLocaleLowerCase();
    return (hint === 'bukhari' || hint === 'sahih bukhari' || hadith.collection.title.toLocaleLowerCase().includes(hint))
      && number === hadith.displayNumber ? hadith : undefined;
  },
  async getHadith(id) { return id === hadith.id || id === 'bukhari:1' ? hadith : undefined; },
  async getPublishedHadith(id) { return id === hadith.id || id === 'bukhari:1' ? hadith : undefined; },
};
const app = createApp(() => repository);

describe('Fortress Platform API', () => {
  it('reports service health', async () => {
    const response = await app.request('/health', { headers: { Origin: 'https://status.fortressofmuslim.org', 'X-Request-ID': 'test-request-123' } }, env);
    const body = await response.json() as { status: string; environment: string; version: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.environment).toBe('test');
    expect(body.version).toBe(PLATFORM_VERSION);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('X-Request-ID')).toBe('test-request-123');
    expect(response.headers.get('X-Fortress-Platform-Version')).toBe(PLATFORM_VERSION);
    expect(response.headers.get('Server-Timing')).toMatch(/^app;dur=\d+\.\d$/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('reports database health without exposing protected content', async () => {
    const response = await app.request('/health/database', {}, env);
    const body = await response.json() as { status: string; version: string; datasetId: string; recordCount: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBe(PLATFORM_VERSION);
    expect(body.datasetId).toBe('dataset.hisn.legacy.2026-07-11-v2');
    expect(body.recordCount).toBe(3);
  });

  it('keeps health available while protected API routes are in maintenance', async () => {
    const maintenanceEnv = {
      ...envConfig,
      AUTH: {
        ...envConfig.AUTH,
        getServiceState: async () => ({ serviceKey: 'api', status: 'maintenance', message: 'Scheduled maintenance.', enforcement: 'worker' }),
      },
    } as never;
    const response = await app.request('/v1/duas?limit=2', authenticated, maintenanceEnv);
    const health = await app.request('/health', {}, maintenanceEnv);
    const body = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(body.error.code).toBe('service_maintenance');
    expect(health.status).toBe(200);
  });

  it('returns a paginated dua summary list', async () => {
    const response = await app.request('/v1/duas?limit=2', {}, env);
    const body = await response.json() as {
      data: Array<{ id: string; parts?: unknown }>;
      pagination: { nextCursor: string | null };
    };
    const first = body.data[0]!;

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(first.id).toBe('dua.hisn.001');
    expect(first.parts).toBeUndefined();
    expect(body.pagination.nextCursor).toBeTruthy();
    expect(response.headers.get('X-Fortress-Dataset-Version')).toBe('dataset.hisn.legacy.2026-07-11-v2');
  });

  it('exposes current unverified records with their exact editorial state', async () => {
    const response = await app.request('/v1/duas?limit=3', {}, env);
    const body = await response.json() as { data: DuaSummary[] };
    const candidate = body.data.find((item) => item.id === 'dua.hisn.003');

    expect(response.status).toBe(200);
    expect(candidate).toMatchObject({
      verificationStatus: 'unverified',
      workflowState: 'pending_review',
      verifiedBy: null,
      verifiedAt: null,
      publishedAt: null,
    });
  });

  it('keeps anonymous reading available when service control is unreachable', async () => {
    const unavailableControlEnv = {
      ...envConfig,
      AUTH: { ...envConfig.AUTH, getServiceState: async () => { throw new Error('Auth unavailable'); } },
    } as never;
    const response = await app.request('/v1/duas?limit=1', {}, unavailableControlEnv);
    expect(response.status).toBe(200);
  });

  it('reports the active dataset provenance', async () => {
    const response = await app.request('/v1/datasets/current', {}, env);
    const body = await response.json() as {
      id: string;
      verificationStatus: string;
      recordCount: number;
      canonicalHash: string;
    };

    expect(response.status).toBe(200);
    expect(body.id).toBe('dataset.hisn.legacy.2026-07-11-v2');
    expect(body.verificationStatus).toBe('verified');
    expect(body.recordCount).toBe(3);
    expect(body.canonicalHash).toBe('test-hash');
  });

  it('retrieves a dua using its canonical ID', async () => {
    const response = await app.request('/v1/duas/dua.hisn.001', {}, env);
    const body = await response.json() as {
      data: { legacyId: string; parts: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(body.data.legacyId).toBe('dua-001');
    expect(body.data.parts.length).toBeGreaterThan(0);
  });

  it('searches titles and segment text', async () => {
    const titleResponse = await app.request('/v1/duas/search?q=waking', authenticated, env);
    const textResponse = await app.request('/v1/duas/search?q=Arabic', authenticated, env);
    const titleBody = await titleResponse.json() as { data: DuaSummary[]; meta: { total: number } };
    const textBody = await textResponse.json() as { data: DuaSummary[]; meta: { total: number } };

    expect(titleResponse.status).toBe(200);
    expect(titleBody.data[0]?.id).toBe('dua.hisn.001');
    expect(titleBody.meta.total).toBe(1);
    expect(textResponse.status).toBe(200);
    expect(textBody.data[0]?.id).toBe('dua.hisn.001');
  });

  it('returns a complete random dua without caching', async () => {
    const response = await app.request('/v1/duas/random', authenticated, env);
    const body = await response.json() as { data: Dua };

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.data.parts.length).toBeGreaterThan(0);
  });

  it('executes an owner-scoped named query definition', async () => {
    const response = await app.request('/v1/queries/qry-test', authenticated, env);
    const body = await response.json() as { data: DuaSummary[]; meta: { namedQueryId: string; total: number } };
    expect(response.status).toBe(200);
    expect(body.data[0]?.id).toBe('dua.hisn.001');
    expect(body.meta.namedQueryId).toBe('qry-test');
    expect(body.meta.total).toBe(1);
  });

  it('reports rate-limit headers on a credentialed request under its plan limit', async () => {
    const response = await app.request('/v1/duas', authenticated, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit-Minute')).toBe('100');
    expect(response.headers.get('X-RateLimit-Remaining-Minute')).toBe('99');
    expect(response.headers.get('X-RateLimit-Limit-Day')).toBe('5000');
  });

  it('does not rate-limit anonymous requests', async () => {
    const response = await app.request('/v1/duas', {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit-Minute')).toBeNull();
  });

  it('rejects a credentialed request over its plan limit with 429 and Retry-After', async () => {
    const limitedEnv = {
      ...envConfig,
      AUTH: {
        ...envConfig.AUTH,
        checkRateLimit: async () => ({
          valid: true as const,
          principalId: 'user-test',
          planCode: 'basic',
          allowed: false,
          limit: { perMinute: 100, perDay: 5000 },
          remaining: { perMinute: 0, perDay: 4000 },
          retryAfterSeconds: 60,
        }),
      },
    } as never;
    const response = await app.request('/v1/duas', authenticated, limitedEnv);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.message).toContain('basic');
  });

  it('returns ordered part resources', async () => {
    const listResponse = await app.request('/v1/duas/dua.hisn.001/parts', authenticated, env);
    const partResponse = await app.request('/v1/duas/dua-001/parts/1', authenticated, env);
    const listBody = await listResponse.json() as { data: Array<{ position: number }> };
    const partBody = await partResponse.json() as { data: { duaId: string; position: number; segmentCount: number } };

    expect(listResponse.status).toBe(200);
    expect(listBody.data[0]?.position).toBe(1);
    expect(partResponse.status).toBe(200);
    expect(partBody.data.duaId).toBe('dua.hisn.001');
    expect(partBody.data.position).toBe(1);
    expect(partBody.data.segmentCount).toBe(2);
  });

  it('returns traceable evidence without requiring a user account', async () => {
    const response = await app.request('/v1/duas/dua.hisn.001/evidence', {}, env);
    const body = await response.json() as { data: { recordId: string; canonicalUrl: string; references: Array<{ verificationStatus: string }> } };

    expect(response.status).toBe(200);
    expect(body.data.recordId).toBe('dua.hisn.001');
    expect(body.data.canonicalUrl).toBe('https://fortressofmuslim.org/hisn/chapter1');
    expect(body.data.references[0]?.verificationStatus).toBe('verified');
  });

  it('validates part positions', async () => {
    const invalidResponse = await app.request('/v1/duas/dua.hisn.001/parts/nope', authenticated, env);
    const missingResponse = await app.request('/v1/duas/dua.hisn.001/parts/10', authenticated, env);
    const invalidBody = await invalidResponse.json() as { error: { code: string } };
    const missingBody = await missingResponse.json() as { error: { code: string } };

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.error.code).toBe('invalid_request');
    expect(missingResponse.status).toBe(404);
    expect(missingBody.error.code).toBe('part_not_found');
  });

  it('returns a structured error for missing content', async () => {
    const response = await app.request('/v1/duas/does-not-exist', authenticated, env);
    const body = await response.json() as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('keeps owner-scoped named queries protected', async () => {
    const response = await app.request('/v1/queries/qry-test', {}, env);
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('lists current collections by content type', async () => {
    const response = await app.request('/v1/collections?type=hadith', {}, env);
    const body = await response.json() as { data: Array<{ slug: string; contentType: string }> };
    expect(response.status).toBe(200);
    expect(body.data).toEqual([expect.objectContaining({ slug: 'bukhari', contentType: 'hadith' })]);
  });

  it('lists and searches Hadith without returning full text in summaries', async () => {
    const listResponse = await app.request('/v1/hadith?collection=bukhari&limit=10', {}, env);
    const searchResponse = await app.request('/v1/hadith/search?q=intentions&collection=bukhari', {}, env);
    const listBody = await listResponse.json() as { data: Array<{ id: string; segments?: unknown }> };
    const searchBody = await searchResponse.json() as { data: Array<{ id: string }> };
    expect(listResponse.status).toBe(200);
    expect(listBody.data[0]?.id).toBe('hadith.bukhari.1');
    expect(listBody.data[0]?.segments).toBeUndefined();
    expect(searchResponse.status).toBe(200);
    expect(searchBody.data[0]?.id).toBe('hadith.bukhari.1');
  });

  it('retrieves complete Hadith by canonical identity', async () => {
    const response = await app.request('/v1/hadith/bukhari:1', {}, env);
    const body = await response.json() as { data: Hadith };
    expect(response.status).toBe(200);
    expect(body.data.segments).toHaveLength(2);
    expect(body.data.references[0]?.locator).toBe('Sahih al-Bukhari 1');
  });

  it('resolves a sequential Fortress Hadith path', async () => {
    const response = await app.request('/v1/hadith/resolve?collection=bukhari&book=1&number=1', {}, env);
    const body = await response.json() as { data: Hadith };
    expect(response.status).toBe(200);
    expect(body.data.id).toBe('hadith.bukhari.1');
    expect(body.data.canonicalUrl).toBe('https://fortressofmuslim.org/bukhari/book1/1');
  });

  it('answers from vector-retrieved records with citations', async () => {
    const ragEnv = {
      ...envConfig,
      CONTENT_DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }),
      },
      AI: {
        run: async (model: string) => model.includes('bge-base')
          ? { data: [[0.1, 0.2, 0.3]] }
          : { response: 'Actions are judged by intentions [1].' },
      },
      VECTOR_INDEX: {
        query: async () => ({ count: 1, matches: [{
          id: 'hadith.bukhari.1', score: 0.94,
          metadata: { recordId: 'hadith.bukhari.1', contentType: 'hadith', collection: 'bukhari' },
        }] }),
      },
    } as never;
    const response = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.4' },
      body: JSON.stringify({ question: 'What do the sources say about intentions?' }),
    }, ragEnv);
    const body = await response.json() as { data: { answer: string; sources: Array<{ canonicalUrl: string; verificationStatus: string }> } };
    expect(response.status).toBe(200);
    expect(body.data.answer).toContain('[1]');
    expect(body.data.sources[0]?.canonicalUrl).toBe('https://fortressofmuslim.org/bukhari/book1/1');
    expect(body.data.sources[0]?.verificationStatus).toBe('verified');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('resolves an exact reference like "Bukhari 1" directly, skipping embedding retrieval', async () => {
    const exactReferenceEnv = {
      ...envConfig,
      CONTENT_DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }),
      },
      AI: {
        run: async (model: string) => {
          if (model.includes('bge-base')) throw new Error('Embedding retrieval must not run for an exact reference.');
          return { response: 'Actions are judged by intentions [1].' };
        },
      },
      VECTOR_INDEX: {
        query: async () => { throw new Error('Vector search must not run for an exact reference.'); },
      },
    } as never;
    const response = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
      body: JSON.stringify({ question: 'Bukhari 1' }),
    }, exactReferenceEnv);
    const body = await response.json() as {
      data: { answer: string; sources: Array<{ id: string }>; meta: { retrievalMode: string; vectorAvailable: boolean } };
    };
    expect(response.status).toBe(200);
    expect(body.data.answer).toContain('[1]');
    expect(body.data.sources).toHaveLength(1);
    expect(body.data.sources[0]?.id).toBe('hadith.bukhari.1');
    expect(body.data.meta.retrievalMode).toBe('exact_reference');
    expect(body.data.meta.vectorAvailable).toBe(false);
  });

  it('falls through to normal retrieval when an exact reference does not match a real record', async () => {
    const noMatchEnv = {
      ...envConfig,
      CONTENT_DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }),
      },
      AI: {
        run: async (model: string) => model.includes('bge-base')
          ? { data: [[0.1, 0.2, 0.3]] }
          : { response: 'Actions are judged by intentions [1].' },
      },
      VECTOR_INDEX: {
        query: async () => ({ count: 1, matches: [{
          id: 'hadith.bukhari.1', score: 0.94,
          metadata: { recordId: 'hadith.bukhari.1', contentType: 'hadith', collection: 'bukhari' },
        }] }),
      },
    } as never;
    const response = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.6' },
      body: JSON.stringify({ question: 'Nonexistent Collection 999' }),
    }, noMatchEnv);
    const body = await response.json() as { data: { meta: { retrievalMode: string } } };
    expect(response.status).toBe(200);
    expect(body.data.meta.retrievalMode).not.toBe('exact_reference');
  });

  it('does not consume quota or invoke AI when no records are published', async () => {
    const emptyRepository = {
      ...repository,
      getCurrentDataset: async () => ({
        ...await repository.getCurrentDataset(),
        id: 'canonical.empty',
        recordCount: 0,
      }),
    };
    const emptyApp = createApp(() => emptyRepository);
    const unavailable = async () => { throw new Error('This dependency must not be called.'); };
    const response = await emptyApp.request('/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What should I read when worried?' }),
    }, {
      ...envConfig,
      CONTENT_DB: { prepare: unavailable },
      AI: { run: unavailable },
      VECTOR_INDEX: { query: unavailable },
    } as never);
    const body = await response.json() as { data: { sources: unknown[]; meta: { retrievalMode: string; remainingToday: number } } };

    expect(response.status).toBe(200);
    expect(body.data.sources).toEqual([]);
    expect(body.data.meta.retrievalMode).toBe('empty_dataset');
    expect(body.data.meta.remainingToday).toBe(20);
  });

  it('falls back to published lexical retrieval when Vectorize is unavailable', async () => {
    const fallbackEnv = {
      ...envConfig,
      CONTENT_DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }),
      },
      AI: {
        run: async (model: string) => {
          if (model.includes('bge-base')) throw new Error('Vector service unavailable');
          return { response: 'Actions are judged by intentions [1].' };
        },
      },
      VECTOR_INDEX: { query: async () => { throw new Error('Vector service unavailable'); } },
    } as never;
    const response = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
      body: JSON.stringify({ question: 'What do the sources say about intentions?' }),
    }, fallbackEnv);
    const body = await response.json() as {
      data: { answer: string; sources: Array<{ id: string }>; meta: { retrievalMode: string; vectorAvailable: boolean } };
    };

    expect(response.status).toBe(200);
    expect(body.data.answer).toContain('[1]');
    expect(body.data.sources[0]?.id).toBe('hadith.bukhari.1');
    expect(body.data.meta.retrievalMode).toBe('lexical');
    expect(body.data.meta.vectorAvailable).toBe(false);
  });

  it('rejects uncited model output and returns a deterministic cited fallback', async () => {
    const uncitedEnv = {
      ...envConfig,
      CONTENT_DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }),
      },
      AI: {
        run: async (model: string) => model.includes('bge-base')
          ? { data: [[0.1, 0.2, 0.3]] }
          : { response: 'Actions are judged by intentions.' },
      },
      VECTOR_INDEX: {
        query: async () => ({ count: 1, matches: [{
          id: 'hadith.bukhari.1', score: 0.94,
          metadata: { recordId: 'hadith.bukhari.1', contentType: 'hadith', collection: 'bukhari' },
        }] }),
      },
    } as never;
    const response = await app.request('/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.6' },
      body: JSON.stringify({ question: 'What do the sources say about intentions?' }),
    }, uncitedEnv);
    const body = await response.json() as { data: { answer: string; meta: { generated: boolean; model: string | null } } };

    expect(response.status).toBe(200);
    expect(body.data.answer).toContain('[1]');
    expect(body.data.meta.generated).toBe(false);
    expect(body.data.meta.model).toBeNull();
  });

  it('reports canonical vector-index readiness', async () => {
    const statusEnv = {
      ...envConfig,
      CONTENT_DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => ({
              expectedCount: 3,
              indexedCount: 3,
              status: 'ready',
              lastError: null,
              updatedAt: '2026-07-23T00:00:00.000Z',
              completedAt: '2026-07-23T00:00:00.000Z',
            }),
            all: async () => ({
              results: sql.includes('canonical_dataset_items')
                ? [{ contentType: 'dua', count: 2 }, { contentType: 'hadith', count: 1 }]
                : [],
            }),
          }),
        }),
      },
    } as never;
    const response = await app.request('/v1/ask/status', {}, statusEnv);
    const body = await response.json() as {
      data: { datasetId: string; status: string; indexedCount: number; contentCounts: { dua: number; hadith: number } };
    };

    expect(response.status).toBe(200);
    expect(body.data.datasetId).toBe('dataset.hisn.legacy.2026-07-11-v2');
    expect(body.data.status).toBe('ready');
    expect(body.data.indexedCount).toBe(3);
    expect(body.data.contentCounts).toEqual({ dua: 2, hadith: 1 });
  });

  it('validates assistant questions before invoking AI', async () => {
    const response = await app.request('/v1/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'hi' }),
    }, env);
    expect(response.status).toBe(400);
  });
});
