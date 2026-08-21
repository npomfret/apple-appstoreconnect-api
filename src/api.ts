import { basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Session } from './session';
import { del, get, patch, post, uploadPart, Query, UploadOperation } from './http';
import { Denormalized, Document, Resource, ResourceIdentifier } from './jsonapi';
import { audited, log, REVIEW_DETAIL_SECRETS } from './log';

/**
 * Include lists lifted verbatim from the browser's own requests — every one of them, so
 * this is the whole inventory of what this client asks iris to sideload.
 *
 * One exception, marked where it sits: `appMetrics` is the browser's list with a
 * relationship *removed*, because that relationship is officially available. Narrowing is
 * the safe direction — iris 400s a name it does not recognise and cannot 400 one that is
 * no longer asked for — but the shortened list is this client's, not a recording.
 *
 * Each is the default for its call, and each call takes an `include` option to replace it.
 * Treat that option with more care than `sideloads` or `fields`: iris is undocumented and
 * picky, and **a relationship name it doesn't recognise 400s the whole request** rather
 * than being ignored. These lists are the ones observed to work, so an override is a
 * hypothesis to test, not a preference — which is also why nothing here is edited without a
 * live call behind it.
 */
const INCLUDES = {
  messages: ['fromActor', 'rejections', 'resolutionCenterMessageAttachments'],
  draftMessage: ['resolutionCenterMessageAttachments', 'fromActor'],
  rejections: [
    'appCustomProductPageVersion',
    'appEvent',
    'appStoreVersion',
    'appStoreVersionExperiment',
    'backgroundAssetVersions',
    'gameCenterAchievementVersions',
    'gameCenterLeaderboardVersions',
    'gameCenterLeaderboardSetVersions',
    'gameCenterChallengeVersions',
    'gameCenterActivityVersions',
    'inAppPurchaseVersions',
    'subscriptionVersions',
    'subscriptionGroupVersions',
    'build',
    'appBundleVersion',
    'rejectionAttachments',
  ],
  // Narrowed from the capture: the browser also asks for `reviewSubmissions`, which Apple
  // serves officially at GET /v1/apps/{id}/reviewSubmissions. See listAppMetrics.
  appMetrics: ['appStoreVersionMetrics', 'betaReviewMetrics'],
  threads: [
    'appStoreVersions',
    'app',
    'appMessageThreadDetail',
    'build',
    'betaBackgroundAssetReviewSubmission',
  ],
  dataUsages: ['category', 'purpose', 'grouping', 'dataProtection'],
} as const;

/**
 * Page sizes for the records those includes drag along — JSON:API's
 * `limit[relationship]` — copied from the browser with the include lists they pair with.
 * A `0` here would not mean "no limit": it asks for the related records to be identified
 * rather than expanded. None of the retained calls sends one, now that the review-centre
 * submission list that did has gone.
 *
 * These are the browser's numbers for the browser's screens, so every call that sends them
 * takes a `sideloads` option to name a different one. The defaults stay as captured.
 */
const SIDELOADS = {
  messages: { rejections: 2000, resolutionCenterMessageAttachments: 1000 },
  draftMessage: { resolutionCenterMessageAttachments: 1000 },
  rejections: { rejectionAttachments: 1000 },
  threads: { appStoreVersions: 2000 },
} as const;

/**
 * The `include` half of a query: a call's captured relationships, or the list a caller gave
 * instead. An empty list drops the parameter rather than sending `include=`, which is not a
 * shape the browser was ever seen sending and so not one to invent here.
 */
function includeList(defaults: readonly string[], override?: readonly string[]): string[] | undefined {
  const list = override ?? defaults;
  return list.length ? [...list] : undefined;
}

/** The sideloads one call sends, as an option: any subset of them, each a new page size. */
export type SideloadLimits<D> = Partial<Record<keyof D, number>>;

