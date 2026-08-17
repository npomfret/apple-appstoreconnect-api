/**
 * Reading a session out of a pasted capture.
 *
 * Every value here is invented. The cookie is shaped like App Store Connect's and is not
 * one, and the itctx payload is assembled below rather than copied from anywhere, so no
 * real capture is needed to run these — or should ever be pasted into them.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { extractCurlCommand, sessionFromCapture, sessionFromCurl, sessionFromText } from '../src/curl';

/** The itctx payload as Apple writes it: base64 JSON, then a `|`-separated tail. */
function itctx(fields: { ds?: number; cp?: string; ex?: string }): string {
  return `${Buffer.from(JSON.stringify(fields)).toString('base64')}|tail`;
}

const COOKIE = `myacinfo=not-a-real-cookie; itctx=${itctx({
  ds: 1234,
  cp: 'team-from-cookie',
  ex: '2026-8-13 16:17:27',
})}; dqsid=not-a-real-cookie`;

const CURL = [
  `curl 'https://appstoreconnect.apple.com/iris/v1/apps/123/appStoreVersions' \\`,
  `  -H 'Accept: application/vnd.api+json' \\`,
  `  -H 'Accept-Encoding: gzip, deflate, br, zstd' \\`,
  `  -H 'Referer: https://appstoreconnect.apple.com/apps/123/distribution/ios/version/inflight' \\`,
  `  -H 'X-Apple-App-Id: 123' \\`,
  `  -H 'Cookie: ${COOKIE}'`,
].join('\n');

describe('a copied curl command', () => {
  const session = sessionFromCurl(CURL);

  test('the cookie jar comes across whole', () => {
    assert.equal(session.cookie, COOKIE);
  });

  test('the account, team and expiry are decoded from itctx', () => {
    assert.equal(session.dsId, '1234');
    assert.equal(session.teamId, 'team-from-cookie');
    assert.equal(session.expiresAt, '2026-08-13T16:17:27.000Z');
  });

  test('the app id is scraped from the Referer', () => {
    assert.equal(session.appId, '123');
  });

  // Forwarding the browser's Accept-Encoding advertises zstd, which undici then can't
  // decompress — the response arrives as bytes nobody can read.
  test('Accept-Encoding is not carried over', () => {
    assert.equal(session.headers['accept-encoding'], undefined);
    assert.equal(session.headers['x-apple-app-id'], '123');
  });

  test('a capture with no CSRF header still gets one', () => {
    assert.equal(session.headers['x-csrf-itc'], '[asc-ui]');
  });

  test('a write capture carries its own team id, which wins over the cookie', () => {
    const written = sessionFromCurl(
      `curl 'https://appstoreconnect.apple.com/iris/v1/apps/123' -X PATCH ` +
        `-H 'X-Connect-Team-Id: team-from-header' -H 'Cookie: ${COOKIE}'`
    );

    assert.equal(written.teamId, 'team-from-header');
  });

  test('something that is not a logged-in request is refused', () => {
    assert.throws(
      () => sessionFromCurl(`curl 'https://appstoreconnect.apple.com/iris/v1/apps' -H 'Cookie: other=1'`),
      /myacinfo/
    );
  });

  test('the command is found among surrounding notes', () => {
    const pasted = ['# pasted 2026-08-15', '', CURL, '', 'some trailing note'].join('\n');
    assert.ok(extractCurlCommand(pasted).startsWith('curl '));
    assert.equal(sessionFromCapture(pasted).dsId, '1234');
  });
});

describe('a pasted header block', () => {
  const TEXT = [
    '# what I copied out of the network tab',
    'GET /iris/v1/apps HTTP/2',
    ':authority: appstoreconnect.apple.com',
    `Cookie: ${COOKIE}`,
    'X-Csrf-Itc: itc',
    'https://appstoreconnect.apple.com/apps/456/distribution/ios/version/inflight',
  ].join('\n');

  const session = sessionFromText(TEXT);

  test('the cookie and the useful headers are picked out', () => {
    assert.equal(session.cookie, COOKIE);
    assert.equal(session.headers['x-csrf-itc'], 'itc');
  });

  test('the page URL stands in for a Referer, and gives the app id', () => {
    assert.equal(session.headers['referer'], TEXT.split('\n').pop());
    assert.equal(session.appId, '456');
  });

  test('the request line and pseudo-headers are dropped', () => {
    assert.equal(session.headers[':authority'], undefined);
    assert.equal(session.headers['authority'], undefined);
  });

  test('either form is accepted without being told which it is', () => {
    assert.equal(sessionFromCapture(TEXT).appId, '456');
  });

  test('text with no cookie in it says so', () => {
    assert.throws(() => sessionFromText('Referer: https://appstoreconnect.apple.com/apps/1'), /No cookie/);
  });
});
