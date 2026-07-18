import { API_VERSION, PLATFORM_NAME, PLATFORM_VERSION, paginationSchema } from '@fortress/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { decodeCursor, encodeCursor } from './lib/pagination';
import { countDuas, getDua, listDuas } from './repositories/dua-repository';
import type { ApiVariables, Bindings } from './types';

const DATASET_VERSION = 'legacy-2026-07-11-v2';

export const app = new Hono<{ Bindings: Bindings; Variables: ApiVariables }>();

app.use('*', logger());
app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));
app.use('*', async (context, next) => {
  const requestId = context.req.header('CF-Ray') ?? crypto.randomUUID();
  context.set('requestId', requestId);
  await next();
  context.header('X-Request-ID', requestId);
  context.header('X-Fortress-Dataset-Version', DATASET_VERSION);
});

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

app.get('/v1', (context) => context.json({
  name: PLATFORM_NAME,
  version: API_VERSION,
  resources: {
    dataset: '/v1/datasets/current',
    duas: '/v1/duas',
  },
}));

app.get('/v1/datasets/current', (context) => context.json({
  id: DATASET_VERSION,
  status: 'legacy-import-unverified',
  recordCount: countDuas(),
  recordType: 'dua',
  warning: 'This initial imported dataset is pending canonical editorial verification.',
}));

app.get('/v1/duas', (context) => {
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
  const items = listDuas(offset, parsed.data.limit);
  const nextOffset = offset + items.length;

  return context.json({
    data: items,
    pagination: {
      limit: parsed.data.limit,
      nextCursor: nextOffset < countDuas() ? encodeCursor(nextOffset) : null,
    },
    meta: {
      datasetVersion: DATASET_VERSION,
      requestId: context.get('requestId'),
    },
  });
});

app.get('/v1/duas/:id', (context) => {
  const dua = getDua(context.req.param('id'));
  if (!dua) {
    return context.json({
      error: {
        code: 'not_found',
        message: 'Dua was not found.',
        requestId: context.get('requestId'),
      },
    }, 404);
  }

  return context.json({
    data: dua,
    meta: {
      datasetVersion: DATASET_VERSION,
      requestId: context.get('requestId'),
    },
  });
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
