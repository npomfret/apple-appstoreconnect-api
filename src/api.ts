import { basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Session } from './session';
import { del, get, patch, post, uploadPart, Query, UploadOperation } from './http';
import { Document, Resource, ResourceIdentifier } from './jsonapi';
import { checkScreenshot, readImageSize } from './screenshots';
import { audited, log } from './log';

/**
 * Include lists lifted verbatim from the browser's own requests — every one of them, so
 * this is the whole inventory of what this client asks iris to sideload.
 *
 * Each is the default for its call, and each call takes an `include` option to replace it.
 * Treat that option with more care than `sideloads` or `fields`: iris is undocumented and
 * picky, and **a relationship name it doesn't recognise 400s the whole request** rather
 * than being ignored. These lists are the ones observed to work, so an override is a
 * hypothesis to test, not a preference — which is also why nothing here is edited without a
 * live call behind it.
 */
const INCLUDES = {
  reviewSubmissions: [
    'appStoreVersionForReview',
    'items',
    'lastUpdatedByActor',
    'submittedByActor',
    'createdByActor',
  ],
  submissionItems: [
    'appCustomProductPageVersion',
    'appEvent',
    'appStoreVersion',
    'appStoreVersionExperiment',
    'backgroundAssetVersion',
    'gameCenterAchievementVersion',
    'gameCenterLeaderboardVersion',
    'gameCenterLeaderboardSetVersion',
    'gameCenterChallengeVersion',
    'gameCenterActivityVersion',
    'inAppPurchaseVersion',
    'subscriptionVersion',
    'subscriptionGroupVersion',
  ],
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
  appMetrics: ['appStoreVersionMetrics', 'betaReviewMetrics', 'reviewSubmissions'],
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
  versionAssets: ['appScreenshotSets', 'appPreviewSets'],
  screenshotSets: ['appScreenshots'],
  previewSets: ['appPreviews'],
  territoryAgeRatings: ['territory'],
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
  // Also the six relationship names a category change writes to — the App Information
  // page asks for exactly this list and PATCHes back into the same names.
  appInfoCategories: [
    'primaryCategory',
    'primarySubcategoryOne',
    'primarySubcategoryTwo',
    'secondaryCategory',
    'secondarySubcategoryOne',
    'secondarySubcategoryTwo',
  ],
  // What the App Information page asks for on load: the categories plus the age-rating
  // declaration. Paired with fields[apps]=isOrEverWasMadeForKids — see listAppInfoPage.
  appInfoPage: [
    'ageRatingDeclaration',
    'app',
    'primaryCategory',
    'primarySubcategoryOne',
    'primarySubcategoryTwo',
    'secondaryCategory',
    'secondarySubcategoryOne',
    'secondarySubcategoryTwo',
  ],
} as const;

/**
 * Page sizes for the records those includes drag along — JSON:API's
 * `limit[relationship]` — copied from the browser with the include lists they pair with.
 * `0` is not "no limit": it asks for the related records to be identified rather than
 * expanded, which is how the review-centre UI avoids pulling every item of every
 * submission just to list them.
 *
 * These are the browser's numbers for the browser's screens, so every call that sends them
 * takes a `sideloads` option to name a different one. The defaults stay as captured.
 */
