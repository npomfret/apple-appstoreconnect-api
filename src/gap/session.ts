import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';

import { sessionFromCapture } from './curl';

export interface Session {
  cookie: string;
  headers: Record<string, string>;
  /** Apple account id, decoded from the itctx cookie. */
  dsId?: string;
  /**
   * Provider/team id. Writes send it as X-Connect-Team-ID; read requests don't carry it,
   * so it's decoded from the itctx cookie's `cp` field instead.
   */
  teamId?: string;
  /** When Apple says the session dies (ISO). Advisory — the server is the authority. */
  expiresAt?: string;
  /** App id scraped from the Referer of the captured request, used as a default. */
  appId?: string;
  /** When the capture file was last written — its mtime, not when it was parsed. */
  capturedAt: string;
}

/**
 * The pasted capture *is* the session. There's no login step and nothing derived on disk:
 * every command re-reads this file, so replacing it when Apple expires the cookie is the
 * whole of "logging in again".
 */
export const CURL_PATH = resolve(process.env.ASC_CURL_PATH ?? resolve(__dirname, '..', 'tmp', 'curl.txt'));

export function loadSession(path = CURL_PATH): Session {
  if (!existsSync(path)) {
    throw new Error(
      `No capture at ${path}. Copy a request from your browser's dev tools ("Copy as cURL") ` +
        'and save it there, or point ASC_CURL_PATH somewhere else.'
    );
  }

  const session = sessionFromCapture(readFileSync(path, 'utf8'));
  // Parsing happens on every command, so "now" would say nothing. The file's mtime is
  // when you actually pasted the cookie, which is what you want to see in `asc status`.
  return { ...session, capturedAt: statSync(path).mtime.toISOString() };
}

/** Milliseconds until the session expires, or undefined if Apple didn't tell us. */
export function timeToExpiry(session: Session): number | undefined {
  if (!session.expiresAt) return undefined;
  const at = new Date(session.expiresAt).getTime();
  return Number.isNaN(at) ? undefined : at - Date.now();
}

export function describeSession(session: Session): string {
  const lines = [
    `captured:  ${session.capturedAt}`,
    `account:   ${session.dsId ?? 'unknown'}`,
    `team:      ${session.teamId ?? 'unknown'}`,
    `app:       ${session.appId ?? 'unknown'}`,
  ];

  const remaining = timeToExpiry(session);
  if (remaining === undefined) {
    lines.push('expires:   unknown');
  } else if (remaining <= 0) {
    lines.push(`expires:   ${session.expiresAt} (EXPIRED — capture a new curl)`);
  } else {
    lines.push(`expires:   ${session.expiresAt} (${Math.round(remaining / 60000)} min left)`);
  }

  return lines.join('\n');
}
