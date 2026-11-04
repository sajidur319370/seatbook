export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

type RequestOptions = RequestInit & { clientMutationId?: string };

async function send(path: string, init: RequestOptions): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.clientMutationId) headers.set('X-Client-Mutation-Id', init.clientMutationId); // used on Day 15
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'NETWORK_ERROR',
      e?.message ?? 'Request failed',
      e?.details,
    );
  }
  return data as T;
}

let refreshing: Promise<boolean> | null = null;

async function refreshInLock(): Promise<boolean> {
  return navigator.locks.request('seatbook-refresh', async () => {
    const res = await send('/auth/refresh', { method: 'POST' });
    if (!res.ok) {
      setAccessToken(null);
      return false;
    }
    const { accessToken: next } = (await res.json()) as { accessToken: string };
    setAccessToken(next);
    return true;
  });
}

/** One refresh at a time, in this tab (single-flight) AND across tabs (Web Lock). */
export function refreshAccessToken(): Promise<boolean> {
  return (refreshing ??= refreshInLock().finally(() => {
    refreshing = null;
  }));
}

/**
 * Auth endpoints answer 401 for wrong passwords and bad cookies: don't refresh for those.
 * logout-all is the exception. It uses the access token, so an expired one must be refreshed;
 * otherwise the sessions would never be revoked, even though the user sees "logged out".
 */
const canRefreshOn401 = (path: string) => !path.startsWith('/auth/') || path === '/auth/logout-all';

export async function api<T>(path: string, init: RequestOptions = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && canRefreshOn401(path)) {
    if (await refreshAccessToken()) res = await send(path, init); // retry once
  }
  return parse<T>(res);
}

const body = (b: unknown) => (b === undefined ? undefined : JSON.stringify(b));

export const http = {
  get: <T>(p: string) => api<T>(p),
  post: <T>(p: string, b?: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'POST', body: body(b ?? {}) }),
  patch: <T>(p: string, b: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'PATCH', body: body(b) }),
  put: <T>(p: string, b: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'PUT', body: body(b) }),
  delete: <T>(p: string, b?: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'DELETE', body: body(b) }),
};
