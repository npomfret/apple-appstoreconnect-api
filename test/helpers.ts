/**
 * Stand-ins for the things the tests must not use for real.
 *
 * Nothing here is a capture and nothing here reaches the network: the cookie below is
 * shaped like a session and is not one, and `stubFetch` replaces `fetch` outright, so a
 * test that means to send a request to Apple fails to send it anywhere instead.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Session } from '../src/gap/session';

/**
 * The package root, found by walking up from wherever this file is executing.
 *
 * Three tests have now needed it and the first two each got it wrong the same way: under
 * `npm test` the suite runs from `out-tsc/`, so `__dirname` is not where the sources are
 * and `'..'` counted from it lands somewhere plausible and empty. A test that reads the
 * tree has to find the tree, and `package.json` is the only landmark in it that does not
 * move when a file does.
 */
export function packageRoot(): string {
  let dir = __dirname;

  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no package.json above the tests');
    dir = parent;
  }

  return dir;
}

/** A path inside `src/`, whichever build is running. */
export function sourcePath(...parts: string[]): string {
  return join(packageRoot(), 'src', ...parts);
}

/** A session with the fields the transport reads, all invented. */
export const SESSION: Session = {
  cookie: 'myacinfo=not-a-real-cookie; itctx=not-a-real-cookie',
  headers: {
    'x-csrf-itc': '[asc-ui]',
    referer: 'https://appstoreconnect.apple.com/apps/123/distribution/ios/version/inflight',
  },
  teamId: 'team-0000',
  capturedAt: '2026-08-15T00:00:00.000Z',
};

/** One request the code under test tried to make. */
export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** What the stub should answer with. Defaults to an empty JSON:API collection, 200. */
export interface Reply {
  status?: number;
  /** Serialised as JSON. Ignored when `text` is given. */
  body?: unknown;
  /** The response body verbatim, for testing what happens to something that isn't JSON. */
  text?: string;
}

export interface Stub {
  /** Every request attempted, in order. A refused request never gets here. */
  calls: Call[];
  restore(): void;
}

function asHeaders(init: RequestInit['headers']): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of new Headers(init).entries()) headers[name] = value;
  return headers;
}

/**
 * Replaces `fetch` for the duration of a test, recording what was sent and answering from
 * `reply`. Restore it in a `finally` — a stub left installed makes the next test's
 * assertions about "what was sent" meaningless.
 */
export function stubFetch(reply: (call: Call) => Reply = () => ({})): Stub {
  const calls: Call[] = [];
  const original = globalThis.fetch;

  const stub: typeof globalThis.fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: asHeaders(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);

    const { status = 200, body = { data: [] }, text } = reply(call);
    return new Response(text ?? JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };

  globalThis.fetch = stub;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

export interface Captured {
  /** Every line written to stderr, unparsed. */
  lines: string[];
  /** The same lines as log records, skipping anything that wasn't JSON. */
  records(): Record<string, unknown>[];
  restore(): void;
}

/** Collects stderr, which is where every log and audit record goes. */
export function captureStderr(): Captured {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));

  return {
    lines,
    records: () =>
      lines.flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      }),
    restore: () => void (console.error = original),
  };
}

/** Runs `body` with stderr collected, restoring it however that goes. */
export async function withStderr<T>(body: (captured: Captured) => Promise<T> | T): Promise<T> {
  const captured = captureStderr();
  try {
    return await body(captured);
  } finally {
    captured.restore();
  }
}
