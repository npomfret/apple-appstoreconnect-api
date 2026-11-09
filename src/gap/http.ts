import { PortalSession, Session, timeToExpiry } from './session';
import { Document } from '../shared/jsonapi';
import { audit, log } from '../shared/log';
import { ApiError } from '../shared/errors';
import { buildQuery, Query } from '../shared/query';

/**
 * The host the App Store Connect session cookie goes to. The developer portal's cookie, a
 * separate credential, goes only to `PORTAL_HOST` below.
 */
const HOST = 'https://appstoreconnect.apple.com';

/** What a collection said about the page it just sent, whatever shape it arrived in. */
export interface Page {
  /** How many records came back in this response. */
  returned: number;
  /** How many exist, where the API says so. */
  total?: number;
  /** The page size the API actually applied, where it says so. */
  limit?: number;
}

/**
 * An API this client speaks, and everything that differs between one and the next.
 *
 * There is one of these per base, and the list of them is this file's rather than a
 * caller's, because everything built on a base goes out with the session cookie attached.
 * `BASE_URL` was a bare constant until 2026-08-22, under a comment saying a second base
 * "would arrive with its own capture and its own reason to exist". One has: see `CI`.
 *
 * The fields are what the bases disagree about, and every one of them is a thing that was
 * observed rather than assumed. Nothing general is here on the chance another base wants
 * it. The third and fourth, `RA` and `PPM`, arrived on 2026-10-27 with four recordings of
 * the Business pane behind them, and needed no field the first two had not.
 */
export interface Api {
  /** What to call this API when a message has to say which one refused something. */
  readonly name: string;
  readonly baseUrl: string;
  readonly accept: string;
  /**
   * The `Content-Type` every request to this API carries, where it has one. Absent means
   * the header is not sent at all, which is not the same as sending a default.
   */
  readonly contentType?: string;
  /**
   * Whether this API may only be read. A method other than GET is refused before a request
   * is built, so a base mapped for a read cannot grow a write by accident.
   */
  readonly readOnly?: boolean;
  /** Whether a 403 from this API means the session is dead rather than the request refused. */
  readonly expiredOn403: (body: string) => boolean;
  /** What this API says about a page it sent, or undefined where the response is not one. */
  readonly pageOf: (document: unknown) => Page | undefined;
  /** Added to a 403's message, where this API's refusals have a known common cause. */
  readonly refusalHint?: string;
}

/**
 * The review centre: JSON:API under `iris/v1`, and everything this client was built for.
 *
 * `accept` is the wider of the two the browser is recorded sending: 78 of the 214 recorded
 * reads ask for exactly this, and the other 133 for `application/vnd.api+json` alone.
 * Asking for more than iris will send costs nothing.
 *
 * `contentType` is on reads as well as writes, which is what the captures show. It used to
 * be overridable per call because they disagreed: the version PATCH sent plain
 * `application/json` where the Resolution Center endpoints send this. That PATCH left with
 * the version slice and the hand-written one left with `asc patch`, so the other value has
 * had neither a caller nor a live capture behind it since.
 *
 * A 403 here is not only an expired session: iris also uses it to refuse a query it does
 * not support, and those refusals come back as a JSON:API error document where a dead
 * session does not.
 */
export const IRIS: Api = {
  name: 'iris',
  baseUrl: `${HOST}/iris/v1`,
  accept: 'application/vnd.api+json, application/json, text/csv',
  contentType: 'application/vnd.api+json',
  expiredOn403: (body) => !body.includes('"errors"'),
  pageOf: (document) => {
    if (typeof document !== 'object' || document === null) return undefined;
    const { data, meta } = document as { data?: unknown; meta?: unknown };
    if (!Array.isArray(data)) return undefined;
    return { returned: data.length, ...irisPaging(meta) };
  },
};

