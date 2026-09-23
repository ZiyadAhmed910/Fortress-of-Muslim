import { describe, expect, it } from 'vitest';
import worker, { countAs, keyFor, tally, type Env } from '../src/index';

// The media Worker's counts go into a usage report for the audio provider, so the rules for what
// counts are the part worth pinning: one listen is one play however many ranges the player asks for,
// a download is a download, and nothing that is not a real fetch of the audio counts at all.

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://media.fortressofmuslim.org${path}`, { method, headers });

describe('what counts', () => {
  it('counts a plain fetch as a play', () => {
    expect(countAs(get('/duas/v1/dua-001/1.mp3'))).toBe('play');
  });

  it('counts the first range of a file as a play', () => {
    expect(countAs(get('/duas/v1/dua-001/1.mp3', { range: 'bytes=0-' }))).toBe('play');
    expect(countAs(get('/duas/v1/dua-001/1.mp3', { range: 'bytes=0-65535' }))).toBe('play');
  });

  it('does not count a seek, or any later range', () => {
    // Otherwise one listen through a long recording would count as a dozen plays.
    expect(countAs(get('/duas/v1/dua-001/1.mp3', { range: 'bytes=65536-' }))).toBeNull();
    expect(countAs(get('/duas/v1/dua-001/1.mp3', { range: 'bytes=-500' }))).toBeNull();
  });

  it('counts an offline download as a download, not a play', () => {
    expect(countAs(get('/duas/v1/dua-001/1.mp3?intent=download'))).toBe('download');
  });

  it('does not count a HEAD', () => {
    expect(countAs(get('/duas/v1/dua-001/1.mp3', {}, 'HEAD'))).toBeNull();
  });
});

describe('what is served', () => {
  it('serves published prefixes only', () => {
    expect(keyFor('/duas/v1/dua-001/1.mp3')).toBe('duas/v1/dua-001/1.mp3');
    // A future collection in the bucket is not public until it is listed.
    expect(keyFor('/quran/alafasy/001001.mp3')).toBeNull();
    expect(keyFor('/')).toBeNull();
  });

  it('refuses path tricks', () => {
    expect(keyFor('/duas/../private/x.mp3')).toBeNull();
    expect(keyFor('/duas//v1/x.mp3')).toBeNull();
  });
});

// A bucket holding one 1000-byte file, and a database that records every tally.
function fakeEnv() {
  const body = new Uint8Array(1000).map((_, index) => index % 256);
  const tallies: unknown[][] = [];
  const object = (range?: { offset: number; length: number }) => ({
    size: body.length,
    httpEtag: '"abc"',
    range,
    body: new Blob([range ? body.slice(range.offset, range.offset + range.length) : body]).stream(),
    writeHttpMetadata: (headers: Headers) => headers.set('content-type', 'audio/mpeg'),
  });
  const env = {
    MEDIA: {
      head: async (key: string) => (key === 'duas/v1/dua-001/1.mp3' ? object() : null),
      get: async (key: string, options: { range?: Headers }) => {
        if (key !== 'duas/v1/dua-001/1.mp3') return null;
        const header = options.range?.get('range');
        const match = header && /^bytes=(\d+)-(\d*)$/.exec(header);
        if (!match) return object();
        const offset = Number(match[1]);
        const end = match[2] ? Number(match[2]) : body.length - 1;
        return object({ offset, length: end - offset + 1 });
      },
    },
    CONTENT_DB: {
      prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { tallies.push(values); } }) }),
    },
  } as unknown as Env;
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => waits.push(promise) } as unknown as ExecutionContext;
  return { env, ctx, tallies, settle: () => Promise.all(waits) };
}

describe('serving a file', () => {
  it('returns the whole file with CORS and a long cache, and counts one play', async () => {
    const { env, ctx, tallies, settle } = fakeEnv();
    const response = await worker.fetch(get('/duas/v1/dua-001/1.mp3'), env, ctx);
    await settle();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('1000');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toMatch(/immutable/);
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
    expect(tallies).toHaveLength(1);
    expect(tallies[0]?.slice(1)).toEqual(['duas/v1/dua-001/1.mp3', 'play']);
  });

  it('answers a range with 206 and the right slice', async () => {
    const { env, ctx } = fakeEnv();
    const response = await worker.fetch(get('/duas/v1/dua-001/1.mp3', { range: 'bytes=100-199' }), env, ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(response.headers.get('content-length')).toBe('100');
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  it('counts nothing for a seek', async () => {
    const { env, ctx, tallies, settle } = fakeEnv();
    await worker.fetch(get('/duas/v1/dua-001/1.mp3', { range: 'bytes=500-' }), env, ctx);
    await settle();
    expect(tallies).toHaveLength(0);
  });

  it('404s what is not there, and what is not published', async () => {
    const { env, ctx } = fakeEnv();
    expect((await worker.fetch(get('/duas/v1/missing.mp3'), env, ctx)).status).toBe(404);
    expect((await worker.fetch(get('/private/anything.mp3'), env, ctx)).status).toBe(404);
  });

  it('refuses anything but reads', async () => {
    const { env, ctx } = fakeEnv();
    expect((await worker.fetch(get('/duas/v1/dua-001/1.mp3', {}, 'PUT'), env, ctx)).status).toBe(405);
  });
});

describe('tallying', () => {
  it('writes today, by file and kind, and never throws', async () => {
    const calls: unknown[][] = [];
    const db = { prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { calls.push(values); } }) }) } as unknown as D1Database;
    await tally(db, 'duas/v1/dua-001/1.mp3', 'download', new Date('2026-09-23T10:00:00Z'));
    expect(calls[0]).toEqual(['2026-09-23', 'duas/v1/dua-001/1.mp3', 'download']);

    const broken = { prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database;
    await expect(tally(broken, 'x', 'play')).resolves.toBeUndefined();
  });
});
