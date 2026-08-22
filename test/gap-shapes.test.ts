/**
 * What this client reads out of the gap responses.
 *
 * The companion to gap-requests.test.ts: that file pins the request, this one pins the
 * answer — the digest built from a Resolution Center thread, and the App Privacy label.
 * Both are shapes Apple's official API does not serve, so nothing here can be checked
 * against a published schema; the fixtures below are invented in the shape the browser was
 * recorded receiving, and the assertions are about what the digest says, not about how it
 * got there.
 *
 * That last part is what let `report` be rebuilt thread-first without changing its answer:
 * these tests assert on the Resolution Center half of what comes out, so the refactor
 * changed the setup below and one expectation — the app-id route, which used to be the one
 * that cost an official read and now costs none. **A removal slice that makes one of these
 * fail has taken something it should not have.**
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { Document, Resource } from '../src/jsonapi';
import { buildReport, fetchPrivacy, formatReport, SubmissionReport } from '../src/report';
import { fetchPlan, fetchPostActions, fetchUsage, formatPostActions, formatUsage } from '../src/ci';
import { SESSION, stubFetch, withStderr } from './helpers';

const APP = '123';
const THREAD = 'thread-0000';

/**
 * A thread as the app's thread list returns it. `appStoreVersions` is to-many — the
 * recorded query asks for up to 2000 of them — so the fixture builds it from a list even
 * where there is one, which is how the digest learns the version without a submission read.
 */
function threads(...versionIds: string[]): Document<Resource[]> {
  return {
    data: [
      {
        type: 'resolutionCenterThreads',
        id: THREAD,
        relationships: {
          appStoreVersions: { data: versionIds.map((id) => ({ type: 'appStoreVersions', id })) },
        },
      },
    ],
    included: versionIds.map((id) => ({
      type: 'appStoreVersions',
      id,
      attributes: { versionString: id.replace('v-', '') },
    })),
  };
}

const THREADS = threads('v-1.4.0');

/**
 * An actor as the messages response sideloads it. `actorType` is what says which side sent
 * a message; the recordings carry `APPLE` or `USER` and nothing else, Apple's own actor has
 * the literal id `APPLE` and no name or email against it, and `apiKeyId` is null on both.
 * Invented values, recorded shape.
 */
function actor(id: string, actorType: string): Resource {
  const person =
    actorType === 'USER'
      ? { userFirstName: 'Nick', userLastName: 'Example', userEmail: 'nick@example.com' }
      : { userFirstName: null, userLastName: null, userEmail: null };

  return { type: 'actors', id, attributes: { actorType, apiKeyId: null, ...person } };
}

const APPLE = 'APPLE';
const YOU = 'ACTOR_0000';
const ACTORS = [actor(APPLE, 'APPLE'), actor(YOU, 'USER')];

/** One message, with an actor and any attachments hung off it. */
function message(
  id: string,
  createdDate: string,
  messageBody: string,
  actorId: string,
  attachments: string[] = []
): Resource {
  return {
    type: 'resolutionCenterMessages',
    id,
    attributes: { createdDate, messageBody },
    relationships: {
      fromActor: { data: { type: 'actors', id: actorId } },
      resolutionCenterMessageAttachments: {
        data: attachments.map((attachmentId) => ({ type: 'resolutionCenterMessageAttachments', id: attachmentId })),
      },
    },
  };
}

function attachment(id: string, fileName: string, fileSize: number): Resource {
  return {
    type: 'resolutionCenterMessageAttachments',
    id,
    attributes: { fileName, fileSize, downloadUrl: `https://example.invalid/${id}` },
  };
}

/**
 * One rejection, with any files hung off it.
 *
 * The relationship is always there, empty or not, because the rejections query always asks
 * for it — in the recordings it is absent from the resource only when it was not included.
 */
function rejection(id: string, reasons: Array<Record<string, string>>, attachments: string[] = []): Resource {
  return {
    type: 'reviewRejections',
    id,
    attributes: { reasons },
    relationships: {
      rejectionAttachments: {
        data: attachments.map((attachmentId) => ({ type: 'resolutionCenterMessageAttachments', id: attachmentId })),
      },
    },
  };
}

