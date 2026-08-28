/**
 * Named accounts: which App Store Connect account a command is talking about.
 *
 * This sits at the top of `src/` rather than in any of the three areas, because it is the
 * one place both credentials are named at once, and `shared/` is defined as the place
 * neither one reaches. It is composition, like `cli.ts`.
 *
 * The rule that keeps that safe is that **nothing here reads a credential**. This module
 * resolves *where* one lives — the path to a `.p8`, the path to a browser capture — and
 * hands those paths to `official/client.ts` and `gap/session.ts`, which do the reading. So
 * a key never passes through here, the config file never holds one, and neither a parse
 * error nor `asc accounts` can print one. `test/accounts.test.ts` asserts it.
 *
 * The config file is for the case the CLI could not express before: more than one account.
 * A single account still needs nothing but the environment variables it always used, and
 * this file changes nothing about that path.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';

import { OfficialCredentials } from './official/client';

/**
 * One account's *locations*, all optional.
 *
 * Optional because an account is not obliged to be both things: a team whose review replies
 * are handled here may have no API key configured, and one used only for storefront reads
 * may have no browser capture. A field is missing until something needs it, and then the
 * error names the account and the field rather than falling back to another account's.
 */
export interface AccountConfig {
  readonly issuerId?: string;
  readonly keyId?: string;
  readonly privateKeyPath?: string;
  readonly capturePath?: string;
}

export interface AccountsFile {
  readonly defaultAccount?: string;
  readonly accounts: Readonly<Record<string, AccountConfig>>;
}

/** Everything a resolution reads, so the decision itself stays pure and testable. */
export interface AccountEnvironment {
  readonly ASC_ISSUER_ID?: string;
  readonly ASC_KEY_ID?: string;
  readonly ASC_PRIVATE_KEY_PATH?: string;
  readonly ASC_CURL_PATH?: string;
}

export interface Resolution {
  /** `--account <name>`, when one was given. */
  readonly account?: string;
  readonly env: AccountEnvironment;
  readonly file?: AccountsFile;
  /** Where a capture lives when nothing names one — `gap/session.ts`'s `CURL_PATH`. */
  readonly defaultCapturePath: string;
}

/** Where the accounts file is looked for. `ASC_CONFIG` overrides it. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const given = env['ASC_CONFIG'];
  return given?.trim() ? expandUser(given.trim()) : join(homedir(), '.config', 'asc', 'accounts.json');
}

/**
 * `~` at the start of a path, expanded.
 *
 * The file is written by hand, so `~/keys/AuthKey_….p8` is what someone will type, and a
 * shell is not involved to expand it. Only a leading `~/` — a literal `~` elsewhere in a
 * path is a legal character and left alone.
 */
