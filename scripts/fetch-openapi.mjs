#!/usr/bin/env node
/**
 * Fetch Apple's official App Store Connect API documentation into `tmp/openapi/`, which is
 * gitignored, so that "does Apple serve this officially?" can be answered locally.
 *
 * Two sources, the same two `docs/evidence.md` audits against:
 *
 *   - the OpenAPI specification, a zip holding one JSON document, unpacked to
 *     `tmp/openapi/openapi.json`; and
 *   - the documentation index behind developer.apple.com's reference pages, saved as
 *     `tmp/openapi/index.json`.
 *
 * No dependency: Node's own `fetch`, and the system `unzip` for the archive. Nothing here
 * touches a credential — both URLs are public — and nothing here reads a capture.
 *
 *   npm run spec:fetch
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_URL =
  'https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip';
const INDEX_URL = 'https://developer.apple.com/tutorials/data/index/appstoreconnectapi';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tmp', 'openapi');

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

mkdirSync(out, { recursive: true });

const zipPath = join(out, 'openapi.zip');
writeFileSync(zipPath, await download(SPEC_URL));
const unpacked = join(out, 'unpacked');
rmSync(unpacked, { recursive: true, force: true });
execFileSync('unzip', ['-o', '-q', zipPath, '-d', unpacked]);

// The archive holds one JSON document under a name Apple changes between releases, plus
// macOS resource-fork noise; find the document rather than assuming its name.
const json = readdirSync(unpacked).find((name) => name.endsWith('.json'));
if (!json) throw new Error(`No .json inside ${zipPath}`);
const specPath = join(out, 'openapi.json');
renameSync(join(unpacked, json), specPath);
rmSync(unpacked, { recursive: true, force: true });

const indexPath = join(out, 'index.json');
writeFileSync(indexPath, await download(INDEX_URL));

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const entries = JSON.stringify(index).match(/"path":/g)?.length ?? 0;

console.log(`specification  ${specPath}`);
console.log(`  version      ${spec.info?.version ?? '(no version)'}`);
console.log(`  paths        ${Object.keys(spec.paths ?? {}).length}`);
console.log(`  schemas      ${Object.keys(spec.components?.schemas ?? {}).length}`);
console.log(`index          ${indexPath}`);
console.log(`  "path" keys  ${entries}`);
