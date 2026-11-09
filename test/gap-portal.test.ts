/**
 * The developer portal: the request the capability catalogue makes, what it reads back, and
 * what the portal capture keeps.
 *
 * The request is pinned to the one recorded from the browser on 2026-11-06 and replayed by
 * the approved probe the same day: a `POST` carrying `X-HTTP-Method-Override: GET`, the type
 * filter in the URL and the bundle ID, platforms and team id in the body. Nothing here reaches
 * the network, no recording is used as a fixture, and every id below is invented.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { portalSessionFromCapture } from '../src/gap/curl';
import { PORTAL_BASE, portalRead } from '../src/gap/http';
import { fetchCapabilityCatalogue, formatCapabilityCatalogue } from '../src/gap/portal';
import { PortalSession } from '../src/gap/session';
import { ApiError } from '../src/shared/errors';
import { Reply, SESSION, stubFetch, withStderr } from './helpers';

const PORTAL_SESSION: PortalSession = {
  kind: 'developer-portal',
  cookie: 'DSESSIONID=not-a-real-cookie; myacinfo=not-a-real-cookie',
  headers: { csrf: 'csrf-invented', csrf_ts: '0000000000000', 'user-agent': 'invented-agent' },
  capturedAt: '2026-11-06T00:00:00.000Z',
};

const SCOPE = { bundleIdResourceId: 'BUNDLE0000', teamId: 'TEAM000000' };

/** One catalogue row, in the shape the portal was recorded returning. */
function row(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'capabilities',
    id,
    attributes: {
      name: `Invented ${id}`,
      description: 'An invented capability.',
      capabilityType: 'capability',
      documentationURL: 'https://developer.apple.com/invented',
      supportedSDKs: [{ name: 'IOS', displayValue: 'iOS' }, { name: 'MAC_OS', displayValue: 'macOS' }],
      distributionTypes: [{ name: 'STORE', displayValue: 'App Store' }],
      entitlementKeys: ['com.apple.developer.invented'],
      entitlements: [],
      editable: true,
      enabledByDefault: false,
      optional: true,
      isPublic: true,
      optInRequired: false,
      canRequestFromPortal: false,
      distributionApprovalRequired: false,
      developmentOnly: false,
      supportsWildcard: false,
      associatedToRequestForms: false,
      hasExistingFeatureRequest: false,
      displaySupportedSDKs: false,
      referenceType: null,
      requestedCustomCapabilities: null,
      ...overrides,
    },
    links: { self: 'https://developer.apple.com/invented' },
  };
}

function catalogue(rows: unknown[]): unknown {
  return { data: rows, links: { self: 'x' }, meta: { paging: { total: 0, limit: 0 } } };
}

/** Runs `call` with every request answered by `reply`, handing back the result or the error. */
async function run<T>(reply: Reply, call: () => Promise<T>) {
  const stub = stubFetch(() => reply);
  try {
    return await withStderr(async (stderr) => ({
      result: await call().catch((error: unknown) => error),
      calls: stub.calls,
      stderr: stderr.lines,
    }));
  } finally {
    stub.restore();
  }
}

describe('the catalogue request', () => {
  test('is the recorded one: a POST read with the query split between the URL and the body', async () => {
    const { calls } = await run({ body: catalogue([]) }, () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE));
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(
      call!.url,
      'https://developer.apple.com/services-account/v1/capabilities?filter[capabilityType]=capability,service&filter[includeRequestable]=true'
    );
    assert.equal(call!.method, 'POST');
    assert.deepEqual(JSON.parse(call!.body ?? ''), {
      urlEncodedQueryParams: 'filter[bundleId]=BUNDLE0000&filter[platform]=IOS,MACOS',
      teamId: 'TEAM000000',
    });
  });

  test('carries the portal session and the recorded headers, and nothing from App Store Connect', async () => {
    const { calls } = await run({ body: catalogue([]) }, () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE));
    const headers = calls[0]!.headers;
    assert.equal(headers['x-http-method-override'], 'GET');
    assert.equal(headers['content-type'], 'application/vnd.api+json');
    assert.equal(headers['accept'], 'application/json, text/plain, */*');
    assert.equal(headers['x-requested-with'], 'XMLHttpRequest');
    assert.equal(headers['origin'], 'https://developer.apple.com');
    assert.equal(headers['cookie'], PORTAL_SESSION.cookie);
    assert.equal(headers['csrf'], 'csrf-invented');
    assert.equal(headers['csrf_ts'], '0000000000000');
    for (const name of ['x-csrf-itc', 'x-connect-team-id', 'x-connect-team-type']) {
      assert.equal(name in headers, false, `sent ${name}`);
    }
  });

  test('is a read, so it leaves no write audit record', async () => {
    const { stderr } = await run({ body: catalogue([]) }, () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE));
    assert.equal(stderr.some((line) => line.includes('"audit":true')), false);
  });

  test('a bundle ID resource id or team id that is not one path segment sends nothing', async () => {
    for (const scope of [
      { ...SCOPE, bundleIdResourceId: 'A&filter[x]=y' },
      { ...SCOPE, teamId: '../TEAM' },
    ]) {
      const { result, calls } = await run({ body: catalogue([]) }, () => fetchCapabilityCatalogue(PORTAL_SESSION, scope));
      assert.ok(result instanceof Error);
      assert.deepEqual(calls, []);
    }
  });
});

