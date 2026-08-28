/**
 * Apple's official App Store Connect API: API-key authentication and GET-only transport.
 *
 * This is deliberately separate from `gap/http.ts`. That transport carries a browser
 * session cookie to undocumented Iris and Xcode Cloud routes; this one carries a
 * short-lived JWT to Apple's documented API. Sharing a transport would make it possible to
 * send the wrong credential to the wrong host, which is a boundary rather than a reuse
 * opportunity — so the two live in directories that may not import each other, and
 * `test/module-boundary.test.ts` fails if one ever does.
 */

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ApiError } from '../shared/errors';
import { buildQuery, Query } from '../shared/query';
import { log } from '../shared/log';

const OFFICIAL_BASE_URL = 'https://api.appstoreconnect.apple.com';
const TOKEN_AUDIENCE = 'appstoreconnect-v1';
const TOKEN_LIFETIME_SECONDS = 20 * 60;
/** Re-mint this long before expiry, so a request in flight cannot cross the boundary. */
const TOKEN_REFRESH_MARGIN_SECONDS = 60;

export interface OfficialCredentials {
  readonly issuerId: string;
  readonly keyId: string;
  readonly privateKeyPath: string;
}

export interface OfficialEnvironment {
  readonly ASC_ISSUER_ID?: string;
  readonly ASC_KEY_ID?: string;
  readonly ASC_PRIVATE_KEY_PATH?: string;
}

export interface OfficialClient {
  get(path: string, query?: Query): Promise<unknown>;
}

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new Error(
    `${name} is required for Apple's official API. Set ASC_ISSUER_ID, ASC_KEY_ID and ` +
      'ASC_PRIVATE_KEY_PATH; no account or key identifiers are built into this client.'
  );
}

/** Read official-API credentials without assigning any account-specific defaults. */
export function officialCredentials(
  environment: OfficialEnvironment = process.env
): OfficialCredentials {
  return {
    issuerId: required(environment.ASC_ISSUER_ID, 'ASC_ISSUER_ID'),
    keyId: required(environment.ASC_KEY_ID, 'ASC_KEY_ID'),
    privateKeyPath: required(environment.ASC_PRIVATE_KEY_PATH, 'ASC_PRIVATE_KEY_PATH'),
  };
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Build the ES256 bearer token Apple documents for App Store Connect API requests.
 *
 * `ieee-p1363` is significant: JOSE carries the fixed-width r||s signature, while Node's
 * default is ASN.1 DER. The token is never logged or returned by a CLI command.
 */
export function officialToken(credentials: OfficialCredentials, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.issuerId,
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
      aud: TOKEN_AUDIENCE,
    })
  );
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey(readFileSync(credentials.privateKeyPath));
  const signature = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64Url(signature)}`;
}

function officialUrl(path: string, query?: Query): string {
  if (!path.trim()) throw new Error('An official App Store Connect API path is required.');
  if (path.includes('?') || path.includes('#')) {
    throw new Error(`"${path}" is not a path; pass query values separately.`);
  }

  const relative = path.replace(/^\/+/, '');
  const url = new URL(relative, `${OFFICIAL_BASE_URL}/`);
  const supportedVersion =
    url.pathname === '/v1' ||
    url.pathname.startsWith('/v1/') ||
    url.pathname === '/v2' ||
    url.pathname.startsWith('/v2/');
  if (url.origin !== OFFICIAL_BASE_URL || !supportedVersion) {
    throw new Error(
      `Official API path "${path}" resolves outside ${OFFICIAL_BASE_URL}/v1 or /v2.`
    );
  }
  return `${url.toString()}${buildQuery(query ?? {})}`;
}

/**
 * Mint on demand and reuse until the token is nearly spent.
 *
 * Apple caps the lifetime at twenty minutes, which is longer than one command and shorter
 * than a script that sweeps every app on an account. Minting once per client would leave
 * such a script failing partway through with a 401 that looks like a permissions problem.
 */
function bearerSource(
  credentials: OfficialCredentials,
  now: () => Date
): () => string {
  let token: string | undefined;
  let expiresAt = 0;

  return () => {
    const at = now();
    const seconds = Math.floor(at.getTime() / 1000);
    if (token === undefined || seconds >= expiresAt - TOKEN_REFRESH_MARGIN_SECONDS) {
      token = officialToken(credentials, at);
      expiresAt = seconds + TOKEN_LIFETIME_SECONDS;
    }
    return token;
  };
}

/** A client that can issue documented GETs and has no method capable of a write. */
export function officialClient(
  credentials: OfficialCredentials,
  now: () => Date = () => new Date()
): OfficialClient {
  const bearer = bearerSource(credentials, now);

  return {
    async get(path: string, query?: Query): Promise<unknown> {
      const url = officialUrl(path, query);
      log.debug('official.http.request', { method: 'GET', url });
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${bearer()}`,
        },
      });
      const body = await response.text();
      log.debug('official.http.response', { method: 'GET', url, status: response.status });
      if (!response.ok) throw new ApiError(response.status, url, body);

      try {
        return JSON.parse(body) as unknown;
      } catch (error) {
        throw new Error(
          `Apple's official API returned non-JSON for ${url}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
