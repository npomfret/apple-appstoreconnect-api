import { basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Session } from './session';
import { del, get, patch, post, uploadPart, Query, UploadOperation } from './http';
import { Document, Resource, ResourceIdentifier } from './jsonapi';
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
  reviewDetails: ['appStoreReviewAttachments', 'appStoreVersion'],
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
  builds: ['icons', 'preReleaseVersion', 'buildBundles'],
  apps: ['appStoreIcon', 'displayableVersions'],
  // Narrowed from the capture: the browser also asks for `reviewSubmissions`, which Apple
  // serves officially at GET /v1/apps/{id}/reviewSubmissions. See listAppMetrics.
  appMetrics: ['appStoreVersionMetrics', 'betaReviewMetrics'],
  app: ['gameCenterDetail'],
  threads: [
    'appStoreVersions',
    'app',
    'appMessageThreadDetail',
    'build',
    'betaBackgroundAssetReviewSubmission',
  ],
  appVersions: ['alternativeDistributionPackage'],
  dataUsages: ['category', 'purpose', 'grouping', 'dataProtection'],
  version: [
    'app',
    'routingAppCoverage',
    'resetRatingsRequest',
    'appStoreVersionSubmission',
    'appStoreVersionPhasedRelease',
    'appStoreVersionLocalizations',
    'ageRatingDeclaration',
    'appStoreReviewDetail',
    'gameCenterConfiguration',
    'appClipDefaultExperience',
  ],
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
  apps: { displayableVersions: 20 },
  threads: { appStoreVersions: 2000 },
  version: { appStoreVersionLocalizations: 50 },
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
 * the browser with the rest of each query. An empty list is not "all of them": it asks for
 * that type to be identified by id alone, which is how the version page names a review
 * detail record without pulling the demo-account credentials in it.
 *
 * Every call that sends one takes a `fields` option. Widening one is safe; narrowing one
 * past what the browser asked for will start removing attributes this client's own
 * formatting reads, so `report.ts` is the thing to check before trimming.
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
  appVersions: {
    appStoreVersions: [
      'appStoreState',
      'appVersionState',
      'versionString',
      'platform',
      'downloadable',
      'alternativeDistributionPackage',
    ],
  },
  version: {
    apps: ['isOrEverWasMadeForKids'],
    appStoreReviewDetails: [],
    gameCenterConfigurations: [],
    appClipDefaultExperiences: [],
  },
  reviewDetails: { appStoreVersions: [] },
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

/** Every app on the account. */
export function listApps(
  session: Session,
  options: { include?: readonly string[]; limit?: number; sideloads?: SideloadLimits<typeof SIDELOADS.apps> } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'apps', {
    include: includeList(INCLUDES.apps, options.include),
    limit: options.limit ?? 200,
    ...sideloadLimits(SIDELOADS.apps, options.sideloads),
  });
}

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

