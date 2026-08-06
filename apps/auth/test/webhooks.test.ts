import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redeliverWebhook, signPayload, triggerWebhookEvent } from '../src/webhooks';

describe('webhooks (record.published / record.verified)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs a payload with a verifiable HMAC-SHA256 hex digest', async () => {
    const signature = await signPayload('whsec_test', '{"event":"record.published"}');
    const expected = createHmac('sha256', 'whsec_test').update('{"event":"record.published"}').digest('hex');
    expect(signature).toBe(expected);
  });

  it('delivers to an active subscription matching the event type, and logs a success row', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.published', 'record.verified'], 'active');
    const env = { IDENTITY_DB: d1(database) } as never;

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Fortress-Event']).toBe('record.published');
    expect(headers['X-Fortress-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const body = JSON.parse(String(init.body));
    expect(body.event).toBe('record.published');
    expect(body.data.canonicalIds).toEqual(['dua.hisn.001']);
    expect(body.triggeredBy).toBe('admin-1');

    const expectedSignature = `sha256=${createHmac('sha256', 'whsec_1').update(String(init.body)).digest('hex')}`;
    expect(headers['X-Fortress-Signature']).toBe(expectedSignature);

    const delivered = database.prepare('SELECT status, event_type AS eventType FROM webhook_deliveries').get() as { status: string; eventType: string };
    expect(delivered.status).toBe('success');
    expect(delivered.eventType).toBe('record.published');
  });

  it('does not call a subscription that is not subscribed to the firing event type', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.verified'], 'active');
    const env = { IDENTITY_DB: d1(database) } as never;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call a disabled subscription', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.published'], 'disabled');
    const env = { IDENTITY_DB: d1(database) } as never;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a failed delivery when the receiver responds with an error status, without throwing', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.published'], 'active');
    const env = { IDENTITY_DB: d1(database) } as never;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server error', { status: 500 })));

    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });

    const delivered = database.prepare('SELECT status, response_status AS responseStatus FROM webhook_deliveries').get() as { status: string; responseStatus: number };
    expect(delivered.status).toBe('failed');
    expect(delivered.responseStatus).toBe(500);
  });

  it('logs a failed delivery when the fetch itself throws (network error, timeout)', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.published'], 'active');
    const env = { IDENTITY_DB: d1(database) } as never;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });

    const delivered = database.prepare('SELECT status, response_snippet AS snippet FROM webhook_deliveries').get() as { status: string; snippet: string };
    expect(delivered.status).toBe('failed');
    expect(delivered.snippet).toBe('network unreachable');
  });

  it('redeliverWebhook resends the original payload to the original subscription', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.published'], 'active');
    const env = { IDENTITY_DB: d1(database) } as never;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });
    const firstDelivery = database.prepare('SELECT id FROM webhook_deliveries').get() as { id: string };

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await redeliverWebhook(env, firstDelivery.id, 'owner-1');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const deliveryCount = database.prepare('SELECT COUNT(*) AS count FROM webhook_deliveries').get() as { count: number };
    expect(deliveryCount.count).toBe(2);
  });

  it('redeliverWebhook refuses a delivery id that does not belong to the caller', async () => {
    const database = createIdentityDatabase();
    seedSubscription(database, 'sub1', 'https://example.com/hook', 'whsec_1', ['record.published'], 'active');
    const env = { IDENTITY_DB: d1(database) } as never;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    await triggerWebhookEvent(env, 'record.published', ['dua.hisn.001'], { triggeredBy: 'admin-1' });
    const firstDelivery = database.prepare('SELECT id FROM webhook_deliveries').get() as { id: string };

    const result = await redeliverWebhook(env, firstDelivery.id, 'someone-else');

    expect(result.ok).toBe(false);
  });
});

function createIdentityDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE webhook_subscriptions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      event_types_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE webhook_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      response_status INTEGER,
      response_snippet TEXT,
      attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

function seedSubscription(database: Database.Database, id: string, url: string, secret: string, eventTypes: string[], status: string) {
  database.prepare(`
    INSERT INTO webhook_subscriptions (id, owner_user_id, url, secret, event_types_json, status)
    VALUES (?, 'owner-1', ?, ?, ?, ?)
  `).run(id, url, secret, JSON.stringify(eventTypes), status);
}

function d1(database: Database.Database) {
  return {
    prepare(sql: string) {
      return new D1Statement(database.prepare(sql));
    },
  };
}

class D1Statement {
  constructor(
    private readonly statement: Database.Statement,
    private readonly parameters: unknown[] = [],
  ) {}

  bind(...parameters: unknown[]) {
    return new D1Statement(this.statement, parameters);
  }

  async first<T>() {
    return (this.statement.get(...this.parameters) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.statement.all(...this.parameters) as T[] };
  }

  async run() {
    const result = this.statement.run(...this.parameters);
    return { success: true, meta: { changes: result.changes } };
  }
}
