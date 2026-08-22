/**
 * Every retained private call, pinned to the request it makes.
 *
 * These are the endpoints Apple's official API has no equivalent for — Resolution Center
 * threads, messages, rejections, drafts and attachments; the unread counts behind
 * `fields[appStoreVersionMetrics]=messageCount`; version state history; App Privacy — and
 * they are the reason this client exists. Everything else here is scheduled to be deleted
 * as official-API overlap, so this file is the fence around what must survive that.
 *
 * **A test in this file that needs editing during a removal slice means the slice took
 * something it should not have.** Read a failure that way before reaching for the test.
 *
 * URLs are asserted whole. These queries carry filters, include lists, page sizes and
 * fieldsets that were copied from the browser verbatim, iris 400s an include list it does
 * not recognise, and a fieldset quietly narrowed drops the one attribute a whole feature
 * reads — so the test compares the string, not its parts. Nothing here reaches the network
 * and no id, thread or file below is real.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import * as api from '../src/api';
import * as ci from '../src/ci';
import { SESSION, stubFetch, withStderr } from './helpers';

const BASE = 'https://appstoreconnect.apple.com/iris/v1';
const APP = '123';
const THREAD = 'thread-0000';
const DRAFT = 'draft-0000';
const ATTACHMENT = 'attachment-0000';

/** Runs `call`, answering every request with `body`, and hands back what was sent. */
async function sent(body: unknown, call: () => Promise<unknown>) {
  const stub = stubFetch(() => ({ body }));
  try {
    await withStderr(() => call());
    return stub.calls;
  } finally {
    stub.restore();
  }
}