/**
 * Xcode Cloud, for the one field on it Apple's official API has no schema for.
 *
 * **This is not JSON:API and answers a request claiming to be with a 403.** Established by
 * hand against a healthy session on 2026-08-21, one header varied at a time on one URL:
 * `accept: *\/*` 200, `content-type: application/json` 200, `content-type: text/plain` 200,
 * `content-type: application/vnd.api+json` **403**. That single header is why every `ci-*`
 * command in this repository was refused for the whole of its life, and it is why
 * `contentType` is absent here rather than set to something. The browser sends no
 * `Content-Type` at all on a CI read and `accept: *\/*` on every one of the 22 CI requests
 * recorded from the browser.
 *
 * **Read-only, and enforced rather than intended.** A `PUT` to `workflows-v15/{id}` is
 * recorded in both directions with read-backs, so the write is evidenced — and it is a
 * full-document replace of fourteen keys, on the workflow that builds every push, which is
 * a design and an approval of its own rather than a thing to leave reachable. Nothing here
 * can send one.
 *
 * **A 403 cannot be read as an expired session here.** iris's rule is that a refusal
 * carries a JSON:API error document; CI never returns one, and the 403 above came back as
 * `content-type: text/html` with a zero-length body while `asc status` on the same capture
 * said the session was healthy with hours left. So a CI 403 is reported as the refusal it
 * is, with the cause that actually produced one.
 *
 * **A collection is a one-key envelope, and the key is not always `items`.** Across the
 * recordings Xcode Cloud spells it three ways — `items` on ten routes, and `products` and
 * `workflows` on the infrastructure-validation ones — so matching `items` by name meant the
 * short-page guard could not fire for two of the three, and a products list clipped at the
 * page size would have looked like the whole list. What separates a page from the compound
 * documents on this base is the count of top-level keys rather than their spelling: a page
 * has exactly one and it holds an array, where `usage/days`, `repos-v3` and
 * `configuration-options-v10` each carry several and are not paged at all. The three routes
 * that answer with a bare top-level array — `notices-v2`, `scm-providers-v2`,
 * `product-environment-variables` — are deliberately not counted as pages: none is a call
 * this client makes, and none is asked for with a limit, so there is nothing for the guard
 * to compare against.
 */
export const CI: Api = {
  name: 'Xcode Cloud',
  baseUrl: `${HOST}/ci/api`,
  accept: '*/*',
  readOnly: true,
  expiredOn403: () => false,
  refusalHint:
    'A 403 here is a refusal rather than a dead session — check "asc status" before ' +
    'assuming otherwise. Xcode Cloud refuses any request that claims to be JSON:API.',
  pageOf: (document) => {
    if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined;
    const entries = Object.entries(document);
    if (entries.length !== 1) return undefined;
    const value = entries[0][1];
    return Array.isArray(value) ? { returned: value.length } : undefined;
  },
};

/**
 * What the Business pane's two bases have in common, which is everything but the base.
 *
 * Recorded across four captures of the Agreements, Tax and Banking page, 2026-08-26 and
 * 2026-10-27. Every read on both prefixes sends `application/json` as both `Accept` and
 * `Content-Type` — a GET with a content type, as iris does. The August recording, the one
 * exported with cookies kept, shows all 34 carrying the cookie, the CSRF header and the team
 * pair `headersFor` already sends; the October three were exported without the cookie or the
 * team pair, and still show the CSRF header on every request.
 *
 * **Read-only.** Three writes on `ppm/v1` are recorded — the DSA trader declaration, which
 * carries identity documents behind an `id.apple.com` code check, its validation echo, and a
 * US W-8BEN tax form — and each is a legal filing rather than an operation for `--yes`.
 *
 * **A 403 is not read as an expired session.** None was recorded on either base, so how one
 * reports a dead session is unknown, and reporting a refusal as "log in again" is the
 * misdirection iris's rule exists to avoid. A 401 still is one.
 *
 * **Nothing here is paged.** None of the mapped reads sends a limit or receives a total.
 */
