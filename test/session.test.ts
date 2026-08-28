/**
 * Where the capture is looked for when nothing says otherwise.
 *
 * A constant resolved from `__dirname` means the default moves whenever the file does, and
 * silently: `session.ts` moving into `gap/` repointed it from `<package>/tmp/curl.txt` to
 * `dist/tmp/curl.txt`, and every existing test still passed because they all pass a path in
 * or stub the read. The failure would only have shown up in a real run, as "no capture at
 * …" for a capture that was exactly where it had always been.
 *
 * So this asserts the resolved value against the package root found independently, rather
 * than against a count of `..` copied from the code it is checking.
 */

import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CURL_PATH } from '../src/gap/session';
import { packageRoot } from './helpers';

describe('the default capture path', () => {
  test('is tmp/curl.txt beside package.json, wherever the module compiles to', () => {
    assert.equal(CURL_PATH, join(packageRoot(), 'tmp', 'curl.txt'));
  });

  test('does not move when ASC_CURL_PATH is set', () => {
    // Reading the environment is `accounts.ts`'s job now, so a suite run with the variable
    // set must produce the same constant as one without. This is the assertion that the
    // precedence rule lives in exactly one place.
    const before = process.env['ASC_CURL_PATH'];
    process.env['ASC_CURL_PATH'] = '/tmp/somewhere-else.txt';
    try {
      assert.equal(CURL_PATH, join(packageRoot(), 'tmp', 'curl.txt'));
    } finally {
      if (before === undefined) delete process.env['ASC_CURL_PATH'];
      else process.env['ASC_CURL_PATH'] = before;
    }
  });

  test('is not inside a build directory', () => {
    for (const built of ['dist', 'out-tsc']) {
      assert.equal(CURL_PATH.includes(`/${built}/`), false, `default points into ${built}/`);
    }
  });
});