describe('the Resolution Center reads', () => {
  test('threads on an app, filtered to the seven types the review centre shows', async () => {
    const calls = await sent({ data: [] }, () => api.listThreads(SESSION, APP));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(
      calls[0]!.url,
      `${BASE}/apps/${APP}/resolutionCenterThreads` +
        '?include=appStoreVersions,app,appMessageThreadDetail,build,betaBackgroundAssetReviewSubmission' +
        '&limit[appStoreVersions]=2000' +
        '&filter[threadType]=REJECTION_BINARY,REJECTION_METADATA,REJECTION_REVIEW_SUBMISSION' +
        ',APP_MESSAGE_ARC,APP_MESSAGE_ARB,APP_MESSAGE_COMM,APP_MESSAGE_INFORMATIONAL'
    );
  });

  test('one version narrows the threads without disturbing the rest of the query', async () => {
    const calls = await sent({ data: [] }, () =>
      api.listThreads(SESSION, APP, { appStoreVersionId: 'v-0000' })
    );

    assert.match(calls[0]!.url, /&filter\[appStoreVersion\]=v-0000$/);
  });

  test('a thread with no version filter sends no empty parameter for it', async () => {
    const calls = await sent({ data: [] }, () => api.listThreads(SESSION, APP));

    assert.doesNotMatch(calls[0]!.url, /filter\[appStoreVersion\]/);
  });

  test('the conversation, with the actor, rejections and attachments beside it', async () => {
    const calls = await sent({ data: [] }, () => api.listMessages(SESSION, THREAD));

    assert.equal(
      calls[0]!.url,
      `${BASE}/resolutionCenterThreads/${THREAD}/resolutionCenterMessages` +
        '?include=fromActor,rejections,resolutionCenterMessageAttachments' +
        '&limit[rejections]=2000&limit[resolutionCenterMessageAttachments]=1000'
    );
  });

  test('no top-level limit on messages unless one is asked for — the browser sends none', async () => {
    const asked = await sent({ data: [] }, () => api.listMessages(SESSION, THREAD, { limit: 500 }));

    assert.match(asked[0]!.url, /&limit=500&/);
  });

  test('the draft box, with its attachments', async () => {
    const calls = await sent({ data: null }, () => api.getDraftMessage(SESSION, THREAD));

    assert.equal(
      calls[0]!.url,
      `${BASE}/resolutionCenterThreads/${THREAD}/resolutionCenterDraftMessage` +
        '?include=resolutionCenterMessageAttachments,fromActor' +
        '&limit[resolutionCenterMessageAttachments]=1000'
    );
  });

  test('rejections reach the thread through the message they hang off', async () => {
    const calls = await sent({ data: [] }, () => api.listRejections(SESSION, THREAD));

    assert.equal(
      calls[0]!.url,
      `${BASE}/reviewRejections` +
        `?filter[resolutionCenterMessage.resolutionCenterThread]=${THREAD}` +
        '&include=appCustomProductPageVersion,appEvent,appStoreVersion,appStoreVersionExperiment' +
        ',backgroundAssetVersions,gameCenterAchievementVersions,gameCenterLeaderboardVersions' +
        ',gameCenterLeaderboardSetVersions,gameCenterChallengeVersions,gameCenterActivityVersions' +
        ',inAppPurchaseVersions,subscriptionVersions,subscriptionGroupVersions,build,appBundleVersion' +
        ',rejectionAttachments' +
        '&limit=2000&limit[rejectionAttachments]=1000'
    );
  });

  test('a thread is found from a submission id by filter, not by walking the app', async () => {
    const calls = await sent({ data: [] }, () => api.findThreadForSubmission(SESSION, 'submission-0000'));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterThreads?filter[reviewSubmission]=submission-0000`);
  });
});

describe('the unread counts', () => {
  /**
   * `inbox` reads the `apps` collection, which is otherwise official-API overlap. What
   * makes it a gap is the fieldset: `appStoreVersionMetrics`, `betaReviewMetrics` and
   * `messageCount` appear in none of the 966 paths or 1,393 schemas of Apple's OpenAPI
   * specification 4.4.1. Narrow this query and the feature goes with it; widen it and the
   * duplication comes back.
   */
  test('asks apps for the private metric fieldsets and nothing else', async () => {
    const calls = await sent({ data: [] }, () => api.listAppMetrics(SESSION));

    assert.equal(
      calls[0]!.url,
      `${BASE}/apps` +
        '?include=appStoreVersionMetrics,betaReviewMetrics' +
        '&limit=200&filter[removed]=false' +
        '&fields[apps]=appStoreVersionMetrics,betaReviewMetrics' +
        '&fields[appStoreVersionMetrics]=messageCount' +
        '&fields[betaReviewMetrics]=messageCount,platform'
    );
  });

  test('both unread counts are asked for by name', async () => {
    const calls = await sent({ data: [] }, () => api.listAppMetrics(SESSION));

    assert.match(calls[0]!.url, /fields\[appStoreVersionMetrics\]=messageCount/);
    assert.match(calls[0]!.url, /fields\[betaReviewMetrics\]=messageCount,platform/);
  });

  test('the apps themselves come back as bare ids — no official attribute is asked for', async () => {
    const calls = await sent({ data: [] }, () => api.listAppMetrics(SESSION));

    // fields[apps] names only relationships, so nothing on Apple's own App resource is
    // requested. Adding an attribute here would make this a duplicate app listing.
    assert.match(calls[0]!.url, /fields\[apps\]=appStoreVersionMetrics,betaReviewMetrics(&|$)/);
  });

  test('the submissions the browser sideloads here are not asked for', async () => {
    const calls = await sent({ data: [] }, () => api.listAppMetrics(SESSION));

    // GET /v1/apps/{id}/reviewSubmissions is official, `state` included, so this client
    // does not send the browser's `reviewSubmissions` sideload.
    assert.doesNotMatch(calls[0]!.url, /reviewSubmissions/);
  });
});

describe('the version history and the privacy declarations', () => {
  test('state changes hang off the version', async () => {
    const calls = await sent({ data: [] }, () => api.listVersionStateChanges(SESSION, 'v-0000'));

    assert.equal(calls[0]!.url, `${BASE}/appStoreVersions/v-0000/appStoreVersionStateChanges?limit=200`);
  });

  test('data usages come with the four enum rows that give them meaning', async () => {
    const calls = await sent({ data: [] }, () => api.listDataUsages(SESSION, APP));

    assert.equal(
      calls[0]!.url,
      `${BASE}/apps/${APP}/dataUsages?include=category,purpose,grouping,dataProtection&limit=500`
    );
  });

  test('the publish state takes no query at all', async () => {
    const calls = await sent({ data: {} }, () => api.getDataUsagePublishState(SESSION, APP));

    assert.equal(calls[0]!.url, `${BASE}/apps/${APP}/dataUsagePublishState`);
  });
});

describe('the draft writes', () => {
  const created = { data: { type: 'resolutionCenterDraftMessages', id: DRAFT } };

  test('a new draft names the thread it belongs to', async () => {
    const calls = await sent(created, () => api.createDraftMessage(SESSION, THREAD, 'We have fixed it.'));

    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterDraftMessages`);
    assert.equal(
      calls[0]!.body,
      '{"data":{"type":"resolutionCenterDraftMessages","attributes":{"messageBody":"We have fixed it."},' +
        `"relationships":{"resolutionCenterThread":{"data":{"type":"resolutionCenterThreads","id":"${THREAD}"}}}}}`
    );
    assert.equal(calls[0]!.headers['content-type'], 'application/vnd.api+json');
  });

  test('an autosave replaces the text and says nothing about attachments', async () => {
    const calls = await sent(created, () => api.updateDraftMessage(SESSION, DRAFT, 'Second thoughts.'));

    assert.equal(calls[0]!.method, 'PATCH');
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterDraftMessages/${DRAFT}`);
    assert.equal(
      calls[0]!.body,
      `{"data":{"type":"resolutionCenterDraftMessages","id":"${DRAFT}",` +
        '"attributes":{"messageBody":"Second thoughts."}}}'
    );
  });

  test('deleting a draft sends no body', async () => {
    const calls = await sent({}, () => api.deleteDraftMessage(SESSION, DRAFT));

    assert.equal(calls[0]!.method, 'DELETE');
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterDraftMessages/${DRAFT}`);
    assert.equal(calls[0]!.body, undefined);
  });

  test('deleting a draft is audited — the attachments go with it', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    try {
      const records = await withStderr(async (captured) => {
        await api.deleteDraftMessage(SESSION, DRAFT);
        return captured.records();
      });

      assert.deepEqual(
        records.filter((record) => record['event'] === 'draft.delete').map((record) => record['phase']),
        ['start', 'ok']
      );
    } finally {
      stub.restore();
    }
  });
});

