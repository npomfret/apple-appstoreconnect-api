import { Session, timeToExpiry } from './session';
import { Document } from './jsonapi';

export const BASE_URL = 'https://appstoreconnect.apple.com/iris/v1';

export class SessionExpiredError extends Error {
  constructor(status: number) {
    super(
      `App Store Connect rejected the session (HTTP ${status}). ` +
        'Log in with your browser, copy a fresh request as cURL and run "asc login".'
    );
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly url: string, readonly body: string) {
    super(`HTTP ${status} for ${url}\n${body.slice(0, 2000)}`);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | boolean | string[] | undefined;
export type Query = Record<string, QueryValue>;

/**
 * Apple's endpoints use literal brackets and commas — `filter[state]=A,B` — and
 * URLSearchParams would percent-encode both. Mirror what the browser sends instead.
 */
export function buildQuery(query: Query): string {
  const parts: string[] = [];

  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const flat = Array.isArray(value) ? value.join(',') : String(value);
    parts.push(`${name}=${encodeURIComponent(flat).replace(/%2C/g, ',')}`);
  }

  return parts.length ? `?${parts.join('&')}` : '';
}

export interface RequestOptions {
  method?: string;
  query?: Query;
  body?: unknown;
}

/** Issues a single authenticated request against the iris API. */
export async function request<T = unknown>(
  session: Session,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const remaining = timeToExpiry(session);
  if (remaining !== undefined && remaining <= 0) {
    throw new SessionExpiredError(401);
  }

  const url = path.startsWith('http') ? path : `${BASE_URL}/${path.replace(/^\//, '')}`;
  const target = `${url}${buildQuery(options.query ?? {})}`;

  const headers: Record<string, string> = {
    accept: 'application/vnd.api+json, application/json, text/csv',
    'content-type': 'application/vnd.api+json',
    ...session.headers,
    cookie: session.cookie,
  };

  const response = await fetch(target, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();

  if (response.status === 401 || response.status === 403) throw new SessionExpiredError(response.status);
  if (!response.ok) throw new ApiError(response.status, target, text);
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, target, `Expected JSON, got:\n${text.slice(0, 500)}`);
  }
}

export function get<T extends Document>(session: Session, path: string, query?: Query): Promise<T> {
  return request<T>(session, path, { query });
}
