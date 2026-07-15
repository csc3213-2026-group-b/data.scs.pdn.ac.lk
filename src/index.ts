export interface Env {
  DATA_SCS_PDN_ASSETS: Fetcher;
}

const allowedPaths: string[] = [];

const blockedExtensions: string[] = [];

function setCORSHeadersToAll(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin');
    const pathname = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') {
      const headers = new Headers();
      setCORSHeadersToAll(headers);
      return new Response(null, {
        status: 204,
        headers
      });
    }

    try {
      const isBlocked = blockedExtensions.some((ext) => pathname.endsWith(ext));
      const isAllowed = allowedPaths.includes(pathname);
      if (isBlocked && !isAllowed) {
        return new Response('Forbidden', {
          status: 403
        });
      }
      const assetResponse = await env.DATA_SCS_PDN_ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      setCORSHeadersToAll(headers);
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        headers
      });
    } catch (err) {
      console.error('Asset not found:', err);
      return new Response('Not Found', {
        status: 404
      });
    }
  }
};
