import { Session } from './session';

/**
 * Headers worth carrying over from the browser: what says which account, which team and
 * which page the request came from. Everything else (Accept-Encoding, Sec-Fetch-*,
 * Priority) is either set by fetch itself or ignored by the server. Accept-Encoding in
 * particular must NOT be forwarded: the browser advertises zstd and undici would then fail
 * to decompress the response.
 *
 * **Accept and Content-Type are not on this list**, and were until 2026-08-21. They are the
 * transport's, not the session's: iris is served from two front-end bundles that spell both
 * differently, so carrying them meant the request the user happened to right-click decided
 * the media types on every request afterwards. `headersFor` in `src/http.ts` owns them.
 *
 * **Neither is X-Apple-App-Id**, which was on this list and carried nothing: it appears on
 * none of the 413 requests in the recordings, on any host. It was also the one header here
 * scoped to a single app rather than to the account, so a session captured from one app's
 * page would have labelled requests about another app with it — a question that needed a
 * capture to answer, and the answer is that the browser never sends it.
 */
const KEEP_HEADERS = new Set([
  'user-agent',
  'referer',
  'x-csrf-itc',
  // On every iris request the browser makes, reads included — 224 of 224 — which is why
  // `headersFor` sends them on both. A session captured as a bare cookie jar has neither,
  // so the team id is also recovered from the itctx cookie; see readItctx.
  'x-connect-team-id',
  'x-connect-team-type',
]);

/**
 * What a session takes from a capture: the cookie jar, and the headers worth keeping.
 *
 * **Not the URL, and not the method.** Both were parsed and returned until 2026-08-21, and
 * both were read by nobody: the method a capture happened to be copied from says nothing
 * about the requests this client goes on to make, and the URL is the API endpoint rather
 * than the page the browser was on, so it is no use as a Referer either — `sessionFromCurl`
 * said exactly that in a comment and threw it away.
 *
 * Parsing them was not free. The URL was taken to be the first token not starting with `-`,
 * which is only right if every value-taking flag is on a list to be stepped over, and curl
 * has far more of those than the six that were on it: `curl --max-time 30 https://…` read
 * `30` as the URL. `-X` earned its branch by keeping `POST` out of that position rather than
 * by anyone reading the method. Nothing here guesses now, and a capture is judged on the
 * cookie it carries, which is the thing a session actually needs.
 */
interface ParsedCurl {
  headers: Record<string, string>;
  cookie: string;
}

/**
 * The flags whose value is a request body — the one token that can hold anything, `-H`
 * included, so it is stepped over rather than looked at. Every other flag's value is now
 * just a bare token, and bare tokens are ignored.
 *
 * `-A` and `-e` were on this list too, under a comment calling them values "we don't care
 * about", which was the wrong reason to give: they are curl's shorthands for User-Agent and
 * Referer, both of which `KEEP_HEADERS` keeps, and the Referer is where the app id comes
 * from. Whether to read them is a question for a capture that uses them — every recording
 * here uses `-H` and `-X` and nothing else — and their values are dropped either way, so the
 * list has stopped claiming to have settled it. `--compressed-header` was on it as well, and
 * is not a curl flag.
 */
const BODY_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary']);

/** Splits a shell-ish string into tokens, honouring quotes, backslash escapes and line continuations. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '\\') {
      const next = input[i + 1];
      if (next === '\n') {
        i++;
        continue;
      }
      // Inside single quotes a backslash is literal; elsewhere it escapes the next char.
      if (quote === "'") {
        current += ch;
        started = true;
      } else if (next !== undefined) {
        current += next;
        started = true;
        i++;
      }
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      started = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }

    current += ch;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

/**
 * Pulls one curl command out of pasted text, which may carry surrounding notes or
 * several commands. Starts at the first line beginning with `curl` and keeps taking
 * lines while the previous one ends in a continuation backslash.
 */
export function extractCurlCommand(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s*curl\s/.test(line));
  if (start === -1) throw new Error('No curl command found in the input');

  const command = [lines[start]];
  while (/\\\s*$/.test(command[command.length - 1]) && start + command.length < lines.length) {
    command.push(lines[start + command.length]);
  }

  return command.join('\n');
}

function parseCurl(text: string): ParsedCurl {
  const tokens = tokenize(extractCurlCommand(text));
  if (tokens[0] !== 'curl') {
    throw new Error(`Expected the command to start with "curl", got "${tokens[0] ?? '<empty>'}"`);
  }

  let cookie = '';
  const headers: Record<string, string> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-H' || token === '--header') {
      const raw = tokens[++i] ?? '';
      const sep = raw.indexOf(':');
      if (sep === -1) continue;
      const name = raw.slice(0, sep).trim();
      const value = raw.slice(sep + 1).trim();
      if (name.toLowerCase() === 'cookie') cookie = value;
      else headers[name.toLowerCase()] = value;
    } else if (token === '-b' || token === '--cookie') {
      cookie = tokens[++i] ?? '';
    } else if (BODY_FLAGS.has(token)) {
      i++;
    }
  }

  return { headers, cookie };
}