interface Thread {
  messages?: Resource[];
  attachments?: Resource[];
  rejections?: Resource[];
  /** Sideloaded on the rejections response, which is the only place they arrive. */
  rejectionAttachments?: Resource[];
  draft?: Resource | null;
  /** The sideloaded actors, which the recorded response always carries. */
  actors?: Resource[];
}

/** Answers each leg of the report chain from `thread`, and hands back the one report. */
async function report(thread: Thread): Promise<SubmissionReport> {
  const stub = stubFetch((call) => {
    if (call.url.includes('/resolutionCenterMessages')) {
      const included = [...(thread.attachments ?? []), ...(thread.actors ?? ACTORS)];
      return { body: { data: thread.messages ?? [], included } };
    }
    if (call.url.includes('/resolutionCenterDraftMessage')) return { body: { data: thread.draft ?? null } };
    if (call.url.includes('/reviewRejections')) {
      return { body: { data: thread.rejections ?? [], included: thread.rejectionAttachments ?? [] } };
    }
    if (call.url.includes('/resolutionCenterThreads')) return { body: THREADS };
    throw new Error(`the digest asked for something outside the Resolution Center: ${call.url}`);
  });

  try {
    const reports = await withStderr(() => buildReport(SESSION, { appId: APP }));
    assert.equal(reports.length, 1);
    return reports[0]!;
  } finally {
    stub.restore();
  }
}

describe('the conversation, as a digest', () => {
  // Same hazard as the history timeline: 01:30-07:00 is 08:30Z and came first,
  // 01:00-08:00 is 09:00Z and came second. As text they sort the other way round.
  const dst = [
    message('m-1', '2026-11-01T01:30:00-07:00', '<p>We are still seeing the crash.</p>', APPLE),
    message('m-2', '2026-11-01T01:00:00-08:00', '<p>A new build is on the way.</p>', YOU),
  ];

  test('the latest message is the latest in time, not in text', async () => {
    const digest = await report({ messages: dst });

    assert.equal(digest.lastMessageDate, '2026-11-01T01:00:00-08:00');
    assert.equal(digest.lastMessageFromApple, false);
  });

  test("Apple is recognised by the actor's own type, and their last word is kept separately", async () => {
    const digest = await report({ messages: dst });

    assert.equal(digest.lastAppleMessage, 'We are still seeing the crash.');
  });

  // Which side sent the last message is the line in the digest that decides whether you
  // act. It used to be read off the actor id with a prefix match, which meant anything
  // unfamiliar came out as "you" — the tool saying you had already replied when you had
  // not. `actorType` says it outright, and no answer is better than a confident wrong one.
  test('an actor of a kind no capture has shown is not quietly reported as you', async () => {
    const machine = actor('SOMETHING_ELSE', 'API_KEY');
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>Automated.</p>', 'SOMETHING_ELSE')],
      actors: [machine],
    });

    assert.equal(digest.lastMessageDate, '2026-04-27T15:51:00-07:00');
    assert.equal(digest.lastMessageFromApple, undefined);
    assert.match(formatReport([digest]), /last msg {3}2026-04-27 15:51-07:00 \(sender not recognised\)/);
  });

  test('an id that merely begins with Apple is not Apple', async () => {
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>Hello.</p>', 'APPLESEED_LTD')],
      actors: [actor('APPLESEED_LTD', 'USER')],
    });

    assert.equal(digest.lastMessageFromApple, false);
    assert.equal(digest.lastAppleMessage, undefined);
  });

  test('an actor that was not sideloaded falls back to the id, and only to the recorded one', async () => {
    const bare = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>We are still seeing the crash.</p>', APPLE)],
      actors: [],
    });

    assert.equal(bare.lastMessageFromApple, true);
    assert.equal(bare.lastAppleMessage, 'We are still seeing the crash.');

    const opaque = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>Any news?</p>', YOU)],
      actors: [],
    });

    assert.equal(opaque.lastMessageFromApple, undefined);
  });

  test('message bodies arrive as HTML and are read as text', async () => {
    const digest = await report({
      messages: [
        message(
          'm-1',
          '2026-04-27T15:51:00-07:00',
          '<p>Guideline 2.1</p><ul><li>The app crashed</li><li>on iPad&nbsp;Air</li></ul>',
          APPLE
        ),
      ],
    });

    assert.equal(digest.lastAppleMessage, 'Guideline 2.1\n  - The app crashed\n  - on iPad Air');
  });

  test('a thread with nothing from Apple has no Apple message rather than the wrong one', async () => {
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>Any news?</p>', YOU)],
    });

    assert.equal(digest.lastAppleMessage, undefined);
    assert.equal(digest.lastMessageFromApple, false);
  });

  test('the thread id is reported, since every reply command needs it', async () => {
    assert.equal((await report({ messages: dst })).threadId, THREAD);
  });

  test('an unsent reply in the box is flagged', async () => {
    const draft: Resource = {
      type: 'resolutionCenterDraftMessages',
      id: 'draft-0000',
      attributes: { messageBody: 'Fixed in build 49.' },
    };

    assert.equal((await report({ messages: dst, draft })).hasDraftReply, true);
    assert.equal((await report({ messages: dst })).hasDraftReply, false);
  });
});