const BUSINESS = {
  accept: 'application/json',
  contentType: 'application/json',
  readOnly: true,
  expiredOn403: () => false,
  refusalHint: 'Nothing recorded shows how this base reports a dead session — check "asc status".',
  pageOf: () => undefined,
} as const satisfies Omit<Api, 'name' | 'baseUrl'>;

/**
 * The legacy iTunes Connect resource API, for the one route on it this client reads:
 * `contentProviders/{team}/agreements`. Its envelope is `{data, messages, constraints}`, with
 * the payload under `data` and Apple's notices beside it — neither JSON:API nor `/ci/api`.
 */
export const RA: Api = {
  ...BUSINESS,
  name: 'iTunes Connect (ra)',
  baseUrl: `${HOST}/WebObjects/iTunesConnect.woa/ra/v1`,
};

/**
 * Payments and compliance: `ppm/v1` and `ppm/complianceform/v1`, one base because they are
 * one service on the browser's side — same media types, same `{accountId, …}` envelope, and
 * every path scoped by the account id `ppm/v1/accountLookup` hands back.
 */
export const PPM: Api = {
  ...BUSINESS,
  name: 'Payments and compliance (ppm)',
  baseUrl: `${HOST}/ppm`,
};

/** The review centre's base, which is what a path means when nothing says otherwise. */
export const BASE_URL = IRIS.baseUrl;

export class SessionExpiredError extends Error {
  constructor(status: number) {
    super(
      `App Store Connect rejected the session (HTTP ${status}). ` +
        'Log in with your browser, copy a fresh request as cURL and paste it over the capture file.'
    );
    this.name = 'SessionExpiredError';
  }
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
  /** Which API the path is relative to. The review centre unless a caller says otherwise. */
  api?: Api;
}

/** Default team type for a normal App Store developer team, as the web UI sends it. */
const TEAM_TYPE = 'PURPLESOFTWARE';

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
function methodOf(api: Api, given: string | undefined): Method {
  const wanted = (given ?? 'GET').trim().toUpperCase();
  const method = METHODS.find((known) => known === wanted);
  if (!method) {
    throw new Error(`Unsupported HTTP method "${given}" — expected one of ${METHODS.join(', ')}`);
  }

  // A base is mapped for the calls it was recorded making. Where those are all reads, the
  // write is refused here rather than left to whoever adds the next function — which is
  // the difference between a surface that is read-only and one that merely has no writes
  // in it yet.
  if (method !== 'GET' && api.readOnly) {
    throw new Error(
      `${api.name} is mapped read-only here, so a ${method} to ${api.baseUrl} is refused. ` +
        'A write to it needs its own evidence, its own confirmation and its own design.'
    );
  }

  return method;
}

/**
 * The URL a resource path names, under the API it was given — checked on the URL that comes
 * out, not on the text that went in.
 *
 * Paths here are relative — `appStoreVersions/{id}`, `apps/{id}/resolutionCenterThreads` —
 * and everything this returns is fetched with the session cookie and the CSRF header
 * attached, so where it lands is this function's whole job. `raw` takes its path from
 * whatever called it and `asc get` takes that off the command line.
 *
 * **A path that climbs out of the base is refused, and one used to get through.** This said
 * a caller could not leave the base "by writing `../`-anything", and that was true only of
 * paths spelled that way. The URL parser resolves more than a literal dot segment: `%2e%2e`
 * and `%2E%2E` are dot segments too, and on a special scheme `\` separates path segments
 * like `/` does — so `resolutionCenterThreads/%2e%2e/%2e%2e/%2e%2e/ci/api/v1/ciBuildRuns`
 * reached `/ci/api`, which was closed at the time, and `.../v1/apps` reached the official
 * record the gap boundary exists to refuse. `withinBoundary` in `api.ts` did not stop either:
 * it reads the first segment to decide the family, and the first segment said
 * `resolutionCenterThreads`. Both went out with the cookie on.
 *
 * So the check is the resolved URL against the base, which is the thing that has to be true
 * — no list of the ways a path can be written to mean somewhere else, since that list is the
 * parser's and it is longer than it looks. The host check above stays for the message it
 * gives; this would catch an absolute URL as well.
 *
 * `/ci/api` is a base in its own right again since 2026-08-22, which changes nothing here:
 * a base is reached by the calls mapped onto it, each carrying the media types and the
 * read-only rule that base was recorded needing, and not by an iris path that resolves into
 * it. An iris request that landed there would arrive claiming to be JSON:API, which is the
 * one thing Xcode Cloud refuses outright.
 *
 * A query or a fragment is refused for a nearer reason: `request` appends `buildQuery` to
 * what comes back from here, so a `?` in the path makes a second one, and everything after a
 * `#` is not sent at all — `resolutionCenterThreads#` with a filter beside it silently asked
 * for the unfiltered list. The query is `options.query`'s to state.
 */
