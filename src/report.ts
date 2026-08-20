import { Session } from './session';
import * as api from './api';
import * as ci from './ci';
import { denormalizeAll, Denormalized } from './jsonapi';

export interface Guideline {
  code: string;
  section: string;
  description: string;
}

export interface Attachment {
  fileName: string;
  fileSize?: number;
  downloadUrl?: string;
}

export interface SubmissionReport {
  /**
   * The submission the thread hangs off, where the report started from one. A report built
   * straight from a thread id has no submission and leaves this out — reading a submission
   * to fill it in would be a call to `apps/{id}/reviewSubmissions`, which Apple serves
   * officially.
   */
  submissionId?: string;
  /**
   * The submission's own state. Absent for the same reason as `submissionId`: reading it
   * would mean an official call.
   */
  state?: string;
  platform?: string;
  version?: string;
  /** Id of the version under review — feed it to `fetchMetadata` or `listBuilds`. */
  versionId?: string;
  submittedDate?: string;
  lastUpdatedDate?: string;
  threadId?: string;
  lastMessageDate?: string;
  lastMessageFromApple?: boolean;
  /** Apple's most recent message, tags stripped. */
  lastAppleMessage?: string;
  guidelines: Guideline[];
  attachments: Attachment[];
  hasDraftReply: boolean;
}

/** Apple sends message bodies as fragments of HTML; the digest wants readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isAppleActor(message: Denormalized): boolean {
  const from = message['fromActor'];
  if (from && typeof from === 'object') {
    const id = (from as { id?: unknown }).id;
    if (typeof id === 'string') return id.toUpperCase().startsWith('APPLE');
  }
  return false;
}

/**
 * A timestamp as a moment in time, or `-Infinity` for one that is missing or won't parse.
 *
 * Apple stamps these with a local UTC offset — `2026-11-01T01:00:00-08:00` — so the text
 * and the instant it names do not sort the same way. Around a daylight-saving change they
 * invert: `01:30:00-07:00` is 08:30Z and `01:00:00-08:00` is 09:00Z, so comparing the
 * strings puts the later one first. That is not a curiosity here — it decides which message
 * is "the latest from Apple" in the digest, and it makes `heldForSeconds` negative.
 *
 * An unusable date sorts to the far past, which is where comparing empty strings put one.
 */
function instant(value: unknown): number {
  const at = Date.parse(String(value ?? ''));
  return Number.isNaN(at) ? -Infinity : at;
}

