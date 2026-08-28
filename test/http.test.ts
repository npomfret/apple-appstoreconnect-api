/**
 * The transport, which is the security boundary: it decides what the session cookie is
 * attached to and what counts as a change worth auditing. Both of those were wrong in ways
 * no exception reported, so they are asserted here rather than read.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  BASE_URL,
  RequestOptions,
  SessionExpiredError,
  UploadOperation,
  get,
  request,
  uploadPart,
} from '../src/gap/http';
import { ApiError } from '../src/shared/errors';
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

  /**
   * Where a path resolves to, rather than how it is spelled. `..` is not the only way to
   * write a dot segment — `%2e%2e` and `%2E%2E` are ones too, and `\` separates segments on
   * a special scheme exactly as `/` does — and each of these reached a base this client
   * closed with the session cookie on it, past `withinBoundary`, which reads the first
   * segment and saw a private family there.
   */
  for (const path of [
    'resolutionCenterThreads/../../../v1/apps',
    'resolutionCenterThreads/%2e%2e/%2e%2e/%2e%2e/ci/api/v1/ciBuildRuns',
    'resolutionCenterThreads/%2E%2E/%2E%2E/%2E%2E/olympus/v1/actors',
    'resolutionCenterThreads/.%2e/.%2e/.%2e/v1/apps',
    'resolutionCenterThreads\\..\\..\\builds',
  ]) {
    test(`the session does not follow "${path}" out of the base`, async () => {
      const stub = stubFetch();
      try {
        await assert.rejects(() => get(SESSION, path), /outside/);
      } finally {
        stub.restore();
      }

      assert.deepEqual(stub.calls, []);
    });
  }

  // `request` appends the query to whatever this returns, so a path carrying one of its own
  // does not describe the request that goes out: a second `?`, or — after a `#` — a query
  // that is never sent at all, which is a filter silently dropped from a read.
  for (const path of ['resolutionCenterThreads?limit=1', 'resolutionCenterThreads#', 'a#b']) {
    test(`"${path}" is not a path`, async () => {
      const stub = stubFetch();
      try {
        await assert.rejects(() => get(SESSION, path, { limit: 5 }), /not a path/);
      } finally {
        stub.restore();
      }

      assert.deepEqual(stub.calls, []);
    });
  }

  // The URL that goes out is the resolved one, so a path that normalises to somewhere still
  // inside the base is sent as where it ends up rather than as what was typed.
  test('a path is sent where it resolves to, not as it was written', async () => {
    const stub = stubFetch();
    try {
      await get(SESSION, 'resolutionCenterThreads/%2e/t1');
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].url, `${BASE_URL}/resolutionCenterThreads/t1`);
  });

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

/**
 * Which headers a request carries, and who decides. The transport owns the media types and
 * the session owns the account's — the two used to be the other way round, silently.
 */