function apiUrl(baseUrl: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new Error(
      `"${path}" is a URL, and this takes a path relative to ${baseUrl}. Sending it would ` +
        'carry the session cookie to whatever host it names.'
    );
  }

  if (path.includes('?') || path.includes('#')) {
    throw new Error(
      `"${path}" is not a path: a query belongs in the request's own query, not in the path. ` +
        'What follows a "#" is never sent, and a "?" here would leave the request carrying two.'
    );
  }

  const url = new URL(`${baseUrl}/${path.replace(/^\/+/, '')}`);
  if (!url.href.startsWith(`${baseUrl}/`)) {
    throw new Error(
      `"${path}" resolves to ${url.href}, which is outside ${baseUrl}. Each base here is ` +
        'reached by the calls mapped onto it, and every request built here goes out with a ' +
        'session on it.'
    );
  }

  return url.href;
}

/**
 * The headers a request goes out with: what the capture carried, then the ones this file
 * owns.
 *
 * **The order is the rule.** The capture is spread first and the transport's own headers
 * are written over it. It read the other way round until 2026-08-21, which made Accept and
 * Content-Type the capture's rather than this file's — and iris is served from two
 * front-end bundles that disagree about both. Of the 214 reads recorded from the browser,
 * 133 send `application/vnd.api+json` as each, and 78 send `application/json` with the
 * wider Accept; the split is per page, not per route, and both spellings reach routes this
 * client uses. So the request that was right-clicked decided the media types on every
 * request afterwards, including the POST that sends a reply to App Review — where all four
 * recorded POSTs send `application/vnd.api+json`. The media types belong to the `Api` above
 * and not to a caller; the capture is not a caller, and now neither is it.
 *
 * **The team pair is not a write header.** `X-Connect-Team-ID` and `X-Connect-Team-Type`
 * are on every iris request in the recordings — 214 of 214 reads and 10 of 10 writes — so
 * they go on both. Setting them only when mutating was invisible while the capture came
 * from a browser GET, since it then carried them itself and they arrived through the
 * spread; a capture that is only a cookie jar, which the CLI's help offers as enough, sent
 * reads without either. The capture's own values win where it has them: they are that
 * account's, and `session.teamId` is decoded from the cookie as the fallback.
 *
 * **`Origin` is the one that really is write-only**: absent from all 214 recorded reads,
 * present on all 10 recorded writes.
 */
function headersFor(api: Api, session: Session, mutating: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    ...session.headers,
    accept: api.accept,
    cookie: session.cookie,
  };

  // Set, or deleted. An API with no content type of its own is one that must not be sent a
  // content type at all — Xcode Cloud answers `application/vnd.api+json` with a 403 — and
  // the spread above is a `Session`, which a library caller builds as a plain record and
  // may have put one in. `KEEP_HEADERS` stopped carrying either media type from a capture
  // on 2026-08-21; this is the same rule holding for a session that did not come from one.
  if (api.contentType) headers['content-type'] = api.contentType;
  else delete headers['content-type'];

  const teamId = session.headers['x-connect-team-id'] ?? session.teamId;
  if (teamId) headers['x-connect-team-id'] = teamId;
  headers['x-connect-team-type'] = session.headers['x-connect-team-type'] ?? TEAM_TYPE;

  if (mutating) headers['origin'] = HOST;

  return headers;
}

