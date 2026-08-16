import { Session } from './session';
import * as api from './api';
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
  submissionId: string;
  state: string;
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

/** Builds one report per open submission, resolving each submission's thread as it goes. */
export async function buildReport(session: Session, appId: string): Promise<SubmissionReport[]> {
  const submissionsDoc = await api.listReviewSubmissions(session, appId);
  const submissions = denormalizeAll(submissionsDoc);

  return Promise.all(submissions.map((submission) => reportForSubmission(session, submission)));
}

async function reportForSubmission(session: Session, submission: Denormalized): Promise<SubmissionReport> {
  const version = submission['appStoreVersionForReview'];
  const report: SubmissionReport = {
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
    guidelines: [],
    attachments: [],
    hasDraftReply: false,
  };

  const thread = await api.findThreadForSubmission(session, submission.id);
  if (!thread) return report;

  report.threadId = thread.id;

  const [messagesDoc, rejectionsDoc, draftDoc] = await Promise.all([
    api.listMessages(session, thread.id),
    api.listRejections(session, thread.id),
    api.getDraftMessage(session, thread.id),
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
      const lines = [
        `submission ${report.submissionId}`,
        `  state      ${report.state}${report.version ? `  (version ${report.version})` : ''}`,
        `  submitted  ${report.submittedDate ?? 'unknown'}`,
        `  thread     ${report.threadId ?? 'none'}`,
      ];

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
