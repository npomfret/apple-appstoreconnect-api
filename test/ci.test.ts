/**
 * The Xcode Cloud calls, pinned to what the browser was recorded sending.
 *
 * URLs are asserted whole rather than in pieces. These paths carry a team UUID, a product
 * UUID and a workflow UUID in that order, and getting two of them the wrong way round
 * produces a URL that still looks right — so the test compares the string, not its parts.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import * as ci from '../src/ci';
import { getCi } from '../src/http';
import { Session } from '../src/session';
import { SESSION, stubFetch, withStderr } from './helpers';

const CI = 'https://appstoreconnect.apple.com/ci/api';
const TEAM = `${CI}/teams/team-0000`;
const PRODUCT = '340CDC9B-A9BA-4B2D-A11C-3548AA5E087F';
const WORKFLOW = '3FAD90EF-F58E-41E4-924A-39EFAB5FFEDD';

/** Runs `call`, answering every request with `body`, and hands back what was sent. */
async function sent(body: unknown, call: () => Promise<unknown>) {
  const stub = stubFetch(() => ({ body }));
  try {
    await call();
    return stub.calls;
  } finally {
    stub.restore();
  }
}

describe('the recorded paths', () => {
  test('an app id becomes a product, on the team path', async () => {
    const calls = await sent({ id: PRODUCT }, () => ci.getProductForApp(SESSION, '6770023782'));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${TEAM}/asc-products/6770023782`);
    assert.equal(calls[0]!.method, 'GET');
  });

  test('a product reads back by its own id', async () => {
    const calls = await sent({ id: PRODUCT }, () => ci.getProduct(SESSION, PRODUCT));
    assert.equal(calls[0]!.url, `${TEAM}/products-v3/${PRODUCT}`);
  });

  test('workflows come back a hundred at a time, deleted ones left out', async () => {
    const calls = await sent({ items: [] }, () => ci.listWorkflows(SESSION, PRODUCT));
    assert.equal(calls[0]!.url, `${TEAM}/products/${PRODUCT}/workflows-v15?limit=100&include_deleted=false`);
  });

  test('one workflow', async () => {
    const calls = await sent({ id: WORKFLOW }, () => ci.getWorkflow(SESSION, PRODUCT, WORKFLOW));
    assert.equal(calls[0]!.url, `${TEAM}/products/${PRODUCT}/workflows-v15/${WORKFLOW}`);
  });

  test('build groups', async () => {
    const calls = await sent({ items: [] }, () => ci.listBuildGroups(SESSION, PRODUCT));
    assert.equal(calls[0]!.url, `${TEAM}/products/${PRODUCT}/build-groups-v4?limit=10`);
  });

  test('build summaries name their groups in one comma-separated parameter', async () => {
    const calls = await sent({ items: [] }, () => ci.listBuildSummaries(SESSION, PRODUCT, ['g1', 'g2']));
    assert.equal(
      calls[0]!.url,
      `${TEAM}/products/${PRODUCT}/build-summaries-v2?build_group_ids=g1,g2&limit=4`
    );
  });

  test('repos and capabilities', async () => {
    const repos = await sent({ primary_repos: [] }, () => ci.listRepos(SESSION, PRODUCT));
    assert.equal(repos[0]!.url, `${TEAM}/products/${PRODUCT}/repos-v3`);

    const caps = await sent({ can_remove_products: true }, () => ci.getUserCapabilities(SESSION));
    assert.equal(caps[0]!.url, `${TEAM}/user-capabilities`);
  });
});

describe('what these calls send', () => {
  test('the CSRF header is dropped and Accept is not the JSON:API one', async () => {
    const session: Session = { ...SESSION, headers: { ...SESSION.headers, 'x-csrf-itc': '[asc-ui]' } };
    const calls = await sent({ items: [] }, () => ci.listWorkflows(session, PRODUCT));

    assert.equal(calls[0]!.headers['accept'], '*/*');
    assert.equal('x-csrf-itc' in calls[0]!.headers, false);
    // The cookie still goes: it is the whole of the authentication on this API.
    assert.equal(calls[0]!.headers['cookie'], SESSION.cookie);
  });

  test('no signature is sent, because none can be computed', async () => {
    const calls = await sent({ items: [] }, () => ci.listWorkflows(SESSION, PRODUCT));

    assert.equal('x-apple-signature' in calls[0]!.headers, false);
    assert.equal('x-apple-signed-at' in calls[0]!.headers, false);
  });
});

describe('refusals', () => {
  test('a capture with no team id sends nothing', async () => {
    const teamless: Session = { ...SESSION, teamId: undefined };
    const stub = stubFetch();
    try {
      await assert.rejects(() => ci.listWorkflows(teamless, PRODUCT), /no team id/);
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });

  test('asking for the builds of no groups sends nothing', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => ci.listBuildSummaries(SESSION, PRODUCT, []), /at least one build group/);
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });

  test('an absolute URL is refused here too, not just on iris', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => getCi(SESSION, 'https://evil.example/steal'), /carry the App Store Connect session cookie/);
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });
});

describe('a clipped page', () => {
  test('an items page exactly as long as the limit is reported, like a data page', async () => {
    const items = Array.from({ length: 3 }, (_, n) => ({ id: `w${n}` }));
    const records = await withStderr(async (captured) => {
      const stub = stubFetch(() => ({ body: { items } }));
      try {
        await ci.listWorkflows(SESSION, PRODUCT, { limit: 3 });
      } finally {
        stub.restore();
      }
      return captured.records();
    });

    const warning = records.find((record) => record['event'] === 'read.atLimit');
    assert.ok(warning, 'expected read.atLimit');
    assert.equal(warning['returned'], 3);
    assert.equal(warning['limit'], 3);
  });
});
