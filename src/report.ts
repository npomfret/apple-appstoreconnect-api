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

function sortByDateDesc(items: Denormalized[], field: string): Denormalized[] {
  return [...items].sort((a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? '')));
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
  const [appInfosDoc, versionLocsDoc] = await Promise.all([
    api.listAppInfos(session, appId),
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

  // Any of the app info records will do for names; the editable one is listed first.
  const appInfo = appInfosDoc.data[0];
  if (appInfo) {
    for (const localization of denormalizeAll(await api.listAppInfoLocalizations(session, appInfo.id))) {
      const locale = asString(localization['locale']);
      if (!locale) continue;
      const existing = byLocale.get(locale) ?? { locale };
      existing.name = asString(localization['name']);
      existing.subtitle = asString(localization['subtitle']);
      byLocale.set(locale, existing);
    }
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
