/**
 * The boundary as a property of the file tree, not of a comment.
 *
 * `test/boundary.test.ts` guards this from the runtime side: it proves a refused path sends
 * nothing. This one guards the same boundary a step earlier, at the point where a refusal
 * would have to be written in the first place. Two authentication systems live in this
 * repository — a short-lived JWT signed by a `.p8`, and a cookie pasted out of a browser —
 * and the thing that keeps either from reaching the other's host is that the modules
 * holding them cannot see each other.
 *
 * That guarantee was previously a docblock in `official/client.ts` saying the two
 * transports are deliberately separate, while the file directly above it imported the other
 * transport for its error class and query encoder. A sentence cannot fail. This can.
 *
 * The rules, in the order they are checked:
 *
 *   - `shared/` imports neither side. It is reachable from both at once, so anything
 *     credential-bearing placed there would be the one module where the two systems meet.
 *   - `official/` never imports `gap/`, and `gap/` never imports `official/`.
 *   - Composition at the top of `src/` may import all three. `cli.ts` has to: it is the one
 *     place a person chooses which credential a command needs.
 *
 * Read the graph off disk rather than off the compiler, because the assertion is about what
 * a file is *allowed* to say, and an unused import is still a path between two modules.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

/**
 * The TypeScript, not the compiled copy of it beside this file.
 *
 * `npm test` runs out of `out-tsc/`, where `../src` is emitted JavaScript and a check for
 * `.ts` files would find none — and a graph with no edges in it passes every rule below
 * without reading a line of source. So walk up to the directory holding `package.json` and
 * read the real tree from there, whichever copy of this test is executing.
 */
function sourceRoot(): string {
  let dir = __dirname;

  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    assert.notEqual(parent, dir, 'no package.json above this test, so no src/ to check');
    dir = parent;
  }

  return join(dir, 'src');
}

const SRC = sourceRoot();

/** Every directory under `src/`, so a new one cannot escape the rules by being new. */
const AREAS = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** Who may import whom. A missing key is a directory nobody thought about — see below. */
const MAY_IMPORT: Readonly<Record<string, readonly string[]>> = {
  shared: [],
  gap: ['shared'],
  official: ['shared'],
};

interface Edge {
  from: string;
  to: string;
  file: string;
  specifier: string;
}

/**
 * Every relative module specifier, in all four forms that reach one.
 *
 * `from '…'` alone is not enough, and the first version of this test made exactly that
 * mistake: a side-effect `import '…'`, a `require('…')` and a lazy `await import('…')`
 * each crossed it undetected. The keyword has to be immediately before the literal, which
 * is what keeps `resolve(__dirname, '..', 'tmp', 'curl.txt')` in `gap/session.ts` from
 * reading as an import.
 */
const IMPORT = /(?:from|import|require)\s*\(?\s*'(\.[^']*)'/g;

/**
 * The area a resolved specifier lands in, or `''` for a module at the top of `src/`.
 *
 * A specifier that resolves to a bare area — `'../gap'`, the barrel — has to count as that
 * area too, or importing a directory would be the way round every rule below.
 */
function areaOf(fromArea: string, specifier: string): string {
  const parts = (fromArea ? `${fromArea}/${specifier}` : specifier).split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }

  const head = resolved[0];

  return head !== undefined && AREAS.includes(head) ? head : '';
}

function edges(): Edge[] {
  const found: Edge[] = [];

  for (const area of ['', ...AREAS]) {
    const dir = area ? join(SRC, area) : SRC;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      for (const match of source.matchAll(IMPORT)) {
        const specifier = match[1]!;
        found.push({
          from: area,
          to: areaOf(area, specifier),
          file: `${area ? `${area}/` : ''}${name}`,
          specifier,
        });
      }
    }
  }

  return found;
}

describe('the credential boundary in the file tree', () => {
  test('every area under src/ has a declared rule', () => {
    assert.deepEqual(
      AREAS.filter((area) => !(area in MAY_IMPORT)),
      [],
      'a new directory under src/ must declare here what it is allowed to import'
    );
  });

  test('the three areas are the ones the boundary is drawn around', () => {
    assert.deepEqual(AREAS, ['gap', 'official', 'shared']);
  });

  for (const [area, allowed] of Object.entries(MAY_IMPORT)) {
    test(`${area}/ imports only ${allowed.length ? allowed.join(', ') : 'itself'}`, () => {
      const crossings = edges().filter(
        (edge) => edge.from === area && edge.to !== '' && edge.to !== area && !allowed.includes(edge.to)
      );

      assert.deepEqual(
        crossings.map((edge) => `${edge.file} imports '${edge.specifier}'`),
        []
      );
    });
  }

  test('the cookie transport is not reachable from the official side at all', () => {
    // Stated separately from the table above because this is the one that matters: it is
    // the assertion that no module authenticating with an API key can see `Session`,
    // `loadSession`, or anything that reads the capture file.
    const reachable = new Set<string>(['official']);
    let grew = true;

    while (grew) {
      grew = false;
      for (const edge of edges()) {
        if (reachable.has(edge.from) && edge.to !== '' && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          grew = true;
        }
      }
    }

    assert.deepEqual([...reachable].sort(), ['official', 'shared']);
  });

  test('no module in shared/ can send a request', () => {
    // The admission test for `shared/`, and deliberately not a search for the *words* — a
    // credential's whole purpose is to be attached to a request, so a module that cannot
    // make one cannot be where the two authentication systems meet. Matching on names
    // would fail here for the opposite of the right reason: `log.ts` has to spell out
    // `cookie`, `itctx` and the rest precisely because removing them is its job.
    const senders: string[] = [];

    for (const name of readdirSync(join(SRC, 'shared'))) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(join(SRC, 'shared', name), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      if (/\bfetch\s*\(/.test(code)) senders.push(`shared/${name}`);
    }

    assert.deepEqual(senders, []);
  });
});
