export interface Env {
  AI: Ai;
  TRANSCRIBE_MODEL?: string;
  ANALYSIS_MODEL?: string;
  RATE_LIMIT: KVNamespace;
}

type PagesContext = {
  request: Request;
  env: Env;
};

export type PagesHandler = (context: PagesContext) => Promise<Response>;

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...headers,
    },
  });

export const ensurePost = (request: Request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }
  return null;
};

export const ensureSameOrigin = (request: Request) => {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (origin !== new URL(request.url).origin) {
    return json({ error: 'Cross-origin request rejected.' }, 403);
  }
  return null;
};

export const readJsonBody = async <T>(request: Request, maxBytes: number): Promise<T> => {
  const declaredLength = Number(request.headers.get('Content-Length') || '0');
  if (declaredLength > maxBytes) {
    throw new RequestError('Request body is too large.', 413);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new RequestError('Request body is too large.', 413);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RequestError('Invalid JSON body.', 400);
  }
};

export class RequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const getClientId = async (request: Request) => {
  const address =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

export const enforceRateLimit = async (
  context: PagesContext,
  bucket: string,
  limit: number,
  windowSeconds = 60
) => {
  const clientId = await getClientId(context.request);
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${bucket}:${clientId}:${windowId}`;
  const current = Number(await context.env.RATE_LIMIT.get(key)) || 0;

  if (current >= limit) {
    return json(
      { error: '利用回数が上限に達しました。少し待ってから再試行してください。' },
      429,
      { 'Retry-After': String(windowSeconds) }
    );
  }

  await context.env.RATE_LIMIT.put(key, String(current + 1), {
    expirationTtl: Math.max(120, windowSeconds * 2),
  });
  return null;
};

export const handleFunctionError = (error: unknown) => {
  if (error instanceof RequestError) {
    return json({ error: error.message }, error.status);
  }

  console.error('EchoMap function error:', error);
  return json({ error: 'サーバー処理に失敗しました。時間を置いて再試行してください。' }, 500);
};
