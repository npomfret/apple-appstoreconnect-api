import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

export interface Session {
  cookie: string;
  headers: Record<string, string>;
  /** Apple account id, decoded from the itctx cookie. */
  dsId?: string;
  /** When Apple says the session dies (ISO). Advisory — the server is the authority. */
  expiresAt?: string;
  /** App id scraped from the Referer of the captured request, used as a default. */
  appId?: string;
  capturedAt: string;
}

export const SESSION_PATH = resolve(
  process.env.ASC_SESSION_PATH ?? resolve(__dirname, '..', 'tmp', 'session.json')
);

export function saveSession(session: Session, path = SESSION_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function loadSession(path = SESSION_PATH): Session {
  if (!existsSync(path)) {
    throw new Error(`No session at ${path}. Run "asc login" and paste a fresh curl from your browser.`);
  }
  const session = JSON.parse(readFileSync(path, 'utf8')) as Session;
  if (!session.cookie) throw new Error(`Session at ${path} has no cookie — capture a new one.`);
  return session;
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