/** The `limit[relationship]` half of a query: a call's captured page sizes, less any overridden. */
function sideloadLimits<D extends Readonly<Record<string, number>>>(
  defaults: D,
  overrides: SideloadLimits<D> = {}
): Query {
  const query: Query = {};
  for (const [name, captured] of Object.entries(defaults)) {
    query[`limit[${name}]`] = overrides[name as keyof D] ?? captured;
  }
  return query;
}

/**
 * Which attributes of a resource type come back — JSON:API's `fields[type]`, copied from
 * the browser with the rest of each query.
 *
 * One call sends one now. It is the only place a fieldset does real work here: it is what
 * keeps `listAppMetrics` a read of two private counters rather than a listing of the apps
 * they hang off. Widening it would put an official app read back.
 */
const FIELDSETS = {
  // `fields[apps]` naming only relationships is what makes this a gap read rather than an
  // app list: the apps come back as bare ids carrying the two private metric records and
  // none of the attributes Apple's official App resource already has.
  appMetrics: {
    apps: ['appStoreVersionMetrics', 'betaReviewMetrics'],
    appStoreVersionMetrics: ['messageCount'],
    betaReviewMetrics: ['messageCount', 'platform'],
  },
} as const;

/** The fieldsets one call sends, as an option: any subset of them, each a new attribute list. */
export type Fieldsets<D> = Partial<Record<keyof D, readonly string[]>>;

/** The `fields[type]` half of a query: a call's captured attribute lists, less any overridden. */
function fieldsets<D extends Readonly<Record<string, readonly string[]>>>(
  defaults: D,
  overrides: Fieldsets<D> = {}
): Query {
  const query: Query = {};
  for (const [type, captured] of Object.entries(defaults)) {
    query[`fields[${type}]`] = [...(overrides[type as keyof D] ?? captured)];
  }
  return query;
}

/**
 * The Resolution Center conversation: Apple's messages and yours, oldest first.
 *
 * The browser sends no top-level `limit` on this one and takes iris's default page, so
 * neither does this by default — but a thread that outlives that page comes back clipped
 * from the *end*, which is where the message you care about is. `read.atLimit` and
 * `read.clipped` in the log say when that may have happened; `limit` is how to see past it.
 */
export function listMessages(
  session: Session,
  threadId: string,
  options: {
    include?: readonly string[];
    limit?: number;
    sideloads?: SideloadLimits<typeof SIDELOADS.messages>;
  } = {}
): Promise<Document<Resource[]>> {
  return get(session, `resolutionCenterThreads/${threadId}/resolutionCenterMessages`, {
    include: includeList(INCLUDES.messages, options.include),
    limit: options.limit,
    ...sideloadLimits(SIDELOADS.messages, options.sideloads),
  });
}

/** The unsent reply sitting in the thread's draft box, if there is one. */
export function getDraftMessage(
  session: Session,
  threadId: string,
  options: { include?: readonly string[]; sideloads?: SideloadLimits<typeof SIDELOADS.draftMessage> } = {}
): Promise<Document<Resource | null>> {
  return get(session, `resolutionCenterThreads/${threadId}/resolutionCenterDraftMessage`, {
    include: includeList(INCLUDES.draftMessage, options.include),
    ...sideloadLimits(SIDELOADS.draftMessage, options.sideloads),
  });
}

/** Guideline rejections attached to a thread — the actionable part of a rejection. */
export function listRejections(
  session: Session,
  threadId: string,
  options: { include?: readonly string[]; limit?: number; sideloads?: SideloadLimits<typeof SIDELOADS.rejections> } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'reviewRejections', {
    'filter[resolutionCenterMessage.resolutionCenterThread]': threadId,
    include: includeList(INCLUDES.rejections, options.include),
    limit: options.limit ?? 2000,
    ...sideloadLimits(SIDELOADS.rejections, options.sideloads),
  });
}

/** Thread types the review-centre UI asks for. */
export const THREAD_TYPES = [
  'REJECTION_BINARY',
  'REJECTION_METADATA',
  'REJECTION_REVIEW_SUBMISSION',
  'APP_MESSAGE_ARC',
  'APP_MESSAGE_ARB',
  'APP_MESSAGE_COMM',
  'APP_MESSAGE_INFORMATIONAL',
] as const;

