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

import { createInterface } from 'readline';

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

/**
 * Returns once the user has agreed, and throws `Cancelled` otherwise.
 *
 * A run with no terminal — cron, a pipe, CI — can't be asked, and treating silence as
 * agreement there would put the guard exactly where it isn't wanted. It refuses instead,
 * having first printed what it would have done, and says which flag lets it through.
 */
export async function confirm(options: ConfirmOptions): Promise<void> {
  const { question, detail = [], yes = false } = options;
  if (yes) return;

  for (const line of detail) console.error(line);

  if (!process.stdin.isTTY) {
    console.error(question);
    throw new Cancelled('No terminal to ask on. Re-run with --yes if that is what you mean.');
  }

  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      reader.question(`${question} [y/N] `, resolve);
    });
    if (!/^y(es)?$/i.test(answer.trim())) throw new Cancelled('Not confirmed.');
  } finally {
    reader.close();
    // readline resumes stdin to listen; left that way the process never exits.
    process.stdin.pause();
  }
}
