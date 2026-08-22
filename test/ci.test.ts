/**
 * The Xcode Cloud base, and the one read on it.
 *
 * `/ci/api` is the second base this client speaks and it agrees with iris about almost
 * nothing: it is not JSON:API, it refuses a request that claims to be, it pages with
 * `items` rather than `data`, and its 403 carries no body to classify. Each of those is a
 * test below, because each of them was a way this surface failed before — every `ci-*`
 * command in this repository was refused for the whole of its life by one header.
 *
 * Nothing here reaches the network, no recording is used as a fixture, and every id, name
 * and workflow below is invented in the shape the browser was recorded receiving.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { ApiError, CI, request, SessionExpiredError } from '../src/http';
import { fetchPlan, fetchPostActions, fetchTeam, fetchUsage, formatPostActions, listWorkflows } from '../src/ci';
import { SESSION, stubFetch, withStderr } from './helpers';

const CI_BASE = 'https://appstoreconnect.apple.com/ci/api';
const PRODUCT = 'product-0000';
const ARCHIVE = 'action-archive';

/** A workflow in the shape the collection returns one: id, content, metadata. */
function workflow(postActions: unknown[], name = 'Nightly'): unknown {
  return {
    id: 'workflow-0000',
    content: {
      name,
      disabled: false,
      actions: [
        { id: 'action-test', action_type: 'test', default_name: 'UnitTests' },
        { id: ARCHIVE, action_type: 'archive', default_name: 'Release' },
      ],
      post_actions: postActions,
      environment_variables: [],
    },
    metadata: { is_deleted: false },
  };
}

/** A post-action in the shape both the PUT body and the read-back carry one. */
function postAction(extra: Record<string, unknown> = {}): unknown {
  return {
    id: 'post-0000',
    name: 'Hand to internal testers',
    type: 'testFlight_internal',
    deployment_config: {
      archive_action_id: ARCHIVE,
      testflight_deployment_ids: { beta_group_ids: ['group-0000'], beta_tester_ids: [] },
    },
    ...extra,
  };
}

/** Runs `call` with every request answered by `body`, and hands back what was sent. */
async function sent(body: unknown, call: () => Promise<unknown>) {
  const stub = stubFetch(() => ({ body }));
  try {
    await withStderr(() => call());
    return stub.calls;
  } finally {
    stub.restore();
  }
}

describe('the Xcode Cloud request', () => {
  // The URL itself is pinned in gap-requests.test.ts, with the rest of the private calls.
  test('the team id in the session is what scopes the path, at no extra request', async () => {
    const calls = await sent({ items: [] }, () => listWorkflows(SESSION, PRODUCT));

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.url.startsWith(`${CI_BASE}/teams/${SESSION.teamId}/`));
  });

  /**
   * The whole reason this surface never worked. `/ci/api` answers a request carrying
   * `content-type: application/vnd.api+json` with a 403, and a session is captured from an
   * iris request — so the header has to be absent rather than merely not set here.
   */
  test('no content type is sent, even when the session carries one', async () => {
    const carrying = { ...SESSION, headers: { ...SESSION.headers, 'content-type': 'application/vnd.api+json' } };
    const calls = await sent({ items: [] }, () => listWorkflows(carrying, PRODUCT));

    assert.equal(calls[0]!.headers['content-type'], undefined);
    assert.equal(calls[0]!.headers['accept'], '*/*');
  });

  test('the session cookie still goes, since this is the same host and the same login', async () => {
    const calls = await sent({ items: [] }, () => listWorkflows(SESSION, PRODUCT));

    assert.equal(calls[0]!.headers['cookie'], SESSION.cookie);
  });
});

