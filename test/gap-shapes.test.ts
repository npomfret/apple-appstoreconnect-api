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
 * That last part matters for the planned work. `report` still discovers a thread through
 * an official-overlap submissions read and is due to be rebuilt thread-first; these tests
 * assert on the Resolution Center half of what comes out, so the refactor changes the
 * setup below and none of the expectations. **A removal slice that makes one of these fail
 * has taken something it should not have.**
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { Document, Resource } from '../src/jsonapi';
import { buildReport, fetchPrivacy, SubmissionReport } from '../src/report';
import { SESSION, stubFetch, withStderr } from './helpers';

const APP = '123';
const THREAD = 'thread-0000';

/** The submission the thread hangs off. Its own fields are not what this file is about. */
const SUBMISSIONS: Document<Resource[]> = {
  data: [
    {
      type: 'reviewSubmissions',
      id: 'submission-0000',
      attributes: {
        state: 'UNRESOLVED_ISSUES',
        platform: 'IOS',
        submittedDate: '2026-04-25T05:46:00-07:00',
        lastUpdatedDate: '2026-04-27T15:51:00-07:00',
      },
      relationships: { appStoreVersionForReview: { data: { type: 'appStoreVersions', id: 'v-0000' } } },
    },
  ],
  included: [{ type: 'appStoreVersions', id: 'v-0000', attributes: { versionString: '1.4.0' } }],
};

const THREADS: Document<Resource[]> = {
  data: [{ type: 'resolutionCenterThreads', id: THREAD, attributes: { state: 'OPEN' } }],
};