export function getApp(
  session: Session,
  appId: string,
  options: { include?: readonly string[] } = {}
): Promise<Document<Resource>> {
  return get(session, `apps/${appId}`, { include: includeList(INCLUDES.app, options.include) });
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
 * Version states that mean "on the store", not "being worked on". A version in one of
 * these is not the one you want to edit.
 */
export const LIVE_VERSION_STATES = [
  'READY_FOR_SALE',
  'REPLACED_WITH_NEW_VERSION',
  'REMOVED_FROM_SALE',
  'DEVELOPER_REMOVED_FROM_SALE',
] as const;

/**
 * Enough of each version to tell them apart, and no more — what the version switcher in
 * the header runs on. The cheap way to find a version id; `getVersion` has the rest.
 *
 * One current version per platform, plus whatever is live: an account with a Mac build
 * gets its READY_FOR_SALE versions back here alongside the iOS one being edited. Pass a
 * platform, or filter on `appStoreState`, before assuming the first is the one you meant.
 */
export function listAppVersions(
  session: Session,
  appId: string,
  options: { include?: readonly string[]; platform?: string; fields?: Fieldsets<typeof FIELDSETS.appVersions> } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/appStoreVersions`, {
    include: includeList(INCLUDES.appVersions, options.include),
    'filter[platform]': options.platform,
    ...fieldsets(FIELDSETS.appVersions, options.fields),
  });
}

/**
 * Every state the version has passed through, oldest first — the "History" tab. Apple
 * keeps this even across rejections and resubmissions, so it is the only record of how
 * long a past review actually took.
 *
 * `initiator` is "Apple" for their side and an Apple ID for yours, which is what tells a
 * rejection apart from your own withdrawal back to PREPARE_FOR_SUBMISSION.
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
 * The version page's own view of a version: state, release settings, and the ids of
 * everything hanging off it. The counterpart to `updateVersion`.
 */
export function getVersion(
  session: Session,
  versionId: string,
  options: {
    include?: readonly string[];
    sideloads?: SideloadLimits<typeof SIDELOADS.version>;
    fields?: Fieldsets<typeof FIELDSETS.version>;
  } = {}
): Promise<Document<Resource>> {
  return get(session, `appStoreVersions/${versionId}`, {
    include: includeList(INCLUDES.version, options.include),
    ...sideloadLimits(SIDELOADS.version, options.sideloads),
    ...fieldsets(FIELDSETS.version, options.fields),
  });
}

/**
 * The App Review Information panel: who Apple contacts, the demo account the reviewer
 * signs in with, and the notes explaining how to reach the feature under test.
 *
 * Worth reading on any rejection — "we were unable to sign in" or "we couldn't locate
 * the feature" are complaints about this record rather than about the build.
 */
export function getReviewDetails(
  session: Session,
  reviewDetailId: string,
  options: { include?: readonly string[]; fields?: Fieldsets<typeof FIELDSETS.reviewDetails> } = {}
): Promise<Document<Resource>> {
  return get(session, `appStoreReviewDetails/${reviewDetailId}`, {
    include: includeList(INCLUDES.reviewDetails, options.include),
    // The version is wanted as an identifier only, not expanded — as the browser asks.
    ...fieldsets(FIELDSETS.reviewDetails, options.fields),
  });
}

/**
 * Reaches the review details from a version, which is the only route to them: the id
 * exists solely as a relationship on the version.
 */
export async function findReviewDetails(
  session: Session,
  versionId: string
): Promise<Document<Resource> | undefined> {
  const version = await getVersion(session, versionId);
  const related = version.data.relationships?.appStoreReviewDetail?.data as
    | ResourceIdentifier
    | undefined;
  if (!related?.id) return undefined;
  return getReviewDetails(session, related.id);
}

/**
 * Blanks the demo account password. Every command here prints to stdout, and a live
 * credential sitting in terminal scrollback is a worse problem than having to ask for it.
 * The account name is left alone — it's the pair that's the credential, and knowing which
 * account Apple was given is usually the point.
 *
 * What counts as a secret is `REVIEW_DETAIL_SECRETS` in `log.ts`, so that hiding it from a
 * command's output and hiding it from the log can't drift apart.
 */
export function redactReviewDetails(document: Document<Resource>): Document<Resource> {
  const attributes = document.data?.attributes;
  if (!attributes) return document;
  for (const field of REVIEW_DETAIL_SECRETS) {
    if (attributes[field]) attributes[field] = '[redacted — pass --reveal to show]';
  }
  return document;
}

/**
 * The build a version currently points at — one, or none at all. This filter does not
 * offer the alternatives; `listBuildCandidates` is the one that lists those. Re-read it
 * after `setVersionBuild` to confirm the change landed.
 */
export function listBuilds(
  session: Session,
  versionId: string,
  options: { include?: readonly string[] } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'builds', {
    'filter[appStoreVersion]': versionId,
    include: includeList(INCLUDES.builds, options.include),
  });
}

/**
 * What the version page's build picker offers: App Store eligible, finished processing,
 * on the given platform, newest first. The build already attached normally appears here
 * too, but isn't guaranteed to — a build can stay attached after ageing out of the list,
 * which is why `fetchBuilds` reads both.
 *
 * The limit of 10 is the picker's own; raise it to see further back.
 */
export function listBuildCandidates(
  session: Session,
  appId: string,
  options: { include?: readonly string[]; platform?: string; limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'builds', {
    include: includeList(INCLUDES.builds, options.include),
    limit: options.limit ?? 10,
    'filter[app]': appId,
    'filter[preReleaseVersion.platform]': options.platform,
    'filter[isAppStoreCandidate]': true,
    'filter[processingState]': 'VALID',
  });
}

export interface VersionUpdate {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: ResourceIdentifier | ResourceIdentifier[] | null }>;
}

/**
 * Saves a change to a version — this is what the version page's Save button does.
 * The body only carries what changed; anything omitted is left alone.
 */
export function updateVersion(
  session: Session,
  versionId: string,
  update: VersionUpdate
): Promise<Document<Resource>> {
  return patch(session, `appStoreVersions/${versionId}`, {
    data: { type: 'appStoreVersions', id: versionId, ...update },
  });
}

/** Attaches a build to a version, or detaches the current one with `null`. */
export function setVersionBuild(
  session: Session,
  versionId: string,
  buildId: string | null
): Promise<Document<Resource>> {
  return audited('version.build.set', { versionId, buildId }, () =>
    updateVersion(session, versionId, {
      relationships: { build: { data: buildId === null ? null : { type: 'builds', id: buildId } } },
    })
  );
}

/**
 * Most iris writes send application/vnd.api+json — the Resolution Center drafts and their
 * attachments all do. The version PATCH behind `updateVersion` is the odd one out and
 * sends plain application/json. Both were copied from the browser rather than reasoned about.
 */
const VND_API_CONTENT_TYPE = 'application/vnd.api+json';

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
    },
    VND_API_CONTENT_TYPE
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
    { data: { type: 'resolutionCenterDraftMessages', id: draftId, attributes: { messageBody } } },
    VND_API_CONTENT_TYPE
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
    },
    VND_API_CONTENT_TYPE
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
    },
    VND_API_CONTENT_TYPE
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
 * Deletes the thread's draft, attachments and all, and says which one went. Addressed by
 * thread because that is the id you have; the draft id is never shown in the UI.
 */
export async function discardDraftReply(session: Session, threadId: string): Promise<string> {
  const draft = (await getDraftMessage(session, threadId)).data;
  if (!draft) throw new Error(`Thread ${threadId} has no draft to delete`);
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
      },
      VND_API_CONTENT_TYPE
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

/** Escape hatch for probing endpoints we haven't mapped yet. */
export function raw<T extends Document>(session: Session, path: string, query: Query = {}): Promise<T> {
  return get<T>(session, path, query);
}

/** Write-side escape hatch: send a hand-written JSON:API body at any path. */
export function rawPatch<T = unknown>(session: Session, path: string, body: unknown): Promise<T> {
  return audited('raw.patch', { path }, () => patch<T>(session, path, body));
}