/** Issues a single authenticated request against one of the APIs above. */
export async function request<T = unknown>(
  session: Session,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const remaining = timeToExpiry(session);
  if (remaining !== undefined && remaining <= 0) {
    throw new SessionExpiredError(401);
  }

  const api = options.api ?? IRIS;
  const method = methodOf(api, options.method);
  const target = `${apiUrl(api.baseUrl, path)}${buildQuery(options.query ?? {})}`;

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
      headers: headersFor(api, session, mutating),
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

  // A 403 isn't only an expired session, and telling the two apart is the API's own rule
  // rather than a general one — reporting a refusal as "log in again" sends you chasing
  // the wrong problem, and each base refuses in its own dialect. A 401 needs no rule.
  if (response.status === 401 || (response.status === 403 && api.expiredOn403(text))) {
    throw new SessionExpiredError(response.status);
  }
  if (!response.ok) {
    throw new ApiError(response.status, target, text, response.status === 403 ? api.refusalHint : undefined);
  }
  if (!text) return undefined as T;

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, target, `Expected JSON, got:\n${text.slice(0, 500)}`);
  }

  if (!mutating) reportShortPage(api, target, options.query, parsed);
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
 * **iris answers the question itself.** Every collection it returns carries
 * `meta.paging.total` beside `meta.paging.limit` — 161 array responses across the browser
 * recordings, all 161 with both — so the total is what decides this, and when there is one
 * there is nothing left to suspect. Guessing on top of it was a false alarm: a page of 20
 * out of a total of 20, asked for with `limit=20`, is the whole list and used to be
 * reported as one that might be short.
 *
 * **The page size is iris's, not ours.** `meta.paging.limit` is the size it actually
 * applied: the number asked for wherever a request named one, and `50` — its own default —
 * in every recorded request that named none. Reading the limit off the outgoing query
 * instead meant the fallback could not fire at all for the two calls whose page is most
 * likely to clip, `listMessages` and `listThreads`, since neither sends a top-level `limit`
 * and both are held to that default of 50.
 *
 * So the suspicion below is a guard rather than an observation: no recorded response omits
 * a total. It stays because iris is undocumented and a route that reports none would
 * otherwise clip in silence — and it now has iris's own page size to compare against.
 */
function reportShortPage(api: Api, url: string, query: Query | undefined, document: unknown): void {
  const page = api.pageOf(document);
  if (!page) return;
  const { returned, total, limit: applied } = page;

  // A total is definite in both directions: bigger than the page means clipped, and equal
  // to it means whole. Neither case has anything left for the heuristic to add.
  if (total !== undefined) {
    if (total > returned) log.warn('read.clipped', { url, returned, total });
    return;
  }

  // Where an API reports no page size of its own — Xcode Cloud reports neither a total nor
  // a limit — the number asked for is all there is to compare against, which is exactly
  // the case this fallback was written for.
  const limit = applied ?? query?.limit;
  if (typeof limit === 'number' && limit > 0 && returned === limit) {
    log.warn('read.atLimit', { url, returned, limit });
  }
}

/**
 * What iris says about the page it just sent: how many records exist, and how many it was
 * willing to put in one response. JSON:API keeps both under `meta.paging`, and iris fills
 * them in on every collection recorded from the browser.
 */
function irisPaging(meta: unknown): { total?: number; limit?: number } {
  if (typeof meta !== 'object' || meta === null) return {};
  const record = (meta as { paging?: unknown }).paging;
  if (typeof record !== 'object' || record === null) return {};
  const { total, limit } = record as { total?: unknown; limit?: unknown };
  return {
    total: typeof total === 'number' ? total : undefined,
    limit: typeof limit === 'number' ? limit : undefined,
  };
}