function expandUser(path: string): string {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

function fail(message: string): never {
  throw new Error(message);
}

function optionalString(source: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${where}: "${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${where} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Parse the accounts file, refusing anything it cannot read.
 *
 * Fail-fast rather than skip-and-continue: a typo'd key in an account block would otherwise
 * resolve to some *other* account's credentials, which is the one outcome this whole module
 * exists to prevent. The path is named in every message because the file is somewhere the
 * caller may not have looked at in months; nothing else about it is quoted, since a value
 * here is a path and paths carry names.
 */
export function parseAccounts(text: string, path: string): AccountsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const root = asObject(parsed, path);
  const accountsValue = root['accounts'];
  if (accountsValue === undefined) fail(`${path}: no "accounts" object. See docs/reading.md.`);
  const accountsObject = asObject(accountsValue, `${path}: "accounts"`);

  const accounts: Record<string, AccountConfig> = {};
  for (const [name, value] of Object.entries(accountsObject)) {
    const where = `${path}: account "${name}"`;
    const block = asObject(value, where);

    const known = ['issuerId', 'keyId', 'privateKeyPath', 'capturePath'];
    const unknownKeys = Object.keys(block).filter((key) => !known.includes(key));
    // Refused rather than ignored. An unrecognised key here is a misspelling of one of the
    // four that matter, and ignoring it means running against the environment instead of
    // the account named on the command line, without saying so.
    if (unknownKeys.length) {
      fail(`${where}: unrecognised ${unknownKeys.length > 1 ? 'keys' : 'key'} ${unknownKeys.join(', ')}. Expected ${known.join(', ')}.`);
    }

    const privateKeyPath = optionalString(block, 'privateKeyPath', where);
    const capturePath = optionalString(block, 'capturePath', where);
    accounts[name] = {
      issuerId: optionalString(block, 'issuerId', where),
      keyId: optionalString(block, 'keyId', where),
      ...(privateKeyPath ? { privateKeyPath: expandUser(privateKeyPath) } : {}),
      ...(capturePath ? { capturePath: expandUser(capturePath) } : {}),
    };
  }

  const defaultAccount = optionalString(root, 'defaultAccount', path);
  if (defaultAccount && !(defaultAccount in accounts)) {
    fail(`${path}: "defaultAccount" is "${defaultAccount}", which is not one of ${listNames(accounts)}.`);
  }

  return defaultAccount ? { defaultAccount, accounts } : { accounts };
}

/** Read the accounts file, or `undefined` when there isn't one. Absence is not an error. */
export function readAccounts(path = configPath()): AccountsFile | undefined {
  if (!existsSync(path)) return undefined;
  return parseAccounts(readFileSync(path, 'utf8'), path);
}

function listNames(accounts: Readonly<Record<string, unknown>>): string {
  const names = Object.keys(accounts);
  return names.length ? names.map((name) => `"${name}"`).join(', ') : '(none)';
}

/**
 * The account a command is about, or `undefined` when nothing names one.
 *
 * A file with exactly one account makes that account the default, because a file with one
 * account and no `defaultAccount` line has only one thing it could mean. Two or more and it
 * has to be said, either in the file or on the command line — picking one would be picking
 * whose App Store data a write lands on.
 */
export function selectAccount(
  file: AccountsFile | undefined,
  named: string | undefined
): { readonly name: string; readonly config: AccountConfig } | undefined {
  if (named) {
    if (!file) {
      fail(`--account ${named} was given, but there is no accounts file at ${configPath()}.`);
    }
    const config = file.accounts[named];
    if (!config) fail(`No account "${named}" in the accounts file. It has ${listNames(file.accounts)}.`);
    return { name: named, config };
  }

  if (!file) return undefined;

  if (file.defaultAccount) {
    // Present by construction: `parseAccounts` refuses a default naming no account.
    return { name: file.defaultAccount, config: file.accounts[file.defaultAccount]! };
  }

  const names = Object.keys(file.accounts);
  const only = names.length === 1 ? names[0]! : undefined;
  return only ? { name: only, config: file.accounts[only]! } : undefined;
}

/**
 * Official-API credentials for this run: `--account` first, then the environment, then the
 * default account.
 *
 * Explicit beats ambient beats configured, which is the ordinary precedence and the only
 * one that leaves the environment-only setup behaving exactly as it did. `--account`
 * outranks the environment deliberately: naming an account and getting whatever was
 * exported in the shell is how a command runs against the wrong team.
 */
export function officialCredentialsFor(resolution: Resolution): OfficialCredentials {
  const { account, env, file } = resolution;
  const selected = selectAccount(file, account);

  if (account && selected) return fromAccount(selected.name, selected.config);

  const fromEnv = completeEnvCredentials(env);
  if (fromEnv) return fromEnv;

  if (selected) return fromAccount(selected.name, selected.config);

  fail(
    'No official-API credentials. Set ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY_PATH, ' +
      `or add an account with all three to ${configPath()} and name it with --account. ` +
      'No account or key identifiers are built into this client.'
  );
}

function completeEnvCredentials(env: AccountEnvironment): OfficialCredentials | undefined {
  const issuerId = env.ASC_ISSUER_ID?.trim();
  const keyId = env.ASC_KEY_ID?.trim();
  const privateKeyPath = env.ASC_PRIVATE_KEY_PATH?.trim();
  // All three or none. Two out of three is a half-finished shell, and filling the third
  // from a config file would sign one account's requests with another account's key.
  if (!issuerId || !keyId || !privateKeyPath) return undefined;
  return { issuerId, keyId, privateKeyPath: expandUser(privateKeyPath) };
}

function fromAccount(name: string, config: AccountConfig): OfficialCredentials {
  const missing = (['issuerId', 'keyId', 'privateKeyPath'] as const).filter((key) => !config[key]);
  if (missing.length) {
    fail(
      `Account "${name}" cannot use the official API: it has no ${missing.join(', no ')} in ` +
        `${configPath()}. Add ${missing.length > 1 ? 'those keys' : 'that key'}, or use an account that has ${missing.length > 1 ? 'them' : 'it'}.`
    );
  }
  return {
    issuerId: config.issuerId!,
    keyId: config.keyId!,
    privateKeyPath: config.privateKeyPath!,
  };
}

/**
 * Where this run's browser capture lives: `--account` first, then `ASC_CURL_PATH`, then the
 * default account, then the built-in `tmp/curl.txt`.
 *
 * Same order as the official credentials, so one mental model covers both. A named account
 * without a `capturePath` is an error rather than a quiet fall-through to the built-in
 * default, which would read another account's cookie.
 */
export function capturePathFor(resolution: Resolution): string {
  const { account, env, file, defaultCapturePath } = resolution;
  const selected = selectAccount(file, account);

  if (account && selected) {
    const path = selected.config.capturePath;
    if (!path) {
      fail(
        `Account "${selected.name}" has no capturePath in ${configPath()}, so there is no ` +
          'browser capture to use for a private command. Add one, or set ASC_CURL_PATH.'
      );
    }
    return absolute(path);
  }

  const fromEnv = env.ASC_CURL_PATH?.trim();
  if (fromEnv) return absolute(expandUser(fromEnv));

  return absolute(selected?.config.capturePath ?? defaultCapturePath);
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(path);
}

/**
 * What `asc accounts` prints.
 *
 * Names, what each account is equipped for, and where its capture lives — and deliberately
 * not `issuerId` or `keyId`. Those identify the account to Apple, this command's job is to
 * say which accounts exist, and the two are not the same question. A path is printed
 * because a path is what someone needs to fix a misconfigured account, and because it is
 * already in a file they wrote.
 */
export function describeAccounts(file: AccountsFile | undefined, path: string): string {
  if (!file) {
    return `No accounts file at ${path}.\nThe environment variables are used instead; see docs/reading.md.`;
  }

  const selected = selectAccount(file, undefined);
  const lines = [`accounts file: ${path}`, ''];

  for (const [name, config] of Object.entries(file.accounts)) {
    const official = config.issuerId && config.keyId && config.privateKeyPath;
    lines.push(
      `  ${name}${selected?.name === name ? '  (default)' : ''}`,
      `    official API:  ${official ? `yes, key at ${config.privateKeyPath}` : 'not configured'}`,
      `    capture:       ${config.capturePath ?? 'not configured'}`
    );
  }

  return lines.join('\n');
}