describe('the headers a request goes out with', () => {
  // 214 of the 214 reads recorded from the browser send both, as do all 10 writes. They
  // were sent only when mutating, which went unnoticed because a capture taken from a
  // browser GET carries them itself — but a capture that is only a cookie jar, which the
  // CLI's help offers as enough, does not, and its reads went out without either.
  test('a read carries the team pair, which the browser sends on every request', async () => {
    const stub = stubFetch();
    try {
      await get(SESSION, 'apps');
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].headers['x-connect-team-id'], 'team-0000');
    assert.equal(stub.calls[0].headers['x-connect-team-type'], 'PURPLESOFTWARE');
  });

  // Origin is the header that really is write-only: absent from all 214 recorded reads,
  // present on all 10 recorded writes.
  test('a read carries no Origin', async () => {
    const stub = stubFetch();
    try {
      await get(SESSION, 'apps');
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].headers['origin'], undefined);
  });

  // The capture used to be spread over the media types rather than under them, so the iris
  // request the user happened to right-click decided what every later one sent. iris is
  // served from two front-end bundles that disagree — 133 recorded reads send
  // `application/vnd.api+json` as both, 78 send `application/json` with the wider Accept —
  // so a capture from the second kind put `content-type: application/json` on the POST that
  // sends a reply to App Review, where every recorded POST sends the JSON:API type.
  test('a capture naming its own media types does not decide the transport\'s', async () => {
    const captured = {
      ...SESSION,
      headers: { ...SESSION.headers, accept: '*/*', 'content-type': 'application/json' },
    };

    const stub = stubFetch();
    try {
      await withStderr(() => request(captured, 'resolutionCenterMessages', { method: 'POST', body: { data: {} } }));
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].headers['content-type'], 'application/vnd.api+json');
    assert.equal(stub.calls[0].headers['accept'], 'application/vnd.api+json, application/json, text/csv');
  });

  // The account's own headers still win where the capture has them: that team id is the one
  // the browser was using, and `session.teamId` is only the cookie-decoded fallback.
  test('a captured team id still wins over the one decoded from the cookie', async () => {
    const captured = {
      ...SESSION,
      headers: { ...SESSION.headers, 'x-connect-team-id': 'team-from-header' },
    };

    const stub = stubFetch();
    try {
      await get(captured, 'apps');
    } finally {
      stub.restore();
    }

    assert.equal(stub.calls[0].headers['x-connect-team-id'], 'team-from-header');
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

describe('answers that are not what they look like', () => {
  // Every collection recorded from the browser carries `meta.paging`, with the collection's
  // real total beside the page size iris applied — 161 array responses, all 161 with both.
  // So the total is the signal, and the fixtures below carry one wherever a real response
  // would.
  const page = (ids: string[], paging?: { total?: number; limit?: number }) => ({
    body: { data: ids.map((id) => ({ type: 'apps', id })), ...(paging ? { meta: { paging } } : {}) },
  });

  const warnings = async (respond: () => ReturnType<typeof page>, run: () => Promise<unknown>) => {
    const stub = stubFetch(respond);
    return withStderr(async (captured) => {
      try {
        await run();
      } finally {
        stub.restore();
      }
      return captured.records();
    });
  };

  test('a page shorter than the total it reports is called out', async () => {
    const records = await warnings(
      () => page(['1'], { limit: 50, total: 9 }),
      () => get(SESSION, 'apps')
    );

    const clipped = records.find((record) => record.event === 'read.clipped');
    assert.equal(clipped?.returned, 1);
    assert.equal(clipped?.total, 9);
  });

  // The heuristic used to run whether or not iris had already answered the question, so a
  // complete list that happened to be exactly as long as the limit was reported as one that
  // might be short. `builds?limit=20` coming back as 20 of a total of 20 is that shape.
  test('a page as long as the limit is not suspected when the total says it is whole', async () => {
    const records = await warnings(
      () => page(['1', '2'], { limit: 2, total: 2 }),
      () => get(SESSION, 'apps', { limit: 2 })
    );

    assert.deepEqual(
      records.map((record) => record.event).filter((event) => event === 'read.atLimit' || event === 'read.clipped'),
      []
    );
  });

  // A guard rather than an observation: no recorded response omits a total. It exists for a
  // route that reports none, which would otherwise clip in silence.
  test('a page exactly as long as the limit is suspected when no total is reported', async () => {
    const records = await warnings(
      () => page(['1', '2']),
      () => get(SESSION, 'apps', { limit: 2 })
    );

    const atLimit = records.find((record) => record.event === 'read.atLimit');
    assert.equal(atLimit?.limit, 2);
  });

  // The two calls whose page is most likely to clip — `listMessages` and `listThreads` —
  // send no top-level limit and are held to iris's own default of 50. Reading the limit off
  // the outgoing query meant the fallback could never fire for either of them; iris reports
  // the page size it applied, so it can.
  test('a page as long as the limit iris applied is suspected even when we asked for none', async () => {
    const records = await warnings(
      () => page(['1', '2'], { limit: 2 }),
      () => get(SESSION, 'apps')
    );

    const atLimit = records.find((record) => record.event === 'read.atLimit');
    assert.equal(atLimit?.returned, 2);
    assert.equal(atLimit?.limit, 2);
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

/**
 * The one call here that does not go through `apiUrl`, and until 2026-08-22 the one with no
 * check on where it lands at all. What is asserted is the same thing `boundary.test.ts`
 * asserts about a refused path: a refusal sends **nothing**. The bytes are the user's file.
 *
 * The host is the recorded one, region prefix included — `northamerica-1.` in front of the
 * name the comments and the documentation used to give flat.
 */
describe('where an upload part goes', () => {
  const RECORDED = 'https://northamerica-1.object-storage.apple.com/part/1?signature=not-a-real-one';

  function part(url: string): UploadOperation {
    return { method: 'PUT', url, offset: 0, length: 4, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] };
  }

  /** Attempts one part and reports what reached the network, whether it threw or not. */
  async function attempt(url: string): Promise<{ urls: string[]; error?: string }> {
    const stub = stubFetch();
    try {
      return await withStderr(async () => {
        try {
          await uploadPart(part(url), Buffer.from('abcd'));
          return { urls: stub.calls.map((call) => call.url) };
        } catch (error) {
          return {
            urls: stub.calls.map((call) => call.url),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    } finally {
      stub.restore();
    }
  }

  test('the host Apple actually presigns is a region under the storage name, and is sent', async () => {
    const attempted = await attempt(RECORDED);

    assert.equal(attempted.error, undefined);
    assert.deepEqual(attempted.urls, [RECORDED]);
  });

  test('the bare storage host is allowed too, since the suffix is what the rule is about', async () => {
    const url = 'https://object-storage.apple.com/part/1?signature=not-a-real-one';

    assert.deepEqual(await attempt(url), { urls: [url] });
  });

  test('a host that merely ends with the letters is not under the storage name', async () => {
    // The bug a bare `endsWith` would have: this is a different host and reads like the same one.
    const attempted = await attempt('https://not-object-storage.apple.com/part/1?signature=x');

    assert.match(attempted.error ?? '', /not under object-storage\.apple\.com/);
    assert.deepEqual(attempted.urls, []);
  });

  test('somewhere else entirely is refused before the file moves', async () => {
    const attempted = await attempt('https://example.invalid/part/1?signature=x');

    assert.match(attempted.error ?? '', /example\.invalid/);
    assert.deepEqual(attempted.urls, []);
  });

  test('the storage host in clear is still refused: the query string is the authorisation', async () => {
    const attempted = await attempt('http://northamerica-1.object-storage.apple.com/part/1?signature=x');

    assert.match(attempted.error ?? '', /https only/);
    assert.deepEqual(attempted.urls, []);
  });

  test('a url that is not a url names no host, so nothing is sent', async () => {
    const attempted = await attempt('/part/1?signature=x');

    assert.match(attempted.error ?? '', /does not parse as one/);
    assert.deepEqual(attempted.urls, []);
  });

  test('a refusal never quotes the presigned url back', async () => {
    const attempted = await attempt('https://example.invalid/part/1?signature=the-whole-authorisation');

    assert.doesNotMatch(attempted.error ?? '', /signature|the-whole-authorisation|\/part\/1/);
  });
});