describe('what Apple attached', () => {
  test('attachments are collected off the messages that carry them', async () => {
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', APPLE, ['a-1'])],
      attachments: [attachment('a-1', 'crash.mp4', 2048)],
    });

    assert.deepEqual(digest.attachments, [
      { id: 'a-1', fileName: 'crash.mp4', fileSize: 2048, downloadUrl: 'https://example.invalid/a-1' },
    ]);
  });

  // Two attachments under one name is not a contrived case: it is the shape of every
  // messages response recorded from the browser, which carries three files under two names.
  test('two files that share a name are two files, since the id is the identity', async () => {
    const digest = await report({
      messages: [
        message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', APPLE, ['a-1']),
        message('m-2', '2026-04-28T09:00:00-07:00', '<p>And again.</p>', APPLE, ['a-2']),
      ],
      attachments: [attachment('a-1', 'crash.mp4', 2048), attachment('a-2', 'crash.mp4', 2048)],
    });

    assert.equal(digest.attachments.length, 2);
    assert.deepEqual(
      digest.attachments.map((file) => file.downloadUrl),
      ['https://example.invalid/a-2', 'https://example.invalid/a-1']
    );
  });

  // The rejections query has asked for `rejectionAttachments` since it was copied from the
  // browser, and the recorded thread hangs two files off a rejection that hang off no
  // message: the screenshots the rejection is arguing with. The digest read none of them.
  test('a file on the rejection is listed too, not only the ones on messages', async () => {
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', APPLE, ['a-1'])],
      attachments: [attachment('a-1', 'crash.mp4', 2178995)],
      rejections: [
        rejection('r-1', [{ reasonCode: '4.1.0', reasonSection: '4.1', reasonDescription: 'Design: Copycats' }], ['a-2', 'a-3']),
      ],
      rejectionAttachments: [attachment('a-2', 'screenshot-1.png', 60283), attachment('a-3', 'screenshot-2.png', 55679)],
    });

    assert.deepEqual(
      digest.attachments.map((file) => file.fileName),
      ['crash.mp4', 'screenshot-1.png', 'screenshot-2.png']
    );
  });

  test('a rejection with no files of its own adds none', async () => {
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', APPLE, ['a-1'])],
      attachments: [attachment('a-1', 'crash.mp4', 2048)],
      rejections: [rejection('r-1', [{ reasonCode: '4.1.0', reasonSection: '4.1', reasonDescription: 'Design: Copycats' }])],
    });

    assert.deepEqual(digest.attachments.map((file) => file.id), ['a-1']);
  });

  test('one file sideloaded onto two messages is still one file', async () => {
    const digest = await report({
      messages: [
        message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', APPLE, ['a-1']),
        message('m-2', '2026-04-28T09:00:00-07:00', '<p>And again.</p>', APPLE, ['a-1']),
      ],
      attachments: [attachment('a-1', 'crash.mp4', 2048)],
    });

    assert.deepEqual(digest.attachments.map((file) => file.id), ['a-1']);
  });
});

