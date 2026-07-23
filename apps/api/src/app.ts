import {
  API_VERSION,
  PLATFORM_NAME,
  PLATFORM_VERSION,
  askQuestionSchema,
  contentTypeSchema,
  hadithListSchema,
  hadithSearchSchema,
  paginationSchema,
  partPositionSchema,
  searchSchema,
  vectorIndexBatchSchema,
  type Dua,
  type DuaPart,
} from '@fortress/contracts';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { decodeCursor, encodeCursor } from './lib/pagination';
import { executeRecordQuery } from './lib/record-query';
import { RagRateLimitError, answerQuestion, getRagStatus, indexRecordBatch } from './rag';
import type { ContentRepository } from './repositories/content-repository';
import { D1ContentRepository } from './repositories/d1-content-repository';
import type { ApiVariables, Bindings } from './types';

type RepositoryFactory = (bindings: Bindings) => ContentRepository;
type ApiContext = Context<{ Bindings: Bindings; Variables: ApiVariables }>;

const defaultRepositoryFactory: RepositoryFactory = (bindings) => new D1ContentRepository(bindings.CONTENT_DB);

export function createApp(repositoryFactory: RepositoryFactory = defaultRepositoryFactory) {
  const app = new Hono<{ Bindings: Bindings; Variables: ApiVariables }>();

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Fortress-API-Key', 'X-Fortress-Index-Key', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID', 'X-Fortress-Dataset-Version', 'X-Fortress-Platform-Version', 'Server-Timing'],
  }));
  app.use('*', async (context, next) => {
    const startedAt = performance.now();
    const requestId = requestIdFrom(context.req.raw);
    context.set('requestId', requestId);
    await next();
    const duration = Math.max(0, performance.now() - startedAt);
    context.header('X-Request-ID', requestId);
    context.header('X-Fortress-Platform-Version', PLATFORM_VERSION);
    context.header('Server-Timing', `app;dur=${duration.toFixed(1)}`);
    applySecurityHeaders(context.res.headers);
    console.log(JSON.stringify({
      event: 'http_request', service: 'api', requestId, method: context.req.method,
      path: context.req.path, status: context.res.status, durationMs: Number(duration.toFixed(1)),
      environment: context.env?.PLATFORM_ENV ?? 'local',
    }));
  });

  const authorize = async (context: ApiContext, next: () => Promise<void>) => {
    const credential = readCredential(context);
    if (!credential) return unauthorized(context, 'An API key or OAuth access token is required.');

    const scopes = requiredScopes(context.req.path);
    try {
      if (credential.startsWith('fom_')) {
        const permissions: Record<string, string[]> = scopes.includes('content:search')
          ? { content: ['search'] }
          : scopes.includes('dataset:read') ? { dataset: ['read'] } : { content: ['read'] };
        const result = await context.env.AUTH.verifyApiKey(credential, permissions);
        if (!result.valid || !result.key) return unauthorized(context, result.error?.message ?? 'API key is invalid.');
        context.set('principalId', result.key.referenceId);
        context.set('credentialId', result.key.id);
      } else {
        const result = await context.env.AUTH.verifyBearerToken(credential, scopes);
        if (!result.valid || !result.subject) return unauthorized(context, result.error ?? 'Access token is invalid.');
        context.set('principalId', result.ownerUserId ?? result.subject);
        context.set('credentialId', result.clientId ?? result.subject);
      }
    } catch (error) {
      console.error('Credential verification failed.', error);
      return context.json({
        error: {
          code: 'authentication_unavailable',
          message: 'Credential verification is temporarily unavailable.',
          requestId: context.get('requestId'),
        },
      }, 503);
    }
    await next();
  };

  app.use('/v1/queries/*', authorize);

  app.get('/', (context) => context.json({
    name: PLATFORM_NAME,
    description: 'Open-source Islamic data and agent platform',
    apiVersion: API_VERSION,
    platformVersion: PLATFORM_VERSION,
    environment: context.env?.PLATFORM_ENV ?? 'local',
    documentation: '/v1',
  }));

  app.get('/health', (context) => context.json({
    status: 'ok',
    service: 'fortress-platform-api',
    version: PLATFORM_VERSION,
    environment: context.env?.PLATFORM_ENV ?? 'local',
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/database', async (context) => {
    const dataset = await repositoryFactory(context.env).getCurrentDataset();
    return context.json({
      status: 'ok',
      service: 'fortress-content-database',
      version: PLATFORM_VERSION,
      datasetId: dataset.id,
      recordCount: dataset.recordCount,
      environment: context.env?.PLATFORM_ENV ?? 'local',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/v1/*', async (context, next) => {
    let state: Awaited<ReturnType<Bindings['AUTH']['getServiceState']>>;
    try {
      state = await context.env.AUTH.getServiceState('api');
    } catch (error) {
      console.error('Service-control lookup failed; public read API remains available.', error);
      state = { serviceKey: 'api', status: 'active', message: '', enforcement: 'worker' };
    }
    if (state.status !== 'active') {
      context.header('Retry-After', '300');
      context.header('Cache-Control', 'no-store');
      return context.json({
        error: {
          code: state.status === 'disabled' ? 'service_disabled' : 'service_maintenance',
          message: state.message,
          requestId: context.get('requestId'),
        },
      }, 503);
    }
    const dataset = await repositoryFactory(context.env).getCurrentDataset();
    context.set('activeDatasetId', dataset.id);
    await next();
    context.header('X-Fortress-Dataset-Version', dataset.id);
  });

  app.get('/v1', (context) => context.json({
    name: PLATFORM_NAME,
    version: API_VERSION,
    resources: {
      dataset: '/v1/datasets/current',
      duas: '/v1/duas',
      search: '/v1/duas/search?q=waking',
      randomDua: '/v1/duas/random',
      duaParts: '/v1/duas/{id}/parts',
      duaEvidence: '/v1/duas/{id}/evidence',
      collections: '/v1/collections',
      hadith: '/v1/hadith',
      hadithSearch: '/v1/hadith/search?q=intentions',
      hadithCanonicalResolver: '/v1/hadith/resolve?collection=bukhari&book=1&number=1',
      ask: '/v1/ask',
      namedQuery: '/v1/queries/{id}',
    },
  }));

  app.get('/v1/datasets/current', async (context) => {
    const dataset = await repositoryFactory(context.env).getCurrentDataset();
    return context.json({
      id: dataset.id,
      version: dataset.sourceVersion,
      publicationStatus: dataset.publicationStatus,
      verificationStatus: dataset.verificationStatus,
      recordCount: dataset.recordCount,
      canonicalHash: dataset.contentHash || null,
      publishedAt: dataset.importedAt,
      recordTypes: ['dua', 'hadith'],
      canonicalSource: 'Fortress Platform',
    });
  });

  app.get('/v1/collections', async (context) => {
    const rawType = context.req.query('type');
    const parsedType = rawType ? contentTypeSchema.safeParse(rawType) : null;
    if (parsedType && !parsedType.success) {
      return context.json({ error: { code: 'invalid_request', message: 'Collection type must be dua or hadith.', requestId: context.get('requestId') } }, 400);
    }
    const data = await repositoryFactory(context.env).listCollections(parsedType?.data);
    return context.json({ data, meta: { total: data.length, ...responseMeta(context) } });
  });

  app.get('/v1/duas', async (context) => {
    const parsed = paginationSchema.safeParse(context.req.query());
    if (!parsed.success) {
      return context.json({
        error: {
          code: 'invalid_request',
          message: 'Pagination parameters are invalid.',
          requestId: context.get('requestId'),
        },
      }, 400);
    }

    const offset = decodeCursor(parsed.data.cursor);
    const repository = repositoryFactory(context.env);
    const [items, total] = await Promise.all([
      repository.listDuas(offset, parsed.data.limit),
      repository.countDuas(),
    ]);
    const nextOffset = offset + items.length;

    return context.json({
      data: items,
      pagination: {
        limit: parsed.data.limit,
        nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null,
      },
      meta: {
        datasetVersion: context.get('activeDatasetId'),
        requestId: context.get('requestId'),
      },
    });
  });

  app.get('/v1/duas/search', async (context) => {
    const parsed = searchSchema.safeParse(context.req.query());
    if (!parsed.success) {
      return context.json({
        error: {
          code: 'invalid_request',
          message: 'Search requires a query between 2 and 200 characters and valid pagination parameters.',
          requestId: context.get('requestId'),
        },
      }, 400);
    }

    const offset = decodeCursor(parsed.data.cursor);
    const result = await repositoryFactory(context.env).searchDuas(parsed.data.q, offset, parsed.data.limit);
    const nextOffset = offset + result.items.length;

    return context.json({
      data: result.items,
      pagination: {
        limit: parsed.data.limit,
        nextCursor: nextOffset < result.total ? encodeCursor(nextOffset) : null,
      },
      meta: {
        query: parsed.data.q,
        total: result.total,
        datasetVersion: context.get('activeDatasetId'),
        requestId: context.get('requestId'),
      },
    });
  });

  app.get('/v1/duas/random', async (context) => {
    const dua = await repositoryFactory(context.env).getRandomDua();
    if (!dua) {
      return context.json({
        error: {
          code: 'not_found',
          message: 'No published dua is available.',
          requestId: context.get('requestId'),
        },
      }, 404);
    }

    context.header('Cache-Control', 'no-store');
    return context.json({ data: dua, meta: responseMeta(context) });
  });

  app.get('/v1/duas/:id/evidence', async (context) => {
    const evidence = await repositoryFactory(context.env).getDuaEvidence(context.req.param('id'));
    if (!evidence) return duaNotFound(context.get('requestId'), context);
    return context.json({ data: evidence, meta: responseMeta(context) });
  });

  app.get('/v1/duas/:id/parts', async (context) => {
    const dua = await repositoryFactory(context.env).getDua(context.req.param('id'));
    if (!dua) return duaNotFound(context.get('requestId'), context);

    return context.json({
      data: toDuaParts(dua),
      meta: {
        duaId: dua.id,
        partCount: dua.partCount,
        ...responseMeta(context),
      },
    });
  });

  app.get('/v1/duas/:id/parts/:position', async (context) => {
    const parsedPosition = partPositionSchema.safeParse(context.req.param('position'));
    if (!parsedPosition.success) {
      return context.json({
        error: {
          code: 'invalid_request',
          message: 'Part position must be a positive integer.',
          requestId: context.get('requestId'),
        },
      }, 400);
    }

    const dua = await repositoryFactory(context.env).getDua(context.req.param('id'));
    if (!dua) return duaNotFound(context.get('requestId'), context);

    const part = toDuaParts(dua)[parsedPosition.data - 1];
    if (!part) {
      return context.json({
        error: {
          code: 'part_not_found',
          message: 'Dua part was not found.',
          requestId: context.get('requestId'),
        },
      }, 404);
    }

    return context.json({ data: part, meta: responseMeta(context) });
  });

  app.get('/v1/duas/:id', async (context) => {
    const dua = await repositoryFactory(context.env).getDua(context.req.param('id'));
    if (!dua) {
      return duaNotFound(context.get('requestId'), context);
    }

    return context.json({
      data: dua,
      meta: {
        datasetVersion: context.get('activeDatasetId'),
        requestId: context.get('requestId'),
      },
    });
  });

  app.get('/v1/hadith', async (context) => {
    const parsed = hadithListSchema.safeParse(context.req.query());
    if (!parsed.success) return invalidHadithRequest(context, 'Hadith pagination or collection is invalid.');
    const offset = decodeCursor(parsed.data.cursor);
    const repository = repositoryFactory(context.env);
    const [items, total] = await Promise.all([
      repository.listHadith(parsed.data.collection, offset, parsed.data.limit),
      repository.countHadith(parsed.data.collection),
    ]);
    const nextOffset = offset + items.length;
    return context.json({
      data: items,
      pagination: { limit: parsed.data.limit, nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null },
      meta: { total, collection: parsed.data.collection ?? null, ...responseMeta(context) },
    });
  });

  app.get('/v1/hadith/search', async (context) => {
    const parsed = hadithSearchSchema.safeParse(context.req.query());
    if (!parsed.success) return invalidHadithRequest(context, 'Search requires text between 2 and 200 characters and valid pagination.');
    const offset = decodeCursor(parsed.data.cursor);
    try {
      const result = await repositoryFactory(context.env).searchHadith(parsed.data.q, parsed.data.collection, offset, parsed.data.limit);
      const nextOffset = offset + result.items.length;
      return context.json({
        data: result.items,
        pagination: { limit: parsed.data.limit, nextCursor: nextOffset < result.total ? encodeCursor(nextOffset) : null },
        meta: { query: parsed.data.q, total: result.total, collection: parsed.data.collection ?? null, ...responseMeta(context) },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('letters or numbers')) return invalidHadithRequest(context, error.message);
      throw error;
    }
  });

  app.get('/v1/hadith/resolve', async (context) => {
    const collection = context.req.query('collection')?.trim() ?? '';
    const book = context.req.query('book')?.trim() ?? '';
    const number = context.req.query('number')?.trim() ?? '';
    if (
      !/^[a-z0-9-]{2,80}$/.test(collection)
      || !/^[\p{L}\p{N}._-]{1,80}$/u.test(book)
      || !/^[\p{L}\p{N}._:-]{1,120}$/u.test(number)
    ) {
      return invalidHadithRequest(context, 'Collection, book, and number are required canonical path components.');
    }
    const hadith = await repositoryFactory(context.env).resolveHadithPath(collection, book, number);
    if (!hadith) {
      return context.json({ error: { code: 'not_found', message: 'Published canonical Hadith was not found.', requestId: context.get('requestId') } }, 404);
    }
    return context.json({ data: hadith, meta: responseMeta(context) });
  });

  app.get('/v1/hadith/:id', async (context) => {
    const hadith = await repositoryFactory(context.env).getHadith(context.req.param('id'));
    if (!hadith) return context.json({ error: { code: 'not_found', message: 'Hadith was not found.', requestId: context.get('requestId') } }, 404);
    return context.json({ data: hadith, meta: responseMeta(context) });
  });

  app.post('/v1/ask', async (context) => {
    const parsed = askQuestionSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: { code: 'invalid_request', message: 'Question must contain between 5 and 500 characters.', requestId: context.get('requestId') } }, 400);
    try {
      const data = await answerQuestion(
        context.env,
        repositoryFactory(context.env),
        parsed.data.question,
        context.req.header('CF-Connecting-IP') ?? 'unknown-client',
      );
      context.header('Cache-Control', 'no-store');
      return context.json({ data, meta: responseMeta(context) });
    } catch (error) {
      if (error instanceof RagRateLimitError) {
        context.header('Retry-After', '86400');
        return context.json({ error: { code: 'rate_limited', message: error.message, requestId: context.get('requestId') } }, 429);
      }
      throw error;
    }
  });

  app.get('/v1/ask/status', async (context) => {
    const data = await getRagStatus(context.env, repositoryFactory(context.env));
    context.header('Cache-Control', 'no-store');
    return context.json({ data, meta: responseMeta(context) });
  });

  app.post('/v1/internal/vector-index', async (context) => {
    if (!context.env.INDEXING_SECRET || !await secretsMatch(context.req.header('X-Fortress-Index-Key') ?? '', context.env.INDEXING_SECRET)) {
      return context.json({ error: { code: 'not_found', message: 'Route was not found.', requestId: context.get('requestId') } }, 404);
    }
    const parsed = vectorIndexBatchSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: { code: 'invalid_request', message: 'Index cursor or batch size is invalid.', requestId: context.get('requestId') } }, 400);
    const data = await indexRecordBatch(context.env, parsed.data.cursor, parsed.data.limit);
    context.header('Cache-Control', 'no-store');
    return context.json({ data, meta: responseMeta(context) });
  });

  app.get('/v1/queries/:id', async (context) => {
    const definition = await context.env.AUTH.getNamedQuery(context.req.param('id'), context.get('principalId'));
    if (!definition) {
      return context.json({ error: { code: 'not_found', message: 'Named query was not found.', requestId: context.get('requestId') } }, 404);
    }
    if (definition.queryKind === 'record_query') {
      try {
        const data = await executeRecordQuery(context.env.CONTENT_DB, definition, context.req.query());
        return context.json({ data, meta: { namedQueryId: definition.id, rowCount: data.length, ...responseMeta(context) } });
      } catch (error) {
        return context.json({ error: { code: 'invalid_query_parameters', message: error instanceof Error ? error.message : 'The query could not be executed.', requestId: context.get('requestId') } }, 400);
      }
    }
    const repository = repositoryFactory(context.env);
    if (definition.operation === 'get_by_id') {
      const dua = await repository.getDua(definition.parameters.duaId ?? '');
      if (!dua) return duaNotFound(context.get('requestId'), context);
      return context.json({ data: dua, meta: { namedQueryId: definition.id, ...responseMeta(context) } });
    }
    const limit = Math.min(100, Math.max(1, definition.parameters.limit ?? 20));
    if (definition.operation === 'search') {
      const result = await repository.searchDuas(definition.parameters.query ?? '', 0, limit);
      return context.json({ data: result.items, meta: { namedQueryId: definition.id, total: result.total, ...responseMeta(context) } });
    }
    const [items, total] = await Promise.all([repository.listDuas(0, limit), repository.countDuas()]);
    return context.json({ data: items, meta: { namedQueryId: definition.id, total, ...responseMeta(context) } });
  });

  app.notFound((context) => context.json({
    error: {
      code: 'not_found',
      message: 'Route was not found.',
      requestId: context.get('requestId'),
    },
  }, 404));

  app.onError((error, context) => {
    console.error(error);
    return context.json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        requestId: context.get('requestId'),
      },
    }, 500);
  });

  return app;
}

function requestIdFrom(request: Request) {
  const supplied = request.headers.get('X-Request-ID');
  if (supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return request.headers.get('CF-Ray') ?? crypto.randomUUID();
}

function applySecurityHeaders(headers: Headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export const app = createApp();

function responseMeta(context: ApiContext) {
  return { datasetVersion: context.get('activeDatasetId'), requestId: context.get('requestId') };
}

function toDuaParts(dua: Dua): DuaPart[] {
  return dua.parts.map((segments, index) => ({
    duaId: dua.id,
    position: index + 1,
    segmentCount: segments.length,
    segments,
  }));
}

function duaNotFound(requestId: string, context: ApiContext) {
  return context.json({
    error: {
      code: 'not_found',
      message: 'Dua was not found.',
      requestId,
    },
  }, 404);
}

function readCredential(context: ApiContext) {
  const apiKey = context.req.header('X-Fortress-API-Key')?.trim();
  if (apiKey) return apiKey;
  const authorization = context.req.header('Authorization')?.trim();
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
}

function requiredScopes(path: string) {
  if (path.startsWith('/v1/queries/')) return ['content:read'];
  if (path === '/v1/duas/search') return ['content:search'];
  if (path.startsWith('/v1/datasets/')) return ['dataset:read'];
  return ['content:read'];
}

function unauthorized(context: ApiContext, message: string) {
  context.header('WWW-Authenticate', 'Bearer realm="Fortress Platform API"');
  return context.json({
    error: {
      code: 'unauthorized',
      message,
      requestId: context.get('requestId'),
    },
  }, 401);
}

function invalidHadithRequest(context: ApiContext, message: string) {
  return context.json({ error: { code: 'invalid_request', message, requestId: context.get('requestId') } }, 400);
}

async function readJsonBody(context: ApiContext) {
  try { return await context.req.json(); } catch { return null; }
}

async function secretsMatch(candidate: string, expected: string) {
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  return left.every((value, index) => value === right[index]);
}