describe('the attachment slots', () => {
  test('reserving names the size before the name, as the recording did', async () => {
    const calls = await sent({ data: { type: 'resolutionCenterMessageAttachments', id: ATTACHMENT } }, () =>
      api.reserveMessageAttachment(SESSION, DRAFT, 'screenshot.png', 4096)
    );

    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterMessageAttachments`);
    assert.equal(
      calls[0]!.body,
      '{"data":{"type":"resolutionCenterMessageAttachments",' +
        '"attributes":{"fileSize":4096,"fileName":"screenshot.png"},' +
        '"relationships":{"resolutionCenterDraftMessage":' +
        `{"data":{"type":"resolutionCenterDraftMessages","id":"${DRAFT}"}}}}}`
    );
    assert.equal(calls[0]!.headers['content-type'], 'application/vnd.api+json');
  });

  test('committing is the one attribute that makes the bytes count', async () => {
    const calls = await sent({ data: { type: 'resolutionCenterMessageAttachments', id: ATTACHMENT } }, () =>
      api.completeMessageAttachment(SESSION, ATTACHMENT)
    );

    assert.equal(calls[0]!.method, 'PATCH');
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterMessageAttachments/${ATTACHMENT}`);
    assert.equal(
      calls[0]!.body,
      `{"data":{"type":"resolutionCenterMessageAttachments","id":"${ATTACHMENT}",` +
        '"attributes":{"uploaded":true}}}'
    );
  });

  test('removing one is audited', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    try {
      const records = await withStderr(async (captured) => {
        await api.deleteMessageAttachment(SESSION, ATTACHMENT);
        return captured.records();
      });

      const audit = records.filter((record) => record['event'] === 'draft.attachment.delete');
      assert.deepEqual(audit.map((record) => record['phase']), ['start', 'ok']);
      assert.equal(audit[0]!['attachmentId'], ATTACHMENT);
    } finally {
      stub.restore();
    }
  });
});