/**
 * Unread-message counts per app — what the App Store Connect home page badges with.
 * The cheapest way to ask "has Apple said anything anywhere?" without walking threads.
 *
 * This is a request to `apps`, which Apple serves officially, and it is kept for one
 * reason: `appStoreVersionMetrics.messageCount` and `betaReviewMetrics.messageCount` are
 * counts the official API has no schema for. Checked against Apple's OpenAPI specification
 * 4.4.1 (generated 2026-07-15): `appStoreVersionMetrics`, `betaReviewMetrics` and
 * `messageCount` appear in none of its 966 paths or 1,393 schemas.
 *
 * So the query asks for those counts and nothing else. `fields[apps]` names only the two
 * metric relationships, which means the apps themselves come back as bare ids: no name, no
 * bundle id, no state. Read those from `GET /v1/apps` on the official API. Widening this
 * back into an app listing puts the duplication back.
 *
 * The browser also sideloads `reviewSubmissions` here; that is
 * `GET /v1/apps/{id}/reviewSubmissions` officially, `state` included, so it is not sent.
 * Dropping a relationship from an include list is safe in the way adding one is not, but
 * the shortened query is this client's own and has not been recorded from the browser.
 */
export function listAppMetrics(
  session: Session,
  options: {
    include?: readonly string[];
    limit?: number;
    fields?: Fieldsets<typeof FIELDSETS.appMetrics>;
  } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'apps', {
    include: includeList(INCLUDES.appMetrics, options.include),
    limit: options.limit ?? 200,
    'filter[removed]': false,
    ...fieldsets(FIELDSETS.appMetrics, options.fields),
  });
}

/** Resolution Center threads on an app, optionally narrowed to one version. */
export function listThreads(
  session: Session,
  appId: string,
  options: {
    include?: readonly string[];
    appStoreVersionId?: string;
    threadTypes?: readonly string[];
    sideloads?: SideloadLimits<typeof SIDELOADS.threads>;
  } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/resolutionCenterThreads`, {
    include: includeList(INCLUDES.threads, options.include),
    ...sideloadLimits(SIDELOADS.threads, options.sideloads),
    'filter[threadType]': [...(options.threadTypes ?? THREAD_TYPES)],
    'filter[appStoreVersion]': options.appStoreVersionId,
  });
}

/**
 * Every state the version has passed through, oldest first — the "History" tab. Apple
 * keeps this even across rejections and resubmissions, so it is the only record of how
 * long a past review actually took.
 *
 * `initiator` is "Apple" for their side and an Apple ID for yours, which is who moved it.
 * It is not what separates a rejection from your own withdrawal: those are distinct states
 * in Apple's own vocabulary, and `report` counts them by state — see `REJECTED_BY_APPLE`.
 */
export function listVersionStateChanges(
  session: Session,
  versionId: string,
  options: { limit?: number } = {}
): Promise<Document<Resource[]>> {
  // The UI sends no query at all and takes the default page of 50. The limit is ours,
  // for versions that have been round the loop more times than that.
  return get(session, `appStoreVersions/${versionId}/appStoreVersionStateChanges`, {
    limit: options.limit ?? 200,
  });
}

/**
 * The App Privacy declarations — one record per (category, purpose, protection) the app
 * admits to, or a single DATA_NOT_COLLECTED row standing for "none of it".
 *
 * Worth reading before a submission: these are declarations rather than anything Apple
 * measures, so they go stale silently when an SDK starts collecting something new.
 */
export function listDataUsages(
  session: Session,
  appId: string,
  options: { include?: readonly string[]; limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/dataUsages`, {
    include: includeList(INCLUDES.dataUsages, options.include),
    limit: options.limit ?? 500,
  });
}

/** Whether the privacy declarations above are live on the store, and who last published them. */
export function getDataUsagePublishState(session: Session, appId: string): Promise<Document<Resource>> {
  return get(session, `apps/${appId}/dataUsagePublishState`, {});
}