/**
 * The developer portal's JSON:API, `developer.apple.com/services-account/v1`: the fifth base
 * and the second host, mapped on 2026-11-06 as the owner decision `AGENTS.md` reserves for
 * one, with two browser recordings and an approved live read behind it.
 *
 * Not an `Api`, because almost nothing about it is shared with the four above. It takes a
 * different credential — a `PortalSession`, whose `DSESSIONID` cookie only this host
 * accepts — and none of the App Store Connect headers: no `x-csrf-itc`, no team pair. What
 * `apiUrl` checks is the one rule both need, and this reuses it.
 */
const PORTAL_HOST = 'https://developer.apple.com';
export const PORTAL_BASE = `${PORTAL_HOST}/services-account/v1`;

/** One portal read: where it goes, what it filters on, and which developer team it is for. */
export interface PortalRead {
  /** Sent in the URL, as the browser sends the catalogue's `filter[capabilityType]`. */
  readonly query?: Query;
  /** Sent inside the body as `urlEncodedQueryParams`, as the browser sends the rest. */
  readonly bodyQuery?: Query;
  /** The 10-character developer team id, which the portal takes in the body. */
  readonly teamId: string;
}

/**
 * A read from the developer portal, sent the way the browser sends one: as a `POST` carrying
 * `X-HTTP-Method-Override: GET`, with the query split between the URL and a body of
 * `{urlEncodedQueryParams, teamId}`.
 *
 * **Read-only by construction.** There is no method parameter: the override is always `GET`,
 * and the body is only ever that pair. The wire method is `POST`, which is why this is a
 * function of its own rather than an `Api` passed to `request` — `request` decides what
 * mutates from the method, and a `POST` there is audited as a write. Nothing here changes
 * anything, so nothing here is audited as one; it is logged as the read it is.
 *
 * Every header below is what all the recorded `services-account/v1` reads carried:
 * `application/json, text/plain, *\/*` as Accept, `application/vnd.api+json` as Content-Type,
 * `X-Requested-With: XMLHttpRequest`, and `Origin` — which the portal sends on reads too,
 * unlike iris, because every one of them is a `POST`.
 *
 * **No status is read as an expired session.** Neither a 401, a 403 nor a redirect was ever
 * recorded on this host, so every one is reported as the refusal it is, with the likeliest
 * cause.
 */
export async function portalRead(session: PortalSession, path: string, read: PortalRead): Promise<unknown> {
  // The type keeps an App Store Connect `Session` out at compile time; this keeps one out of a
  // plain-JavaScript caller too. A cookie without the portal's own is not this host's to see.
  if (session.kind !== 'developer-portal' || !/(?:^|;\s*)DSESSIONID=/.test(session.cookie)) {
    throw new Error(
      'portalRead takes a developer-portal session — loadPortalSession() — and this one has no ' +
        'DSESSIONID cookie, so it is not one. Nothing was sent.'
    );
  }
  const target = `${apiUrl(PORTAL_BASE, path)}${buildQuery(read.query ?? {})}`;
  const body = JSON.stringify({
    urlEncodedQueryParams: buildQuery(read.bodyQuery ?? {}).replace(/^\?/, ''),
    teamId: read.teamId,
  });

  const started = Date.now();
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      ...session.headers,
      cookie: session.cookie,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/vnd.api+json',
      'x-http-method-override': 'GET',
      'x-requested-with': 'XMLHttpRequest',
      origin: PORTAL_HOST,
    },
    body,
    // Not followed. Followed, a redirect to a sign-in host would carry the csrf pair there
    // (fetch drops the cookie on a cross-origin hop, not custom headers), and its HTML would
    // come back as a confusing "Expected JSON". A 3xx is reported below as the refusal it is.
    redirect: 'manual',
  });
  const text = await response.text();
  log.debug('http.read', { method: 'GET', url: target, status: response.status, ms: Date.now() - started });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      target,
      text,
      'Nothing recorded shows how the developer portal reports a dead session. Re-capture a ' +
        "services-account request from a bundle ID's edit page, and check the account's portalTeamId."
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(response.status, target, `Expected JSON, got:\n${text.slice(0, 500)}`);
  }
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
 * The host an upload part is allowed to leave for, matched as a suffix.
 *
 * This is where the region prefix lives. Three documents and the comment below all named
 * `object-storage.apple.com` flat, and the one upload recorded from the browser goes to
 * **`northamerica-1.object-storage.apple.com`** — so a check spelled as the exact host
 * everything here claimed would have refused the only upload there is evidence of, and the
 * host this client has been describing for its whole life is one Apple was never seen to
 * use. It is a suffix, and the prefix is where you are.
 *
 * Spelled `hostname === HOST || hostname.endsWith('.' + HOST)` rather than a bare
 * `endsWith`, which would also admit `not-object-storage.apple.com`. That leaves it wide
 * enough for a region nobody here has uploaded from and narrow enough to be a check.
 */