describe('the guidelines behind a rejection', () => {
  // The shape of a reason is the recorded one: a dotted code, a `reasonSection` that is that
  // code with its last segment cut off, and a description carrying the section's title ahead
  // of a colon. Nothing reads the section but the fallback in the last test below.
  test('every reason on every rejection becomes one guideline, lowest number first', async () => {
    const digest = await report({
      rejections: [
        rejection('r-1', [
          { reasonCode: '4.3.0', reasonSection: '4.3', reasonDescription: 'Design: Spam' },
          { reasonCode: '2.1.0', reasonSection: '2.1', reasonDescription: 'Performance: App Completeness' },
        ]),
        rejection('r-2', [
          { reasonCode: '1.2.0', reasonSection: '1.2', reasonDescription: 'Safety: User-Generated Content' },
        ]),
      ],
    });

    assert.deepEqual(
      digest.guidelines.map((guideline) => guideline.code),
      ['1.2.0', '2.1.0', '4.3.0']
    );
    assert.equal(digest.guidelines[1]!.description, 'Performance: App Completeness');
  });

  // Both duplicates here are recorded ones: one rejection repeats a code inside its own
  // `reasons`, and the four rejections on the recorded thread cite two codes between them.
  // Nothing dates a rejection, so the first wording is the only one there is a rule for.
  test('the same guideline cited twice is reported once', async () => {
    const digest = await report({
      rejections: [
        rejection('r-1', [
          { reasonCode: '2.1.0', reasonSection: '2.1', reasonDescription: 'Performance: First' },
          { reasonCode: '2.1.0', reasonSection: '2.1', reasonDescription: 'Performance: Repeat' },
        ]),
        rejection('r-2', [{ reasonCode: '2.1.0', reasonSection: '2.1', reasonDescription: 'Performance: Second' }]),
      ],
    });

    assert.deepEqual(digest.guidelines, [{ code: '2.1.0', description: 'Performance: First' }]);
  });

  // A guard, not an observation: every recorded reason carries all three fields. A section
  // is still a guideline you can look up, which is why it beats dropping the reason.
  test('a reason with no code falls back to its section rather than being dropped', async () => {
    const digest = await report({
      rejections: [rejection('r-1', [{ reasonSection: '5.1', reasonDescription: 'Legal: Privacy' }])],
    });

    assert.deepEqual(digest.guidelines, [{ code: '5.1', description: 'Legal: Privacy' }]);
  });

  test('a thread with no rejections has no guidelines, which is not an error', async () => {
    assert.deepEqual((await report({})).guidelines, []);
  });
});