/**
 * Resolution Center replies live as a *draft* until you send them: Apple keeps one unsent
 * message per thread and autosaves it as you type, which is what the calls below do.
 *
 * Sending is `sendDraftMessage`, and it is the one call here that cannot be taken back:
 * the message is on the thread the moment it returns, with no edit and no unsend. Nothing
 * else in this file reaches Apple.
 */

/**
 * Starts the thread's draft. The web UI POSTs this the moment you type the first
 * character and PATCHes from then on, so call it only when there is no draft already —
 * `saveDraftReply` handles that choice.
 *
 * Only open threads take drafts: a closed one answers 409 ENTITY_ERROR.RELATIONSHIP.INVALID,
 * "Cannot add draft message to closed thread".
 *
 * The id that comes back is derived from the thread rather than random — delete a draft,
 * start another on the same thread, and the same UUID returns with a new `createdDate`.
 * Don't lean on that: read the draft for its id rather than remembering one.
 */
export function createDraftMessage(
  session: Session,
  threadId: string,
  messageBody: string
): Promise<Document<Resource>> {
  return post(
    session,
    'resolutionCenterDraftMessages',
    {
      data: {
        type: 'resolutionCenterDraftMessages',
        attributes: { messageBody },
        relationships: {
          resolutionCenterThread: { data: { type: 'resolutionCenterThreads', id: threadId } },
        },
      },
    }
  );
}

/** Replaces the draft's text — the autosave. Attachments already on it are left alone. */
export function updateDraftMessage(
  session: Session,
  draftId: string,
  messageBody: string
): Promise<Document<Resource>> {
  return patch(
    session,
    `resolutionCenterDraftMessages/${draftId}`,
    { data: { type: 'resolutionCenterDraftMessages', id: draftId, attributes: { messageBody } } }
  );
}

/**
 * Throws the draft away — the "Delete Draft" button. A DELETE with no body at all.
 *
 * Attachments go with it: after a draft was deleted this way, a GET of the attachment
 * that had been on it returned 404. The thread is left with no draft, so the next
 * `saveDraftReply` starts a fresh one.
 */
export function deleteDraftMessage(session: Session, draftId: string): Promise<void> {
  return audited('draft.delete', { draftId }, () =>
    del<void>(session, `resolutionCenterDraftMessages/${draftId}`)
  );
}

/**
 * Step one of attaching a file: reserve a slot on the draft for a file of this name and
 * size. The response carries the `uploadOperations` saying where the bytes go: reserve,
 * PUT each part to its presigned URL, then commit with `{"uploaded":true}`.
 */
export function reserveMessageAttachment(
  session: Session,
  draftId: string,
  fileName: string,
  fileSize: number
): Promise<Document<Resource>> {
  return post(
    session,
    'resolutionCenterMessageAttachments',
    {
      data: {
        type: 'resolutionCenterMessageAttachments',
        attributes: { fileSize, fileName },
        relationships: {
          resolutionCenterDraftMessage: {
            data: { type: 'resolutionCenterDraftMessages', id: draftId },
          },
        },
      },
    }
  );
}

/** Step three: tell iris the bytes have all arrived. Until this lands the slot is empty. */
export function completeMessageAttachment(
  session: Session,
  attachmentId: string
): Promise<Document<Resource>> {
  return patch(
    session,
    `resolutionCenterMessageAttachments/${attachmentId}`,
    {
      data: {
        type: 'resolutionCenterMessageAttachments',
        id: attachmentId,
        attributes: { uploaded: true },
      },
    }
  );
}

/**
 * Removes an attachment from a draft. Not in any capture — the shape was probed, and
 * works on an attachment that has been uploaded.
 */
export function deleteMessageAttachment(session: Session, attachmentId: string): Promise<void> {
  return audited('draft.attachment.delete', { attachmentId }, () =>
    del<void>(session, `resolutionCenterMessageAttachments/${attachmentId}`)
  );
}

