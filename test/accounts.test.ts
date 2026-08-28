/**
 * Named accounts: which account's credentials a command uses, and where they are read from.
 *
 * Every test here is about a decision, not a request — nothing in `accounts.ts` talks to
 * Apple. The resolution functions take the environment and the parsed file as arguments
 * precisely so the precedence rules can be checked without a config file on disk, an
 * exported variable, or a key anywhere.
 *
 * The one that matters most is the last suite: this module names where credentials live and
 * must never read one, because it is the only module both credential systems pass through.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { sourcePath } from './helpers';

import {
  AccountsFile,
  Resolution,
  capturePathFor,
  describeAccounts,
  officialCredentialsFor,
  parseAccounts,
  selectAccount,
} from '../src/accounts';

const BUILT_IN = '/pkg/tmp/curl.txt';

const FILE: AccountsFile = {
  defaultAccount: 'acme',
  accounts: {
    acme: {
      issuerId: 'issuer-acme',
      keyId: 'key-acme',
      privateKeyPath: '/keys/acme.p8',
      capturePath: '/captures/acme.txt',
    },
    beta: {
      issuerId: 'issuer-beta',
      keyId: 'key-beta',
      privateKeyPath: '/keys/beta.p8',
      capturePath: '/captures/beta.txt',
    },
    readonly: { capturePath: '/captures/readonly.txt' },
    keyonly: { issuerId: 'i', keyId: 'k', privateKeyPath: '/keys/only.p8' },
  },
};

const ENV = {
  ASC_ISSUER_ID: 'issuer-env',
  ASC_KEY_ID: 'key-env',
  ASC_PRIVATE_KEY_PATH: '/keys/env.p8',
  ASC_CURL_PATH: '/captures/env.txt',
};

function resolution(over: Partial<Resolution> = {}): Resolution {
  return { env: {}, defaultCapturePath: BUILT_IN, ...over };
}

describe('reading the accounts file', () => {
  test('a well-formed file round-trips', () => {
    const file = parseAccounts(
      JSON.stringify({ defaultAccount: 'a', accounts: { a: { keyId: 'k' } } }),
      '/cfg.json'
    );
    assert.equal(file.defaultAccount, 'a');
    assert.deepEqual(file.accounts['a'], { issuerId: undefined, keyId: 'k' });
  });

  test('a leading ~ in a path is expanded, since no shell was involved', () => {
    const file = parseAccounts(
      JSON.stringify({ accounts: { a: { privateKeyPath: '~/keys/k.p8', capturePath: '~/c.txt' } } }),
      '/cfg.json'
    );
    assert.equal(file.accounts['a']!.privateKeyPath, join(homedir(), 'keys', 'k.p8'));
    assert.equal(file.accounts['a']!.capturePath, join(homedir(), 'c.txt'));
  });

  test('a ~ that is not the whole first segment is left alone', () => {
    const file = parseAccounts(JSON.stringify({ accounts: { a: { capturePath: '/x/~y/c.txt' } } }), '/cfg.json');
    assert.equal(file.accounts['a']!.capturePath, '/x/~y/c.txt');
  });

  for (const [what, text] of [
    ['not JSON at all', '{oops'],
    ['a top level that is not an object', '[]'],
    ['no accounts key', '{"defaultAccount":"a"}'],
    ['an account that is not an object', '{"accounts":{"a":"nope"}}'],
    ['an empty value where a path belongs', '{"accounts":{"a":{"keyId":"  "}}}'],
    ['a default naming no account', '{"defaultAccount":"z","accounts":{"a":{}}}'],
  ] as const) {
    test(`${what} is refused, naming the file`, () => {
      assert.throws(() => parseAccounts(text, '/cfg.json'), /\/cfg\.json/);
    });
  }

  test('a misspelled key is refused rather than ignored', () => {
    // The whole point: an ignored `privateKey` would leave the account without a key and
    // send the command to whatever was exported in the shell instead.
    assert.throws(
      () => parseAccounts('{"accounts":{"a":{"privateKey":"/k.p8"}}}', '/cfg.json'),
      /unrecognised key privateKey/
    );
  });
});

describe('which account a command is about', () => {
  test('--account names it', () => {
    assert.equal(selectAccount(FILE, 'beta')?.name, 'beta');
  });

  test('otherwise the declared default', () => {
    assert.equal(selectAccount(FILE, undefined)?.name, 'acme');
  });

  test('a single account is its own default', () => {
    assert.equal(selectAccount({ accounts: { solo: {} } }, undefined)?.name, 'solo');
  });

  test('two accounts and no declared default is nobody', () => {
    // Not the first one. Picking would pick whose App Store data a write lands on.
    assert.equal(selectAccount({ accounts: { a: {}, b: {} } }, undefined), undefined);
  });

  test('naming an account that is not there lists the ones that are', () => {
    assert.throws(() => selectAccount(FILE, 'ghost'), /"acme", "beta", "readonly", "keyonly"/);
  });

  test('naming an account with no file at all says so', () => {
    assert.throws(() => selectAccount(undefined, 'acme'), /no accounts file/);
  });
});

describe('official credentials: --account, then the environment, then the default', () => {
  test('--account outranks an exported environment', () => {
    // The important one. Naming an account and getting the shell's key is how a command
    // runs against the wrong team.
    const found = officialCredentialsFor(resolution({ account: 'beta', env: ENV, file: FILE }));
    assert.equal(found.issuerId, 'issuer-beta');
    assert.equal(found.privateKeyPath, '/keys/beta.p8');
  });

  test('a complete environment outranks the default account', () => {
    const found = officialCredentialsFor(resolution({ env: ENV, file: FILE }));
    assert.equal(found.issuerId, 'issuer-env');
  });

  test('an incomplete environment is ignored rather than completed from the file', () => {
    // Two out of three is a half-finished shell. Filling the third from the file would
    // sign one account's requests with another account's key.
    const found = officialCredentialsFor(
      resolution({ env: { ASC_ISSUER_ID: 'issuer-env', ASC_KEY_ID: 'key-env' }, file: FILE })
    );
    assert.equal(found.issuerId, 'issuer-acme');
    assert.equal(found.keyId, 'key-acme');
  });

  test('with nothing exported, the default account', () => {
    assert.equal(officialCredentialsFor(resolution({ file: FILE })).issuerId, 'issuer-acme');
  });

  test('with neither, the message names both ways to fix it', () => {
    assert.throws(() => officialCredentialsFor(resolution()), /ASC_ISSUER_ID.*--account/s);
  });

  test('an account with no key cannot be used for the official API, and says which key', () => {
    assert.throws(
      () => officialCredentialsFor(resolution({ account: 'readonly', file: FILE })),
      /"readonly".*no issuerId, no keyId, no privateKeyPath/s
    );
  });
});

describe('the capture path: the same order, for the other credential', () => {
  test('--account outranks ASC_CURL_PATH', () => {
    assert.equal(capturePathFor(resolution({ account: 'beta', env: ENV, file: FILE })), '/captures/beta.txt');
  });

  test('ASC_CURL_PATH outranks the default account', () => {
    assert.equal(capturePathFor(resolution({ env: ENV, file: FILE })), '/captures/env.txt');
  });

  test('then the default account', () => {
    assert.equal(capturePathFor(resolution({ file: FILE })), '/captures/acme.txt');
  });

  test('then the built-in path', () => {
    assert.equal(capturePathFor(resolution()), BUILT_IN);
  });

  test('a named account with no capture is an error, not a fall-through', () => {
    // Falling back to the built-in path here would read a different account's cookie.
    assert.throws(() => capturePathFor(resolution({ account: 'keyonly', file: FILE })), /no capturePath/);
  });
});

describe('what `asc accounts` prints', () => {
  const printed = describeAccounts(FILE, '/cfg.json');

  test('names every account and marks the default', () => {
    assert.match(printed, /acme {2}\(default\)/);
    assert.match(printed, /\bbeta\b/);
  });

  test('says what each one is equipped for', () => {
    assert.match(printed, /official API: {2}yes, key at \/keys\/acme\.p8/);
    assert.match(printed, /official API: {2}not configured/);
  });

  test('prints no identifiers', () => {
    // Paths are printed because a path is what fixes a misconfigured account. The issuer
    // and key ids identify the account to Apple and answer a question nobody asked here.
    for (const identifier of ['issuer-acme', 'key-acme', 'issuer-beta', 'key-beta']) {
      assert.equal(printed.includes(identifier), false, `printed ${identifier}`);
    }
  });

  test('with no file, says so rather than inventing one', () => {
    assert.match(describeAccounts(undefined, '/cfg.json'), /No accounts file at \/cfg\.json/);
  });
});

describe('the invariant that makes this module safe to sit above both credentials', () => {
  test('it never reads a credential, only names where one lives', () => {
    // `accounts.ts` is the one module both authentication systems pass through, so it
    // resolves paths and hands them on: `official/client.ts` reads the `.p8`, and
    // `gap/session.ts` reads the capture. If this list ever needs extending, the boundary
    // has moved and the reason belongs in `docs/evidence.md`, not in this assertion.
    const source = readFileSync(sourcePath('accounts.ts'), 'utf8');
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    assert.equal(/\bcreatePrivateKey\b/.test(body), false, 'accounts.ts signs something');
    assert.equal(/\bfetch\s*\(/.test(body), false, 'accounts.ts sends a request');
    assert.equal(/\bsessionFromCapture\b/.test(body), false, 'accounts.ts parses a capture');

    // It reads exactly one file, and that file is the accounts list.
    const reads = [...body.matchAll(/readFileSync\(([^)]*)\)/g)].map((match) => match[1]!.trim());
    assert.deepEqual(reads, ["path, 'utf8'"]);
  });
});
