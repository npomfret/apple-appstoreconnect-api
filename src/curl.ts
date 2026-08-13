import { Session } from './session';

/**
 * Headers worth carrying over from the browser. Everything else (Accept-Encoding,
 * Sec-Fetch-*, Priority) is either set by fetch itself or ignored by the server.
 * Accept-Encoding in particular must NOT be forwarded: the browser advertises zstd
 * and undici would then fail to decompress the response.
 */
const KEEP_HEADERS = new Set([
  'accept',
  'content-type',
  'user-agent',
  'referer',
  'x-csrf-itc',
  'x-apple-app-id',
]);

interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  cookie: string;
}

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

  let url: string | undefined;
  let method: string | undefined;
  let cookie = '';
  const headers: Record<string, string> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-X' || token === '--request') {
      method = tokens[++i];
    } else if (token === '-H' || token === '--header') {
      const raw = tokens[++i] ?? '';
      const sep = raw.indexOf(':');
      if (sep === -1) continue;
      const name = raw.slice(0, sep).trim();
      const value = raw.slice(sep + 1).trim();
      if (name.toLowerCase() === 'cookie') cookie = value;
      else headers[name.toLowerCase()] = value;
    } else if (token === '-b' || token === '--cookie') {
      cookie = tokens[++i] ?? '';
    } else if (token.startsWith('-')) {
      // Flags that take a value we don't care about; skip the value too.
      if (['-d', '--data', '--data-raw', '--data-binary', '-A', '-e', '--compressed-header'].includes(token)) i++;
    } else if (!url) {
      url = token;
    }
  }

  if (!url) throw new Error('No URL found in the curl command');
  return { url, method: method ?? 'GET', headers, cookie };
}

/** The itctx cookie carries the account id and a session expiry. */
function readItctx(cookie: string): { dsId?: string; expiresAt?: string } {
  const match = /(?:^|;\s*)itctx=([^;]+)/.exec(cookie);
  if (!match) return {};

  const payload = match[1].split('|')[0];
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
      ds?: number | string;
      ex?: string;
    };
    return {
      dsId: decoded.ds === undefined ? undefined : String(decoded.ds),
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

/** Pulls the app id out of a Referer like /apps/6761343835/distribution/... */
function readAppId(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  return /\/apps\/(\d+)\b/.exec(referer)?.[1];
}

/**
 * Turns a curl command copied from Safari/Chrome dev tools into a Session.
 * Any of the five App Store Connect review-centre requests will do — they all
 * carry the same cookie jar and CSRF header.
 */
export function sessionFromCurl(command: string): Session {
  const parsed = parseCurl(command);

  if (!parsed.cookie) {
    throw new Error('The curl command has no Cookie header — copy it as "Copy as cURL" while logged in');
  }
  if (!/(?:^|;\s*)myacinfo=/.test(parsed.cookie)) {
    throw new Error('Cookie is missing myacinfo — this does not look like a logged-in App Store Connect request');
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed.headers)) {
    if (KEEP_HEADERS.has(name)) headers[name] = value;
  }
  if (!headers['x-csrf-itc']) headers['x-csrf-itc'] = '[asc-ui]';

  const { dsId, expiresAt } = readItctx(parsed.cookie);

  return {
    cookie: parsed.cookie,
    headers,
    dsId,
    expiresAt,
    appId: readAppId(headers['referer']),
    capturedAt: new Date().toISOString(),
  };
}