/** Puts one file on a draft: reserve, send the parts, commit. */
export async function attachToDraft(
  session: Session,
  draftId: string,
  filePath: string
): Promise<Resource> {
  const file = readFileSync(filePath);
  const fileName = basename(filePath);

  return audited('draft.attach', { draftId, fileName, fileSize: file.length }, async () => {
    const reserved = (await reserveMessageAttachment(session, draftId, fileName, file.length)).data;
    const operations = (reserved.attributes?.uploadOperations ?? []) as UploadOperation[];
    if (!operations.length) {
      throw new Error(
        `Attachment ${reserved.id} came back with no uploadOperations — nowhere to send the file`
      );
    }

    log.info('draft.attachment.reserved', { attachmentId: reserved.id, parts: operations.length });

    for (const operation of operations) await uploadPart(operation, file);

    return (await completeMessageAttachment(session, reserved.id)).data;
  });
}

export interface DraftReply {
  threadId: string;
  /** The whole reply. This replaces the draft's text rather than adding to it. */
  body: string;
  /** Files to attach, added to whatever the draft already carries. */
  attach?: string[];
}

/**
 * Writes a reply into the thread's draft box, creating the draft if the thread has none
 * and attaching any files given. Nothing here reaches Apple: the draft is yours until
 * someone presses Send in the browser.
 *
 * **No confirmation, and the text it replaces is not kept.** A draft that already has
 * words in it is written over — that is what the browser's own autosave does — so the
 * CLI's `save-draft` reads the box first and asks about what is in it. Attachments are the
 * exception: those are added to, never replaced.
 *
 * The draft is read back at the end because neither the POST nor the PATCH response
 * mentions attachments — the relationship only shows up on a fresh GET.
 */
export async function saveDraftReply(session: Session, reply: DraftReply): Promise<Document<Resource>> {
  const { threadId, body, attach = [] } = reply;

  // Checked before anything is written: a mistyped path found halfway through would leave
  // the text saved and the files not, which is the confusing half-done state to avoid.
  for (const filePath of attach) {
    if (!existsSync(filePath)) throw new Error(`No such file to attach: ${filePath}`);
  }

  return audited(
    'draft.save',
    { threadId, bodyLength: body.length, attaching: attach.length || undefined },
    async () => {
      const existing = (await getDraftMessage(session, threadId)).data;

      const draft = existing
        ? (await updateDraftMessage(session, existing.id, body)).data
        : (await createDraftMessage(session, threadId, body)).data;

      log.info(existing ? 'draft.updated' : 'draft.created', { threadId, draftId: draft.id });

      for (const filePath of attach) await attachToDraft(session, draft.id, filePath);

      const saved = await getDraftMessage(session, threadId);
      if (!saved.data) {
        throw new Error(`Saved draft ${draft.id} on thread ${threadId}, but reading it back gave nothing`);
      }
      return saved as Document<Resource>;
    }
  );
}

/**
 * The part of a draft a confirmation is about: the text, and which files go with it.
 *
 * Both of the writes that destroy a draft's words — `send-reply`, which copies them to
 * Apple, and `save-draft`, which writes over them — print the box and ask about what is in
 * it. Between the question and the write is a gap the length of however long the prompt was
 * on screen, and App Store Connect autosaves that box as you type, so a browser open on the
 * same thread moves it under you. Fingerprinting what was shown is how the write notices.
 *
 * It does not close the gap and nothing here can: iris has no conditional write, so there
 * is still a round trip between the check and the change. What it catches is an edit made
 * while somebody was reading, which is the one that actually happens.
 *
 * Ordering the attachments makes this about the set rather than the order iris happened to
 * list them in. The draft's own id is in there because a delete-and-recreate returns the
 * same id — see [replying](../docs/replying.md) — so it wouldn't catch that on its own, but
 * a changed one is certainly a different draft.
 */
export function draftState(draft: Denormalized): string {
  const attachments = (draft['resolutionCenterMessageAttachments'] ?? []) as Denormalized[];

  return JSON.stringify({
    id: draft.id,
    body: String(draft['messageBody'] ?? ''),
    attachments: attachments.map((file) => `${file.id}:${String(file['fileName'] ?? '')}`).sort(),
  });
}