describe('sending, which is the irreversible one', () => {
  const sendable = {
    data: {
      type: 'resolutionCenterDraftMessages',
      id: DRAFT,
      attributes: { messageBody: 'We have fixed it.' },
    },
  };

  test('the send posts a reference to the draft, not the text', async () => {
    const calls = await sent({ data: { type: 'resolutionCenterMessages', id: 'message-0000' } }, () =>
      api.sendDraftMessage(SESSION, DRAFT)
    );

    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/resolutionCenterMessages`);
    assert.equal(
      calls[0]!.body,
      '{"data":{"type":"resolutionCenterMessages","relationships":{"createFromDraftMessage":' +
        `{"data":{"type":"resolutionCenterDraftMessages","id":"${DRAFT}"}}}}}`
    );
    assert.equal(calls[0]!.headers['content-type'], 'application/vnd.api+json');
    // Whatever is in the draft box at this moment is what Apple gets: the body carries no
    // copy of the text, so a stale draft cannot be sent as a fresh one by accident.
    assert.doesNotMatch(calls[0]!.body!, /messageBody/);
  });

  test('the send is audited before it goes out, since there is no unsend', async () => {
    const stub = stubFetch(() => ({ body: { data: { type: 'resolutionCenterMessages', id: 'message-0000' } } }));
    try {
      const records = await withStderr(async (captured) => {
        await api.sendDraftMessage(SESSION, DRAFT);
        return captured.records();
      });

      const audit = records.filter((record) => record['event'] === 'message.send');
      assert.deepEqual(audit.map((record) => record['phase']), ['start', 'ok']);
      assert.equal(audit[0]!['draftId'], DRAFT);
    } finally {
      stub.restore();
    }
  });

  test('an empty draft sends nothing', async () => {
    const stub = stubFetch(() => ({
      body: { data: { type: 'resolutionCenterDraftMessages', id: DRAFT, attributes: { messageBody: '  ' } } },
    }));
    try {
      await assert.rejects(() => api.sendDraftReply(SESSION, THREAD), /is empty/);
      assert.equal(stub.calls.length, 1, 'the draft was read and nothing was posted');
      assert.equal(stub.calls[0]!.method, 'GET');
    } finally {
      stub.restore();
    }
  });

  test('a thread with no draft sends nothing', async () => {
    const stub = stubFetch(() => ({ body: { data: null } }));
    try {
      await assert.rejects(() => api.sendDraftReply(SESSION, THREAD), /no draft to send/);
      assert.equal(stub.calls.length, 1);
      assert.equal(stub.calls[0]!.method, 'GET');
    } finally {
      stub.restore();
    }
  });

  test('a sendable draft is read first and posted second', async () => {
    const stub = stubFetch((call) => ({
      body: call.method === 'GET' ? sendable : { data: { type: 'resolutionCenterMessages', id: 'message-0000' } },
    }));
    try {
      await withStderr(() => api.sendDraftReply(SESSION, THREAD));

      assert.deepEqual(
        stub.calls.map((call) => call.method),
        ['GET', 'POST']
      );
      assert.equal(
        stub.calls[0]!.url,
        `${BASE}/resolutionCenterThreads/${THREAD}/resolutionCenterDraftMessage` +
          '?include=resolutionCenterMessageAttachments,fromActor' +
          '&limit[resolutionCenterMessageAttachments]=1000'
      );
      assert.equal(stub.calls[1]!.url, `${BASE}/resolutionCenterMessages`);
    } finally {
      stub.restore();
    }
  });
});

describe('saving a reply', () => {
  test('a thread with no draft gets one created, then read back', async () => {
    let reads = 0;
    const stub = stubFetch((call) => {
      if (call.method !== 'GET') return { body: { data: { type: 'resolutionCenterDraftMessages', id: DRAFT } } };
      reads += 1;
      return {
        body: {
          data:
            reads === 1
              ? null
              : { type: 'resolutionCenterDraftMessages', id: DRAFT, attributes: { messageBody: 'Fixed.' } },
        },
      };
    });
    try {
      await withStderr(() => api.saveDraftReply(SESSION, { threadId: THREAD, body: 'Fixed.' }));

      assert.deepEqual(
        stub.calls.map((call) => call.method),
        ['GET', 'POST', 'GET'],
        'the draft is read back because neither write mentions attachments'
      );
    } finally {
      stub.restore();
    }
  });

  test('a thread that already has one gets it replaced, not doubled', async () => {
    const existing = {
      data: { type: 'resolutionCenterDraftMessages', id: DRAFT, attributes: { messageBody: 'Old.' } },
    };
    const stub = stubFetch(() => ({ body: existing }));
    try {
      await withStderr(() => api.saveDraftReply(SESSION, { threadId: THREAD, body: 'New.' }));

      assert.deepEqual(
        stub.calls.map((call) => call.method),
        ['GET', 'PATCH', 'GET']
      );
      assert.equal(stub.calls[1]!.url, `${BASE}/resolutionCenterDraftMessages/${DRAFT}`);
    } finally {
      stub.restore();
    }
  });

  test('an attachment path that is not there stops before anything is written', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(
        () =>
          api.saveDraftReply(SESSION, {
            threadId: THREAD,
            body: 'Fixed.',
            attach: ['/no/such/file/at/all.png'],
          }),
        /No such file to attach/
      );
      assert.equal(stub.calls.length, 0, 'the text was not saved half way');
    } finally {
      stub.restore();
    }
  });

  // The read half, which `delete-draft` needs on its own: the confirmation is about the
  // words in the box, and a thread id says nothing about those.
  test('the draft to be deleted comes back with its attachments beside it', async () => {
    const stub = stubFetch(() => ({
      body: {
        data: { type: 'resolutionCenterDraftMessages', id: DRAFT },
        included: [{ type: 'resolutionCenterMessageAttachments', id: ATTACHMENT }],
      },
    }));
    try {
      const document = await api.findDeletableDraft(SESSION, THREAD);

      assert.equal(document.data.id, DRAFT);
      assert.deepEqual(
        document.included?.map((one) => one.id),
        [ATTACHMENT]
      );
      assert.equal(stub.calls.length, 1, 'reading it deleted nothing');
      assert.equal(stub.calls[0]!.method, 'GET');
    } finally {
      stub.restore();
    }
  });

  // The two reads differ in exactly this, which is why they are two.
  test('an empty draft is still one to delete, though not one to send', async () => {
    const stub = stubFetch(() => ({
      body: {
        data: { type: 'resolutionCenterDraftMessages', id: DRAFT, attributes: { messageBody: '   ' } },
      },
    }));
    try {
      assert.equal((await api.findDeletableDraft(SESSION, THREAD)).data.id, DRAFT);
      await assert.rejects(() => api.findSendableDraft(SESSION, THREAD), /is empty/);
    } finally {
      stub.restore();
    }
  });

  test('discarding needs a draft to discard and says which one went', async () => {
    const stub = stubFetch(() => ({ body: { data: null } }));
    try {
      await assert.rejects(() => api.discardDraftReply(SESSION, THREAD), /no draft to delete/);
      assert.equal(stub.calls.length, 1);
    } finally {
      stub.restore();
    }
  });
});

/**
 * The one Xcode Cloud read, and the only call here that is not iris.
 *
 * `post_actions` is the field: re-checked 2026-08-21 against specification 4.4.1, where
 * `post_action`, `postAction`, `deployment_config`, `archive_action_id` and
 * `testFlight_internal` occur zero times across 966 paths and 1,393 schemas, and
 * `CiWorkflow` has no post-action attribute. Everything else about Xcode Cloud is official
 * and is not here, so this file's rule applies with a second edge: a test below that needs
 * editing during a removal means the removal took the gap, and one that needs editing to
 * add a *second* Xcode Cloud call means the slice grew past the field it was allowed.
 */
describe('the Xcode Cloud read', () => {
  test('one workflow list on one product, with the browser\'s own query', async () => {
    const calls = await sent({ items: [] }, () => ci.fetchPostActions(SESSION, 'product-0000'));

    assert.equal(calls.length, 1, 'the product id is given, never looked up from an app id');
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(
      calls[0]!.url,
      'https://appstoreconnect.apple.com/ci/api' +
        `/teams/${SESSION.teamId}/products/product-0000/workflows-v15` +
        '?limit=100&include_deleted=false'
    );
  });

  /**
   * Not a detail. `/ci/api` answers a request carrying `application/vnd.api+json` with a
   * 403, and that one header is why every `ci-*` command in this repository was refused for
   * the whole of its life. The session is captured from an iris request, so the header has
   * to be absent rather than merely unset.
   */
  test('nothing about this request claims to be JSON:API', async () => {
    const calls = await sent({ items: [] }, () => ci.fetchPostActions(SESSION, 'product-0000'));

    assert.equal(calls[0]!.headers['content-type'], undefined);
    assert.equal(calls[0]!.headers['accept'], '*/*');
  });
});

/**
 * The compute reads. Apple has no usage resource of any kind — the only official `usage`
 * paths are TestFlight's, about testers rather than build minutes — so like the block
 * above this is a fence: a test here that needs editing to add a *fifth* Xcode Cloud call
 * means the slice grew past what it was allowed. It stood at three on 2026-08-22, when the
 * team read was added deliberately and this sentence was changed to say so; at four later
 * the same day, when the capabilities read was. Each step past this line is a decision
 * somebody took on its own evidence, which is why the count is written out rather than
 * incremented in passing.
 */
describe('the Xcode Cloud compute reads', () => {
  test('the plan is one GET, scoped by the session team, with no query at all', async () => {
    const calls = await sent({ plan: { name: 'p', total: 6000, used: 1, available: 5999 } }, () =>
      ci.fetchPlan(SESSION)
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(
      calls[0]!.url,
      `https://appstoreconnect.apple.com/ci/api/teams/${SESSION.teamId}/usage/summary`
    );
  });

  test('the breakdown is one GET, with the window as the browser spells it', async () => {
    const calls = await sent({ usage: [], product_usage: [], info: {} }, () => ci.fetchUsage(SESSION, 31));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'GET');

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, `/ci/api/teams/${SESSION.teamId}/usage/days`);
    assert.deepEqual([...url.searchParams.keys()], ['start', 'end']);
    for (const key of ['start', 'end']) {
      assert.match(url.searchParams.get(key)!, /^\d{4}-\d{2}-\d{2}$/, `${key} is a plain date`);
    }
  });

  test('neither compute read claims to be JSON:API either', async () => {
    const calls = await sent({ usage: [], product_usage: [], info: {} }, () => ci.fetchUsage(SESSION, 7));

    assert.equal(calls[0]!.headers['content-type'], undefined);
    assert.equal(calls[0]!.headers['accept'], '*/*');
  });
});