describe('what the Xcode Cloud base refuses', () => {
  /**
   * The `PUT` that sets `post_actions` is recorded in both directions, and is still not
   * reachable: it replaces the whole fourteen-key workflow document, so a client that does
   * not model every key destroys what it fails to send back. The base refuses the method
   * rather than trusting that no function here happens to use one.
   */
  for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
    test(`a ${method} is refused before a request is built`, async () => {
      const stub = stubFetch();
      try {
        await assert.rejects(
          () => request(SESSION, 'teams/t/products/p/workflows-v15/w', { api: CI, method }),
          /read-only/
        );
      } finally {
        stub.restore();
      }

      assert.deepEqual(stub.calls, []);
    });
  }

  test('a product id that is not one path segment never becomes a path', async () => {
    const stub = stubFetch();
    try {
      for (const bad of ['../../../v1/apps', 'a/b', '', '..', '%2e%2e']) {
        await assert.rejects(() => listWorkflows(SESSION, bad), /is not a product id/);
      }
    } finally {
      stub.restore();
    }

    assert.deepEqual(stub.calls, []);
  });

  test('a session with no team id is told where the team id comes from', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => listWorkflows({ ...SESSION, teamId: undefined }, PRODUCT), /no team id/);
    } finally {
      stub.restore();
    }

    assert.deepEqual(stub.calls, []);
  });
});

describe('how a refusal is read', () => {
  /**
   * iris tells a dead session from a refused query by whether the body is a JSON:API error
   * document. `/ci/api` never sends one — the 403 observed by hand came back as
   * `text/html` with a zero-length body, while `asc status` on the same capture said the
   * session was healthy with hours left — so the iris rule would report every Xcode Cloud
   * refusal as "log in again".
   */
  test('a 403 from Xcode Cloud is a refusal, not an expired session', async () => {
    const stub = stubFetch(() => ({ status: 403, text: '' }));
    try {
      await withStderr(async () => {
        const error = await listWorkflows(SESSION, PRODUCT).catch((thrown: unknown) => thrown);
        assert.ok(error instanceof ApiError, 'a CI 403 should not be a SessionExpiredError');
        assert.equal(error.status, 403);
        assert.match(error.message, /refusal rather than a dead session/);
        assert.match(error.message, /JSON:API/);
      });
    } finally {
      stub.restore();
    }
  });

  test('a 401 is still an expired session, which needs no rule', async () => {
    const stub = stubFetch(() => ({ status: 401, text: '' }));
    try {
      await withStderr(() => assert.rejects(() => listWorkflows(SESSION, PRODUCT), SessionExpiredError));
    } finally {
      stub.restore();
    }
  });
});

describe('a page that may be short', () => {
  /**
   * Xcode Cloud reports neither a total nor the page size it applied, so the only thing
   * left to compare against is the number asked for — which is the case the `read.atLimit`
   * fallback exists for. Under iris's `meta.paging` rule this response says nothing at all.
   */
  test('a full page of items is reported as possibly clipped', async () => {
    const items = Array.from({ length: 2 }, () => workflow([]));
    const stub = stubFetch(() => ({ body: { items } }));

    const records = await withStderr(async (captured) => {
      try {
        await listWorkflows(SESSION, PRODUCT, 2);
      } finally {
        stub.restore();
      }
      return captured.records();
    });

    const warned = records.find((record) => record['event'] === 'read.atLimit');
    assert.ok(warned, 'a page as long as the limit should warn');
    assert.equal(warned['returned'], 2);
    assert.equal(warned['limit'], 2);
  });
});

// What an empty and a populated `post_actions` come out as is pinned in gap-shapes.test.ts.
// These are about the parse surviving a document it was not expecting.
describe('reading a document nobody promised', () => {
  /**
   * The field has no official schema to check against and the API is undocumented, so a key
   * this client has never seen is reported rather than dropped — by name, since a value
   * from an unknown key is not a thing to print.
   */
  test('a key Apple has added is named rather than dropped', async () => {
    const stub = stubFetch(() => ({ body: { items: [workflow([postAction({ notarize_config: { on: true } })])] } }));
    const workflows = await withStderr(async () => {
      try {
        return await fetchPostActions(SESSION, PRODUCT);
      } finally {
        stub.restore();
      }
    });

    assert.deepEqual(workflows[0]!.postActions[0]!.unmodelled, ['notarize_config']);
    assert.match(formatPostActions(workflows), /also sent {4}notarize_config/);
  });

  test('a workflow with no content block is dropped rather than throwing', async () => {
    const stub = stubFetch(() => ({ body: { items: [{ id: 'workflow-0001' }, workflow([])] } }));
    const workflows = await withStderr(async () => {
      try {
        return await fetchPostActions(SESSION, PRODUCT);
      } finally {
        stub.restore();
      }
    });

    assert.equal(workflows.length, 1);
    assert.equal(workflows[0]!.workflowId, 'workflow-0000');
  });
});