describe('where a portal read may go', () => {
  test('a path that climbs out of the base never carries the portal session anywhere', async () => {
    for (const path of ['../../account/x', '%2e%2e/%2e%2e/x', 'https://appstoreconnect.apple.com/iris/v1/apps']) {
      const { result, calls } = await run({}, () => portalRead(PORTAL_SESSION, path, { teamId: 'TEAM000000' }));
      assert.ok(result instanceof Error, `${path} was sent`);
      assert.deepEqual(calls, []);
    }
  });

  test('an App Store Connect cookie is never sent there, whatever it is labelled', async () => {
    // The compile-time half: if a `Session` ever type-checks as a `PortalSession`, the test
    // build fails here on an unused directive.
    // @ts-expect-error — an App Store Connect session is not a developer-portal one
    const notPortal: PortalSession = SESSION;
    void notPortal;

    // The runtime half, for a caller in plain JavaScript.
    const labelled: PortalSession = { kind: 'developer-portal', cookie: SESSION.cookie, headers: SESSION.headers, capturedAt: SESSION.capturedAt };
    const { result, calls } = await run({}, () => portalRead(labelled, 'capabilities', { teamId: 'TEAM000000' }));
    assert.ok(result instanceof Error);
    assert.match(result.message, /no DSESSIONID cookie/);
    assert.deepEqual(calls, []);
  });

  test('a redirect is not followed, and is reported as a refusal', async () => {
    const { result, calls } = await run({ status: 302, text: '' }, () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE));
    assert.equal(calls[0]!.redirect, 'manual');
    assert.ok(result instanceof ApiError);
    assert.equal(result.status, 302);
  });

  test('the base is the recorded one', () => {
    assert.equal(PORTAL_BASE, 'https://developer.apple.com/services-account/v1');
  });
});

describe('how a portal refusal is read', () => {
  for (const status of [401, 403]) {
    test(`a ${status} is reported as a refusal, since no dead session was ever recorded`, async () => {
      const { result } = await run({ status, text: '' }, () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE));
      assert.ok(result instanceof ApiError);
      assert.match(result.message, /Re-capture a services-account request/);
    });
  }

  test('a refusal quoting the portal credentials back has them scrubbed', async () => {
    const { result } = await run(
      { status: 400, text: '{"csrf":"csrf-invented","DSESSIONID":"not-a-real-cookie"}' },
      () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE)
    );
    assert.ok(result instanceof ApiError);
    assert.equal(result.message.includes('csrf-invented'), false);
    assert.equal(result.message.includes('not-a-real-cookie'), false);
  });
});