describe('starting without an official read', () => {
  /**
   * No route into the digest reads a resource Apple serves officially. An app id lists the
   * app's threads, a submission id filters them, a thread id skips discovery — and all
   * three come back with the same Resolution Center digest, which is what made the
   * thread-first rebuild a change of entry point rather than a change of answer.
   */
  const messages = [
    message('m-1', '2026-04-27T15:51:00-07:00', '<p>We are still seeing the crash.</p>', APPLE),
  ];

  async function from(target: Parameters<typeof buildReport>[1]) {
    const stub = stubFetch((call) => {
      if (call.url.includes('/resolutionCenterMessages')) return { body: { data: messages } };
      if (call.url.includes('/resolutionCenterDraftMessage')) return { body: { data: null } };
      if (call.url.includes('/reviewRejections')) return { body: { data: [] } };
      if (call.url.includes('/resolutionCenterThreads')) return { body: THREADS };
      throw new Error(`the digest asked for something outside the Resolution Center: ${call.url}`);
    });
    try {
      const reports = await withStderr(() => buildReport(SESSION, target));
      return { reports, urls: stub.calls.map((call) => call.url) };
    } finally {
      stub.restore();
    }
  }

  test('a thread id reads the thread and nothing else', async () => {
    const { reports, urls } = await from({ threadId: THREAD });

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.threadId, THREAD);
    assert.equal(reports[0]!.lastAppleMessage, 'We are still seeing the crash.');
    assert.doesNotMatch(urls.join(' '), /reviewSubmissions/);
  });

  test('a thread id leaves the version and submission unsaid rather than guessing them', async () => {
    const [digest] = (await from({ threadId: THREAD })).reports;

    assert.equal(digest!.submissionId, undefined);
    assert.equal(digest!.versionId, undefined);
    assert.deepEqual(digest!.versions, []);
  });

  test('a submission id finds its thread by the private filter, not by listing submissions', async () => {
    const { reports, urls } = await from({ submissionId: 'submission-0000' });

    assert.equal(reports[0]!.submissionId, 'submission-0000');
    assert.equal(reports[0]!.threadId, THREAD);
    assert.doesNotMatch(urls.join(' '), /apps\/123\/reviewSubmissions/);
    assert.ok(
      urls.some((url) => url.includes('resolutionCenterThreads?filter[reviewSubmission]=submission-0000')),
      'the thread came from the private submission filter'
    );
  });

  test('a submission whose thread does not exist still reports the submission', async () => {
    const stub = stubFetch((call) => {
      if (call.url.includes('resolutionCenterThreads')) return { body: { data: [] } };
      throw new Error(`nothing else should have been read: ${call.url}`);
    });
    try {
      const reports = await withStderr(() => buildReport(SESSION, { submissionId: 'submission-0000' }));

      assert.equal(reports.length, 1);
      assert.equal(reports[0]!.threadId, undefined);
      assert.equal(stub.calls.length, 1, 'nothing was read once there was no thread to read');
    } finally {
      stub.restore();
    }
  });

  test('an app id starts from the thread list, not from a submissions read', async () => {
    const { reports, urls } = await from({ appId: APP });

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.threadId, THREAD);
    assert.ok(urls.some((url) => url.includes(`/apps/${APP}/resolutionCenterThreads`)));
    assert.doesNotMatch(urls.join(' '), /reviewSubmissions/);
  });

  test('the version comes off the thread, and the submission fields stay unsaid', async () => {
    const [digest] = (await from({ appId: APP })).reports;

    assert.deepEqual(digest!.versions, [{ versionId: 'v-1.4.0', version: '1.4.0' }]);
    assert.equal(digest!.version, '1.4.0');
    assert.equal(digest!.versionId, 'v-1.4.0');
    assert.equal(digest!.submissionId, undefined);
  });

  test('a thread about several versions names them all rather than picking one', async () => {
    const stub = stubFetch((call) => {
      if (call.url.includes('/resolutionCenterMessages')) return { body: { data: messages } };
      if (call.url.includes('/resolutionCenterDraftMessage')) return { body: { data: null } };
      if (call.url.includes('/reviewRejections')) return { body: { data: [] } };
      if (call.url.includes('/resolutionCenterThreads')) return { body: threads('v-1.4.0', 'v-1.4.1') };
      throw new Error(`nothing else should have been read: ${call.url}`);
    });
    try {
      const [digest] = await withStderr(() => buildReport(SESSION, { appId: APP }));

      assert.deepEqual(
        digest!.versions.map((one) => one.version),
        ['1.4.0', '1.4.1']
      );
      // Two versions is two answers to "which version is this about", so neither is
      // promoted to the singular field.
      assert.equal(digest!.version, undefined);
      assert.equal(digest!.versionId, undefined);
    } finally {
      stub.restore();
    }
  });
});

describe('the privacy label', () => {
  /** A usage row: the enum values are the relationship ids, not attributes. */
  function usage(id: string, related: Record<string, string>): Resource {
    return {
      type: 'dataUsages',
      id,
      relationships: Object.fromEntries(
        Object.entries(related).map(([name, value]) => [name, { data: { type: `dataUsage${name}`, id: value } }])
      ),
    };
  }

  async function privacy(usages: Resource[], state: Record<string, unknown>) {
    const stub = stubFetch((call) => ({
      body: call.url.includes('dataUsagePublishState')
        ? { data: { type: 'dataUsagePublishStates', id: APP, attributes: state } }
        : { data: usages },
    }));
    try {
      return await withStderr(() => fetchPrivacy(SESSION, APP));
    } finally {
      stub.restore();
    }
  }

  test('each declaration is read out of its relationship ids', async () => {
    const declared = await privacy(
      [
        usage('u-1', {
          category: 'PAYMENT_INFORMATION',
          grouping: 'FINANCIAL_INFO',
          purpose: 'APP_FUNCTIONALITY',
          dataProtection: 'DATA_LINKED_TO_YOU',
        }),
      ],
      { published: true, lastPublished: '2026-04-25T05:46:00-07:00', lastPublishedBy: 'nick@example.com' }
    );

    assert.deepEqual(declared.usages, [
      {
        category: 'PAYMENT_INFORMATION',
        grouping: 'FINANCIAL_INFO',
        purpose: 'APP_FUNCTIONALITY',
        protection: 'DATA_LINKED_TO_YOU',
      },
    ]);
    assert.equal(declared.published, true);
    assert.equal(declared.lastPublishedBy, 'nick@example.com');
  });

  test('"we collect nothing" is one row with no category, not an empty list', async () => {
    const declared = await privacy([usage('u-1', { dataProtection: 'DATA_NOT_COLLECTED' })], { published: true });

    assert.equal(declared.collectsNothing, true);
    assert.equal(declared.usages.length, 1);
  });

  test('an empty list is "not filled in yet", which is a different thing', async () => {
    const declared = await privacy([], { published: false });

    assert.equal(declared.collectsNothing, false);
    assert.deepEqual(declared.usages, []);
  });

  test('a declaration that collects something is not read as collecting nothing', async () => {
    const declared = await privacy(
      [usage('u-1', { category: 'EMAIL_ADDRESS', dataProtection: 'DATA_NOT_COLLECTED' })],
      { published: false }
    );

    assert.equal(declared.collectsNothing, false, 'the marker row is the one with no category');
  });

  test('an unpublished label says so rather than defaulting to live', async () => {
    assert.equal((await privacy([], {})).published, false);
  });
});

