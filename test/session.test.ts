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
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { CURL_PATH } from '../src/gap/session';

function packageRoot(): string {
  let dir = __dirname;

  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    assert.notEqual(parent, dir, 'no package.json above this test');
    dir = parent;
  }

  return dir;
}

describe('the default capture path', () => {
  test('is tmp/curl.txt beside package.json, wherever the module compiles to', () => {
    // ASC_CURL_PATH would override it, so a suite run with one set is testing the override
    // rather than the default. Say so instead of passing for the wrong reason.
    assert.equal(process.env['ASC_CURL_PATH'], undefined, 'unset ASC_CURL_PATH to run this');
    assert.equal(CURL_PATH, join(packageRoot(), 'tmp', 'curl.txt'));
  });

  test('is not inside a build directory', () => {
    for (const built of ['dist', 'out-tsc']) {
      assert.equal(CURL_PATH.includes(`/${built}/`), false, `default points into ${built}/`);
    }
  });
});
