export interface Env {
  DATA_SCS_PDN_ASSETS: Fetcher;
}

const allowedPaths: string[] = [];

const blockedExtensions: string[] = [];

function setCORSHeaders(headers: Headers, origin: string | null): void {
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  } else {
    headers.set('Access-Control-Allow-Origin', '*');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Client-Id'
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin');
    const pathname = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') {
      const headers = new Headers();
      setCORSHeaders(headers, origin);
      return new Response(null, {
        status: 204,
        headers
      });
    }

    try {
      const isBlocked = blockedExtensions.some((ext) => pathname.endsWith(ext));
      const isAllowed = allowedPaths.includes(pathname);
      if (isBlocked && !isAllowed) {
        const headers = new Headers();
        setCORSHeaders(headers, origin);
        return new Response('Forbidden', {
          status: 403,
          headers
        });
      }
      const assetResponse = await env.DATA_SCS_PDN_ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      setCORSHeaders(headers, origin);
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        headers
      });
    } catch (err) {
      console.error('Asset not found:', err);
      const headers = new Headers();
      setCORSHeaders(headers, origin);
      return new Response('Not Found', {
        status: 404,
        headers
      });
    }
  }
};
