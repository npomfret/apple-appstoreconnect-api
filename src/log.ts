/**
 * Structured logging: one JSON object per line, always on **stderr**.
 *
 * stderr rather than stdout on purpose — the commands print their data to stdout, so
 * keeping the two apart means `asc report --json | jq` still works with logging on.
 *
 * Every mutation goes through `audit`. Those records are emitted whatever the level is
 * set to, because an audit trail you can turn down isn't one: this tool changes live App
 * Store Connect data, and the record of what it changed shouldn't depend on verbosity.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error';

export type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Fields on a review detail record that must not be printed.
 *
 * Nothing here reads one any more, and as of the escape-hatch slice nothing here *can*:
 * `review-details` went with the version slice because Apple serves
 * `GET /v1/appStoreReviewDetails/{id}` officially, `asc patch` has gone entirely, and
 * `asc get` is now confined to the private families, which that record is not one of.
 *
 * It stays regardless, and is not a leftover. Scrubbing by field name costs one string
 * comparison and covers whatever turns up carrying that name — an iris error body quoting
 * a request back, a future gap read, a caller of this library that isn't the CLI. Dropping
 * a known credential from the redaction list because today's read set happens not to
 * produce it is the wrong direction to reason in: the list is a standing rule about a
 * field name, not a reaction to a particular caller.
 */
export const REVIEW_DETAIL_SECRETS = ['demoAccountPassword'] as const;

/**
 * Every field name whose value is a credential, written once and read twice: a secret can
 * arrive as a field of a record this process built, or buried in a string that arrived
 * whole from somewhere else, and the two need different matching for the same list.
 */
const SECRET_FIELDS = [
  'cookie',
  'set-cookie',
  'authorization',
  'x-csrf-itc',
  'myacinfo',
  'itctx',
  'dqsid',
  'wosid',
  ...REVIEW_DETAIL_SECRETS,
] as const;

/** Keys whose values never get written out, wherever they turn up in a record. */
const SENSITIVE = new RegExp(`^(${SECRET_FIELDS.join('|')})$`, 'i');

/**
 * The same names again, as JSON members inside a string.
 *
 * The scrub above only sees a record built here, field by field. A response body is not
 * one: it reaches the log as a single string — an `ApiError` carries the body the request
 * was refused with, and iris quotes parts of the request back inside it — and a string is
 * scrubbed by value, so the field names in it are never looked at.
 *
 * JSON is the only textual form a session secret can arrive in, because the only host this
 * client sends the cookie to speaks `application/vnd.api+json` on every request. The
 * storage host that answers in XML is never sent one; what it can quote back is a
 * signature, which is the scrub below.
 */
const SECRET_MEMBERS = new RegExp(
  `("(?:${SECRET_FIELDS.join('|')})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  'gi'
);

/**
 * The query parameters that carry the authorisation on a presigned upload URL — both the
 * older `AWSAccessKeyId`/`Signature` pair and the SigV4 names. Which of them Apple's
 * storage hosts actually use isn't the point: a signed URL is a bearer credential, and one
 * that reaches the log is one anybody reading the log can upload with until it expires.
 *
 * Applied to every string logged, not just to URLs, because storage hosts quote the request
 * they refused back inside their error bodies.
 */
const SIGNED_PARAMS =
  /([?&](?:awsaccesskeyid|signature|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&\s"']+/gi;

/**
 * The scrub for what arrived inside a string rather than as a field of its own. Applied to
 * every string written, and again where an `ApiError` is built, so a body that is printed
 * to stderr without ever passing through here is scrubbed too.
 */
export function redact(text: string): string {
  return text.replace(SIGNED_PARAMS, '$1[redacted]').replace(SECRET_MEMBERS, '$1"[redacted]"');
}

/** Long strings are trimmed so one fat body can't bury the rest of the log. */
const MAX_STRING = 2000;

function level(): number {
  const configured = (process.env.ASC_LOG ?? 'info').toLowerCase();
  if (configured === 'off' || configured === 'silent' || configured === 'none') return Infinity;
  return ORDER[configured as Level] ?? ORDER.info;
}

function scrub(key: string, value: unknown): unknown {
  if (SENSITIVE.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    const safe = redact(value);
    return safe.length > MAX_STRING ? `${safe.slice(0, MAX_STRING)}… (${safe.length} chars)` : safe;
  }
  // Errors are replaced before their message is reached, so redact it here too.
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  return value;
}

/**
 * Serialising must never be what breaks a command, so a body that can't be stringified
 * (circular, a BigInt, a stray Proxy) degrades to a note rather than throwing.
 *
 * **The note is scrubbed like anything else**, and was not until 2026-08-21: it was built
 * with a bare `JSON.stringify` and no replacer, so the one record written when serialising
 * fails was the one record exempt from both scrubs and from the length cap. What it carries
 * is a message this process did not write — `JSON.stringify` calls `toJSON` before the
 * replacer ever runs, so a value that throws from there decides the text of this line — and
 * `Fields` is a library export, so what reaches it is not only what the CLI logs. Whether
 * today's callers can produce a message with a credential in it is the wrong question to
 * settle it on, for the reason `SECRET_FIELDS` gives above: the scrub is a standing rule
 * about what gets written, not a reaction to a particular caller.
 */
function line(record: Fields): string {
  try {
    return JSON.stringify(record, scrub);
  } catch (error) {
    return JSON.stringify(
      {
        ts: record.ts,
        level: 'error',
        event: 'log.unserializable',
        of: String(record.event),
        error: error instanceof Error ? error.message : String(error),
      },
      scrub
    );
  }
}

function write(severity: Level, event: string, fields: Fields, always = false): void {
  if (!always && ORDER[severity] < level()) return;
  console.error(line({ ts: new Date().toISOString(), level: severity, event, ...fields }));
}

export const log = {
  debug: (event: string, fields: Fields = {}) => write('debug', event, fields),
  info: (event: string, fields: Fields = {}) => write('info', event, fields),
  warn: (event: string, fields: Fields = {}) => write('warn', event, fields),
  error: (event: string, fields: Fields = {}) => write('error', event, fields),
};

/** Where a change had got to. `start` is emitted before the request leaves. */
export type Phase = 'start' | 'ok' | 'error';

/**
 * Records one step of a change to live data. Always emitted, and marked `audit` so the
 * trail can be sieved out of everything else:
 *
 *     asc send-reply ... 2>&1 >/dev/null | jq -c 'select(.audit)'
 */
export function audit(action: string, phase: Phase, fields: Fields = {}): void {
  write(phase === 'error' ? 'error' : 'info', action, { audit: true, phase, ...fields }, true);
}

/**
 * Brackets a change with start/ok or start/error records, so a run that dies halfway
 * still leaves evidence that the write was in flight — which is the case you most want
 * a log for.
 */
export async function audited<T>(action: string, fields: Fields, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  audit(action, 'start', fields);
  try {
    const result = await run();
    audit(action, 'ok', { ...fields, ms: Date.now() - started });
    return result;
  } catch (error) {
    audit(action, 'error', {
      ...fields,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
