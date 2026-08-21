/**
 * The transport, which is the security boundary: it decides what the session cookie is
 * attached to and what counts as a change worth auditing. Both of those were wrong in ways
 * no exception reported, so they are asserted here rather than read.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { ApiError, BASE_URL, RequestOptions, SessionExpiredError, buildQuery, get, request } from '../src/http';
import { SESSION, stubFetch, withStderr } from './helpers';

describe('where a request goes', () => {
  test('a path is resolved against the iris base url, with the session attached', async () => {
    const stub = stubFetch();
    try {
      await get(SESSION, 'appStoreVersions/v1', { limit: 10 });
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, `${BASE_URL}/appStoreVersions/v1?limit=10`);
    assert.equal(stub.calls[0].headers['cookie'], SESSION.cookie);
    assert.equal(stub.calls[0].headers['x-csrf-itc'], '[asc-ui]');
  });

  test('a leading slash is not a second one', async () => {
    const stub = stubFetch();
    try {
      await get(SESSION, '/apps');
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].url, `${BASE_URL}/apps`);
  });

  // The cookie is a live App Store Connect session and `asc get` takes its path off the
  // command line. An absolute URL here would send it to whatever host it named, so it must
  // be refused *before* anything leaves. Which host it names is the point: this is the one
  // check the gap allowlist in `api.ts` does not subsume, because it is about where the
  // cookie goes rather than about which resources are in scope.
  for (const url of [
    'https://example.invalid/collect',
    'http://example.invalid/collect',
    'HTTPS://EXAMPLE.INVALID/collect',
    '//example.invalid/collect',
    'file:///etc/passwd',
  ]) {
    test(`the session is not sent to ${url}`, async () => {
      const stub = stubFetch();
      try {
        await assert.rejects(() => get(SESSION, url), /cookie|path relative/i);
      } finally {
        stub.restore();
      }

      assert.deepEqual(stub.calls, []);
    });
  }

  test('a path that merely starts with the letters http is an ordinary path', async () => {
    const stub = stubFetch();
    try {
      await get(SESSION, 'httpProbes/1');
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].url, `${BASE_URL}/httpProbes/1`);
  });
});

describe('what counts as a write', () => {
  // What a consumer in plain JavaScript can pass. TypeScript callers are stopped by the
  // union on RequestOptions; nothing stops this one, and classifying it as a read would
  // send the mutation with no audit record and none of the write headers.
  const lowercase: RequestOptions = JSON.parse('{"method":"patch"}');

  test('a lowercase method still sends the write headers', async () => {
    const stub = stubFetch();
    try {
      await withStderr(() => request(SESSION, 'appStoreVersions/v1', { ...lowercase, body: { data: {} } }));
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].method, 'PATCH');
    assert.equal(stub.calls[0].headers['origin'], 'https://appstoreconnect.apple.com');
    assert.equal(stub.calls[0].headers['x-connect-team-id'], 'team-0000');
    // One content type now, on reads and writes alike — a write no longer names its own,
    // and there is no second value to reach by leaving it out.
    assert.equal(stub.calls[0].headers['content-type'], 'application/vnd.api+json');
  });

  test('a lowercase method still leaves an audit record', async () => {
    const stub = stubFetch();
    const records = await withStderr(async (captured) => {
      try {
        await request(SESSION, 'appStoreVersions/v1', { ...lowercase, body: { data: {} } });
      } finally {
        stub.restore();
      }
      return captured.records();
    });

    const writes = records.filter((record) => record.event === 'http.write');
    assert.deepEqual(
      writes.map((record) => record.phase),
      ['start', 'ok']
    );
    assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].audit, true);
  });

  test('a read is not audited as a write', async () => {
    const stub = stubFetch();
    const records = await withStderr(async (captured) => {
      try {
        await get(SESSION, 'apps');
      } finally {
        stub.restore();
      }
      return captured.records();
    });

    assert.deepEqual(records.filter((record) => record.event === 'http.write'), []);
  });

  // PUT is in the list on purpose. The one PUT this client sends is an upload part, which
  // goes to Apple's storage without the cookie and never through `request`, so a PUT
  // arriving here is a caller who has the wrong function rather than a supported verb.
  for (const method of ['TRACE', 'PUT']) {
    test(`${method} is not one of the four methods, and is refused`, async () => {
      const stub = stubFetch();
      const options: RequestOptions = JSON.parse(`{"method":"${method}"}`);
      try {
        await assert.rejects(() => request(SESSION, 'apps', options), /Unsupported HTTP method/);
      } finally {
        stub.restore();
      }

      assert.deepEqual(stub.calls, []);
    });
  }
});

describe('query strings', () => {
  test('brackets and commas are sent as the browser sends them', () => {
    assert.equal(
      buildQuery({ 'filter[state]': ['A', 'B'], 'fields[apps]': 'name' }),
      '?filter[state]=A,B&fields[apps]=name'
    );
  });

  test('an undefined value is left out entirely', () => {
    assert.equal(buildQuery({ limit: undefined, include: 'app' }), '?include=app');
  });

  test('nothing to send is no question mark', () => {
    assert.equal(buildQuery({}), '');
  });

  test('a value that would change the url is encoded', () => {
    assert.equal(buildQuery({ 'filter[name]': 'a&b=c' }), '?filter[name]=a%26b%3Dc');
  });
});

describe('answers that are not what they look like', () => {
  test('a page shorter than the total it reports is called out', async () => {
    const stub = stubFetch(() => ({ body: { data: [{ type: 'apps', id: '1' }], meta: { paging: { total: 9 } } } }));
    const records = await withStderr(async (captured) => {
      try {
        await get(SESSION, 'apps');
      } finally {
        stub.restore();
      }
      return captured.records();
    });

    const clipped = records.find((record) => record.event === 'read.clipped');
    assert.equal(clipped?.returned, 1);
    assert.equal(clipped?.total, 9);
  });

  test('a page exactly as long as the limit is suspected', async () => {
    const stub = stubFetch(() => ({ body: { data: [{ type: 'apps', id: '1' }, { type: 'apps', id: '2' }] } }));
    const records = await withStderr(async (captured) => {
      try {
        await get(SESSION, 'apps', { limit: 2 });
      } finally {
        stub.restore();
      }
      return captured.records();
    });

    assert.ok(records.some((record) => record.event === 'read.atLimit'));
  });

  // iris answers a query it doesn't support with a 403 and a JSON:API error document.
  // Reporting that as an expired session sends you off to re-capture a session that was
  // working fine.
  test('a 403 carrying errors is a refused query, not a dead session', async () => {
    const stub = stubFetch(() => ({ status: 403, body: { errors: [{ code: 'PARAMETER_ERROR' }] } }));
    try {
      await assert.rejects(() => get(SESSION, 'apps'), ApiError);
    } finally {
      stub.restore();
    }
  });

  // The refusal body carries whatever iris chose to quote back, and it travels further
  // than the log: the CLI prints an error message to stderr on its own. Scrubbing it where
  // the error is built is what covers both.
  test('a refusal body is scrubbed before it becomes an error message', async () => {
    const stub = stubFetch(() => ({
      status: 400,
      body: { errors: [{ detail: 'bad', meta: { request: { cookie: 'myacinfo=real' } } }] },
    }));
    try {
      await assert.rejects(
        () => get(SESSION, 'resolutionCenterThreads'),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.body.includes('myacinfo=real'), false);
          assert.equal(error.message.includes('myacinfo=real'), false);
          assert.ok(error.message.includes('bad'), 'the rest of the refusal survives');
          return true;
        }
      );
    } finally {
      stub.restore();
    }
  });

  test('a bare 403 is a dead session', async () => {
    const stub = stubFetch(() => ({ status: 403, text: 'Forbidden' }));
    try {
      await assert.rejects(() => get(SESSION, 'apps'), SessionExpiredError);
    } finally {
      stub.restore();
    }
  });

  test('a session already past its expiry is not sent at all', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(
        () => get({ ...SESSION, expiresAt: '2020-01-01T00:00:00.000Z' }, 'apps'),
        SessionExpiredError
      );
    } finally {
      stub.restore();
    }

    assert.deepEqual(stub.calls, []);
  });
});
