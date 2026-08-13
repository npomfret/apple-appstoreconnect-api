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
  /**
   * Overrides the Content-Type a write would otherwise send. Not every write agrees:
   * the version PATCH uses application/json, the asset endpoints application/vnd.api+json.
   */
  contentType?: string;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Default team type for a normal App Store developer team, as the web UI sends it. */
export const TEAM_TYPE = 'PURPLESOFTWARE';

/**
 * Reads and writes don't send the same headers. The browser adds an Origin and the
 * X-Connect-Team-* pair only when mutating, and switches Content-Type to plain
 * application/json. Mirror that rather than sending one header set for everything.
 */
function headersFor(session: Session, method: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.api+json, application/json, text/csv',
    'content-type': 'application/vnd.api+json',
    ...session.headers,
    cookie: session.cookie,
  };

  if (WRITE_METHODS.has(method)) {
    headers['content-type'] = contentType ?? 'application/json';
    headers['origin'] = 'https://appstoreconnect.apple.com';
    const teamId = session.headers['x-connect-team-id'] ?? session.teamId;
    if (teamId) headers['x-connect-team-id'] = teamId;
    headers['x-connect-team-type'] = session.headers['x-connect-team-type'] ?? TEAM_TYPE;
  }

  return headers;
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
  const method = options.method ?? 'GET';

  const response = await fetch(target, {
    method,
    headers: headersFor(session, method, options.contentType),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();

  // A 403 isn't only an expired session: iris also uses it to refuse a query it doesn't
  // support, and reporting that as "log in again" sends you chasing the wrong problem.
  // Those refusals come back as a JSON:API error document; a dead session does not.
  if (response.status === 401 || (response.status === 403 && !text.includes('"errors"'))) {
    throw new SessionExpiredError(response.status);
  }
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

export function patch<T = unknown>(
  session: Session,
  path: string,
  body: unknown,
  contentType?: string
): Promise<T> {
  return request<T>(session, path, { method: 'PATCH', body, contentType });
}

export function post<T = unknown>(
  session: Session,
  path: string,
  body: unknown,
  contentType?: string
): Promise<T> {
  return request<T>(session, path, { method: 'POST', body, contentType });
}

export function del<T = unknown>(session: Session, path: string): Promise<T> {
  return request<T>(session, path, { method: 'DELETE' });
}

/**
 * One leg of an asset upload, as iris hands it back on the reservation response. The url
 * is presigned and already carries the part number, so the client just replays these in
 * order rather than working out where the bytes go.
 */
export interface UploadOperation {
  method?: string;
  url: string;
  /** Byte range of the source file this part covers. */
  offset: number;
  length: number;
  requestHeaders?: { name: string; value: string }[];
}

/**
 * Sends one part to Apple's object storage. Deliberately does not go through `request`:
 * these leave for a different host (object-storage.apple.com) and the whole of the auth
 * is the presigned query string, so the session cookie must not follow the bytes there.
 */
export async function uploadPart(operation: UploadOperation, file: Buffer): Promise<void> {
  const headers: Record<string, string> = {};
  for (const header of operation.requestHeaders ?? []) headers[header.name] = header.value;

  const response = await fetch(operation.url, {
    method: operation.method ?? 'PUT',
    headers,
    body: file.subarray(operation.offset, operation.offset + operation.length),
  });

  if (!response.ok) {
    throw new ApiError(response.status, operation.url, await response.text());
  }
}
