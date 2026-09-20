import { describe, expect, it } from 'vitest';
import { hasOversizedBody, isMutation, isTrustedBrowserMutation } from '../src/security';

const origins = {
  DEVELOPERS_URL: 'https://developers-test.fortressofmuslim.org',
  ADMIN_URL: 'https://admin-test.fortressofmuslim.org',
};

describe('management request security', () => {
  it('recognizes mutation methods without case sensitivity', () => {
    expect(isMutation('post')).toBe(true);
    expect(isMutation('PATCH')).toBe(true);
    expect(isMutation('GET')).toBe(false);
  });

  it('accepts trusted portal and non-browser requests', () => {
    expect(isTrustedBrowserMutation(new Request('https://auth.example/v1/control/profile', {
      method: 'POST', headers: { Origin: origins.DEVELOPERS_URL, 'Sec-Fetch-Site': 'same-site' },
    }), origins)).toBe(true);
    expect(isTrustedBrowserMutation(new Request('https://auth.example/v1/control/profile', { method: 'POST' }), origins)).toBe(true);
  });

  it('rejects cross-site and unknown browser origins', () => {
    expect(isTrustedBrowserMutation(new Request('https://auth.example/v1/control/profile', {
      method: 'POST', headers: { Origin: 'https://attacker.example' },
    }), origins)).toBe(false);
    expect(isTrustedBrowserMutation(new Request('https://auth.example/v1/control/profile', {
      method: 'POST', headers: { Origin: origins.DEVELOPERS_URL, 'Sec-Fetch-Site': 'cross-site' },
    }), origins)).toBe(false);
  });

  it('enforces the management body limit with and without Content-Length', async () => {
    const small = new Request('https://auth.example/v1/control/test', { method: 'POST', body: 'small' });
    const large = new Request('https://auth.example/v1/control/test', { method: 'POST', body: 'x'.repeat(65) });
    const declaredLarge = new Request('https://auth.example/v1/control/test', {
      method: 'POST', body: 'small', headers: { 'Content-Length': '1000' },
    });
    expect(await hasOversizedBody(small, 64)).toBe(false);
    expect(await hasOversizedBody(large, 64)).toBe(true);
    expect(await hasOversizedBody(declaredLarge, 64)).toBe(true);
  });
});