/** Oldest first. Subtraction won't do: two unusable dates are both `-Infinity`. */
function byInstant(left: unknown, right: unknown): number {
  const a = instant(left);
  const b = instant(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function sortByDateDesc(items: Denormalized[], field: string): Denormalized[] {
  return [...items].sort((a, b) => byInstant(b[field], a[field]));
}

function collectGuidelines(rejections: Denormalized[]): Guideline[] {
  const byCode = new Map<string, Guideline>();

  for (const rejection of rejections) {
    const reasons = rejection['reasons'];
    if (!Array.isArray(reasons)) continue;
    for (const reason of reasons as Array<Record<string, unknown>>) {
      const code = asString(reason['reasonCode']) ?? asString(reason['reasonSection']);
      if (!code || byCode.has(code)) continue;
      byCode.set(code, {
        code,
        section: asString(reason['reasonSection']) ?? code,
        description: asString(reason['reasonDescription']) ?? '',
      });
    }
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

function collectAttachments(messages: Denormalized[]): Attachment[] {
  const byName = new Map<string, Attachment>();

  for (const message of messages) {
    const attachments = message['resolutionCenterMessageAttachments'];
    if (!Array.isArray(attachments)) continue;
    for (const attachment of attachments as Array<Record<string, unknown>>) {
      const fileName = asString(attachment['fileName']);
      if (!fileName || byName.has(fileName)) continue;
      byName.set(fileName, {
        fileName,
        fileSize: typeof attachment['fileSize'] === 'number' ? attachment['fileSize'] : undefined,
        downloadUrl: asString(attachment['downloadUrl']),
      });
    }
  }

  return [...byName.values()];
}

/**
 * Where a report starts, and how much of an official read it costs to get there.
 *
 * - `threadId` — nothing is discovered. Every call the report then makes is one Apple has
 *   no official equivalent for.
 * - `submissionId` — the thread is found by `resolutionCenterThreads?filter[reviewSubmission]`,
 *   a private filter, so this route reads no official resource either. The submission's own
 *   state and version are not fetched; the id you passed is reported back as given.
 * - `appId` — every open submission on the app, which means `apps/{id}/reviewSubmissions`.
 *   **That read is officially available** and is the one thing here that duplicates Apple's
 *   API. It buys the state, platform, version and dates that the other two routes have no
 *   source for.
 */
export type ReportTarget =
  | { readonly appId: string }
  | { readonly submissionId: string }
  | { readonly threadId: string };

/**
 * Digests a review conversation: one report per open submission when given an app, or the
 * single one behind a submission or thread id.
 */
export async function buildReport(session: Session, target: ReportTarget): Promise<SubmissionReport[]> {
  if ('threadId' in target) {
    return [await addThread(session, blankReport(), target.threadId)];
  }

  if ('submissionId' in target) {
    const thread = await api.findThreadForSubmission(session, target.submissionId);
    const report = { ...blankReport(), submissionId: target.submissionId };
    return [thread ? await addThread(session, report, thread.id) : report];
  }

  const submissions = denormalizeAll(await api.listReviewSubmissions(session, target.appId));
  return Promise.all(submissions.map((submission) => reportForSubmission(session, submission)));
}

/** A report with nothing in it yet — everything a thread cannot tell you is left unsaid. */
function blankReport(): SubmissionReport {
  return { guidelines: [], attachments: [], hasDraftReply: false };
}

async function reportForSubmission(session: Session, submission: Denormalized): Promise<SubmissionReport> {
  const version = submission['appStoreVersionForReview'];
  const report: SubmissionReport = {
    ...blankReport(),
    submissionId: submission.id,
    state: asString(submission['state']) ?? 'UNKNOWN',
    platform: asString(submission['platform']),
    version:
      version && typeof version === 'object'
        ? asString((version as Record<string, unknown>)['versionString'])
        : undefined,
    versionId:
      version && typeof version === 'object' ? asString((version as Record<string, unknown>)['id']) : undefined,
    submittedDate: asString(submission['submittedDate']),
    lastUpdatedDate: asString(submission['lastUpdatedDate']),
  };

  const thread = await api.findThreadForSubmission(session, submission.id);
  return thread ? addThread(session, report, thread.id) : report;
}

/**
 * Fills in everything that comes off the thread: the conversation, the guidelines cited,
 * what Apple attached, and whether a reply is sitting unsent. This is the whole of the
 * report that has no official-API equivalent, and it needs no id but the thread's.
 */
async function addThread(
  session: Session,
  report: SubmissionReport,
  threadId: string
): Promise<SubmissionReport> {
  report.threadId = threadId;

  const [messagesDoc, rejectionsDoc, draftDoc] = await Promise.all([
    api.listMessages(session, threadId),
    api.listRejections(session, threadId),
    api.getDraftMessage(session, threadId),
  ]);

  const messages = sortByDateDesc(denormalizeAll(messagesDoc), 'createdDate');
  report.attachments = collectAttachments(messages);
  report.guidelines = collectGuidelines(denormalizeAll(rejectionsDoc));
  report.hasDraftReply = draftDoc.data !== null && draftDoc.data !== undefined;

  const latest = messages[0];
  if (latest) {
    report.lastMessageDate = asString(latest['createdDate']);
    report.lastMessageFromApple = isAppleActor(latest);
  }

  const latestFromApple = messages.find(isAppleActor);
  const body = latestFromApple && asString(latestFromApple['messageBody']);
  if (body) report.lastAppleMessage = htmlToText(body);

  return report;
}

export interface BuildChoice {
  /** Feed it to `setVersionBuild`. */
  buildId: string;
  /** The build number — the part in brackets of "1.1.1 (5)". */
  buildNumber?: string;
  /** Marketing version the build was uploaded against. */
  version?: string;
  platform?: string;
  uploadedDate?: string;
  processingState?: string;
  expired?: boolean;
  /** True for the one the version currently points at. */
  attached: boolean;
}

function toBuildChoice(build: Denormalized, attachedId: string | undefined): BuildChoice {
  const preRelease = build['preReleaseVersion'] as Record<string, unknown> | undefined;

  return {
    buildId: build.id,
    // The build's own `version` is the build number; the marketing version it belongs
    // to lives on the preReleaseVersion, which is why the picker asks for both.
    buildNumber: asString(build['version']),
    version: preRelease && asString(preRelease['version']),
    platform: preRelease && asString(preRelease['platform']),
    uploadedDate: asString(build['uploadedDate']),
    processingState: asString(build['processingState']),
    expired: build['expired'] === true,
    attached: build.id === attachedId,
  };
}

/**
 * Every build that could be attached to a version, with the current one marked — the
 * list you need before `setVersionBuild`, which otherwise wants an id from nowhere.
 *
 * Three requests, as the version page itself makes: the version supplies the app and
 * platform to filter candidates by, and the attached build is read separately because
 * it need not still be among them.
 */
export async function fetchBuilds(
  session: Session,
  versionId: string,
  options: { limit?: number } = {}
): Promise<BuildChoice[]> {
  const version = await api.getVersion(session, versionId);
  const appId = (version.data.relationships?.app?.data as { id?: string } | undefined)?.id;
  if (!appId) {
    throw new Error(`Version ${versionId} came back without an app — cannot list its builds`);
  }

  const [attachedDoc, candidateDoc] = await Promise.all([
    api.listBuilds(session, versionId),
    api.listBuildCandidates(session, appId, {
      platform: asString(version.data.attributes?.['platform']),
      limit: options.limit,
    }),
  ]);

  const attachedId = attachedDoc.data[0]?.id;
  const choices = denormalizeAll(candidateDoc).map((build) => toBuildChoice(build, attachedId));

  if (attachedId && !choices.some((choice) => choice.buildId === attachedId)) {
    choices.unshift(...denormalizeAll(attachedDoc).map((build) => toBuildChoice(build, attachedId)));
  }

  return choices;
}

/** Renders the build picker for a terminal. */
export function formatBuilds(builds: BuildChoice[]): string {
  if (builds.length === 0) {
    return 'No builds to choose from — none have finished processing for this platform.';
  }

  const lines = builds.map((build) => {
    const name = `${build.version ?? '?'} (${build.buildNumber ?? '?'})`;
    const notes = [
      build.processingState !== 'VALID' ? build.processingState : undefined,
      build.expired ? 'expired' : undefined,
    ].filter(Boolean);

    const row = [
      build.attached ? '*' : ' ',
      name.padEnd(16),
      build.buildId,
      `uploaded ${build.uploadedDate ?? 'unknown'}`,
    ].join(' ');

    return notes.length ? `${row}  [${notes.join(', ')}]` : row;
  });

  lines.push('');
  lines.push(
    builds.some((build) => build.attached)
      ? '* attached. Change it with: asc set-build <versionId> <buildId>'
      : 'None attached. Attach one with: asc set-build <versionId> <buildId>'
  );

  return lines.join('\n');
}

export interface StateChange {
  /** The state the version moved into. */
  state: string;
  date?: string;
  /** "Apple", or the Apple ID of whoever on your side did it. */
  initiator?: string;
  /** True when Apple made the move rather than someone on the account. */
  byApple: boolean;
  /** How long the version sat in this state, in seconds. Absent for the current one. */
  heldForSeconds?: number;
}

/**
 * The version's whole submission history, oldest first — how many times it went round,
 * who moved it each time, and how long each state lasted.
 */
export async function fetchHistory(session: Session, versionId: string): Promise<StateChange[]> {
  const document = await api.listVersionStateChanges(session, versionId);

  const changes = denormalizeAll(document)
    .map((change) => {
      const initiator = asString(change['initiator']);
      return {
        // appStoreState and appVersionState have agreed on every capture so far; the
        // first is the one the History tab shows.
        state: asString(change['appStoreState']) ?? asString(change['appVersionState']) ?? 'UNKNOWN',
        date: asString(change['date']),
        initiator,
        byApple: initiator === 'Apple',
      } as StateChange;
    })
    .sort((a, b) => byInstant(a.date, b.date));

  for (let i = 0; i < changes.length - 1; i++) {
    const from = instant(changes[i]!.date);
    const to = instant(changes[i + 1]!.date);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      changes[i]!.heldForSeconds = Math.round((to - from) / 1000);
    }
  }

  return changes;
}

/** "2026-04-25T07:34:29-07:00" -> "2026-04-25 07:34-07:00", keeping the offset honest. */
function shortDate(date: string | undefined): string {
  if (!date) return 'unknown date';
  return `${date.slice(0, 10)} ${date.slice(11, 16)}${date.slice(19)}`;
}

/** Rounds a span to its largest useful unit — exact seconds mean nothing after a day. */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.round((seconds % 86400) / 3600);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/** Renders the history as a timeline. */
export function formatHistory(changes: StateChange[]): string {
  if (changes.length === 0) return 'No recorded state changes for this version.';

  const lines = changes.map((change) => {
    const who = change.byApple ? 'Apple' : (change.initiator ?? 'unknown');
    const held = change.heldForSeconds === undefined ? '(current)' : duration(change.heldForSeconds);

    return [shortDate(change.date), change.state.padEnd(22), who.padEnd(28), held].join('  ');
  });

  const reviews = changes.filter((change) => change.state === 'IN_REVIEW').length;
  const rejections = changes.filter((change) => change.state === 'REJECTED').length;
  if (reviews || rejections) {
    const times = (count: number) => (count === 1 ? 'once' : `${count} times`);
    lines.push('');
    lines.push(`Reviewed ${times(reviews)}, rejected ${times(rejections)}.`);
  }

  return lines.join('\n');
}

export interface DataUsage {
  /** What is collected, e.g. "PAYMENT_INFORMATION". */
  category?: string;
  /** The heading it sits under, e.g. "FINANCIAL_INFO". */
  grouping?: string;
  /** What it is used for, e.g. "ANALYTICS". */
  purpose?: string;
  /** LINKED / NOT_LINKED / TRACKING, or DATA_NOT_COLLECTED for the "we collect nothing" row. */
  protection?: string;
}

export interface PrivacyDeclaration {
  /** Whether what follows is live on the store, or only a draft. */
  published: boolean;
  lastPublished?: string;
  lastPublishedBy?: string;
  /** True when the app declares it collects nothing at all. */
  collectsNothing: boolean;
  usages: DataUsage[];
}

/** The relationship's id *is* the value on these — they are enum rows, not records. */
function relationshipId(usage: Denormalized, field: string): string | undefined {
  const related = usage[field];
  if (!related || typeof related !== 'object') return undefined;
  return asString((related as Record<string, unknown>)['id']);
}

/** The App Privacy nutrition label as declared, and whether it has been published. */
export async function fetchPrivacy(session: Session, appId: string): Promise<PrivacyDeclaration> {
  const [usageDoc, stateDoc] = await Promise.all([
    api.listDataUsages(session, appId),
    api.getDataUsagePublishState(session, appId),
  ]);

  const usages = denormalizeAll(usageDoc).map((usage) => ({
    category: relationshipId(usage, 'category'),
    grouping: relationshipId(usage, 'grouping'),
    purpose: relationshipId(usage, 'purpose'),
    protection: relationshipId(usage, 'dataProtection'),
  }));

  const state = stateDoc.data?.attributes ?? {};

  return {
    published: state['published'] === true,
    lastPublished: asString(state['lastPublished']),
    lastPublishedBy: asString(state['lastPublishedBy']),
    // Apple stores "nothing collected" as one row with no category and this protection,
    // not as an empty list — an empty list would mean "not filled in yet".
    collectsNothing: usages.some((usage) => usage.protection === 'DATA_NOT_COLLECTED' && !usage.category),
    usages,
  };
}

/** Renders the privacy declarations for a terminal. */
export function formatPrivacy(privacy: PrivacyDeclaration): string {
  const lines = [
    privacy.published
      ? `Published ${privacy.lastPublished ?? 'at an unknown date'}${privacy.lastPublishedBy ? ` by ${privacy.lastPublishedBy}` : ''}`
      : 'Not published — these declarations are still a draft',
  ];

  if (privacy.usages.length === 0) {
    lines.push('No privacy declarations at all — this app has not answered the questionnaire.');
    return lines.join('\n');
  }

  if (privacy.collectsNothing) {
    lines.push('Declares that it collects no data.');
    return lines.join('\n');
  }

  lines.push('');
  for (const usage of privacy.usages) {
    lines.push(
      [
        (usage.category ?? '?').padEnd(28),
        (usage.purpose ?? '-').padEnd(24),
        usage.protection ?? '-',
      ].join('  ')
    );
  }

  return lines.join('\n');
}

export interface LocaleMetadata {
  locale: string;
  /** Id of the appStoreVersionLocalization — feed it to `listScreenshotSets`. */
  localizationId?: string;
  name?: string;
  subtitle?: string;
  description?: string;
  keywords?: string;
  promotionalText?: string;
  whatsNew?: string;
  marketingUrl?: string;
  supportUrl?: string;
}

/**
 * Merges the two halves of App Store metadata into one per-locale view: name and subtitle
 * come from the app info record, everything else from the version.
 */
export async function fetchMetadata(
  session: Session,
  appId: string,
  versionId: string
): Promise<LocaleMetadata[]> {
  const [appInfo, versionLocsDoc] = await Promise.all([
    api.findEditableAppInfo(session, appId),
    api.listVersionLocalizations(session, versionId),
  ]);

  const byLocale = new Map<string, LocaleMetadata>();

  for (const localization of denormalizeAll(versionLocsDoc)) {
    const locale = asString(localization['locale']);
    if (!locale) continue;
    byLocale.set(locale, {
      locale,
      localizationId: localization.id,
      description: asString(localization['description']),
      keywords: asString(localization['keywords']),
      promotionalText: asString(localization['promotionalText']),
      whatsNew: asString(localization['whatsNew']),
      marketingUrl: asString(localization['marketingUrl']),
      supportUrl: asString(localization['supportUrl']),
    });
  }

  // Names come from the editable app info record, not the live one — see
  // findEditableAppInfo. A shipped app has both, and they disagree the moment you edit.
  for (const localization of denormalizeAll(await api.listAppInfoLocalizations(session, appInfo.id))) {
    const locale = asString(localization['locale']);
    if (!locale) continue;
    const existing = byLocale.get(locale) ?? { locale };
    existing.name = asString(localization['name']);
    existing.subtitle = asString(localization['subtitle']);
    byLocale.set(locale, existing);
  }

  return [...byLocale.values()];
}

/** Renders the digest for a terminal. */
export function formatReport(reports: SubmissionReport[]): string {
  if (reports.length === 0) return 'No open review submissions.';

  return reports
    .map((report) => {
      // A report built from a thread id has no submission to head the block with, and no
      // state or submitted date either — those come off the submission, and reading one
      // would mean an official call. Print what is known rather than a row of "unknown".
      const lines = report.submissionId
        ? [`submission ${report.submissionId}`]
        : [`thread     ${report.threadId ?? 'none'}`];

      // The state and the submitted date come off the submission together, so they print
      // together: "submitted unknown" next to a state means the submission has no date,
      // where printing it with no state at all would read as if one had been looked for.
      if (report.state) {
        lines.push(`  state      ${report.state}${report.version ? `  (version ${report.version})` : ''}`);
        lines.push(`  submitted  ${report.submittedDate ?? 'unknown'}`);
      }
      if (report.submissionId) lines.push(`  thread     ${report.threadId ?? 'none'}`);

      if (report.lastMessageDate) {
        const who = report.lastMessageFromApple ? 'Apple' : 'you';
        lines.push(`  last msg   ${report.lastMessageDate} (from ${who})`);
      }
      if (report.hasDraftReply) lines.push('  draft      an unsent reply is waiting');

      if (report.guidelines.length) {
        lines.push('  guidelines');
        for (const guideline of report.guidelines) {
          lines.push(`    ${guideline.code.padEnd(7)} ${guideline.description}`);
        }
      }

      if (report.attachments.length) {
        lines.push(`  attachments (${report.attachments.length})`);
        for (const attachment of report.attachments) {
          lines.push(`    ${attachment.fileName}`);
        }
      }

      if (report.lastAppleMessage) {
        lines.push('  latest message from Apple:');
        for (const line of report.lastAppleMessage.split('\n')) lines.push(`    ${line}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Xcode Cloud
//
// A digest of one build run, and the reason it exists: a workflow's *saved*
// configuration and what a build *executed* are two different facts, and the
// build page shows them a screen apart. A run that predates an edit will happily
// report "succeeded" while having tested something else entirely, so anything
// here that reports one always reports the other beside it.
// ---------------------------------------------------------------------------

/** A destination the run actually used, with what happened on it. */
export interface RunDestination {
  device: string;
  runtime: string;
  executed: number;
  passed: number;
  failed: number;
}

/** One failing test, gathered across every destination that failed it. */
export interface RunFailure {
  test: string;
  message: string;
  file?: string;
  line?: number;
  devices: string[];
}

export interface RunStage {
  name: string;
  type: string;
  state: string;
  required: boolean;
  warnings: number;
  errors: number;
  testFailures: number;
  seconds: number;
}

/** What a test stage did, once its results are counted. */
export interface RunTests {
  stageId: string;
  stageName: string;
  cases: number;
  destinations: RunDestination[];
  failures: RunFailure[];
  /** Warnings from the stage's issue list, deduplicated by message. */
  warnings: number;
}

export interface RunReport {
  buildId: string;
  number: number;
  state: string;
  startedAt?: string;
  finishedAt?: string;
  branch: string;
  commit: { sha: string; message: string; author: string };
  triggeredFrom: string;
  triggeredBy: string;
  builder: string;
  os: string;
  stages: RunStage[];
  tests: RunTests[];
  /** The workflow as it stands *now* — not necessarily what this build ran. */
  saved: {
    workflowId: string;
    name: string;
    testPlans: string[];
    destinations: string[];
    modifiedAt: string;
    modifiedBy: string;
  };
  /**
   * True when the workflow was saved after this build started, so its current
   * configuration cannot be what ran. Distinct from the destinations differing:
   * either one on its own is enough to make the run stale evidence.
   */
  savedAfterRun: boolean;
}

/** `class.name()`, which is how a test is named in an issue and how people say it. */
function testName(result: ci.CiTestResult): string {
  return result.class_name ? `${result.class_name}.${result.name}` : result.name;
}

/** Counts per destination, and the failures gathered by test rather than by device. */
function countTests(results: readonly ci.CiTestResult[]): {
  destinations: RunDestination[];
  failures: RunFailure[];
} {
  const destinations = new Map<string, RunDestination>();
  const failures = new Map<string, RunFailure>();

  for (const result of results) {
    for (const run of result.device_runs) {
      const key = `${run.device_name}\u0000${run.os_version}`;
      const seen = destinations.get(key) ?? {
        device: run.device_name,
        runtime: run.os_version,
        executed: 0,
        passed: 0,
        failed: 0,
      };
      seen.executed += 1;
      if (run.status === 'success') seen.passed += 1;
      else seen.failed += 1;
      destinations.set(key, seen);

      if (run.status === 'success') continue;
      // Keyed by test and message, not by device: the same assertion failing on four
      // simulators is one thing to fix, and listing it four times buries the others.
      const name = testName(result);
      const failureKey = `${name}\u0000${run.message}`;
      const failure = failures.get(failureKey) ?? {
        test: name,
        message: run.message || result.message || '',
        file: result.location?.file_path,
        line: result.location?.line_number,
        devices: [],
      };
      failure.devices.push(run.device_name);
      failures.set(failureKey, failure);
    }
  }

  const byDevice = [...destinations.values()].sort((a, b) => a.device.localeCompare(b.device));
  return { destinations: byDevice, failures: [...failures.values()] };
}

/** Every destination the workflow names today, across its test actions. */
function savedDestinations(content: ci.CiWorkflowContent): string[] {
  const names = new Set<string>();
  for (const action of content.actions) {
    for (const destination of action.test_config?.test_destinations ?? []) names.add(destination.name);
  }
  return [...names];
}

/**
 * One build run, with the workflow it belongs to read alongside it.
 *
 * Test results are fetched per stage, and only for a stage whose sections say it has any —
 * asking an archive stage for test results is a request with a knowable answer.
 */
export async function fetchRun(
  session: Session,
  productId: string,
  buildId: string
): Promise<RunReport> {
  const detail = await ci.getBuild(session, productId, buildId);
  const workflow = await ci.getWorkflow(session, productId, detail.build.workflow_id);

  const testStages = detail.build_stages.filter(
    (stage) => stage.stage_type === 'test' || (stage.stage_sections?.sections ?? []).includes('tests')
  );

  const tests = await Promise.all(
    testStages.map(async (stage): Promise<RunTests> => {
      const [results, issues] = await Promise.all([
        ci.listTestResults(session, productId, buildId, stage.id),
        ci.listStageIssues(session, productId, buildId, stage.id),
      ]);
      const { destinations, failures } = countTests(results.items);

      return {
        stageId: stage.id,
        stageName: stage.name,
        cases: results.items.length,
        destinations,
        failures,
        warnings: issues.items.filter((issue) => issue.issue_type === 'warning').length,
      };
    })
  );

  const started = detail.build.started_at ?? detail.build.created_at;

  return {
    buildId,
    number: detail.build.number,
    state: detail.build.state,
    startedAt: detail.build.started_at,
    finishedAt: detail.build.finished_at,
    branch: detail.build.git_ref.display_name,
    commit: {
      sha: detail.build.commit.commit_sha,
      message: detail.build.commit.message,
      author: detail.build.commit.author.display_name,
    },
    triggeredFrom: detail.triggered_from,
    triggeredBy: detail.triggered_by_user,
    builder: detail.builder_name,
    os: detail.os_name,
    stages: detail.build_stages.map((stage) => ({
      name: stage.name,
      type: stage.stage_type,
      state: stage.state,
      required: stage.is_required,
      warnings: stage.metadata_summary.warnings,
      errors: stage.metadata_summary.errors,
      testFailures: stage.metadata_summary.test_failures,
      seconds: stage.usage_time,
    })),
    tests,
    saved: {
      workflowId: workflow.id,
      name: workflow.content.name,
      testPlans: workflow.content.actions
        .map((action) => action.test_config?.test_plan_name)
        .filter((plan): plan is string => Boolean(plan)),
      destinations: savedDestinations(workflow.content),
      modifiedAt: workflow.metadata.last_modified_at,
      modifiedBy: workflow.metadata.last_modified_by,
    },
    savedAfterRun: workflow.metadata.last_modified_at > started,
  };
}

/** "1 warning", "2 warnings" — enough of a plural for counts that are always regular. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Renders one run for a terminal. */
export function formatRun(run: RunReport): string {
  const lines = [
    `build ${run.number}  ${run.state}`,
    `  id         ${run.buildId}`,
    `  branch     ${run.branch}`,
    `  commit     ${run.commit.sha.slice(0, 12)}  ${run.commit.message.split('\n')[0]}`,
    `  author     ${run.commit.author}  (${run.triggeredFrom}, ${run.triggeredBy})`,
    `  started    ${run.startedAt ?? 'not yet'}`,
    `  finished   ${run.finishedAt ?? 'still running'}`,
    `  ran on     ${run.builder} / ${run.os}`,
    '  stages',
  ];

  for (const stage of run.stages) {
    const notes = [
      stage.testFailures ? plural(stage.testFailures, 'test failure') : undefined,
      stage.errors ? plural(stage.errors, 'error') : undefined,
      stage.warnings ? plural(stage.warnings, 'warning') : undefined,
      stage.required ? undefined : 'not required to pass',
    ].filter(Boolean);
    lines.push(
      `    ${stage.state.padEnd(10)} ${stage.name.padEnd(20)} ${String(stage.seconds).padStart(5)}s` +
        (notes.length ? `  [${notes.join(', ')}]` : '')
    );
  }

  for (const stage of run.tests) {
    lines.push(`  tests (${stage.stageName})`);
    if (stage.cases === 0) {
      // Not "all green". A stage that reports no cases has told us nothing about the code,
      // and a report that renders that as a pass is the failure this command exists to stop.
      lines.push('    NO TESTS REPORTED — this run proves nothing about the suite.');
      lines.push('    A stage that ran zero cases is not a passing stage.');
      continue;
    }

    lines.push(
      `    ${plural(stage.cases, 'test case')}, executed on ${plural(stage.destinations.length, 'destination')}`
    );
    for (const destination of stage.destinations) {
      const failed = destination.failed ? `${destination.failed} failed` : 'all passed';
      lines.push(
        `      ${destination.device.padEnd(28)} ${destination.runtime.padEnd(6)} ` +
          `${String(destination.executed).padStart(5)} run  ${failed}`
      );
    }

    for (const failure of stage.failures) {
      lines.push(`    ${failure.test}`);
      lines.push(`      ${failure.message}`);
      if (failure.file) {
        lines.push(`      ${failure.file}${failure.line === undefined ? '' : `:${failure.line}`}`);
      }
      lines.push(`      failed on ${failure.devices.join(', ')}`);
    }
  }

  const executed = [...new Set(run.tests.flatMap((stage) => stage.destinations.map((d) => d.device)))];
  lines.push('  workflow now');
  lines.push(`    ${run.saved.name}  (${run.saved.workflowId})`);
  lines.push(`    saved ${run.saved.modifiedAt} by ${run.saved.modifiedBy}`);
  lines.push(`    test plans   ${run.saved.testPlans.join(', ') || 'none'}`);
  lines.push(`    destinations ${run.saved.destinations.join(', ') || 'none'}`);

  const sameDestinations =
    executed.length === run.saved.destinations.length &&
    executed.every((device) => run.saved.destinations.includes(device));

  if (run.savedAfterRun || !sameDestinations) {
    lines.push('');
    lines.push('  THIS RUN IS NOT EVIDENCE FOR THE WORKFLOW AS IT STANDS.');
    if (run.savedAfterRun) {
      lines.push(`    The workflow was saved at ${run.saved.modifiedAt}, after this build started`);
      lines.push(`    at ${run.startedAt ?? 'an unknown time'}.`);
    }
    if (!sameDestinations) {
      lines.push(`    It executed on:  ${executed.join(', ') || 'nothing'}`);
      lines.push(`    It now names:    ${run.saved.destinations.join(', ') || 'nothing'}`);
      lines.push('    A named group such as "Recommended iPhones" expands to several devices,');
      lines.push('    so a difference here is not always a change — but it is never proof.');
    }
    lines.push('    Trigger a build on the current configuration to prove it.');
  }

  return lines.join('\n');
}