/**
 * The thread's draft box, having established there is something in it to delete.
 *
 * All that is checked is that a draft exists. An empty one is still worth deleting, unlike
 * sending, which is why this and `findSendableDraft` are two reads rather than one: the
 * question each is asked before is a different question.
 *
 * Split out of `discardDraftReply` for the same reason the send is split — the CLI needs
 * the draft in its hands to show you what is about to go. The whole document comes back
 * rather than the draft alone because the attachments are sideloaded beside it, and they
 * go with it.
 */
export async function findDeletableDraft(
  session: Session,
  threadId: string
): Promise<Document<Resource>> {
  const document = await getDraftMessage(session, threadId);
  const draft = document.data;

  if (!draft) throw new Error(`Thread ${threadId} has no draft to delete`);

  return { ...document, data: draft };
}

/**
 * Deletes the thread's draft, attachments and all, and says which one went. Addressed by
 * thread because that is the id you have; the draft id is never shown in the UI.
 *
 * **No confirmation and nothing kept.** The CLI's `delete-draft` is these same two steps
 * with the draft printed and a question in between.
 */
export async function discardDraftReply(session: Session, threadId: string): Promise<string> {
  const draft = (await findDeletableDraft(session, threadId)).data;
  await deleteDraftMessage(session, draft.id);
  return draft.id;
}

/**
 * Sends the draft. **This is the irreversible one.**
 *
 * The Send button doesn't post the text: it posts a *reference to the draft*, and iris
 * copies the body and its attachments across into a real message. So whatever is in the
 * draft box at this moment is what Apple gets — read it back before calling this.
 *
 * Copied from a recording of one real send. The draft is gone afterwards and the message is on
 * the thread, with a `createdDate` and no relationships in the response; read the thread
 * to see it in context. There is no unsend.
 */
export function sendDraftMessage(session: Session, draftId: string): Promise<Document<Resource>> {
  return audited('message.send', { draftId }, () =>
    post<Document<Resource>>(
      session,
      'resolutionCenterMessages',
      {
        data: {
          type: 'resolutionCenterMessages',
          relationships: {
            createFromDraftMessage: { data: { type: 'resolutionCenterDraftMessages', id: draftId } },
          },
        },
      }
    )
  );
}

/**
 * The thread's draft, having established there is something there worth sending: a box
 * with no draft in it and a draft with no text in it are both errors here rather than at
 * the point of no return. The browser disables Send until there's text, and an empty
 * message to App Review helps nobody.
 *
 * This is where "sendable" is decided, for both the one-call `sendDraftReply` and the CLI,
 * which needs the draft in its hands to show you before it asks. The whole document comes
 * back rather than the draft alone because the attachments are sideloaded beside it, and
 * showing a reply without them would be showing half of it.
 */
export async function findSendableDraft(session: Session, threadId: string): Promise<Document<Resource>> {
  const document = await getDraftMessage(session, threadId);
  const draft = document.data;

  if (!draft) throw new Error(`Thread ${threadId} has no draft to send`);
  if (!String(draft.attributes?.messageBody ?? '').trim()) {
    throw new Error(`The draft on thread ${threadId} is empty — nothing to send`);
  }

  return { ...document, data: draft };
}

/**
 * Sends whatever is in the thread's draft box, addressed by thread because that is the id
 * you have.
 *
 * **No confirmation and no undo** — this reaches Apple the moment it is called. The CLI's
 * `send-reply` is the same two steps with the draft shown and a question in between.
 */
export async function sendDraftReply(session: Session, threadId: string): Promise<Resource> {
  const draft = (await findSendableDraft(session, threadId)).data;
  return (await sendDraftMessage(session, draft.id)).data;
}

/**
 * The thread behind a review submission. The UI only ever reaches this via the page
 * URL, but the filter works — verified against a live rejection.
 */
export async function findThreadForSubmission(
  session: Session,
  submissionId: string
): Promise<Resource | undefined> {
  const document = await get<Document<Resource[]>>(session, 'resolutionCenterThreads', {
    'filter[reviewSubmission]': submissionId,
  });
  return document.data[0];
}