/**
 * The team read. There is no team resource in Apple's official API at all — the only
 * `team` in 4.4.1 is `gameCenterMatchmakingTeams` — and nothing official mentions the
 * Program License Agreement, so this belongs behind the same fence.
 */
describe('the Xcode Cloud team read', () => {
  const TEAM = {
    name: 'A team',
    program_state: 'active',
    wwdr_pla_needs_signing: false,
    wwdr_team_within_pla_grace_period: false,
    wwdr_team_id: 'AB12CD34EF',
  };

  test('one GET at the bare team path, scoped by the session team, with no query', async () => {
    const calls = await sent(TEAM, () => ci.fetchTeam(SESSION));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(calls[0]!.url, `https://appstoreconnect.apple.com/ci/api/teams/${SESSION.teamId}`);
  });

  test('it does not claim to be JSON:API either', async () => {
    const calls = await sent(TEAM, () => ci.fetchTeam(SESSION));

    assert.equal(calls[0]!.headers['content-type'], undefined);
    assert.equal(calls[0]!.headers['accept'], '*/*');
  });
});

/**
 * The capabilities read. The thirteen booleans have no official schema — `canConfigure`,
 * `canTrigger`, `canRestrict` and the rest occur zero times in 4.4.1 — and Apple's
 * `/v1/users` serves coarse roles beside people's names rather than resolved permissions,
 * so this belongs behind the same fence.
 */
describe('the Xcode Cloud capabilities read', () => {
  const CAPS = {
    can_edit_restricted_workflows: true,
    can_restrict_workflows: true,
    can_remove_products: true,
    can_change_next_build_number: true,
    can_manage_subscriptions: true,
    can_configure_external_deployments: true,
    can_trigger_external_deployments: true,
    can_configure_notarization: true,
    can_trigger_notarization: true,
    can_configure_locked_version_aliases: true,
    can_configure_locked_product_environment_variables: true,
    can_configure_infrastructure_validation: true,
    can_onboard_to_distribution: true,
  };

  test('one GET at the user-capabilities path, scoped by the session team, with no query', async () => {
    const calls = await sent(CAPS, () => ci.fetchCapabilities(SESSION));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(
      calls[0]!.url,
      `https://appstoreconnect.apple.com/ci/api/teams/${SESSION.teamId}/user-capabilities`
    );
  });

  test('it does not claim to be JSON:API either', async () => {
    const calls = await sent(CAPS, () => ci.fetchCapabilities(SESSION));

    assert.equal(calls[0]!.headers['content-type'], undefined);
    assert.equal(calls[0]!.headers['accept'], '*/*');
  });
});