/**
 * The Xcode Cloud answer: is a build handed to testers automatically, or is it not.
 *
 * The whole point of the read, and the thing `ciWorkflows` cannot say. The fixtures are
 * invented in the shape recorded from the browser — a workflow is `{id, content, metadata}`
 * and a post-action hangs off one of the workflow's own actions rather than off the
 * workflow — and both directions are pinned, because "no post-actions" is a real answer
 * here and not an empty result.
 */
describe('what a workflow says it does with a build', () => {
  const ARCHIVE = 'action-archive';

  function page(postActions: unknown[]): unknown {
    return {
      items: [
        {
          id: 'workflow-0000',
          content: {
            name: 'Nightly',
            disabled: false,
            actions: [{ id: ARCHIVE, action_type: 'archive', default_name: 'Release' }],
            post_actions: postActions,
          },
        },
      ],
    };
  }

  const testFlight = {
    id: 'post-0000',
    name: 'Hand to internal testers',
    type: 'testFlight_internal',
    deployment_config: {
      archive_action_id: ARCHIVE,
      testflight_deployment_ids: { beta_group_ids: ['group-0000'], beta_tester_ids: [] },
    },
  };

  async function read(body: unknown) {
    const stub = stubFetch(() => ({ body }));
    return withStderr(async () => {
      try {
        return await fetchPostActions(SESSION, 'product-0000');
      } finally {
        stub.restore();
      }
    });
  }

  test('nothing configured is an answer, not an absence', async () => {
    const workflows = await read(page([]));

    assert.equal(workflows.length, 1);
    assert.deepEqual(workflows[0]!.postActions, []);
    assert.match(formatPostActions(workflows), /not handed on automatically/);
  });

  test('a TestFlight hand-off names the build step it follows and the group it goes to', async () => {
    const workflows = await read(page([testFlight]));
    const [action] = workflows[0]!.postActions;

    // Apple's own spelling, mixed case and all. A plausible guess would have been wrong.
    assert.equal(action!.type, 'testFlight_internal');
    assert.equal(action!.archiveActionId, ARCHIVE);
    // Resolved from the same document — the id on its own says nothing a reader can use.
    assert.equal(action!.archiveAction, 'archive (Release)');
    assert.deepEqual(action!.betaGroupIds, ['group-0000']);
    assert.deepEqual(action!.betaTesterIds, []);

    const digest = formatPostActions(workflows);
    assert.match(digest, /archive \(Release\)/);
    // Ids, not names: resolving a beta group is `/v1/betaGroups`, which Apple serves.
    assert.match(digest, /group-0000/);
    assert.match(digest, /1 of 1 workflows/);
  });
});


/**
 * What the compute reads say once they are read back.
 *
 * The numbers below are invented, but two properties of them are not, and both are pinned
 * here because getting either wrong misreports an allowance rather than merely formatting
 * it oddly: the plan is denominated in **minutes**, and the plan window and the day window
 * are different windows that must never be added together or shown as one.
 */
