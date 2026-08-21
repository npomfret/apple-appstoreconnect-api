/**
 * The escape hatch stays inside the gap.
 *
 * `asc get` is the one command that takes a path off the command line, which makes it the
 * one place the whole boundary can be walked round: every official read this project spent
 * step 4 deleting is still there in iris, one argument away. So the interesting assertion
 * here is not what the refusal says — it is that a refused path sends **nothing**, before
 * a cookie leaves the process.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { raw } from '../src/api';
import { SESSION, stubFetch, withStderr } from './helpers';

/** Attempts a `raw` read and reports what reached the network, whether it threw or not. */
async function attempt(path: string): Promise<{ urls: string[]; error?: string }> {
  const stub = stubFetch();
  try {
    return await withStderr(async () => {
      try {
        await raw(SESSION, path);
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

describe('paths the boundary allows', () => {
  test('a private family, and anything under it', async () => {
    for (const path of [
      'resolutionCenterThreads',
      'resolutionCenterThreads/t1',
      'resolutionCenterThreads/t1/resolutionCenterMessages',
      'resolutionCenterDraftMessages/d1',
      'resolutionCenterMessageAttachments/a1',
      'reviewRejections',
    ]) {
      const { urls, error } = await attempt(path);
      assert.equal(error, undefined, `${path} was refused: ${error}`);
      assert.deepEqual(urls, [`https://appstoreconnect.apple.com/iris/v1/${path}`]);
    }
  });

  test('a private relationship of an official record', async () => {
    for (const path of [
      'apps/123/resolutionCenterThreads',
      'apps/123/dataUsages',
      'apps/123/dataUsagePublishState',
      'appStoreVersions/v1/appStoreVersionStateChanges',
    ]) {
      const { urls, error } = await attempt(path);
      assert.equal(error, undefined, `${path} was refused: ${error}`);
      assert.equal(urls.length, 1);
    }
  });
});

describe('paths the boundary refuses', () => {
  // The parent of a private relationship is not itself in scope: one segment is the
  // difference between `apps/{id}/dataUsages` and `GET /v1/apps/{id}`.
  test('the official record a gap hangs off', async () => {
    for (const path of ['apps', 'apps/123', 'appStoreVersions/v1', 'apps/123/appStoreVersions']) {
      const { urls, error } = await attempt(path);
      assert.match(error ?? '', /Refusing to GET/);
      assert.deepEqual(urls, [], `${path} was sent anyway`);
    }
  });

  test('the families whose commands were removed for being official', async () => {
    for (const path of ['builds', 'appStoreReviewDetails/r1', 'appInfos/i1', 'ciWorkflows', 'userInvitations']) {
      const { urls, error } = await attempt(path);
      assert.match(error ?? '', /Refusing to GET/);
      assert.deepEqual(urls, [], `${path} was sent anyway`);
    }
  });

  // Traversal is the way a family prefix stops meaning what it says.
  test('a path that climbs back out of a family it names', async () => {
    for (const path of [
      'resolutionCenterThreads/../apps/123',
      'resolutionCenterThreads/t1/../../builds',
      '/resolutionCenterThreads/./../builds',
    ]) {
      const { urls, error } = await attempt(path);
      assert.match(error ?? '', /Refusing to GET/);
      assert.deepEqual(urls, [], `${path} was sent anyway`);
    }
  });

  /**
   * The same climb, spelled so the family check cannot see it: `withinBoundary` reads the
   * first segment to decide the family, and every one of these says `resolutionCenterThreads`
   * while resolving somewhere else entirely — `/ci/api`, the base this client closed, and
   * `/v1/apps`, the official record the boundary exists to refuse. `%2e%2e` and `%2E%2E` are
   * dot segments to the URL parser, and `\` separates segments on a special scheme as `/`
   * does, so all four of these were sent with the session cookie on them until 2026-08-21.
   * What refuses them now is the transport rather than the family check, so the message is
   * not the boundary's; what matters here is unchanged, which is that nothing leaves.
   */
  test('a path that climbs out in a spelling the family check cannot read', async () => {
    for (const path of [
      'resolutionCenterThreads/%2e%2e/%2e%2e/%2e%2e/ci/api/v1/ciBuildRuns',
      'resolutionCenterThreads/%2E%2E/%2E%2E/%2E%2E/v1/apps',
      'resolutionCenterThreads/.%2e/.%2e/.%2e/olympus/v1/actors',
      'resolutionCenterThreads/t1\\..\\..\\..\\builds',
    ]) {
      const { urls, error } = await attempt(path);
      assert.match(error ?? '', /resolves to .* which is outside/);
      assert.deepEqual(urls, [], `${path} was sent anyway`);
    }
  });

  test('the refusal names what is in scope, and where the rest lives', async () => {
    const { error } = await attempt('builds');
    assert.match(error ?? '', /resolutionCenterThreads/);
    assert.match(error ?? '', /apps\/\{id\}\/\{resolutionCenterThreads,dataUsages,dataUsagePublishState\}/);
    assert.match(error ?? '', /developer\.apple\.com\/documentation\/appstoreconnectapi/);
  });
});
