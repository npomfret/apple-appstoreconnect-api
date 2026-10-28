/**
 * What the non-iris readers share: narrowing an `unknown` off the transport, and turning an
 * id into a path segment.
 *
 * Xcode Cloud and the Business pane both answer in plain JSON rather than JSON:API, and both
 * are scoped by the session's team id, so the same four rules were needed twice. They live
 * once here rather than in either reader. Not exported from the package: these are how a
 * reader is written, not something a caller of one needs.
 */

import { Session } from './session';

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * A path segment, checked before it is one.
 *
 * Every id here arrives from a command line, a caller or a response and is interpolated
 * into a path. `apiUrl` would catch a segment that climbs out of the base, since it compares
 * the resolved URL — but it would report it as a path that resolves somewhere odd, which is
 * a confusing way to say "that is not an id". Apple's own are uuids; the pattern is wider
 * than that on purpose, since the format is Apple's to change and this only has to exclude
 * the characters that make a segment stop being one.
 */
export function segment(value: string, what: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`"${value}" is not a ${what}: it has to be one path segment of letters, digits, ".", "_" or "-"`);
  }
  return value;
}

/**
 * The team a team-scoped path is scoped by, taken from the session.
 *
 * Not discovered, and not a flag. On all 34 `/ci/api` requests recorded from the browser the
 * `teams/{id}` path segment is the same value as the `X-Connect-Team-ID` header, and on all
 * 34 Business-pane requests in the 2026-08-26 recording the `contentProviders/{id}` and
 * `teamIds/{id}` segments are too. `src/gap/curl.ts` already keeps that header from the
 * capture and otherwise decodes it from the `itctx` cookie, so this costs no request: in
 * particular it does not need `olympus/v1/actors`, which carries names and email addresses
 * this client has no reason to hold.
 */
export function teamOf(session: Session): string {
  if (!session.teamId) {
    throw new Error(
      'The session has no team id, and every team-scoped path is scoped by one. Capture a ' +
        'fresh request as cURL — the team id is in the cookie, and in the X-Connect-Team-ID header.'
    );
  }
  return segment(session.teamId, 'team id');
}
