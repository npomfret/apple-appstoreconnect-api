import { Session, timeToExpiry } from './session';
import { Document } from './jsonapi';
import { audit, log, redact } from './log';

/** The one host this client will send the session cookie to. */
const HOST = 'https://appstoreconnect.apple.com';

/**
 * The one API this client speaks: the review centre, JSON:API under `iris/v1`.
 *
 * A constant rather than a set a caller picks from. It was a set while the Xcode Cloud
 * surface was here, and a set with one member after that left — a decision shaped like a
 * choice that isn't one. Everything built on this base goes out with the session cookie
 * attached, so the base is this file's to decide; a second one would arrive with its own
 * capture and its own reason to exist.
 */
export const BASE_URL = `${HOST}/iris/v1`;

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
  /**
   * What the request was refused with, scrubbed.
   *
   * Scrubbed here rather than at each place it is written, because this body goes further
   * than the log: it is in the message, and the CLI's top-level handler prints an error
   * message to stderr on its own. iris quotes parts of the request back in a refusal, and
   * by the time it is a string the field-name scrub can no longer see the fields.
   */
  readonly body: string;

  constructor(readonly status: number, readonly url: string, body: string) {
    const safe = redact(body);
    super(`HTTP ${status} for ${url}\n${safe.slice(0, 2000)}`);
    this.body = safe;
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
 *
 * PUT is not among them. The only PUT this client sends is an upload part, and that one
 * deliberately doesn't come through here at all — different host, presigned URL, no cookie,
 * see `uploadPart`. Nothing addressed to iris uses it, so it is refused rather than left
 * standing on the strength of being a familiar verb.
 */
const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;

export type Method = (typeof METHODS)[number];

export interface RequestOptions {
  method?: Method;
  query?: Query;
  body?: unknown;
}

/** Default team type for a normal App Store developer team, as the web UI sends it. */
const TEAM_TYPE = 'PURPLESOFTWARE';

/**
 * The Content-Type every request here sends.
 *
 * iris is JSON:API, and the captures send this on reads and writes alike. It used to be
 * overridable per call because the captures disagreed: the version PATCH sent plain
 * `application/json` where the Resolution Center endpoints send this. That PATCH left with
 * the version slice and the hand-written one left with `asc patch`, so the other value has
 * had neither a caller nor a live capture behind it since. One constant, named here rather
 * than repeated at every write; a gap that turns out to need something else brings a
 * capture showing it.
 */
const CONTENT_TYPE = 'application/vnd.api+json';

/**
 * The method to send, in the case the rest of this file expects.
 *
 * Whether a request mutates used to be decided by comparing the caller's string against
 * uppercase names, in two places. `{ method: 'patch' }` matched neither: the PATCH went to
 * Apple classified as a read, so it carried none of the write headers and — the part that
 * matters — left no `http.write` record, in a client whose audit trail is complete only
 * because every mutation passes through here. The union above stops a TypeScript caller
 * doing that; this is a security boundary, so it is also checked at runtime, where a
 * consumer in plain JavaScript lives. A method that isn't one of the four is refused
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
 * The base is the module constant above and nothing is ever read off the path to choose it,
 * so a caller cannot leave it by writing `../`-anything.
 */
function apiUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new Error(
      `"${path}" is a URL, and this takes a path relative to ${BASE_URL}. Sending it would ` +
        'carry the App Store Connect session cookie to whatever host it names.'
    );
  }

  return `${BASE_URL}/${path.replace(/^\//, '')}`;
}

/**
 * Reads and writes don't send the same headers: the browser adds an Origin and the
 * X-Connect-Team-* pair only when mutating. Mirror that rather than sending one header set
 * for everything.
 *
 * Content-Type is no longer part of the difference. It was, while a write could ask for
 * `application/json` — but every write left here sends what the reads send, so it goes on
 * once, above, and the mutating branch is the three headers that genuinely only appear on
 * a write.
 */
function headersFor(session: Session, mutating: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.api+json, application/json, text/csv',
    'content-type': CONTENT_TYPE,
    ...session.headers,
    cookie: session.cookie,
  };

  if (mutating) {
    headers['origin'] = HOST;
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
  const target = `${apiUrl(path)}${buildQuery(options.query ?? {})}`;

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
      headers: headersFor(session, mutating),
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

export function patch<T = unknown>(session: Session, path: string, body: unknown): Promise<T> {
  return request<T>(session, path, { method: 'PATCH', body });
}

export function post<T = unknown>(session: Session, path: string, body: unknown): Promise<T> {
  return request<T>(session, path, { method: 'POST', body });
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
    // The body needs no separate treatment: a storage host will happily quote the request
    // it refused back at you, and `ApiError` scrubs what it is given.
    throw new ApiError(response.status, safeHost(operation.url), await response.text());
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