/** One message, with an actor and any attachments hung off it. */
function message(
  id: string,
  createdDate: string,
  messageBody: string,
  actor: string,
  attachments: string[] = []
): Resource {
  return {
    type: 'resolutionCenterMessages',
    id,
    attributes: { createdDate, messageBody },
    relationships: {
      fromActor: { data: { type: 'actors', id: actor } },
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

function rejection(id: string, reasons: Array<Record<string, string>>): Resource {
  return { type: 'reviewRejections', id, attributes: { reasons } };
}

interface Thread {
  messages?: Resource[];
  attachments?: Resource[];
  rejections?: Resource[];
  draft?: Resource | null;
}

/** Answers each leg of the report chain from `thread`, and hands back the one report. */
async function report(thread: Thread): Promise<SubmissionReport> {
  const stub = stubFetch((call) => {
    if (call.url.includes('/resolutionCenterMessages')) {
      return { body: { data: thread.messages ?? [], included: thread.attachments ?? [] } };
    }
    if (call.url.includes('/resolutionCenterDraftMessage')) return { body: { data: thread.draft ?? null } };
    if (call.url.includes('/reviewRejections')) return { body: { data: thread.rejections ?? [] } };
    if (call.url.includes('/resolutionCenterThreads')) return { body: THREADS };
    return { body: SUBMISSIONS };
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
    message('m-1', '2026-11-01T01:30:00-07:00', '<p>We are still seeing the crash.</p>', 'APPLE_REVIEW'),
    message('m-2', '2026-11-01T01:00:00-08:00', '<p>A new build is on the way.</p>', 'ACTOR_0000'),
  ];

  test('the latest message is the latest in time, not in text', async () => {
    const digest = await report({ messages: dst });

    assert.equal(digest.lastMessageDate, '2026-11-01T01:00:00-08:00');
    assert.equal(digest.lastMessageFromApple, false);
  });

  test('Apple is recognised by the actor id, and their last word is kept separately', async () => {
    const digest = await report({ messages: dst });

    assert.equal(digest.lastAppleMessage, 'We are still seeing the crash.');
  });

  test('message bodies arrive as HTML and are read as text', async () => {
    const digest = await report({
      messages: [
        message(
          'm-1',
          '2026-04-27T15:51:00-07:00',
          '<p>Guideline 2.1</p><ul><li>The app crashed</li><li>on iPad&nbsp;Air</li></ul>',
          'APPLE_REVIEW'
        ),
      ],
    });

    assert.equal(digest.lastAppleMessage, 'Guideline 2.1\n  - The app crashed\n  - on iPad Air');
  });

  test('a thread with nothing from Apple has no Apple message rather than the wrong one', async () => {
    const digest = await report({
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>Any news?</p>', 'ACTOR_0000')],
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
      messages: [message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', 'APPLE_REVIEW', ['a-1'])],
      attachments: [attachment('a-1', 'crash.mp4', 2048)],
    });

    assert.deepEqual(digest.attachments, [
      { fileName: 'crash.mp4', fileSize: 2048, downloadUrl: 'https://example.invalid/a-1' },
    ]);
  });

  test('the same file on two messages is listed once', async () => {
    const digest = await report({
      messages: [
        message('m-1', '2026-04-27T15:51:00-07:00', '<p>See the video.</p>', 'APPLE_REVIEW', ['a-1']),
        message('m-2', '2026-04-28T09:00:00-07:00', '<p>And again.</p>', 'APPLE_REVIEW', ['a-2']),
      ],
      attachments: [attachment('a-1', 'crash.mp4', 2048), attachment('a-2', 'crash.mp4', 2048)],
    });

    assert.equal(digest.attachments.length, 1);
  });
});

describe('the guidelines behind a rejection', () => {
  test('every reason on every rejection becomes one guideline, lowest number first', async () => {
    const digest = await report({
      rejections: [
        rejection('r-1', [
          { reasonCode: '4.3.0', reasonSection: 'Design', reasonDescription: 'Spam' },
          { reasonCode: '2.1', reasonSection: 'Performance', reasonDescription: 'App Completeness' },
        ]),
        rejection('r-2', [
          { reasonCode: '1.2', reasonSection: 'Safety', reasonDescription: 'User-Generated Content' },
        ]),
      ],
    });

    assert.deepEqual(
      digest.guidelines.map((guideline) => guideline.code),
      ['1.2', '2.1', '4.3.0']
    );
    assert.equal(digest.guidelines[1]!.section, 'Performance');
    assert.equal(digest.guidelines[1]!.description, 'App Completeness');
  });

  test('the same guideline cited twice is reported once', async () => {
    const digest = await report({
      rejections: [
        rejection('r-1', [{ reasonCode: '2.1', reasonSection: 'Performance', reasonDescription: 'First' }]),
        rejection('r-2', [{ reasonCode: '2.1', reasonSection: 'Performance', reasonDescription: 'Second' }]),
      ],
    });

    assert.deepEqual(digest.guidelines, [
      { code: '2.1', section: 'Performance', description: 'First' },
    ]);
  });

  test('a reason with no code falls back to its section rather than being dropped', async () => {
    const digest = await report({
      rejections: [rejection('r-1', [{ reasonSection: 'Legal', reasonDescription: 'Privacy' }])],
    });

    assert.deepEqual(digest.guidelines, [{ code: 'Legal', section: 'Legal', description: 'Privacy' }]);
  });

  test('a thread with no rejections has no guidelines, which is not an error', async () => {
    assert.deepEqual((await report({})).guidelines, []);
  });
});

describe('starting without an official read', () => {
  /**
   * The app-id route finds submissions through `apps/{id}/reviewSubmissions`, which Apple
   * serves officially. A thread id or a submission id skips it, and what comes back is the
   * same Resolution Center digest — which is what makes the planned thread-first rebuild a
   * change of entry point rather than a change of answer.
   */
  const messages = [
    message('m-1', '2026-04-27T15:51:00-07:00', '<p>We are still seeing the crash.</p>', 'APPLE_REVIEW'),
  ];

  async function from(target: Parameters<typeof buildReport>[1]) {
    const stub = stubFetch((call) => {
      if (call.url.includes('/resolutionCenterMessages')) return { body: { data: messages } };
      if (call.url.includes('/resolutionCenterDraftMessage')) return { body: { data: null } };
      if (call.url.includes('/reviewRejections')) return { body: { data: [] } };
      if (call.url.includes('/resolutionCenterThreads')) return { body: THREADS };
      return { body: SUBMISSIONS };
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

  test('a thread id leaves the submission fields unsaid rather than guessing them', async () => {
    const [digest] = (await from({ threadId: THREAD })).reports;

    assert.equal(digest!.submissionId, undefined);
    assert.equal(digest!.state, undefined);
    assert.equal(digest!.versionId, undefined);
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
    const stub = stubFetch((call) =>
      call.url.includes('resolutionCenterThreads') ? { body: { data: [] } } : { body: SUBMISSIONS }
    );
    try {
      const reports = await withStderr(() => buildReport(SESSION, { submissionId: 'submission-0000' }));

      assert.equal(reports.length, 1);
      assert.equal(reports[0]!.threadId, undefined);
      assert.equal(stub.calls.length, 1, 'nothing was read once there was no thread to read');
    } finally {
      stub.restore();
    }
  });

  test('an app id is the one route that costs an official read', async () => {
    const { urls } = await from({ appId: APP });

    assert.ok(urls.some((url) => url.includes(`/apps/${APP}/reviewSubmissions`)));
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
