import { describe, expect, it } from 'vitest';
import type { Dua, DuaSummary } from '@fortress/contracts';
import { createApp } from '../src/app';
import type { ContentRepository, DatasetSummary } from '../src/repositories/content-repository';

const env = { PLATFORM_ENV: 'test' as const } as never;
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

const repository: ContentRepository = {
  async getCurrentDataset(): Promise<DatasetSummary> {
    return {
      id: 'dataset.hisn.legacy.2026-07-11-v2', sourceName: 'Test dataset', sourceVersion: 'test',
      publicationStatus: 'active', verificationStatus: 'pending', recordCount: records.length,
      contentHash: 'test-hash', importedAt: '2026-07-18T00:00:00.000Z',
    };
  },
  async countDuas() { return records.length; },
  async listDuas(offset, limit): Promise<DuaSummary[]> {
    return records.slice(offset, offset + limit).map(({ parts: _parts, ...summary }) => summary);
  },
  async getDua(id) { return records.find((record) => record.id === id || record.legacyId === id); },
};
const app = createApp(() => repository);

describe('Fortress Platform API', () => {
  it('reports service health', async () => {
    const response = await app.request('/health', {}, env);
    const body = await response.json() as { status: string; environment: string; version: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.environment).toBe('test');
    expect(body.version).toBe('0.2.0');
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

  it('returns a structured error for missing content', async () => {
    const response = await app.request('/v1/duas/does-not-exist', {}, env);
    const body = await response.json() as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });
});
