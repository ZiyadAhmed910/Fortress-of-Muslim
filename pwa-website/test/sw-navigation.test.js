import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Opening the app must not wait on the network. It used to: navigations went to Bluehost first and
// fell back to the cached shell only when the request failed outright, so a slow server or a weak
// signal held the launch splash for seconds, and the first launch after every deploy re-downloaded
// the whole app. This runs the real sw.js fetch handler against a fake cache and network.

const SOURCE = readFileSync(resolve(process.cwd(), 'sw.js'), 'utf8');
const ORIGIN = 'https://fortressofmuslim.org';

function loadWorker({ cached = {} } = {}) {
  const listeners = {};
  const store = new Map(Object.entries(cached).map(([path, body]) => [new URL(path, `${ORIGIN}/`).href, body]));
  const cache = {
    match: async (request) => {
      const key = new URL(typeof request === 'string' ? request : request.url, `${ORIGIN}/`).href;
      return store.has(key) ? new Response(store.get(key)) : undefined;
    },
    put: async () => {},
  };
  const network = vi.fn(async () => new Response('from network'));
  const self = {
    location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    clients: { claim: () => {} },
  };
  const caches = { open: async () => cache, match: cache.match, keys: async () => [] };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, network);
  const navigate = async (path) => {
    let responded;
    listeners.fetch({
      request: { method: 'GET', mode: 'navigate', url: `${ORIGIN}${path}`, headers: new Headers() },
      respondWith: (promise) => { responded = promise; },
    });
    return (await responded)?.text();
  };
  return { navigate, network };
}

describe('opening the app', () => {
  it('shows the cached shell without touching the network', async () => {
    const worker = loadWorker({ cached: { './index.html': 'cached shell' } });
    expect(await worker.navigate('/')).toBe('cached shell');
    expect(worker.network).not.toHaveBeenCalled();
  });

  it('does the same for deep links, which are index.html on the server too', async () => {
    const worker = loadWorker({ cached: { './index.html': 'cached shell' } });
    expect(await worker.navigate('/hisn/chapter27')).toBe('cached shell');
    expect(await worker.navigate('/quran/2/255')).toBe('cached shell');
    expect(await worker.navigate('/?screen=qibla')).toBe('cached shell');
    expect(worker.network).not.toHaveBeenCalled();
  });

  it('goes to the network when there is no cached shell yet', async () => {
    const worker = loadWorker();
    expect(await worker.navigate('/')).toBe('from network');
  });

  it('never serves the shell in place of the reset page', async () => {
    // reset.html is the escape hatch for a broken worker; answering it from that worker's cache
    // would make it useless.
    const worker = loadWorker({ cached: { './index.html': 'cached shell' } });
    expect(await worker.navigate('/reset.html')).toBe('from network');
    expect(worker.network).toHaveBeenCalledTimes(1);
  });
});
