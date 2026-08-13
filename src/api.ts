import { Session } from './session';
import { get, Query } from './http';
import { Document, Resource } from './jsonapi';

/**
 * Include lists lifted verbatim from the browser's own requests. The iris API is
 * undocumented and picky: asking for an include it doesn't recognise 400s the whole
 * request, so these stay as-is unless verified against a live call.
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
} as const;

export const OPEN_SUBMISSION_STATES = [
  'READY_FOR_REVIEW',
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'UNRESOLVED_ISSUES',
  'CANCELING',
  'COMPLETING',
] as const;

export type SubmissionState = (typeof OPEN_SUBMISSION_STATES)[number];

/** Review submissions for an app. Defaults to the states the review-centre UI shows. */
export function listReviewSubmissions(
  session: Session,
  appId: string,
  options: { states?: readonly string[]; limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/reviewSubmissions`, {
    include: [...INCLUDES.reviewSubmissions],
    limit: options.limit ?? 2000,
    'limit[items]': 0,
    'filter[state]': [...(options.states ?? OPEN_SUBMISSION_STATES)],
  });
}

/** The individual things (version, IAPs, events...) bundled into one submission. */
export function listSubmissionItems(
  session: Session,
  submissionId: string,
  options: { limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, `reviewSubmissions/${submissionId}/items`, {
    include: [...INCLUDES.submissionItems],
    limit: options.limit ?? 200,
  });
}

/** The Resolution Center conversation: Apple's messages and yours, oldest first. */
export function listMessages(session: Session, threadId: string): Promise<Document<Resource[]>> {
  return get(session, `resolutionCenterThreads/${threadId}/resolutionCenterMessages`, {
    include: [...INCLUDES.messages],
    'limit[rejections]': 2000,
    'limit[resolutionCenterMessageAttachments]': 1000,
  });
}

/** The unsent reply sitting in the thread's draft box, if there is one. */
export function getDraftMessage(session: Session, threadId: string): Promise<Document<Resource | null>> {
  return get(session, `resolutionCenterThreads/${threadId}/resolutionCenterDraftMessage`, {
    include: [...INCLUDES.draftMessage],
    'limit[resolutionCenterMessageAttachments]': 1000,
  });
}

/** Guideline rejections attached to a thread — the actionable part of a rejection. */
export function listRejections(
  session: Session,
  threadId: string,
  options: { limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'reviewRejections', {
    'filter[resolutionCenterMessage.resolutionCenterThread]': threadId,
    include: [...INCLUDES.rejections],
    limit: options.limit ?? 2000,
    'limit[rejectionAttachments]': 1000,
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
export function listApps(session: Session, options: { limit?: number } = {}): Promise<Document<Resource[]>> {
  return get(session, 'apps', {
    include: ['appStoreIcon', 'displayableVersions'],
    limit: options.limit ?? 200,
    'limit[displayableVersions]': 20,
  });
}

export function getApp(session: Session, appId: string): Promise<Document<Resource>> {
  return get(session, `apps/${appId}`, { include: ['gameCenterDetail'] });
}

/** Resolution Center threads on an app, optionally narrowed to one version. */
export function listThreads(
  session: Session,
  appId: string,
  options: { appStoreVersionId?: string; threadTypes?: readonly string[] } = {}
): Promise<Document<Resource[]>> {
  return get(session, `apps/${appId}/resolutionCenterThreads`, {
    include: ['appStoreVersions', 'app', 'appMessageThreadDetail', 'build', 'betaBackgroundAssetReviewSubmission'],
    'limit[appStoreVersions]': 2000,
    'filter[threadType]': [...(options.threadTypes ?? THREAD_TYPES)],
    'filter[appStoreVersion]': options.appStoreVersionId,
  });
}

/** Threads attached to one App Store version, across apps. */
export function listThreadsForVersion(session: Session, versionId: string): Promise<Document<Resource[]>> {
  return get(session, 'resolutionCenterThreads', {
    include: ['appMessageThreadDetail'],
    'filter[appStoreVersion]': versionId,
  });
}

/** Builds behind an App Store version — what Apple actually reviewed. */
export function listBuilds(session: Session, versionId: string): Promise<Document<Resource[]>> {
  return get(session, 'builds', {
    'filter[appStoreVersion]': versionId,
    include: ['icons', 'preReleaseVersion', 'buildBundles'],
  });
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

/**
 * Per-locale version metadata: description, keywords, promo text, what's new.
 * Not in the captured requests — found by probing, and it's the bridge from a version to
 * its screenshot sets.
 */
export function listVersionLocalizations(session: Session, versionId: string): Promise<Document<Resource[]>> {
  return get(session, `appStoreVersions/${versionId}/appStoreVersionLocalizations`);
}

/** Screenshots for one localization of a version — the metadata behind 4.1/2.3 rejections. */
export function listScreenshotSets(session: Session, localizationId: string): Promise<Document<Resource[]>> {
  return get(session, 'appScreenshotSets', {
    include: ['appScreenshots'],
    'filter[appStoreVersionLocalization]': localizationId,
  });
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