describe('what Xcode Cloud says about compute', () => {
  const SUMMARY = {
    plan: { name: 'Pro', total: 6000, used: 4500, available: 1500, reset_date: '2026-09-01' },
    links: { manage: 'https://appstoreconnect.apple.com/teams/x/ci/settings' },
  };

  test('the plan is read as minutes, and as Apple\'s own arithmetic', async () => {
    const stub = stubFetch(() => ({ body: SUMMARY }));
    try {
      const plan = await withStderr(() => fetchPlan(SESSION));

      assert.equal(plan.totalMinutes, 6000);
      assert.equal(plan.usedMinutes, 4500);
      assert.equal(plan.availableMinutes, 1500);
      assert.equal(plan.resetDate, '2026-09-01');
      assert.equal(
        plan.usedMinutes + plan.availableMinutes,
        plan.totalMinutes,
        'used + available === total held on every recorded response'
      );
    } finally {
      stub.restore();
    }
  });

  test('a plan the response does not carry is an error, not an empty allowance', async () => {
    const stub = stubFetch(() => ({ body: { links: {} } }));
    try {
      await assert.rejects(() => withStderr(() => fetchPlan(SESSION)), /no "plan"/);
    } finally {
      stub.restore();
    }
  });

  test('a plan total Apple did not send is refused rather than read as zero', async () => {
    const stub = stubFetch(() => ({ body: { plan: { name: 'Pro', used: 1, available: 2 } } }));
    try {
      await assert.rejects(() => withStderr(() => fetchPlan(SESSION)), /did not send a usable plan total/);
    } finally {
      stub.restore();
    }
  });

  test('the breakdown keeps the day series and the per-product series apart', async () => {
    const stub = stubFetch(() => ({
      body: {
        usage: [
          { date: '2026-08-20', minutes: 120, number_of_builds: 4 },
          { date: '2026-08-21', minutes: 30, number_of_builds: 1 },
        ],
        product_usage: [
          {
            product_id: 'product-0000',
            usage_in_minutes: 100,
            usage_in_seconds: 6042,
            number_of_builds: 3,
            previous_usage_in_minutes: 80,
            previous_number_of_builds: 2,
          },
        ],
        info: { can_view_all_products: true },
      },
    }));
    try {
      const window = await withStderr(() => fetchUsage(SESSION, 2));

      assert.equal(window.days.length, 2);
      assert.equal(window.products.length, 1);
      assert.equal(window.allProducts, true);
      assert.equal(window.products[0]!.minutes, 100);
      assert.equal(window.products[0]!.previousMinutes, 80);
      assert.equal(
        window.products[0]!.minutes,
        Math.floor(window.products[0]!.seconds / 60),
        'minutes is floor(seconds / 60) on every recorded row'
      );
    } finally {
      stub.restore();
    }
  });

  /**
   * The one relationship the recording rules out. `plan.used` counts the billing period
   * ending at `reset_date`; the day series counts the dates asked for. In the recording
   * they do not agree, and a digest that presented one as the other would be wrong in a way
   * nobody could see.
   */
  test('the digest never merges the plan window with the asked-for window', async () => {
    const plan = { name: 'Pro', totalMinutes: 6000, usedMinutes: 4500, availableMinutes: 1500, resetDate: '2026-09-01' };
    const window = {
      start: '2026-08-20',
      end: '2026-08-21',
      days: [{ date: '2026-08-20', minutes: 120, builds: 4 }],
      products: [],
      allProducts: true,
    };
    const digest = formatUsage(plan, window);

    assert.match(digest, /4,500 of 6,000 minutes/, 'the plan is reported as Apple stated it');
    assert.match(digest, /counted separately from the plan/, 'and the window says it is a different window');
    assert.doesNotMatch(digest, /4,620/, 'the two totals are never summed');
  });

  test('the plan alone is a complete answer, with no window asked for', () => {
    const digest = formatUsage({
      name: 'Pro',
      totalMinutes: 6000,
      usedMinutes: 4500,
      availableMinutes: 1500,
      resetDate: '2026-09-01',
    });

    assert.match(digest, /1,500 minutes/);
    assert.doesNotMatch(digest, /counted separately/);
  });
});
