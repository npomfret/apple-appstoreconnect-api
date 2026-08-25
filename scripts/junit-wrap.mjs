#!/usr/bin/env node
// Node's built-in `--test-reporter=junit` emits bare <testcase> elements directly under
// <testsuites> when the tests are top-level (no `describe`), which is how this repo writes
// them. TeamCity parses that file successfully and then reports "0 suites" — a silent
// no-op that looks like working test reporting. Wrap those orphans in a single <testsuite>
// so the results are actually recorded.
//
// Vitest nests correctly and never needs this.

import { readFileSync, writeFileSync } from 'node:fs';

const [file, suiteName] = process.argv.slice(2);
if (!file || !suiteName) {
  throw new Error('junit-wrap: usage: junit-wrap.mjs <junit-xml-file> <suite-name>');
}

const xml = readFileSync(file, 'utf8');

// Already nested: nothing to do. Checked explicitly rather than assumed, because a future
// Node release fixing the reporter must not silently double-wrap.
if (/<testsuite\s/.test(xml)) {
  process.exit(0);
}

const open = xml.indexOf('<testsuites>');
const close = xml.lastIndexOf('</testsuites>');
if (open === -1 || close === -1) {
  throw new Error(
    `junit-wrap: ${file} has no <testsuites> root; the reporter output changed shape`,
  );
}

const head = xml.slice(0, open + '<testsuites>'.length);
const body = xml.slice(open + '<testsuites>'.length, close);
const tail = xml.slice(close);

const tests = (body.match(/<testcase[\s>]/g) ?? []).length;
const failures = (body.match(/<failure[\s>]/g) ?? []).length;

// Everything lands in one <testsuite> because Node's reporter records no source file
// (`classname` is the literal string "test" for every case), so two tests sharing a name are
// indistinguishable and TeamCity keeps one. That under-counts the suite silently — the build
// stays green and simply reports fewer tests than ran. Refuse to emit an ambiguous report.
const names = [...body.matchAll(/<testcase\s[^>]*\bname="([^"]*)"/g)].map((m) => m[1]);
const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
if (duplicates.length > 0) {
  throw new Error(
    `junit-wrap: ${suiteName} has ${duplicates.length} duplicate test name(s), which TeamCity ` +
      `would silently collapse. Rename so each is unique: ${duplicates.join(', ')}`,
  );
}

writeFileSync(
  file,
  `${head}\n<testsuite name="${suiteName}" tests="${tests}" failures="${failures}">${body}</testsuite>\n${tail}`,
);