describe('fetchCapabilityCatalogue', () => {
  test('carries what each entry applies to and how it is turned on', async () => {
    const { result } = await run(
      { body: catalogue([row('WEATHERKIT'), row('WEATHER_KIT', { capabilityType: 'service', canRequestFromPortal: true })]) },
      () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE)
    );
    assert.ok(Array.isArray(result));
    assert.deepEqual(result[0], {
      id: 'WEATHERKIT',
      name: 'Invented WEATHERKIT',
      type: 'capability',
      description: 'An invented capability.',
      platforms: ['IOS', 'MAC_OS'],
      distributionTypes: ['STORE'],
      entitlementKeys: ['com.apple.developer.invented'],
      documentationUrl: 'https://developer.apple.com/invented',
      editable: true,
      enabledByDefault: false,
      optional: true,
      isPublic: true,
      optInRequired: false,
      canRequestFromPortal: false,
      distributionApprovalRequired: false,
      developmentOnly: false,
      supportsWildcard: false,
    });
    assert.equal(result[1].type, 'service');
    assert.equal(result[1].canRequestFromPortal, true);
  });

  test('a list Apple did not send stays absent rather than becoming an empty one', async () => {
    const { result } = await run(
      { body: catalogue([row('BARE', { distributionTypes: undefined, entitlementKeys: undefined, documentationURL: null })]) },
      () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE)
    );
    assert.ok(Array.isArray(result));
    for (const key of ['distributionTypes', 'entitlementKeys', 'documentationUrl']) {
      assert.equal(key in result[0], false, `carried ${key}`);
    }
  });

  for (const [what, body] of [
    ['a response with no data list', { data: null }],
    ['a row without an id', catalogue([{ ...row('X'), id: undefined }])],
    ['a row without a flag every recorded row carries', catalogue([row('X', { editable: undefined })])],
    ['a row without its platform list', catalogue([row('X', { supportedSDKs: undefined })])],
    ['an entitlement list holding something other than strings', catalogue([row('X', { entitlementKeys: [1] })])],
  ] as const) {
    test(`${what} is refused rather than defaulted`, async () => {
      const { result } = await run({ body }, () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE));
      assert.ok(result instanceof Error);
      assert.match(result.message, /developer portal did not send/);
    });
  }

  test('the digest names each entry and what stands in the way of turning it on', async () => {
    const { result } = await run(
      { body: catalogue([row('ASKED', { editable: false, canRequestFromPortal: true, distributionApprovalRequired: true })]) },
      () => fetchCapabilityCatalogue(PORTAL_SESSION, SCOPE)
    );
    assert.ok(Array.isArray(result));
    const printed = formatCapabilityCatalogue(result);
    assert.match(printed, /^ASKED\s+capability\s+Invented ASKED$/m);
    assert.match(printed, /platforms IOS, MAC_OS; entitlements com\.apple\.developer\.invented/);
    assert.match(printed, /not editable; requested from the portal; distribution needs approval/);
  });
});

describe('the portal capture', () => {
  const curl = (headers: string[]) =>
    ['curl https://developer.apple.com/services-account/v1/bundleIds', ...headers.map((h) => `-H '${h}'`), `--data-raw '{"teamId":"TEAM000000"}'`].join(' \\\n  ');

  test('keeps the cookie, the csrf pair and the browser identity, and nothing else', () => {
    const session = portalSessionFromCapture(
      curl([
        'cookie: DSESSIONID=not-a-real-cookie; myacinfo=not-a-real-cookie',
        'csrf: csrf-invented',
        'csrf_ts: 0000000000000',
        'user-agent: invented-agent',
        'referer: https://developer.apple.com/account/resources/identifiers/bundleId/edit/BUNDLE0000',
        'x-csrf-itc: [asc-ui]',
        'accept-encoding: gzip, zstd',
      ])
    );
    assert.equal(session.cookie, 'DSESSIONID=not-a-real-cookie; myacinfo=not-a-real-cookie');
    assert.deepEqual(Object.keys(session.headers).sort(), ['csrf', 'csrf_ts', 'referer', 'user-agent']);
  });

  test('an App Store Connect capture is refused, since it has no DSESSIONID', () => {
    assert.throws(
      () => portalSessionFromCapture(curl(['cookie: myacinfo=not-a-real-cookie', 'csrf: c', 'csrf_ts: t'])),
      /no DSESSIONID cookie/
    );
  });

  test('a capture without the csrf pair is refused', () => {
    assert.throws(() => portalSessionFromCapture(curl(['cookie: DSESSIONID=x', 'csrf: c'])), /no csrf and csrf_ts/);
  });

  test('anything but a curl command is refused', () => {
    assert.throws(() => portalSessionFromCapture('Cookie: DSESSIONID=x'), /Copy as cURL/);
  });
});
