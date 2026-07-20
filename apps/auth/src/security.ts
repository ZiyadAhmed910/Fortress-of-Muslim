import type { Bindings } from './types';

export function isMutation(method: string) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function isTrustedBrowserMutation(request: Request, env: Pick<Bindings, 'DEVELOPERS_URL' | 'ADMIN_URL'>) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite === 'cross-site') return false;
  return !origin || origin === env.DEVELOPERS_URL || origin === env.ADMIN_URL;
}

export async function hasOversizedBody(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return true;
  if (!request.body) return false;

  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let received = 0;
  try {
    while (received <= maximumBytes) {
      const { done, value } = await reader.read();
      if (done) return false;
      received += value.byteLength;
    }
    return true;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
