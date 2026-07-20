import { describe, expect, it } from 'vitest';
import type { Dua, DuaSummary, Hadith } from '@fortress/contracts';
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
  },
};
const env = envConfig as never;
const authenticated = { headers: { Authorization: 'Bearer test-token' } };
const records: Dua[] = [
  {
    id: 'dua.hisn.001', legacyId: 'dua-001', sequence: 1, title: 'When waking up',
    partCount: 1, verificationStatus: 'pending',
    parts: [[{ kind: 'arabic', text: 'Arabic text' }, { kind: 'translation', text: 'Translation' }]],
  },
  {
    id: 'dua.hisn.002', legacyId: 'dua-002', sequence: 2, title: 'Upon wearing clothes',
    partCount: 1, verificationStatus: 'pending', parts: [[{ kind: 'translation', text: 'Translation' }]],
  },
  {
    id: 'dua.hisn.003', legacyId: 'dua-003', sequence: 3, title: 'Upon wearing new clothes',
    partCount: 1, verificationStatus: 'pending', parts: [[{ kind: 'translation', text: 'Translation' }]],
  },
];
const hadith: Hadith = {
  id: 'hadith.bukhari.1', sequence: 1, displayNumber: '1', title: 'Sahih al-Bukhari 1',
  collection: { slug: 'bukhari', title: 'Sahih al-Bukhari' },
  book: { number: '1', title: 'Revelation' }, chapter: { number: '1', title: 'How revelation began' },
  narrator: 'Umar bin Al-Khattab', grade: null, verificationStatus: 'pending',
  segments: [{ kind: 'arabic', text: 'Arabic Hadith' }, { kind: 'translation', text: 'Actions are by intentions.' }],
  references: [{ type: 'primary', locator: 'Sahih al-Bukhari 1' }],
};

const repository: ContentRepository = {
  async getCurrentDataset(): Promise<DatasetSummary> {
    return {
      id: 'dataset.hisn.legacy.2026-07-11-v2', sourceName: 'Test dataset', sourceVersion: 'test',
      publicationStatus: 'active', verificationStatus: 'pending', recordCount: records.length,
      contentHash: 'test-hash', importedAt: '2026-07-18T00:00:00.000Z',
    };
  },
  async listCollections(contentType) {
    return [
      { id: 'collection.hisn', slug: 'hisn', contentType: 'dua' as const, title: 'Hisn al-Muslim', titleArabic: null, recordCount: 3, bookCount: 1, chapterCount: 2, verificationStatus: 'pending' as const },
      { id: 'collection.bukhari', slug: 'bukhari', contentType: 'hadith' as const, title: 'Sahih al-Bukhari', titleArabic: null, recordCount: 1, bookCount: 1, chapterCount: 1, verificationStatus: 'pending' as const },
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
  async findDuasByTitle(query, limit) {
    const normalized = query.toLocaleLowerCase();
    return records.filter((record) => record.title.toLocaleLowerCase().includes(normalized))
      .slice(0, limit).map((record) => ({ ...record, matchScore: 1 }));
  },
  async getRandomDua() { return records[0]; },
  async getDua(id) { return records.find((record) => record.id === id || record.legacyId === id); },
  async getDuaEvidence(id) {
    const record = records.find((item) => item.id === id || item.legacyId === id);
    if (!record) return undefined;
    return {
      recordId: record.id,
      dataset: await this.getCurrentDataset(),
      collection: { id: 'collection.hisn.legacy', title: 'Fortress of Muslim (legacy import)', verificationStatus: 'pending' },
      sources: [],
      datasetSources: [{ id: 'source.legacy', title: 'Legacy source', importLocator: 'source.docx', licenseStatus: 'unknown', authenticityStatus: 'unreviewed' }],
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
  async getHadith(id) { return id === hadith.id || id === 'bukhari:1' ? hadith : undefined; },
};
const app = createApp(() => repository);

describe('Fortress Platform API', () => {
  it('reports service health', async () => {
    const response = await app.request('/health', { headers: { Origin: 'https://status.fortressofmuslim.org', 'X-Request-ID': 'test-request-123' } }, env);
    const body = await response.json() as { status: string; environment: string; version: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.environment).toBe('test');
    expect(body.version).toBe('0.14.0');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('X-Request-ID')).toBe('test-request-123');
    expect(response.headers.get('X-Fortress-Platform-Version')).toBe('0.14.0');
    expect(response.headers.get('Server-Timing')).toMatch(/^app;dur=\d+\.\d$/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('reports database health without exposing protected content', async () => {
    const response = await app.request('/health/database', {}, env);
    const body = await response.json() as { status: string; version: string; datasetId: string; recordCount: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.14.0');
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
      contentHash: string;
    };

    expect(response.status).toBe(200);
    expect(body.id).toBe('dataset.hisn.legacy.2026-07-11-v2');
    expect(body.verificationStatus).toBe('pending');
    expect(body.recordCount).toBe(3);
    expect(body.contentHash).toBe('test-hash');
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
    const body = await response.json() as { data: { recordId: string; datasetSources: Array<{ licenseStatus: string }> } };

    expect(response.status).toBe(200);
    expect(body.data.recordId).toBe('dua.hisn.001');
    expect(body.data.datasetSources[0]?.licenseStatus).toBe('unknown');
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

  it('lists published collections by content type', async () => {
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

  it('retrieves complete Hadith by provider identity', async () => {
    const response = await app.request('/v1/hadith/bukhari:1', {}, env);
    const body = await response.json() as { data: Hadith };
    expect(response.status).toBe(200);
    expect(body.data.segments).toHaveLength(2);
    expect(body.data.references[0]?.locator).toBe('Sahih al-Bukhari 1');
  });
});
