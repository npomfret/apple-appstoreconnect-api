import { basename } from 'path';
import { readFileSync } from 'fs';
import { Session } from './session';
import { del, get, patch, post, uploadPart, Query, UploadOperation } from './http';
import { Document, Resource, ResourceIdentifier } from './jsonapi';
import { checkScreenshot, readImageSize } from './screenshots';
import { audited, log } from './log';

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

/** One submission on its own, without going via the app. */
export function getReviewSubmission(session: Session, submissionId: string): Promise<Document<Resource>> {
  return get(session, `reviewSubmissions/${submissionId}`, {
    include: [...INCLUDES.reviewSubmissions],
    'limit[items]': 0,
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

/**
 * Unread-message counts per app — what the App Store Connect home page badges with.
 * The cheapest way to ask "has Apple said anything anywhere?" without walking threads.
 */
export function listAppMetrics(session: Session, options: { limit?: number } = {}): Promise<Document<Resource[]>> {
  return get(session, 'apps', {
    include: ['appStoreVersionMetrics', 'betaReviewMetrics', 'reviewSubmissions'],
    limit: options.limit ?? 200,
    'filter[removed]': false,
    'fields[apps]': ['appStoreVersionMetrics', 'betaReviewMetrics', 'reviewSubmissions'],
    'fields[appStoreVersionMetrics]': 'messageCount',
    'fields[betaReviewMetrics]': ['messageCount', 'platform'],
    'fields[reviewSubmissions]': 'state',
    'limit[reviewSubmissions]': 10,
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

/**
 * The version page's own view of a version: state, release settings, and the ids of
 * everything hanging off it. The counterpart to `updateVersion`.
 */
export function getVersion(session: Session, versionId: string): Promise<Document<Resource>> {
  return get(session, `appStoreVersions/${versionId}`, {
    include: [...INCLUDES.version],
    'limit[appStoreVersionLocalizations]': 50,
    'fields[apps]': 'isOrEverWasMadeForKids',
    // Empty fieldsets: the UI wants these related records identified, not expanded.
    'fields[appStoreReviewDetails]': '',
    'fields[gameCenterConfigurations]': '',
    'fields[appClipDefaultExperiences]': '',
  });
}

/**
 * The App Review Information panel: who Apple contacts, the demo account the reviewer
 * signs in with, and the notes explaining how to reach the feature under test.
 *
 * Worth reading on any rejection — "we were unable to sign in" or "we couldn't locate
 * the feature" are complaints about this record rather than about the build.
 */
export function getReviewDetails(session: Session, reviewDetailId: string): Promise<Document<Resource>> {
  return get(session, `appStoreReviewDetails/${reviewDetailId}`, {
    include: [...INCLUDES.reviewDetails],
    // The version is wanted as an identifier only, not expanded — as the browser asks.
    'fields[appStoreVersions]': '',
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
  versionId: string
): Promise<Document<Resource[]>> {
  return get(session, 'appStoreVersionLocalizations', {
    'filter[appStoreVersion]': versionId,
    include: ['appScreenshotSets', 'appPreviewSets'],
    'limit[appScreenshotSets]': 50,
    'limit[appPreviewSets]': 50,
  });
}

/**
 * The build a version currently points at — one, or none at all. This filter does not
 * offer the alternatives; `listBuildCandidates` is the one that lists those. Re-read it
 * after `setVersionBuild` to confirm the change landed.
 */
export function listBuilds(session: Session, versionId: string): Promise<Document<Resource[]>> {
  return get(session, 'builds', {
    'filter[appStoreVersion]': versionId,
    include: [...INCLUDES.builds],
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
  options: { platform?: string; limit?: number } = {}
): Promise<Document<Resource[]>> {
  return get(session, 'builds', {
    include: [...INCLUDES.builds],
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
 * App preview videos for one localization — the moving counterpart to the screenshot
 * sets, and subject to the same 4.1/2.3 objections. Worth asking for separately:
 * `listVersionLocalizationsWithAssets` names a locale's preview sets but not what is
 * inside them.
 */
export function listPreviewSets(session: Session, localizationId: string): Promise<Document<Resource[]>> {
  return get(session, 'appPreviewSets', {
    include: ['appPreviews'],
    'filter[appStoreVersionLocalization]': localizationId,
  });
}

/**
 * The asset endpoints send application/vnd.api+json on writes, unlike the version PATCH
 * behind `updateVersion` which sends application/json. Both were copied from the browser.
 */
const ASSET_CONTENT_TYPE = 'application/vnd.api+json';

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
    ASSET_CONTENT_TYPE
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
    ASSET_CONTENT_TYPE
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
    ASSET_CONTENT_TYPE
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
