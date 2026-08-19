/**
 * Which submissions can still be handed to Apple.
 *
 * A rejected submission comes back as `UNRESOLVED_ISSUES` and keeps the submitted date of
 * the run that was refused. Reading "has a submitted date" as "is with Apple" stranded it:
 * `submit` refused and pointed at `resolve-item`, `resolve-item` refused because the item
 * was no longer `REJECTED`, and there was no way through. It is not with Apple — it has
 * come back, and `{"submitted":true}` moves it to `WAITING_FOR_REVIEW`.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { Resource } from '../src/jsonapi';
import { planSubmission, runSubmission } from '../src/api';
import { SESSION, stubFetch, withStderr } from './helpers';

const VERSION_ID = 'version-1';
const APP_ID = '123';

function submission(id: string, state: string, submittedDate?: string): Resource {
  return { type: 'reviewSubmissions', id, attributes: { state, platform: 'IOS', submittedDate } };
}

function item(id: string, state: string, versionId = VERSION_ID): Resource {
  return {
    type: 'reviewSubmissionItems',
    id,
    attributes: { state },
    relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
  };
}

/** Answers the three reads `planSubmission` makes, by URL. */
async function plan(submissions: Resource[], items: Resource[] = []) {
  const stub = stubFetch((call) => {
    if (call.url.includes(`appStoreVersions/${VERSION_ID}`)) {
      return { body: { data: { type: 'appStoreVersions', id: VERSION_ID, attributes: { platform: 'IOS', versionString: '1.1.2' } } } };
    }
    if (call.url.includes('/items')) return { body: { data: items } };
    return { body: { data: submissions } };
  });
  try {
    // Awaited inside the try: returning the promise would restore `fetch` before the
    // requests are made, and they would go to Apple for real.
    return await withStderr(() => planSubmission(SESSION, APP_ID, VERSION_ID));
  } finally {
    stub.restore();
  }
}

describe('planning a submission', () => {
  test('a rejection that has been resolved is reused, not reported as in flight', async () => {
    const result = await plan(
      [submission('sub-1', 'UNRESOLVED_ISSUES', '2026-05-15T17:16:17.429Z')],
      [item('item-1', 'READY_FOR_REVIEW')]
    );

    assert.equal(result.inFlight, undefined, 'a returned submission is not in front of Apple');
    assert.equal(result.submissionId, 'sub-1', 'it is reused rather than duplicated');
    assert.equal(result.itemId, 'item-1', 'the version is already on it');
    assert.equal(result.unresolvedItemIds, undefined);
  });

  test('a rejection with an item still open names the items to resolve', async () => {
    const result = await plan(
      [submission('sub-1', 'UNRESOLVED_ISSUES', '2026-05-15T17:16:17.429Z')],
      [item('item-1', 'REJECTED'), item('item-2', 'READY_FOR_REVIEW', 'other-version')]
    );

    assert.deepEqual(result.unresolvedItemIds, ['item-1']);
    assert.equal(result.submissionId, 'sub-1');
  });

  test('a submission genuinely in review is still in flight', async () => {
    for (const state of ['WAITING_FOR_REVIEW', 'IN_REVIEW']) {
      const result = await plan([submission('sub-1', state, '2026-05-15T17:16:17.429Z')]);
      assert.equal(result.inFlight?.state, state, `${state} is with Apple`);
      assert.equal(result.submissionId, undefined, `${state} must not be reused`);
    }
  });

  test('a built-but-never-sent submission is reused', async () => {
    const result = await plan([submission('sub-1', 'READY_FOR_REVIEW')], [item('item-1', 'READY_FOR_REVIEW')]);
    assert.equal(result.inFlight, undefined);
    assert.equal(result.submissionId, 'sub-1');
  });

  test('READY_FOR_REVIEW with a submitted date is not treated as unsent', async () => {
    const result = await plan([submission('sub-1', 'READY_FOR_REVIEW', '2026-05-15T17:16:17.429Z')]);
    assert.equal(result.submissionId, undefined, 'Apple has already seen this one');
    assert.equal(result.inFlight?.id, 'sub-1');
  });
});

describe('running a submission', () => {
  test('refuses while Apple still has an item open, and says which', async () => {
    const stub = stubFetch(() => ({}));
    try {
      await assert.rejects(
        () => runSubmission(SESSION, {
          appId: APP_ID,
          versionId: VERSION_ID,
          platform: 'IOS',
          submissionId: 'sub-1',
          unresolvedItemIds: ['item-1', 'item-2'],
        }),
        /asc resolve-item item-1[\s\S]*asc resolve-item item-2/
      );
    } finally {
      stub.restore();
    }
    assert.equal(stub.calls.length, 0, 'nothing is sent to Apple when the plan is refused');
  });
});
