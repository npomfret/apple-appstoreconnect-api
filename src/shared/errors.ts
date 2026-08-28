/**
 * The refusal both transports raise.
 *
 * Shared because the scrub is the point: a refusal body is the one response this client
 * puts in an exception message, which the CLI's top-level handler prints. Either host can
 * quote the request back in one, so either host can quote a credential back in one, and a
 * second copy of this class is a second place for that guarantee to drift.
 */

import { redact } from './log';

export class ApiError extends Error {
  /**
   * What the request was refused with, scrubbed.
   *
   * Scrubbed here rather than at each place it is written, because this body goes further
   * than the log: it is in the message, and the CLI's top-level handler prints an error
   * message to stderr on its own. iris quotes parts of the request back in a refusal, and
   * by the time it is a string the field-name scrub can no longer see the fields.
   */
  readonly body: string;

  constructor(readonly status: number, readonly url: string, body: string, hint?: string) {
    const safe = redact(body);
    super(`HTTP ${status} for ${url}\n${safe.slice(0, 2000)}${hint ? `\n${hint}` : ''}`);
    this.body = safe;
    this.name = 'ApiError';
  }
}