const SIDELOADS = {
  reviewSubmissions: { items: 0 },
  messages: { rejections: 2000, resolutionCenterMessageAttachments: 1000 },
  draftMessage: { resolutionCenterMessageAttachments: 1000 },
  rejections: { rejectionAttachments: 1000 },
  apps: { displayableVersions: 20 },
  appMetrics: { reviewSubmissions: 10 },
  threads: { appStoreVersions: 2000 },
  version: { appStoreVersionLocalizations: 50 },
  versionAssets: { appScreenshotSets: 50, appPreviewSets: 50 },
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
  appMetrics: {
    apps: ['appStoreVersionMetrics', 'betaReviewMetrics', 'reviewSubmissions'],
    appStoreVersionMetrics: ['messageCount'],
    betaReviewMetrics: ['messageCount', 'platform'],
    reviewSubmissions: ['state'],
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
  appInfoPage: { apps: ['isOrEverWasMadeForKids'] },
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

export const OPEN_SUBMISSION_STATES = [
  'READY_FOR_REVIEW',
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'UNRESOLVED_ISSUES',
  'CANCELING',
  'COMPLETING',
] as const;

/** Review submissions for an app. Defaults to the states the review-centre UI shows. */
export function listReviewSubmissions(
  session: Session,
  appId: string,
  options: {
    include?: readonly string[];
    states?: readonly string[];
    limit?: number;
    sideloads?: SideloadLimits<typeof SIDELOADS.reviewSubmissions>;
  } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/reviewSubmissions`, {
    include: includeList(INCLUDES.reviewSubmissions, options.include),
    limit: options.limit ?? 2000,
    ...sideloadLimits(SIDELOADS.reviewSubmissions, options.sideloads),
    'filter[state]': [...(options.states ?? OPEN_SUBMISSION_STATES)],
  });
}

/** One submission on its own, without going via the app. */
export function getReviewSubmission(
  session: Session,
  submissionId: string,
  options: { include?: readonly string[]; sideloads?: SideloadLimits<typeof SIDELOADS.reviewSubmissions> } = {}
): Promise<Document<Resource>> {
  return get(session, `reviewSubmissions/${submissionId}`, {
    include: includeList(INCLUDES.reviewSubmissions, options.include),
    ...sideloadLimits(SIDELOADS.reviewSubmissions, options.sideloads),
  });
}

/** The individual things (version, IAPs, events...) bundled into one submission. */
export function listSubmissionItems(
  session: Session,
  submissionId: string,
  options: { include?: readonly string[]; limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, `reviewSubmissions/${submissionId}/items`, {
    include: includeList(INCLUDES.submissionItems, options.include),
    limit: options.limit ?? 200,
  });
}

/** The Resolution Center conversation: Apple's messages and yours, oldest first. */
export function listMessages(
  session: Session,
  threadId: string,
  options: { include?: readonly string[]; sideloads?: SideloadLimits<typeof SIDELOADS.messages> } = {}
): Promise<Document<Resource[]>> {
  return get(session, `resolutionCenterThreads/${threadId}/resolutionCenterMessages`, {
    include: includeList(INCLUDES.messages, options.include),
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
 */
export function listAppMetrics(
  session: Session,
  options: {
    include?: readonly string[];
    limit?: number;
    sideloads?: SideloadLimits<typeof SIDELOADS.appMetrics>;
    fields?: Fieldsets<typeof FIELDSETS.appMetrics>;
  } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'apps', {
    include: includeList(INCLUDES.appMetrics, options.include),
    limit: options.limit ?? 200,
    'filter[removed]': false,
    ...fieldsets(FIELDSETS.appMetrics, options.fields),
    ...sideloadLimits(SIDELOADS.appMetrics, options.sideloads),
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
 * the header runs on. The cheap way to find a version id when there is no open submission
 * to take one from; `getVersion` has the rest.
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

/** What `redactReviewDetails` blanks, and what `--reveal` keeps. */
export const REVIEW_DETAIL_SECRETS = ['demoAccountPassword'] as const;

/**
 * Blanks the demo account password. Every command here prints to stdout, and a live
 * credential sitting in terminal scrollback is a worse problem than having to ask for it.
 * The account name is left alone — it's the pair that's the credential, and knowing which
 * account Apple was given is usually the point.
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
 * Every locale of a version with its screenshot and preview sets already attached — the
 * form the version page itself uses. One request, where going via the localization list
 * and then asking for each locale's sets costs one per locale.
 */
export function listVersionLocalizationsWithAssets(
  session: Session,
  versionId: string,
  options: { include?: readonly string[]; sideloads?: SideloadLimits<typeof SIDELOADS.versionAssets> } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'appStoreVersionLocalizations', {
    'filter[appStoreVersion]': versionId,
    include: includeList(INCLUDES.versionAssets, options.include),
    ...sideloadLimits(SIDELOADS.versionAssets, options.sideloads),
  });
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
 * App-level metadata records. Name and subtitle live here rather than on the version,
 * which matters: they are usually what a 4.1 metadata rejection is about.
 */
export function listAppInfos(session: Session, appId: string): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/appInfos`);
}

/** Per-locale name and subtitle. */
export function listAppInfoLocalizations(session: Session, appInfoId: string): Promise<Document<Resource[]>> {
  return get(session, `appInfos/${appInfoId}/appInfoLocalizations`);
}

/** An app info record in this state is the one on the store, not the one you're editing. */
const LIVE_APP_INFO_STATE = 'READY_FOR_DISTRIBUTION';

/**
 * The app info record that can actually be changed.
 *
 * An app on the store has two: the live one and the one being prepared alongside the
 * version in review. **The live one is listed first**, and writing to it is refused with
 * `409 ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE` — "The field 'subtitle' can not be
 * modified in the current state" — so taking the first record is taking the wrong one.
 * Reads are worth pointing here too: the live record still says whatever the store says,
 * not the name you edited this morning.
 *
 * An app that has never shipped has one record, in an editable state, and it is returned.
 */
export async function findEditableAppInfo(session: Session, appId: string): Promise<Resource> {
  return pickEditableAppInfo((await listAppInfos(session, appId)).data, appId);
}

/**
 * The same choice made against records already in hand — `listAppInfoPage` returns both
 * with everything hanging off them, and re-fetching to pick between them would be a
 * second request for an answer already on the table.
 */
export function pickEditableAppInfo(appInfos: readonly Resource[], appId: string): Resource {
  if (!appInfos.length) throw new Error(`App ${appId} has no appInfo record`);

  const editable = appInfos.filter((one) => one.attributes?.state !== LIVE_APP_INFO_STATE);
  if (editable.length > 1) {
    const states = editable.map((one) => `${one.id} (${String(one.attributes?.state)})`).join(', ');
    log.warn('appInfo.ambiguous', { appId, candidates: states });
  }

  return editable[0] ?? appInfos[0]!;
}

/**
 * The six category slots on an app info record: a primary and a secondary App Store
 * category, each with two subcategory slots that only the games categories populate.
 */
export const APP_CATEGORY_SLOTS = INCLUDES.appInfoCategories;

export type AppCategorySlot = (typeof APP_CATEGORY_SLOTS)[number];

/**
 * Categories are relationships, not attributes, and the category's name *is* the resource
 * id — `{"type":"appCategories","id":"GAMES_TRIVIA"}`. Omitted slots are left alone; a
 * `null` clears one.
 */
export type AppCategoryUpdate = Partial<Record<AppCategorySlot, string | null>>;

/**
 * One app info record with its categories resolved, as the App Information page reads
 * them. Point it at `findEditableAppInfo`: the live record answers with the categories the
 * store shows, not the ones being prepared.
 */
export function getAppInfoCategories(
  session: Session,
  appInfoId: string,
  options: { include?: readonly string[] } = {}
): Promise<Document<Resource>> {
  return get(session, `appInfos/${appInfoId}`, { include: includeList(APP_CATEGORY_SLOTS, options.include) });
}

/**
 * Changes an app's App Store categories — the App Information page's Save button, which
 * was recorded sending this PATCH with only the slots it changed in it.
 *
 * Two things in here go beyond the recording and are guesses, not evidence. The capture
 * set `primaryCategory`, `secondaryCategory` and both primary subcategories; the
 * `secondarySubcategoryOne`/`Two` names come from the include list the same page sends,
 * and are assumed to write the way their primary twins do. Clearing a slot with `null` was
 * never recorded here either — it is the form `setVersionBuild` uses to detach a build,
 * which was.
 *
 * Categories belong to the app, not a version, so a change is live as soon as it lands —
 * the same `409 ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE` guards the live record.
 */
export function setAppCategories(
  session: Session,
  appInfoId: string,
  update: AppCategoryUpdate
): Promise<Document<Resource>> {
  const relationships: Record<string, { data: ResourceIdentifier | null }> = {};
  for (const slot of APP_CATEGORY_SLOTS) {
    const category = update[slot];
    if (category === undefined) continue;
    relationships[slot] = { data: category === null ? null : { type: 'appCategories', id: category } };
  }
  if (!Object.keys(relationships).length) throw new Error('No categories to change');

  return audited('appInfo.categories.set', { appInfoId, ...update }, () =>
    patch(session, `appInfos/${appInfoId}`, { data: { type: 'appInfos', id: appInfoId, relationships } })
  );
}

/**
 * Everything the App Information page loads in one request: both app info records with
 * their categories and their age-rating declarations, and the app narrowed to the one
 * field that page reads off it.
 */
export function listAppInfoPage(
  session: Session,
  appId: string,
  options: { include?: readonly string[]; fields?: Fieldsets<typeof FIELDSETS.appInfoPage> } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/appInfos`, {
    include: includeList(INCLUDES.appInfoPage, options.include),
    ...fieldsets(FIELDSETS.appInfoPage, options.fields),
  });
}

/**
 * The ratings Apple derives from the questionnaire, one per territory. Read-only: they
 * are an output of `setAgeRating`, not something to write.
 *
 * The limit of 500 is the browser's own, and comfortably above the number of App Store
 * territories — raise it if Apple ever starts returning more than one row each.
 */
export function listTerritoryAgeRatings(
  session: Session,
  appInfoId: string,
  options: { include?: readonly string[]; limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, `appInfos/${appInfoId}/territoryAgeRatings`, {
    include: includeList(INCLUDES.territoryAgeRatings, options.include),
    limit: options.limit ?? 500,
  });
}

/**
 * The questions the recorded body carried, in the order it carried them.
 *
 * **This is one app's questionnaire, not the questionnaire.** It came off a single
 * recording on a single account, and nothing observed here says every app is asked the same
 * set — a made-for-kids app, a different storefront or a schema change would all show up as
 * a different set of attributes. So this list orders a body; it does not decide what belongs
 * in one. That comes from the declaration Apple returns for the app being edited — see
 * `ageRatingAnswersFrom`.
 *
 * The values are less well evidenced than the names. Every frequency question came back
 * `"NONE"` in the recording, so the scale the public App Store Connect API documents —
 * `INFREQUENT_OR_MILD`, `FREQUENT_OR_INTENSE` — is inferred, not proven. Values are passed
 * through unchecked: one Apple won't take is a 4xx, which beats this client refusing a
 * legitimate answer it has never seen.
 */
export const AGE_RATING_QUESTIONS = [
  'messagingAndChat',
  'sexualContentGraphicAndNudity',
  'gambling',
  'horrorOrFearThemes',
  'parentalControls',
  'advertising',
  'ageRatingOverrideV2',
  'violenceRealisticProlongedGraphicOrSadistic',
  'matureOrSuggestiveThemes',
  'healthOrWellnessTopics',
  'unrestrictedWebAccess',
  'violenceCartoonOrFantasy',
  'kidsAgeBand',
  'medicalOrTreatmentInformation',
  'lootBox',
  'alcoholTobaccoOrDrugUseOrReferences',
  'gamblingSimulated',
  'violenceRealistic',
  'profanityOrCrudeHumor',
  'socialMedia',
  'contests',
  'koreaAgeRatingOverride',
  'ageAssurance',
  'userGeneratedContent',
  'gunsOrOtherWeapons',
  'socialMediaAgeRestricted',
  'gracRatingClassificationNumber',
  'developerAgeRatingInfoUrl',
  'sexualContentOrNudity',
] as const;

/** One answer, as iris carries it: a choice, a yes/no, a number or unanswered. */
export type AgeRatingAnswer = string | boolean | number | null;

/** A whole questionnaire — whichever questions this app's declaration carries. */
export type AgeRatingAnswers = Record<string, AgeRatingAnswer>;

function isAnswer(value: unknown): value is AgeRatingAnswer {
  return value === null || ['string', 'boolean', 'number'].includes(typeof value);
}

/**
 * Rebuilds a body in the recorded order: the questions that were in the recording first, in
 * its order, then anything else in the order Apple listed it.
 *
 * Key order means nothing to a JSON parser, so this buys no correctness — it keeps the body
 * this client sends byte-identical to the recorded one for an app asked the same questions,
 * which is what makes that comparison worth running at all.
 */
function inRecordedOrder(answers: AgeRatingAnswers): AgeRatingAnswers {
  const ordered: AgeRatingAnswers = {};
  for (const question of AGE_RATING_QUESTIONS) {
    if (question in answers) ordered[question] = answers[question];
  }
  for (const [question, value] of Object.entries(answers)) {
    if (!(question in ordered)) ordered[question] = value;
  }
  return ordered;
}

/**
 * The questionnaire as it stands on a declaration Apple returned, and the definition of
 * which questions this app has. Takes the declaration's attributes — the JSON:API `type`
 * and `id` are the caller's to strip, since it is the one that knows how the record reached
 * it.
 *
 * An attribute that isn't a scalar is an error rather than something to drop: the whole
 * questionnaire is resent on every save, so anything quietly discarded here is an answer
 * quietly removed there.
 */
export function ageRatingAnswersFrom(attributes: Record<string, unknown>): AgeRatingAnswers {
  const answers: AgeRatingAnswers = {};
  for (const [question, value] of Object.entries(attributes)) {
    if (!isAnswer(value)) {
      throw new Error(`Age-rating answer ${question} came back as something other than a scalar`);
    }
    answers[question] = value;
  }

  if (!Object.keys(answers).length) {
    throw new Error('The age-rating declaration came back with no answers on it');
  }

  return inRecordedOrder(answers);
}

/**
 * Narrows a hand-written or piped-in questionnaire against the one Apple currently holds.
 *
 * `asked` is that current declaration, and it — not a list baked in here — is what decides
 * which questions exist. The recording is one app's; an app asked a different set would
 * otherwise be unable to read its own answers back, let alone write them.
 *
 * Every question has to be answered. The browser resends all of them on every save and no
 * partial body was ever recorded, so whether an omitted answer is left alone or cleared is
 * unknown, and refusing an incomplete object is the only reading that can't silently wipe
 * one. Names Apple didn't ask for are refused for the mirror-image reason: on a private API
 * a typo would otherwise be sent and, at best, ignored.
 */
export function parseAgeRatingAnswers(input: unknown, asked: AgeRatingAnswers): AgeRatingAnswers {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Expected a JSON object of age-rating answers');
  }

  const given = input as Record<string, unknown>;
  const unknownNames = Object.keys(given).filter((name) => !(name in asked));
  if (unknownNames.length) {
    throw new Error(
      `Not questions this app was asked: ${unknownNames.join(', ')}. ` +
        'Start from "asc age-rating", which prints the current answers in this shape.'
    );
  }

  const answers: AgeRatingAnswers = {};
  const missing: string[] = [];
  for (const question of Object.keys(asked)) {
    const value = given[question];
    if (value === undefined) {
      missing.push(question);
      continue;
    }
    if (!isAnswer(value)) {
      throw new Error(`${question} must be a string, boolean, number or null`);
    }
    answers[question] = value;
  }

  if (missing.length) {
    throw new Error(
      `Every question has to be answered — missing ${missing.length}: ${missing.join(', ')}. ` +
        'Start from "asc age-rating", which prints the current answers in this shape.'
    );
  }

  return inRecordedOrder(answers);
}

/**
 * Saves the age-rating questionnaire — the App Information page's Save button, recorded
 * sending all of these attributes in one body whether they changed or not.
 *
 * The declaration hangs off the app info record, so the editable record's declaration is
 * the one to write to. Apple recomputes the per-territory ratings from it; read them back
 * with `listTerritoryAgeRatings`.
 */
export function setAgeRating(
  session: Session,
  declarationId: string,
  answers: AgeRatingAnswers
): Promise<Document<Resource>> {
  return audited('ageRating.set', { declarationId }, () =>
    patch(session, `ageRatingDeclarations/${declarationId}`, {
      data: { type: 'ageRatingDeclarations', id: declarationId, attributes: answers },
    })
  );
}

/**
 * Whether the app uses third-party content its publisher has the rights to. This one sits
 * on the app itself rather than an app info record, so there is no editable-versus-live
 * choice to make.
 *
 * Only `DOES_NOT_USE_THIRD_PARTY_CONTENT` was captured. `USES_THIRD_PARTY_CONTENT` is the
 * public App Store Connect API's other value and is not proven here, so the declaration is
 * passed through as given rather than checked against a list.
 */
export function setContentRights(
  session: Session,
  appId: string,
  declaration: string
): Promise<Document<Resource>> {
  return audited('app.contentRights.set', { appId, declaration }, () =>
    patch(session, `apps/${appId}`, {
      data: { type: 'apps', id: appId, attributes: { contentRightsDeclaration: declaration } },
    })
  );
}

/**
 * Per-locale version metadata: description, keywords, promo text, what's new.
 * Not in the captured requests — found by probing, and it's the bridge from a version to
 * its screenshot sets.
 */
export function listVersionLocalizations(session: Session, versionId: string): Promise<Document<Resource[]>> {
  return get(session, `appStoreVersions/${versionId}/appStoreVersionLocalizations`);
}

/**
 * The two halves of App Store metadata, and which resource each field lives on. Every
 * name here was read off a captured response, so the spelling is Apple's; what isn't
 * captured is the PATCH that writes the version half — see `setMetadataField`.
 *
 * The split matters when a 4.1 rejection names a field: `name` and `subtitle` belong to
 * the app info record and change for the whole app, while a description or keyword list
 * belongs to one version and only ships when that version does.
 */
export const METADATA_FIELDS = {
  appStoreVersionLocalizations: [
    'description',
    'keywords',
    'promotionalText',
    'whatsNew',
    'marketingUrl',
    'supportUrl',
  ],
  appInfoLocalizations: [
    'name',
    'subtitle',
    'privacyPolicyUrl',
    'privacyPolicyText',
    'privacyChoicesUrl',
  ],
} as const;

export type MetadataResource = keyof typeof METADATA_FIELDS;

/** Which of the two resources owns a field, or undefined if it isn't one we know. */
export function metadataResourceFor(field: string): MetadataResource | undefined {
  for (const [resource, fields] of Object.entries(METADATA_FIELDS)) {
    if ((fields as readonly string[]).includes(field)) return resource as MetadataResource;
  }
  return undefined;
}

/** One editable field, located: which record holds it, and what it says now. */
export interface MetadataField {
  field: string;
  locale: string;
  resource: MetadataResource;
  localizationId: string;
  current: string | null;
}

/**
 * Finds the record a field lives on, for one locale, and reads its current value.
 *
 * Both halves have to be searched by locale rather than addressed directly: the ids are
 * per-locale and never shown in the UI. A locale the app doesn't have is an error here
 * rather than a silently created one — adding a language is a bigger decision than editing
 * a line of text, and isn't what `set-metadata` is for.
 */
export async function findMetadataField(
  session: Session,
  target: { appId: string; versionId: string; locale: string; field: string }
): Promise<MetadataField> {
  const { appId, versionId, locale, field } = target;
  const resource = metadataResourceFor(field);
  if (!resource) {
    const known = [...METADATA_FIELDS.appInfoLocalizations, ...METADATA_FIELDS.appStoreVersionLocalizations];
    throw new Error(`Unknown metadata field "${field}". Try one of: ${known.join(', ')}`);
  }

  let localizations: Resource[];
  if (resource === 'appStoreVersionLocalizations') {
    localizations = (await listVersionLocalizations(session, versionId)).data;
  } else {
    localizations = (await listAppInfoLocalizations(session, (await findEditableAppInfo(session, appId)).id)).data;
  }

  const found = localizations.find((one) => one.attributes?.locale === locale);
  if (!found) {
    const have = localizations.map((one) => String(one.attributes?.locale)).join(', ');
    throw new Error(`No ${locale} localization to edit. This app has: ${have || 'none'}`);
  }

  const current = found.attributes?.[field];
  return {
    field,
    locale,
    resource,
    localizationId: found.id,
    current: typeof current === 'string' ? current : null,
  };
}

/**
 * Writes one metadata field.
 *
 * **The app info half is captured; the version half is not.** A Save on the App
 * Information page was recorded sending exactly this: `PATCH appInfoLocalizations/{id}`,
 * plain `application/json`, `{data:{type,id,attributes}}` carrying only the edited fields.
 * The browser sent `name` and `subtitle` together where this writes one at a time, which
 * is a subset of that body rather than a different shape.
 *
 * The `appStoreVersionLocalizations` PATCH has never been recorded. Its shape is the
 * captured version PATCH's — same envelope, same `application/json`, same habit of sending
 * only what changed — pointed at a localization, and the field names come from real
 * responses. The version page's Save button is what sends both, and the app info capture
 * now shows that envelope working against a localization. Still a good guess rather than a
 * certainty; the failure mode is a 4xx, not a wrong edit.
 *
 * The old value is not recoverable from Apple once this returns, which is why the CLI
 * prints it before asking. Changing a version's metadata doesn't reach the store until the
 * version ships; changing the app info's name or subtitle applies to the app itself.
 */
export function setMetadataField(
  session: Session,
  field: MetadataField,
  value: string
): Promise<Document<Resource>> {
  return audited(
    'metadata.set',
    { resource: field.resource, localizationId: field.localizationId, field: field.field, locale: field.locale },
    () =>
      patch<Document<Resource>>(session, `${field.resource}/${field.localizationId}`, {
        data: {
          type: field.resource,
          id: field.localizationId,
          attributes: { [field.field]: value },
        },
      })
  );
}

/** Screenshots for one localization of a version — the metadata behind 4.1/2.3 rejections. */
export function listScreenshotSets(
  session: Session,
  localizationId: string,
  options: { include?: readonly string[] } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'appScreenshotSets', {
    include: includeList(INCLUDES.screenshotSets, options.include),
    'filter[appStoreVersionLocalization]': localizationId,
  });
}

/**
 * App preview videos for one localization — the moving counterpart to the screenshot
 * sets, and subject to the same 4.1/2.3 objections. Worth asking for separately:
 * `listVersionLocalizationsWithAssets` names a locale's preview sets but not what is
 * inside them.
 */
export function listPreviewSets(
  session: Session,
  localizationId: string,
  options: { include?: readonly string[] } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'appPreviewSets', {
    include: includeList(INCLUDES.previewSets, options.include),
    'filter[appStoreVersionLocalization]': localizationId,
  });
}

/**
 * Most iris writes send application/vnd.api+json — the asset endpoints and the Resolution
 * Center drafts both do. The version PATCH behind `updateVersion` is the odd one out and
 * sends plain application/json. Both were copied from the browser rather than reasoned about.
 */
const VND_API_CONTENT_TYPE = 'application/vnd.api+json';

/**
 * Creates an empty screenshot set for one device size on one locale. Only needed when
 * the locale has no set for that size yet — otherwise upload straight into the existing
 * set id from `listScreenshotSets`.
 */
export function createScreenshotSet(
  session: Session,
  localizationId: string,
  displayType: string
): Promise<Document<Resource>> {
  return post(
    session,
    'appScreenshotSets',
    {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: 'appStoreVersionLocalizations', id: localizationId },
          },
        },
      },
    },
    VND_API_CONTENT_TYPE
  );
}

/**
 * Step one of an upload: reserve a slot for a file of this name and size. No bytes yet —
 * the response carries the `uploadOperations` saying where to put them.
 */
export function reserveScreenshot(
  session: Session,
  setId: string,
  fileName: string,
  fileSize: number
): Promise<Document<Resource>> {
  return post(
    session,
    'appScreenshots',
    {
      data: {
        type: 'appScreenshots',
        attributes: { fileSize, fileName },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
      },
    },
    VND_API_CONTENT_TYPE
  );
}

/**
 * Step three: tell iris the bytes are all there. Until this lands the screenshot exists
 * as an empty reservation and doesn't show up on the version page.
 */
export function completeScreenshot(session: Session, screenshotId: string): Promise<Document<Resource>> {
  return patch(
    session,
    `appScreenshots/${screenshotId}`,
    { data: { type: 'appScreenshots', id: screenshotId, attributes: { uploaded: true } } },
    VND_API_CONTENT_TYPE
  );
}

/** Removes a screenshot. Not in any capture — the shape was probed and works. */
export function deleteScreenshot(session: Session, screenshotId: string): Promise<void> {
  return audited('screenshot.delete', { screenshotId }, () =>
    del<void>(session, `appScreenshots/${screenshotId}`)
  );
}

/** Removes a whole set, screenshots and all. Probed, like `deleteScreenshot`. */
export function deleteScreenshotSet(session: Session, setId: string): Promise<void> {
  return audited('screenshotSet.delete', { setId }, () =>
    del<void>(session, `appScreenshotSets/${setId}`)
  );
}

/**
 * The set for one device size on one locale, if it exists.
 *
 * Goes via the localization rather than the set id because iris has no GET for a single
 * appScreenshotSet — `appScreenshotSets/{id}` 404s even for a set that demonstrably
 * exists, and filtering appScreenshots by set is refused outright with a 403. The
 * collection filtered by localization is the only way in.
 */
export async function findScreenshotSet(
  session: Session,
  localizationId: string,
  displayType: string
): Promise<Resource | undefined> {
  const document = await listScreenshotSets(session, localizationId);
  return document.data.find((set) => set.attributes?.screenshotDisplayType === displayType);
}

export interface UploadScreenshotOptions {
  localizationId: string;
  displayType: string;
  filePath: string;
  /** Upload even if the pre-flight checks object. */
  force?: boolean;
}

/**
 * The whole add-a-screenshot flow: check, reserve, send the parts, commit.
 *
 * The set is created if the locale doesn't have one for that device size yet. Apple
 * splits large files across several presigned URLs, so the operations are replayed in
 * order rather than assumed to be a single PUT.
 */
export async function uploadScreenshot(
  session: Session,
  options: UploadScreenshotOptions
): Promise<Resource> {
  const { localizationId, displayType, filePath, force } = options;
  const fileName = basename(filePath);

  const file = readFileSync(filePath);
  const size = readImageSize(file);
  const existingSet = await findScreenshotSet(session, localizationId, displayType);

  // Counted from the set we just read; a set that doesn't exist yet is empty by definition.
  const existing = existingSet
    ? ((existingSet.relationships?.appScreenshots?.data as unknown[] | undefined) ?? []).length
    : 0;

  const problems = checkScreenshot({ displayType, size, existing });
  for (const problem of problems) {
    log.warn('screenshot.check', { fileName, displayType, problem, forced: Boolean(force) });
  }
  if (problems.length && !force) {
    throw new Error(
      `Not uploading ${fileName}: ${problems.join('; ')}. Pass --force to upload anyway.`
    );
  }

  return audited(
    'screenshot.upload',
    {
      localizationId,
      displayType,
      fileName,
      fileSize: file.length,
      dimensions: size && `${size.width} × ${size.height}`,
      existingInSet: existing,
      forced: problems.length ? true : undefined,
    },
    async () => {
      const setId =
        existingSet?.id ?? (await createScreenshotSet(session, localizationId, displayType)).data.id;

      const reserved = await reserveScreenshot(session, setId, fileName, file.length);
      const screenshot = reserved.data;
      const operations = (screenshot.attributes?.uploadOperations ?? []) as UploadOperation[];
      if (!operations.length) {
        throw new Error(
          `Reservation ${screenshot.id} came back with no uploadOperations — nowhere to send the file`
        );
      }

      log.info('screenshot.reserved', { screenshotId: screenshot.id, setId, parts: operations.length });

      for (const operation of operations) await uploadPart(operation, file);

      const done = await completeScreenshot(session, screenshot.id);
      return done.data;
    }
  );
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
 * size. The response carries the `uploadOperations` saying where the bytes go — the same
 * reserve/upload/commit dance as screenshots, against a different resource.
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
 * Removes an attachment from a draft. Not in any capture — the shape was probed, like
 * `deleteScreenshot`, and works on an attachment that has been uploaded.
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
 * The submission an item belongs to, read out of the item's own id.
 *
 * Item ids are base64 of `{submissionId}|{n}|{appId}` — a uuid, an index, a numeric app id. The
 * browser never decodes them and Apple never promised the format, so this is a guess and
 * treated as one: anything that doesn't come back as a leading UUID gives `undefined`
 * rather than a wrong answer. Worth having because a direct
 * `GET reviewSubmissionItems/{id}` is refused with a 403, so the parent is the only way in.
 */
export function submissionIdFromItemId(itemId: string): string | undefined {
  const [first] = Buffer.from(itemId, 'base64').toString('utf8').split('|');
  return first && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(first) ? first : undefined;
}

/** Every item of the submission an item id points at, or nothing if the id won't decode. */
export async function findSubmissionItems(
  session: Session,
  itemId: string
): Promise<Document<Resource[]> | undefined> {
  const submissionId = submissionIdFromItemId(itemId);
  return submissionId ? listSubmissionItems(session, submissionId) : undefined;
}

/**
 * Marks one item of a submission as fixed — the "resolved" step on a submission sitting in
 * `UNRESOLVED_ISSUES`. **Also irreversible:** the item goes straight to `READY_FOR_REVIEW`
 * and back into Apple's queue, and there is no un-resolve.
 *
 * Copied from a recording of one real resolve. The response carries the new state; the parent
 * submission's own state lags a moment behind, so re-read it rather than trusting the
 * `UNRESOLVED_ISSUES` you may still see immediately afterwards.
 */
export function resolveSubmissionItem(session: Session, itemId: string): Promise<Document<Resource>> {
  return audited('submission.item.resolve', { itemId }, () =>
    patch<Document<Resource>>(
      session,
      `reviewSubmissionItems/${itemId}`,
      { data: { type: 'reviewSubmissionItems', id: itemId, attributes: { resolved: true } } },
      VND_API_CONTENT_TYPE
    )
  );
}

/**
 * Submitting a version for review.
 *
 * **Read this before using it.** Nothing below was captured. Every other write in this
 * file was copied from App Store Connect doing the thing; these four were not, because no
 * recording of the Submit button exists. What they are built on:
 *
 * - Apple's *public* App Store Connect API documents this exact flow on these exact
 *   resource names — create a `reviewSubmissions`, add `reviewSubmissionItems` to it,
 *   PATCH `submitted: true`.
 * - iris demonstrably shares that model: `reviewSubmissions`, `reviewSubmissionItems` and
 *   `items` all read back the way the public API describes, and the `resolved` attribute
 *   we *did* capture is the public API's documented attribute, spelled the same way.
 *
 * That is a good reason to expect these to work and not a reason to be sure. The realistic
 * failure is a 4xx; the unpleasant one is a half-made submission left on the account, so
 * `runSubmission` stops at the first error and says where it got to. Record the Submit
 * button once and this can be replaced with something certain.
 */

/**
 * Starts an empty review submission for an app. Nothing is in front of Apple yet.
 *
 * The platform is required rather than defaulted: a submission is per-platform, and an
 * assumed one would put a Mac or tvOS version into an iOS submission on someone else's
 * account. `planSubmission` reads it off the version.
 */
export function createReviewSubmission(
  session: Session,
  appId: string,
  platform: string
): Promise<Document<Resource>> {
  return audited('submission.create', { appId, platform }, () =>
    post<Document<Resource>>(
      session,
      'reviewSubmissions',
      {
        data: {
          type: 'reviewSubmissions',
          attributes: { platform },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      },
      VND_API_CONTENT_TYPE
    )
  );
}

/** Puts a version into a submission — the "add for review" step. Still not submitted. */
export function addSubmissionItem(
  session: Session,
  submissionId: string,
  versionId: string
): Promise<Document<Resource>> {
  return audited('submission.item.add', { submissionId, versionId }, () =>
    post<Document<Resource>>(
      session,
      'reviewSubmissionItems',
      {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
          },
        },
      },
      VND_API_CONTENT_TYPE
    )
  );
}

/**
 * Hands the submission to App Review. **This is the irreversible one** — everything before
 * it is a draft you can throw away, and this is the step that starts the review.
 *
 * `cancelReviewSubmission` is the nearest thing to an undo, and only while Apple hasn't
 * started looking.
 */
export function submitReviewSubmission(session: Session, submissionId: string): Promise<Document<Resource>> {
  return audited('submission.submit', { submissionId }, () =>
    patch<Document<Resource>>(
      session,
      `reviewSubmissions/${submissionId}`,
      { data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } } },
      VND_API_CONTENT_TYPE
    )
  );
}

/** Withdraws a submission from the queue. Once review has started this is refused. */
export function cancelReviewSubmission(session: Session, submissionId: string): Promise<Document<Resource>> {
  return audited('submission.cancel', { submissionId }, () =>
    patch<Document<Resource>>(
      session,
      `reviewSubmissions/${submissionId}`,
      { data: { type: 'reviewSubmissions', id: submissionId, attributes: { canceled: true } } },
      VND_API_CONTENT_TYPE
    )
  );
}

/** What `submit` would do, worked out before anything is written. */
export interface SubmissionPlan {
  appId: string;
  versionId: string;
  versionString?: string;
  platform: string;
  /** An unsubmitted submission to reuse. Absent means one has to be created. */
  submissionId?: string;
  /** The item for this version, if it's already on that submission. */
  itemId?: string;
  /** A submission already in front of Apple — the reason not to make another. */
  inFlight?: { id: string; state: string };
}

/**
 * Works out the three steps without taking any of them: which of create / add / submit are
 * actually needed for this version.
 *
 * Existing submissions are reused rather than duplicated, because App Store Connect only
 * carries one open submission per platform and a second POST would either fail or make a
 * mess. A submission that has already gone to Apple stops the plan instead — resubmitting
 * over the top of one in review is not a thing this should do quietly.
 */
export async function planSubmission(
  session: Session,
  appId: string,
  versionId: string
): Promise<SubmissionPlan> {
  const version = (await getVersion(session, versionId)).data;
  // Not defaulted to IOS: everything below is per-platform, and guessing would mean
  // reusing or creating a submission on the wrong one.
  const platform = version.attributes?.platform;
  if (typeof platform !== 'string' || !platform) {
    throw new Error(`Version ${versionId} came back without a platform — cannot plan a submission for it`);
  }

  const plan: SubmissionPlan = {
    appId,
    versionId,
    versionString: version.attributes?.versionString as string | undefined,
    platform,
  };

  // Matched strictly, and one with no platform at all is reported rather than assumed to
  // be this one — the cost of getting that wrong is reusing another platform's submission.
  const all = (await listReviewSubmissions(session, appId)).data;
  const unplaced = all.filter((one) => typeof one.attributes?.platform !== 'string');
  if (unplaced.length) {
    log.warn('submission.platformMissing', { appId, ids: unplaced.map((one) => one.id) });
  }
  const submissions = all.filter((one) => one.attributes?.platform === platform);

  // "Not yet submitted" is the pair: still READY_FOR_REVIEW and never given a submitted
  // date. Either on its own would misread a submission Apple has already seen.
  const open = submissions.find(
    (one) => one.attributes?.state === 'READY_FOR_REVIEW' && !one.attributes?.submittedDate
  );
  const sent = submissions.find((one) => one !== open);

  if (open) {
    plan.submissionId = open.id;
    const items = (await listSubmissionItems(session, open.id)).data;
    plan.itemId = items.find(
      (item) => item.relationships?.appStoreVersion?.data &&
        !Array.isArray(item.relationships.appStoreVersion.data) &&
        item.relationships.appStoreVersion.data.id === versionId
    )?.id;
  } else if (sent) {
    plan.inFlight = { id: sent.id, state: String(sent.attributes?.state ?? 'unknown') };
  }

  return plan;
}

/**
 * Carries out a plan: create if needed, add the version if needed, then submit.
 *
 * Each step is logged as it lands, so a run that dies in the middle leaves a record of
 * exactly how far it got — which matters more here than usual, since the half-finished
 * state is a real submission sitting on the account.
 */
export async function runSubmission(session: Session, plan: SubmissionPlan): Promise<Resource> {
  if (plan.inFlight) {
    throw new Error(
      `Submission ${plan.inFlight.id} is already with Apple (${plan.inFlight.state}). ` +
        'Cancel it first if you mean to replace it.'
    );
  }

  const submissionId =
    plan.submissionId ?? (await createReviewSubmission(session, plan.appId, plan.platform)).data.id;
  if (!plan.submissionId) log.info('submission.created', { submissionId, appId: plan.appId });

  if (!plan.itemId) {
    const item = (await addSubmissionItem(session, submissionId, plan.versionId)).data;
    log.info('submission.item.added', { submissionId, itemId: item.id, versionId: plan.versionId });
  }

  return (await submitReviewSubmission(session, submissionId)).data;
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
