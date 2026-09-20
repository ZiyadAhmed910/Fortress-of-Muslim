import type { Bindings } from './types';

export type WebhookEventType = 'record.published' | 'record.verified';
export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = ['record.published', 'record.verified'];

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_CANONICAL_IDS_IN_PAYLOAD = 500;

type Subscription = { id: string; url: string; secret: string };

// Best-effort delivery: awaited by the caller before it responds to the admin action that
// triggered the event, run in parallel across matching subscriptions, each bounded by a short
// timeout so one slow receiver can't stall the triggering publish/verify request for long.
// There is no automatic retry queue -- a failed attempt is only ever retried if the developer
// clicks Redeliver in the console. See migrations/0011_webhooks.sql for why.
export async function triggerWebhookEvent(
  env: Bindings,
  eventType: WebhookEventType,
  canonicalIds: string[],
  meta: { triggeredBy: string },
): Promise<void> {
  if (!canonicalIds.length) return;
  const subscriptions = await env.IDENTITY_DB.prepare(`
    SELECT id, url, secret FROM webhook_subscriptions
    WHERE status = 'active' AND EXISTS (
      SELECT 1 FROM json_each(webhook_subscriptions.event_types_json) je WHERE je.value = ?
    )
  `).bind(eventType).all<Subscription>();
  if (!subscriptions.results.length) return;

  const payload = {
    event: eventType,
    triggeredAt: new Date().toISOString(),
    triggeredBy: meta.triggeredBy,
    data: {
      canonicalIds: canonicalIds.slice(0, MAX_CANONICAL_IDS_IN_PAYLOAD),
      count: canonicalIds.length,
    },
  };
  const body = JSON.stringify(payload);
  await Promise.allSettled(subscriptions.results.map((subscription) => deliverOne(env, subscription, eventType, body)));
}

async function deliverOne(env: Bindings, subscription: Subscription, eventType: string, body: string): Promise<void> {
  let responseStatus: number | null = null;
  let responseSnippet: string | null = null;
  let status: 'success' | 'failed' = 'failed';
  try {
    const signature = await signPayload(subscription.secret, body);
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Fortress-Event': eventType,
        'X-Fortress-Signature': `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseStatus = response.status;
    responseSnippet = (await response.text()).slice(0, 500);
    status = response.ok ? 'success' : 'failed';
  } catch (error) {
    responseSnippet = (error instanceof Error ? error.message : 'Delivery failed.').slice(0, 500);
  }
  await env.IDENTITY_DB.prepare(`
    INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload_json, status, response_status, response_snippet)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(`whd_${crypto.randomUUID()}`, subscription.id, eventType, body, status, responseStatus, responseSnippet).run();
}

// HMAC-SHA256 over the raw JSON body, hex-encoded, sent as `X-Fortress-Signature: sha256=<hex>`
// -- the same header/format convention used by Stripe and GitHub webhooks, so receivers can reuse
// existing verification code rather than learning a Fortress-specific scheme.
export async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function redeliverWebhook(env: Bindings, deliveryId: string, ownerUserId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const original = await env.IDENTITY_DB.prepare(`
    SELECT delivery.event_type AS eventType, delivery.payload_json AS payloadJson,
           subscription.id AS subscriptionId, subscription.url AS url, subscription.secret AS secret,
           subscription.status AS subscriptionStatus
    FROM webhook_deliveries delivery
    JOIN webhook_subscriptions subscription ON subscription.id = delivery.subscription_id
    WHERE delivery.id = ? AND subscription.owner_user_id = ?
  `).bind(deliveryId, ownerUserId).first<{
    eventType: string; payloadJson: string; subscriptionId: string; url: string; secret: string; subscriptionStatus: string;
  }>();
  if (!original) return { ok: false, message: 'Delivery was not found.' };
  if (original.subscriptionStatus !== 'active') return { ok: false, message: 'This webhook is disabled. Enable it before redelivering.' };
  await deliverOne(env, { id: original.subscriptionId, url: original.url, secret: original.secret }, original.eventType, original.payloadJson);
  return { ok: true };
}

export function parseWebhookRegistration(body: Record<string, unknown>): { ok: true; value: { url: string; eventTypes: WebhookEventType[] } } | { ok: false; message: string } {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'Enter a valid HTTPS webhook URL.' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, message: 'Webhook URLs must use HTTPS.' };
  const eventTypes = Array.isArray(body.eventTypes)
    ? [...new Set(body.eventTypes.map(String).filter((value): value is WebhookEventType => WEBHOOK_EVENT_TYPES.includes(value as WebhookEventType)))]
    : [];
  if (!eventTypes.length) return { ok: false, message: 'Choose at least one event.' };
  return { ok: true, value: { url: parsed.toString(), eventTypes } };
}