describe('the compute window', () => {
  const EMPTY = { usage: [], product_usage: [], info: {} };

  test('a day count becomes an inclusive window ending today, in UTC', async () => {
    const calls = await sent(EMPTY, () => fetchUsage(SESSION, 30));
    const query = new URL(calls[0]!.url).searchParams;
    const start = new Date(`${query.get('start')}T00:00:00Z`);
    const end = new Date(`${query.get('end')}T00:00:00Z`);

    assert.equal((end.getTime() - start.getTime()) / 86_400_000, 29, '30 days inclusive of both ends');
    assert.equal(query.get('end'), new Date().toISOString().slice(0, 10), 'the window ends today, UTC');
  });

  test('one day is a window of one day, not an empty one', async () => {
    const calls = await sent(EMPTY, () => fetchUsage(SESSION, 1));
    const query = new URL(calls[0]!.url).searchParams;

    assert.equal(query.get('start'), query.get('end'));
  });

  test('a day count that is not a whole positive number never becomes a request', async () => {
    const stub = stubFetch();
    try {
      for (const bad of [0, -1, 1.5, NaN, Infinity]) {
        await assert.rejects(() => fetchUsage(SESSION, bad), /whole number of days/);
      }
    } finally {
      stub.restore();
    }

    assert.deepEqual(stub.calls, []);
  });

  test('every team-scoped read needs the team id, and says so when it is missing', async () => {
    const stub = stubFetch();
    try {
      const without = { ...SESSION, teamId: undefined };
      await assert.rejects(() => fetchPlan(without), /no team id/);
      await assert.rejects(() => fetchUsage(without, 7), /no team id/);
      await assert.rejects(() => fetchTeam(without), /no team id/);
    } finally {
      stub.restore();
    }

    assert.deepEqual(stub.calls, []);
  });

  /**
   * The team path has no trailing segment, so a team id that is not one path segment would
   * be the whole of what the URL says. `teamOf` checks it for the same reason every other
   * id here is checked, and this is the one call where nothing follows it to disguise a
   * bad one.
   */
  test('a team id that is not a path segment is refused before a request is built', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => fetchTeam({ ...SESSION, teamId: '../../v1/apps' }), /not a team id/);
    } finally {
      stub.restore();
    }

    assert.deepEqual(stub.calls, []);
  });

  test('a team document that is not an object is refused rather than read as an empty team', async () => {
    const stub = stubFetch(() => ({ body: [] }));
    try {
      await assert.rejects(() => withStderr(() => fetchTeam(SESSION)), /no team document/);
    } finally {
      stub.restore();
    }
  });

  /**
   * The breakdown named seven products where the products call returned two, and only two
   * of the ids matched: compute outlives the product that spent it. So a row is kept on its
   * id alone, and nothing here tries to resolve one.
   */
  test('a product id that resolves to nothing is still a row', async () => {
    const stub = stubFetch(() => ({
      body: {
        usage: [],
        product_usage: [{ product_id: 'deleted-0000', usage_in_minutes: 12, number_of_builds: 1 }],
        info: { can_view_all_products: false },
      },
    }));
    try {
      const window = await withStderr(() => fetchUsage(SESSION, 7));

      assert.equal(window.products.length, 1);
      assert.equal(window.products[0]!.productId, 'deleted-0000');
      assert.equal(window.allProducts, false, 'and a partial view says it is partial');
    } finally {
      stub.restore();
    }
  });

  test('a row Apple sends in an unrecognised shape is dropped, not thrown over', async () => {
    const stub = stubFetch(() => ({
      body: {
        usage: [{ minutes: 5 }, { date: '2026-08-21', minutes: 5, number_of_builds: 1 }],
        product_usage: [{ usage_in_minutes: 9 }],
        info: {},
      },
    }));
    try {
      const window = await withStderr(() => fetchUsage(SESSION, 7));

      assert.equal(window.days.length, 1, 'the day with no date is not a day');
      assert.equal(window.products.length, 0, 'and a product row with no id names no product');
    } finally {
      stub.restore();
    }
  });
});
