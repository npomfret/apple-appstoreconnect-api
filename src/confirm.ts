/**
 * Asking before the handful of things that can't be taken back.
 *
 * Most of this client is safely repeatable: a read costs nothing, and a bad `set-build` is
 * one more `set-build` away from being fixed. Sending a reply to App Review is not — the
 * message is on the thread the instant the POST returns, and putting an item back in the
 * review queue is the same. Those stop and ask.
 *
 * The prompt goes to **stderr** and the answer is read from stdin, so a command's real
 * output still pipes cleanly.
 */

import { createReadStream, openSync } from 'fs';
import { createInterface } from 'readline';
import { Readable } from 'stream';

import { log } from './log';

/** The user said no, or there was nobody to ask. Never thrown after a write has started. */
export class Cancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Cancelled';
  }
}

export interface ConfirmOptions {
  /** The question, phrased so that "y" means go ahead. */
  question: string;
  /** Shown above it: the thing being acted on, so the answer isn't blind. */
  detail?: string[];
  /** `--yes` — the caller has already decided, and isn't asked. */
  yes?: boolean;
}

/** Somewhere to read an answer from, and how to let go of it afterwards. */
interface Asked {
  input: Readable;
  done: () => void;
}

/**
 * Where to ask.
 *
 * Normally stdin. But a command whose *input* arrives on stdin has none left to answer on —
 * `cat description.txt | asc set-metadata en-GB description -` is a documented way to run
 * this — and refusing there would mean the guarded writes are exactly the ones you have to
 * add `--yes` to. There is still a terminal in that case, reachable as `/dev/tty`, so the
 * question goes there instead.
 *
 * Nothing to open means nothing to ask: cron, CI and a container with no tty all fail here,
 * and that is the case the refusal below is for.
 */
function whereToAsk(): Asked | undefined {
  if (process.stdin.isTTY) {
    // readline resumes stdin to listen; left that way the process never exits.
    return { input: process.stdin, done: () => process.stdin.pause() };
  }

  try {
    // Opened here rather than left to the stream, because this is the call that fails when
    // there is no controlling terminal. A stream would report that asynchronously, by which
    // point the prompt is already waiting for an answer that can never arrive.
    const fd = openSync('/dev/tty', 'r');
    const tty = createReadStream('/dev/tty', { fd, autoClose: true });
    tty.on('error', (error) => log.debug('confirm.tty.failed', { error }));
    return { input: tty, done: () => tty.destroy() };
  } catch {
    return undefined;
  }
}

/**
 * Returns once the user has agreed, and throws `Cancelled` otherwise.
 *
 * A run with nowhere to ask can't be asked, and treating silence as agreement there would
 * put the guard exactly where it isn't wanted. It refuses instead, having first printed what
 * it would have done, and says which flag lets it through.
 *
 * What is being done is printed either way, `--yes` included. That flag says the answer is
 * already decided, not that there is nothing worth recording: `set-metadata` prints the text
 * it is about to overwrite, and Apple keeps no other copy of it.
 */
export async function confirm(options: ConfirmOptions): Promise<void> {
  const { question, detail = [], yes = false } = options;

  for (const line of detail) console.error(line);

  if (yes) {
    console.error(`${question} --yes`);
    return;
  }

  const asked = whereToAsk();
  if (!asked) {
    console.error(question);
    throw new Cancelled('No terminal to ask on. Re-run with --yes if that is what you mean.');
  }

  const reader = createInterface({ input: asked.input, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      reader.question(`${question} [y/N] `, resolve);
    });
    if (!/^y(es)?$/i.test(answer.trim())) throw new Cancelled('Not confirmed.');
  } finally {
    reader.close();
    asked.done();
  }
}
