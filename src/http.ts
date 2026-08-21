import { Session, timeToExpiry } from './session';
import { Document } from './jsonapi';
import { audit, log, redactSignedUrls } from './log';

/** The one host this client will send the session cookie to. */
const HOST = 'https://appstoreconnect.apple.com';

/**
 * The App Store Connect APIs this client speaks, as base paths on that host.
 *
 * One, since the Xcode Cloud surface left: the review centre, JSON:API under `iris/v1`.
 * Still a closed set rather than a base a caller hands in, because everything built here
 * goes out with the session cookie attached, so which prefixes exist is a decision this
 * file makes rather than a caller's.
 */
export const API_BASES = {
  iris: `${HOST}/iris/v1`,
} as const;

export type Api = keyof typeof API_BASES;

/** The review-centre base, under the name it has always had. Part of the library contract. */
export const BASE_URL = API_BASES.iris;

export class SessionExpiredError extends Error {
  constructor(status: number) {
    super(
      `App Store Connect rejected the session (HTTP ${status}). ` +
        'Log in with your browser, copy a fresh request as cURL and paste it over the capture file.'
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

/**
 * The methods this client speaks.
 *
 * A union rather than a bare string because one thing is read off a method — whether the
 * request changes anything — and a value that classifies wrong is a mutation that goes out
 * without an audit record.
 */
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

export type Method = (typeof METHODS)[number];

export interface RequestOptions {
  /** Which API the path is relative to. Defaults to the review centre. */
  api?: Api;
  method?: Method;
  query?: Query;
  body?: unknown;
  /**
   * Overrides the Content-Type a write would otherwise send. The captures disagreed about
   * it — the version PATCH sent application/json, the Resolution Center endpoints
   * application/vnd.api+json — and only the second kind is left, every one of them naming
   * the header explicitly. Which means the default below now has no caller.
   */
  contentType?: string;
}

/** Default team type for a normal App Store developer team, as the web UI sends it. */
export const TEAM_TYPE = 'PURPLESOFTWARE';

/**
 * The method to send, in the case the rest of this file expects.
 *
 * Whether a request mutates used to be decided by comparing the caller's string against
 * uppercase names, in two places. `{ method: 'patch' }` matched neither: the PATCH went to
 * Apple classified as a read, so it carried none of the write headers and — the part that
 * matters — left no `http.write` record, in a client whose audit trail is complete only
 * because every mutation passes through here. The union above stops a TypeScript caller
 * doing that; this is a security boundary, so it is also checked at runtime, where a
 * consumer in plain JavaScript lives. A method that isn't one of the five is refused
 * rather than guessed at.
 */
function methodOf(given: string | undefined): Method {
  const wanted = (given ?? 'GET').trim().toUpperCase();
  const method = METHODS.find((known) => known === wanted);
  if (!method) {
    throw new Error(`Unsupported HTTP method "${given}" — expected one of ${METHODS.join(', ')}`);
  }

  return method;
}

/**
 * The URL a resource path names, under the base above.
 *
 * Paths here are relative — `appStoreVersions/{id}`, `apps/{id}/resolutionCenterThreads` —
 * and an absolute URL is refused rather than sent. Everything this function returns is fetched
 * with the session cookie and the CSRF header attached, so a URL naming another host is
 * that cookie handed to that host, and `asc get` takes its path straight off the command
 * line. Nothing in this client ever asked for an absolute one: the single
 * cross-origin request, an upload part, deliberately doesn't come through `request` at all
 * — see `uploadPart`, which sends the presigned URL and no cookie.
 *
 * Which base is in play is chosen from the `Api` union, never from the path, so a caller
 * cannot leave it by writing `../`-anything.
 */
function apiUrl(api: Api, path: string): string {
  const base = API_BASES[api];
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new Error(
      `"${path}" is a URL, and this takes a path relative to ${base}. Sending it would ` +
        'carry the App Store Connect session cookie to whatever host it names.'
    );
  }

  return `${base}/${path.replace(/^\//, '')}`;
}

/**
 * Reads and writes don't send the same headers. The browser adds an Origin and the
 * X-Connect-Team-* pair only when mutating, and switches Content-Type to plain
 * application/json. Mirror that rather than sending one header set for everything.
 *
 * That default is now unreached: every write left in this client passes `contentType`
 * itself. It is left standing for the transport step to settle along with the rest of the
 * question — the `Api` union with one member, the methods no retained call uses — rather
 * than half-answered here.
 */
function headersFor(session: Session, mutating: boolean, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.api+json, application/json, text/csv',
    'content-type': 'application/vnd.api+json',
    ...session.headers,
    cookie: session.cookie,
  };

  if (mutating) {
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

  const method = methodOf(options.method);
  const api = options.api ?? 'iris';
  const target = `${apiUrl(api, path)}${buildQuery(options.query ?? {})}`;

  // Every mutation in this client funnels through here, so auditing at this one point is
  // what makes the trail complete — the higher-level calls add meaning, not coverage.
  // Classified once, from the normalised method, and passed on from there: the headers and
  // the audit record can't disagree about what kind of request this is. GET is the only
  // method here that changes nothing.
  const mutating = method !== 'GET';
  const started = Date.now();
  if (mutating) audit('http.write', 'start', { method, url: target, body: options.body });

  let response: Response;
  let text: string;
  try {
    response = await fetch(target, {
      method,
      headers: headersFor(session, mutating, options.contentType),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    text = await response.text();
  } catch (error) {
    // A transport failure on a write is the ambiguous case: the change may or may not
    // have landed, and that uncertainty is worth a record of its own.
    if (mutating) {
      audit('http.write', 'error', { method, url: target, ms: Date.now() - started, error });
    }
    throw error;
  }

  const outcome = { method, url: target, status: response.status, ms: Date.now() - started };
  if (mutating) audit('http.write', response.ok ? 'ok' : 'error', outcome);
  else log.debug('http.read', outcome);

  // A 403 isn't only an expired session: iris also uses it to refuse a query it doesn't
  // support, and reporting that as "log in again" sends you chasing the wrong problem.
  // Those refusals come back as a JSON:API error document; a dead session does not.
  if (response.status === 401 || (response.status === 403 && !text.includes('"errors"'))) {
    throw new SessionExpiredError(response.status);
  }
  if (!response.ok) throw new ApiError(response.status, target, text);
  if (!text) return undefined as T;

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, target, `Expected JSON, got:\n${text.slice(0, 500)}`);
  }

  if (!mutating) reportShortPage(target, options.query, parsed);
  return parsed;
}

/**
 * Says so when a collection may have come back incomplete.
 *
 * Nothing here reads a second page — iris is asked for one page and given one, and this
 * client's page sizes are the browser's own. What it can do is stop a clipped list from
 * looking like a whole one, which is the failure worth catching: a digest built on the
 * first 50 of 60 messages reports the wrong "latest message from Apple" without saying so.
 *
 * Two signals, because they are separately available. If iris returns a total it is
 * believed; that is the definite one, and whether it does depends on the endpoint. Failing
 * that, a page that came back exactly as long as the limit asked for is suspicious rather
 * than proven — raise the call's `limit` to find out.
 */
function reportShortPage(url: string, query: Query | undefined, document: unknown): void {
  if (typeof document !== 'object' || document === null) return;
  const { data, meta } = document as { data?: unknown; meta?: unknown };
  if (!Array.isArray(data)) return;
  const page: unknown[] = data;

  const total = pagingTotal(meta);
  if (total !== undefined && total > page.length) {
    log.warn('read.clipped', { url, returned: page.length, total });
    return;
  }

  const limit = query?.limit;
  if (typeof limit === 'number' && page.length === limit && limit > 0) {
    log.warn('read.atLimit', { url, returned: page.length, limit });
  }
}

/** JSON:API puts a collection's size under `meta.paging.total`, where the endpoint reports one. */
function pagingTotal(meta: unknown): number | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const paging = (meta as { paging?: unknown }).paging;
  if (typeof paging !== 'object' || paging === null) return undefined;
  const total = (paging as { total?: unknown }).total;
  return typeof total === 'number' ? total : undefined;
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

  const method = operation.method ?? 'PUT';
  const started = Date.now();
  // The presigned URL carries the signature in its query string, so only the host and
  // path go in the record — the rest is a credential.
  const where = { method, host: safeHost(operation.url), offset: operation.offset, length: operation.length };
  audit('asset.part', 'start', where);

  let response: Response;
  try {
    response = await fetch(operation.url, {
      method,
      headers,
      body: file.subarray(operation.offset, operation.offset + operation.length),
    });
  } catch (error) {
    audit('asset.part', 'error', { ...where, ms: Date.now() - started, error });
    throw error;
  }

  audit('asset.part', response.ok ? 'ok' : 'error', {
    ...where,
    status: response.status,
    ms: Date.now() - started,
  });

  if (!response.ok) {
    // Named by host and path, never by the presigned URL itself. An error message ends up
    // in the audit trail — `audited` logs it, and so does the CLI — and the signature in
    // that query string is the whole of the authorisation to write to Apple's storage.
    // The response body goes the same way, since a storage host will happily quote the
    // request it refused back at you.
    throw new ApiError(response.status, safeHost(operation.url), redactSignedUrls(await response.text()));
  }
}

/** Host and path of a URL, dropping the query string — which is where Apple's signatures live. */
function safeHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '<unparseable url>';
  }
}