/** The itctx cookie carries the account id, the team id and a session expiry. */
function readItctx(cookie: string): { dsId?: string; teamId?: string; expiresAt?: string } {
  const match = /(?:^|;\s*)itctx=([^;]+)/.exec(cookie);
  if (!match) return {};

  const payload = match[1].split('|')[0];
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
      ds?: number | string;
      cp?: string;
      ex?: string;
    };
    return {
      dsId: decoded.ds === undefined ? undefined : String(decoded.ds),
      // `cp` is the same uuid the browser sends as X-Connect-Team-ID on writes.
      teamId: decoded.cp,
      // Apple writes "2026-8-13 16:17:27" — not ISO, and with no zone. Normalise
      // enough for Date to accept it and treat the result as a hint, not a guarantee.
      expiresAt: decoded.ex ? normaliseExpiry(decoded.ex) : undefined,
    };
  } catch {
    return {};
  }
}

function normaliseExpiry(raw: string): string | undefined {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const pad = (v: string) => v.padStart(2, '0');
  const date = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${s}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Pulls the app id out of a Referer like /apps/{appId}/distribution/... */
function readAppId(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  return /\/apps\/(\d+)\b/.exec(referer)?.[1];
}

/**
 * Everything a session needs comes from the cookie jar plus a few headers, however they
 * were captured. The account id, team id and expiry are decoded from the cookie itself,
 * so the headers are close to optional.
 */
function buildSession(cookie: string, rawHeaders: Record<string, string>, url?: string): Session {
  if (!/(?:^|;\s*)myacinfo=/.test(cookie)) {
    throw new Error('Cookie is missing myacinfo — this does not look like a logged-in App Store Connect request');
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (KEEP_HEADERS.has(name)) headers[name] = value;
  }
  if (!headers['x-csrf-itc']) headers['x-csrf-itc'] = '[asc-ui]';
  if (!headers['referer'] && url) headers['referer'] = url;

  const { dsId, teamId, expiresAt } = readItctx(cookie);

  return {
    cookie,
    headers,
    dsId,
    teamId: headers['x-connect-team-id'] ?? teamId,
    expiresAt,
    appId: readAppId(headers['referer']),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Turns a curl command copied from Safari/Chrome dev tools into a Session.
 * Any of the App Store Connect review-centre requests will do — they all carry the
 * same cookie jar and CSRF header.
 */
export function sessionFromCurl(command: string): Session {
  const parsed = parseCurl(command);

  if (!parsed.cookie) {
    throw new Error('The curl command has no Cookie header — copy it as "Copy as cURL" while logged in');
  }

  return buildSession(parsed.cookie, parsed.headers);
}

/** Request lines from "Copy request headers" — nothing in them we need. */
const REQUEST_LINE = /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s+\S+/;

/**
 * Reads a session out of plain text instead of a curl command. One item per line, in any
 * order: `Name: value` headers, a bare cookie jar, or the page URL. Blank lines and `#`
 * comments are ignored, and so is anything not worth keeping — which means an HTTP/2
 * header block pasted straight out of dev tools works as-is.
 *
 * The cookie is the only required part:
 *
 *   Cookie: myacinfo=...; itctx=...
 *   https://appstoreconnect.apple.com/apps/1234567890/distribution/ios/version/inflight
 */
export function sessionFromText(text: string): Session {
  let cookie = '';
  let url: string | undefined;
  const headers: Record<string, string> = {};

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (REQUEST_LINE.test(trimmed)) continue;

    // Checked before the header pattern, which would otherwise read "https" as a name.
    if (/^https?:\/\//.test(trimmed)) {
      url = trimmed;
      continue;
    }

    // The leading colon covers HTTP/2 pseudo-headers (:authority, :path); they fall out
    // at the KEEP_HEADERS filter like any other header we don't want.
    const header = /^:?([A-Za-z0-9-]+):\s*(.*)$/.exec(trimmed);
    if (header) {
      const name = header[1].toLowerCase();
      if (name === 'cookie') cookie = header[2].trim();
      else headers[name] = header[2].trim();
      continue;
    }

    // A cookie jar pasted on its own, without its header name.
    if (/(?:^|;\s*)myacinfo=/.test(trimmed)) cookie = trimmed;
  }

  if (!cookie) {
    throw new Error(
      'No cookie found. The file needs the Cookie header from a logged-in App Store ' +
        'Connect request, e.g. "Cookie: myacinfo=...; itctx=..."'
    );
  }

  return buildSession(cookie, headers, url);
}

/** Accepts either form: a copied curl command, or a plain-text cookie/header list. */
export function sessionFromCapture(text: string): Session {
  return /^\s*curl\s/m.test(text) ? sessionFromCurl(text) : sessionFromText(text);
}