/**
 * The private resource families this client is for: types iris serves and Apple's official
 * API has no path and no schema for. One list, and the boundary `raw` is held to.
 *
 * Checked against Apple's OpenAPI specification **4.4.1** (generated 2026-07-15) on
 * 2026-08-21: `resolutionCenter`, `reviewRejection`, `dataUsage`, `appStoreVersionStateChange`
 * and `messageCount` each appear zero times anywhere in its 966 paths and 1,393 schemas.
 *
 * A whole family is opened rather than only the routes mapped above, because a type the
 * official API has never heard of has no official call to duplicate anywhere inside it —
 * so a *new* gap can still be found here without the boundary moving. Being on the list
 * says a path is in scope, not that it works: an unmapped route is still an unproven one,
 * and the evidence for one comes from the browser doing it.
 */
const GAP_FAMILIES = [
  'resolutionCenterThreads',
  'resolutionCenterMessages',
  'resolutionCenterDraftMessages',
  'resolutionCenterMessageAttachments',
  'reviewRejections',
] as const;

/**
 * Private relationships that hang off a resource Apple *does* serve.
 *
 * Kept keyed by parent rather than folded into the list above, because the parent is the
 * part that is out of scope: `apps/{id}/dataUsages` is a gap and `apps/{id}` is
 * `GET /v1/apps/{id}`, and one segment is the whole difference between them. `apps` bare
 * is a gap for exactly one query — the two unread counts `listAppMetrics` asks for — which
 * is why that is a mapped call rather than something reachable with a free-form path.
 */
const GAP_SUBRESOURCES: Record<string, readonly string[]> = {
  apps: ['resolutionCenterThreads', 'dataUsages', 'dataUsagePublishState'],
  appStoreVersions: ['appStoreVersionStateChanges'],
};

/** Whether a relative iris path names something in the two lists above. */
function withinBoundary(path: string): boolean {
  const segments = path.replace(/^\/+/, '').split('/');
  // `.` or `..` would leave the family the path appears to name, and an empty segment is a
  // doubled slash, which reads as a host rather than a path.
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;

  const [family, , child] = segments;
  if (family === undefined) return false;
  if (GAP_FAMILIES.some((known) => known === family)) return true;
  if (segments.length !== 3 || child === undefined) return false;

  const children = GAP_SUBRESOURCES[family];
  return children !== undefined && children.includes(child);
}

/** The boundary spelled out, built from the lists so a refusal cannot describe a stale one. */
function inScope(): string {
  const children = Object.entries(GAP_SUBRESOURCES)
    .map(([parent, names]) => `${parent}/{id}/{${names.join(',')}}`)
    .join(', ');
  return `${GAP_FAMILIES.join(', ')}, and ${children}`;
}

/**
 * A GET at a path inside those families, for a query the calls above don't send: another
 * include list, a filter nothing here uses, a relationship no command reads yet.
 *
 * It used to take any `iris/v1` path at all, which is how everything step 4 removed stayed
 * one command-line argument away from being back — an unrestricted private GET duplicates
 * whatever you point it at, and the boundary never sees it happen. So `apps/{id}`,
 * `appStoreVersions/{id}`, `appInfos/{id}`, `builds`, `ciWorkflows` and pricing are refused
 * here and served by Apple's API with a key.
 *
 * The refusal is a boundary rule rather than a safety rail: nothing is sent, and there is
 * no flag that widens it. What is on the other side of it is a browser capture, which is
 * where evidence for an unmapped call has to come from anyway.
 */
export function raw<T extends Document>(session: Session, path: string, query: Query = {}): Promise<T> {
  if (!withinBoundary(path)) {
    throw new Error(
      `Refusing to GET "${path}": this client is only for what Apple's official App Store ` +
        `Connect API does not serve, and that path is either outside that or is the official ` +
        `record itself. In scope: ${inScope()}. Everything else is at ` +
        'https://developer.apple.com/documentation/appstoreconnectapi/.'
    );
  }

  return get<T>(session, path, query);
}
