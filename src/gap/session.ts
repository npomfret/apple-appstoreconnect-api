import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';

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
  /** When the capture file was last written — its mtime, not when it was parsed. */
  capturedAt: string;
}

/**
 * The pasted capture *is* the session. There's no login step and nothing derived on disk:
 * every command re-reads this file, so replacing it when Apple expires the cookie is the
 * whole of "logging in again".
 */
/**
 * `tmp/` beside `package.json`, found by walking up rather than by counting `..`.
 *
 * A count is wrong the moment the file moves, and silently: this module was one level up
 * from the package root until it moved into `gap/`, which repointed the default at
 * `dist/tmp/curl.txt` — a path that never exists, so every command without
 * `ASC_CURL_PATH` set would have said there was no capture. A count cannot even be right
 * for both builds at once, since `tsc` emits this to `dist/gap/` and the test build to
 * `out-tsc/src/gap/`. `test/session.test.ts` pins the result either way.
 */
function packageRoot(): string {
  let dir = __dirname;

  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'Could not find the package root above this module, so there is no default capture ' +
          'path. Set ASC_CURL_PATH to the file holding your "Copy as cURL" capture.'
      );
    }
    dir = parent;
  }

  return dir;
}

/**
 * The built-in capture path, and nothing else.
 *
 * `ASC_CURL_PATH` used to be read here. It is now one input to `accounts.ts`, which ranks
 * it against `--account` and the configured default and hands the winner to `loadSession`.
 * Precedence in two places is precedence that disagrees with itself, and this is the side
 * that has to lose: a module in `gap/` should be told which capture to read, not go looking
 * for one in the environment.
 */
export const CURL_PATH = resolve(join(packageRoot(), 'tmp', 'curl.txt'));

export function loadSession(path = CURL_PATH): Session {
  if (!existsSync(path)) {
    throw new Error(
      `No capture at ${path}. Copy a request from your browser's dev tools ("Copy as cURL") ` +
        'and save it there. Which file that is comes from --account, ASC_CURL_PATH or the ' +
        'accounts file, in that order — "asc accounts" shows what is configured.'
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
