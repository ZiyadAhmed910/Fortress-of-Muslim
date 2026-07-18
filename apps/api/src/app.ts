import { API_VERSION, CURRENT_DATASET_ID, PLATFORM_NAME, PLATFORM_VERSION, paginationSchema } from '@fortress/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { decodeCursor, encodeCursor } from './lib/pagination';
import type { ContentRepository } from './repositories/content-repository';
import { D1ContentRepository } from './repositories/d1-content-repository';
import type { ApiVariables, Bindings } from './types';

type RepositoryFactory = (bindings: Bindings) => ContentRepository;

const defaultRepositoryFactory: RepositoryFactory = (bindings) => new D1ContentRepository(bindings.CONTENT_DB);

export function createApp(repositoryFactory: RepositoryFactory = defaultRepositoryFactory) {
  const app = new Hono<{ Bindings: Bindings; Variables: ApiVariables }>();

  app.use('*', logger());
  app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));
  app.use('*', async (context, next) => {
    const requestId = context.req.header('CF-Ray') ?? crypto.randomUUID();
    context.set('requestId', requestId);
    await next();
    context.header('X-Request-ID', requestId);
    context.header('X-Fortress-Dataset-Version', CURRENT_DATASET_ID);
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

  app.get('/v1/datasets/current', async (context) => {
    const dataset = await repositoryFactory(context.env).getCurrentDataset();
    return context.json({
      ...dataset,
      recordType: 'dua',
      warning: 'This initial imported dataset is pending canonical editorial verification.',
    });
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
        datasetVersion: CURRENT_DATASET_ID,
        requestId: context.get('requestId'),
      },
    });
  });

  app.get('/v1/duas/:id', async (context) => {
    const dua = await repositoryFactory(context.env).getDua(context.req.param('id'));
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
        datasetVersion: CURRENT_DATASET_ID,
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

  return app;
}

export const app = createApp();
