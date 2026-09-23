// The media Worker: serves the app's large, on-demand audio from R2 and counts what it serves.
//
// Why a Worker in front of the bucket, rather than a public bucket URL: the counts. Each play and
// each offline download is tallied into D1 as it happens (see migration 0029), which is what a
// usage report for an audio provider is built from. It also means every URL is ours --
// media.fortressofmuslim.org -- so nothing a listener's browser requests names anyone else.
//
// Everything here is read-only for the public: GET and HEAD of objects, nothing else. Ranges are
// honoured, because audio players seek by asking for byte ranges and an iPhone will not play a file
// from a server that refuses them.

export interface Env {
  MEDIA: R2Bucket;
  CONTENT_DB: D1Database;
}

// Only these prefixes are served. The bucket will hold other things over time; publishing a new
// collection should be a decision recorded here, not a side effect of uploading it.
const PUBLIC_PREFIXES = ['duas/'];

const CORS = {
  // Anyone may read the files -- they are played by the app from its own origin, and the offline
  // download reads the body with fetch(), which needs this.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges, etag',
};

export type Kind = 'play' | 'download';

/**
 * Whether a request should be counted, and as what. Null means "not counted".
 *
 * An offline download is marked by the app (?intent=download) and is always a whole-file fetch.
 * Anything else is a play, and a play counts only when it asks for the start of the file: players
 * fetch in ranges and ask again on every seek, so counting every request would turn one listen into
 * a dozen. HEAD requests and ranges starting past byte 0 are not counted at all.
 */
export function countAs(request: Request): Kind | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.searchParams.get('intent') === 'download') return 'download';
  const range = request.headers.get('range');
  if (!range) return 'play';
  const start = /^bytes=(\d*)-/.exec(range.trim())?.[1];
  return start === '0' ? 'play' : null;
}

/** The object key for a request path, or null if it is not something we publish. */
export function keyFor(pathname: string): string | null {
  const key = decodeURIComponent(pathname.replace(/^\/+/, ''));
  if (!key || key.includes('..') || key.includes('//')) return null;
  return PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix)) ? key : null;
}

/**
 * Adds one to today's count. Never throws: a failed tally must not cost anyone the audio they asked
 * for, so it is logged and dropped. An upsert, so the first play of the day creates the row.
 */
export async function tally(db: D1Database, path: string, kind: Kind, now = new Date()) {
  try {
    await db.prepare(`
      INSERT INTO media_daily_stats (day, path, kind, count) VALUES (?, ?, ?, 1)
      ON CONFLICT (day, path, kind) DO UPDATE SET count = count + 1
    `).bind(now.toISOString().slice(0, 10), path, kind).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'media_tally_failed', path, kind, message: String(error) }));
  }
}

function headersFor(object: R2Object, extra: Record<string, string> = {}) {
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // Stored with the object at upload; fall back to the same policy if it was not. Keys are versioned
  // (duas/v1/...), so a changed recording is a new URL and a cached one never goes stale.
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=31536000, immutable');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'fortress-media' }, { headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...CORS, allow: 'GET, HEAD, OPTIONS' } });
    }

    const key = keyFor(url.pathname);
    if (!key) return new Response('Not found', { status: 404, headers: CORS });

    if (request.method === 'HEAD') {
      const head = await env.MEDIA.head(key);
      if (!head) return new Response('Not found', { status: 404, headers: CORS });
      return new Response(null, { headers: headersFor(head, { 'content-length': String(head.size) }) });
    }

    const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
    if (!object) return new Response('Not found', { status: 404, headers: CORS });

    // onlyIf matched a precondition (If-None-Match): R2 returns metadata without a body.
    if (!('body' in object)) return new Response(null, { status: 304, headers: headersFor(object) });

    const kind = countAs(request);
    if (kind) ctx.waitUntil(tally(env.CONTENT_DB, key, kind));

    const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
    if (range && request.headers.has('range')) {
      const offset = range.offset ?? (range.suffix !== undefined ? object.size - range.suffix : 0);
      const length = range.length ?? object.size - offset;
      return new Response(object.body, {
        status: 206,
        headers: headersFor(object, {
          'content-range': `bytes ${offset}-${offset + length - 1}/${object.size}`,
          'content-length': String(length),
        }),
      });
    }
    return new Response(object.body, { headers: headersFor(object, { 'content-length': String(object.size) }) });
  },
} satisfies ExportedHandler<Env>;
