import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

const env = { PLATFORM_ENV: 'test' as const };

describe('Fortress Platform API', () => {
  it('reports service health', async () => {
    const response = await app.request('/health', {}, env);
    const body = await response.json() as { status: string; environment: string; version: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.environment).toBe('test');
    expect(body.version).toBe('0.1.1');
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