const UPLOAD_HOST = 'object-storage.apple.com';

/**
 * Where a part may be sent, decided on the parsed URL rather than on the text of it — the
 * rule `apiUrl` applies to everything else in this file, arrived at for the same reason.
 *
 * A part is the user's own file. Where it goes is iris's answer rather than this client's
 * choice, and until 2026-08-22 that answer was fetched as given: `uploadPart` is the one
 * call here that does not go through `apiUrl`, so it was also the one with no check on
 * where it lands. The property was written down five times over — in the comment below, in
 * `architecture.md`, and in three passages of the documentation — and enforced nowhere. No
 * cookie follows the bytes, which is what the absence of a check was implicitly leaning on;
 * the file itself still would have gone.
 *
 * The URL is never quoted back, in an error or anywhere else: the signature that authorises
 * the write is in its query string, and an error message reaches the audit trail. The
 * hostname is the whole of what a refusal needs to name.
 */
function uploadTarget(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'An upload operation came back with a url that does not parse as one, so there is no ' +
        'host to check and the part is not sent. It is not quoted here because it is presigned.'
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `An upload operation named ${parsed.protocol}//${parsed.hostname}, and a part goes over ` +
        'https only. The presigned query string is the whole of the authorisation to write, ' +
        'so sending it in clear would publish the file and the means to replace it.'
    );
  }

  if (parsed.hostname !== UPLOAD_HOST && !parsed.hostname.endsWith(`.${UPLOAD_HOST}`)) {
    throw new Error(
      `An upload operation named ${parsed.hostname}, which is not under ${UPLOAD_HOST}. The ` +
        'part is the file itself, so an unrecognised destination is refused rather than ' +
        'obeyed. If Apple has moved its storage, record a capture and widen this deliberately.'
    );
  }

  return parsed;
}

/**
 * Sends one part to Apple's object storage. Deliberately does not go through `request`:
 * these leave for a different host and the whole of the auth is the presigned query string,
 * so the session cookie must not follow the bytes there.
 *
 * Not going through `request` meant not going through `apiUrl` either. `uploadTarget` is
 * the check that closes that, and it runs before the audit record and before the body is
 * sliced: a part addressed somewhere unexpected is refused, not reported on its way out.
 */
export async function uploadPart(operation: UploadOperation, file: Buffer): Promise<void> {
  const target = uploadTarget(operation.url);
  const headers: Record<string, string> = {};
  for (const header of operation.requestHeaders ?? []) headers[header.name] = header.value;

  const method = operation.method ?? 'PUT';
  const started = Date.now();
  // The presigned URL carries the signature in its query string, so only the host and
  // path go in the record — the rest is a credential.
  const where = { method, host: safeHost(target), offset: operation.offset, length: operation.length };
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
    throw new ApiError(response.status, safeHost(target), await response.text());
  }
}

/**
 * Host and path of a URL, dropping the query string — which is where Apple's signatures live.
 *
 * Takes the parsed URL rather than the string, so there is no unparseable case to answer
 * for: `uploadTarget` has already refused one, and the `'<unparseable url>'` this used to
 * fall back to was a label on an audit record for a request that could never be sent.
 */
function safeHost(url: URL): string {
  return `${url.host}${url.pathname}`;
}
