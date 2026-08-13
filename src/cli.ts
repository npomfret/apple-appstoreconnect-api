import { readFileSync } from 'fs';
import { CURL_PATH, describeSession, loadSession, Session } from './session';
import { Cancelled, confirm } from './confirm';
import { denormalize, denormalizeAll, Denormalized, Document } from './jsonapi';
import { Query } from './http';
import {
  buildReport,
  fetchBuilds,
  fetchHistory,
  fetchMetadata,
  fetchPrivacy,
  formatBuilds,
  formatHistory,
  formatPrivacy,
  formatReport,
} from './report';
import { log } from './log';
import * as api from './api';

const USAGE = `App Store Connect review-centre client (unofficial, session-scraped).

  asc status [file]           Show the captured session and how long it has left
  asc report [appId]          Digest of every open submission: state, guidelines, Apple's latest message
  asc apps                    List every app on the account
  asc inbox                   Unread message counts per app — where to look first
  asc app [appId]             Show one app
  asc submissions [appId]     List review submissions for an app
  asc submission <id>         Show one review submission
  asc items <submissionId>    List the items bundled into a submission
  asc versions [appId]        List the app's editable versions — where version ids come from
  asc version [versionId]     Show one App Store version and everything hanging off it
  asc history [versionId]     The version's submission history: every state it passed through,
                              who moved it, and how long each one lasted
  asc privacy [appId]         App Privacy declarations and whether they are published
  asc builds [versionId]      Builds you can attach to a version, newest first, with the
                              current one marked "*" — the version page's build picker
  asc metadata [versionId]    Per-locale name, subtitle, description and keywords (defaults
                              to the version under review)
  asc screenshots [versionId] Every locale of a version with its screenshot and preview
                              sets, in one request (defaults to the version under review)
  asc previews <locId>        App preview videos in one locale's preview sets. The
                              localization id comes from "asc screenshots"
  asc review-details [versionId]
                              App Review Information: reviewer contact, demo account and
                              notes. The demo password is hidden unless --reveal
  asc threads [appId]         List Resolution Center threads on an app
  asc thread <submissionId>   Find the thread behind a review submission
  asc messages <threadId>     List Resolution Center messages in a thread
  asc draft <threadId>        Show the thread's unsent draft reply, with its attachments
  asc rejections <threadId>   List guideline rejections for a thread
  asc get <path> [k=v ...]    Raw GET against /iris/v1 for probing unmapped endpoints

Writes (these change your live App Store Connect data):
  asc set-build <versionId> <buildId|none>
                              Attach a build to a version — the version page's Save button
  asc screenshot-set <locId> <displayType>
                              Create an empty screenshot set for a device size
  asc upload-screenshot <locId> <displayType> <file>
                              Add a screenshot, creating the set if the size has none yet.
                              Checks dimensions and the 10-per-set limit before uploading
  asc delete-screenshot <id>  Remove a screenshot
  asc save-draft <threadId> <text|-> [--attach file ...]
                              Write the reply to Apple into the thread's draft box, with
                              attachments. "-" reads the text from stdin. This does NOT
                              send it — see send-reply
  asc delete-attachment <id>  Remove one attachment from a draft
  asc delete-draft <threadId> Throw the thread's draft away, attachments and all
  asc patch <path> <json>     Raw PATCH against /iris/v1 with a hand-written body

These reach Apple and cannot be undone. Both show you what they are about to do and ask
first; --yes answers for you:
  asc send-reply <threadId>   Send the thread's draft to App Review. No unsend, no edit
  asc resolve-item <itemId>   Mark a submission item fixed and put it back in the review
                              queue — what you press after answering a rejection. Item ids
                              come from "asc items <submissionId>"

Options:
  --raw                       Print the untouched JSON:API document instead of denormalizing it
  --json                      For "report", "builds", "history" and "privacy": emit JSON
                              instead of the digest
  --yes                       Skip the confirmation prompt on the commands that ask
  --force                     For "upload-screenshot": upload despite failed checks
  --reveal                    For "review-details": print the demo account password
  --attach <file>             For "save-draft": a file to attach. Repeat for several

Logging goes to stderr as one JSON object per line, so stdout stays pipeable:
  ASC_LOG=debug|info|warn|error|off   default info
Every change to live data is logged whatever the level, marked "audit":true. To keep just
the audit trail:  asc upload-screenshot ... 2>&1 >/dev/null | jq -c 'select(.audit)'

The session is read from ${CURL_PATH} (override with ASC_CURL_PATH), fresh on every
command. There is no login step: log in with your passkey, open dev tools, right-click any
/iris/v1 request, "Copy as cURL", and paste it over that file. Its Cookie header on its own
works too — everything else is derived from it. Keep the file gitignored; it is a live
credential.`;

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(document: Document, raw: boolean): void {
  console.log(JSON.stringify(raw ? document : denormalizeAll(document), null, 2));
}

function requireAppId(session: Session, given: string | undefined): string {
  const appId = given ?? session.appId;
  if (!appId) {
    throw new Error('No app id given and none recorded in the session — pass one: asc submissions <appId>');
  }
  return appId;
}

/** Falls back to the version attached to the first open review submission. */
async function versionUnderReview(session: Session, appId: string): Promise<string> {
  const [report] = await buildReport(session, appId);
  if (report?.versionId) return report.versionId;

  // Nothing open — the app is between rounds, so fall back to the version being edited.
  // Live versions come back from this call too, and on a multi-platform app so does one
  // per platform, so narrow to the drafts and refuse to guess between two of them.
  const versions = denormalizeAll(await api.listAppVersions(session, appId));
  const drafts = versions.filter(
    (version) => !(api.LIVE_VERSION_STATES as readonly string[]).includes(String(version['appStoreState'] ?? ''))
  );

  if (drafts.length === 0) {
    throw new Error('No open submission and no version in progress — pass one: asc metadata <versionId>');
  }
  if (drafts.length > 1) {
    const choices = drafts.map((v) => `  ${v.id}  ${v['platform']} ${v['versionString']}`).join('\n');
    throw new Error(`More than one version is in progress — say which:\n${choices}`);
  }

  log.debug('no open submission, using the version in progress', { versionId: drafts[0]!.id });
  return drafts[0]!.id;
}

/**
 * What `send-reply` shows before it asks. The whole body, not a preview of it: this is the
 * last look anyone gets at a message that can't be edited or taken back afterwards.
 */
function describeDraft(threadId: string, draft: Denormalized): string[] {
  const body = String(draft['messageBody'] ?? '');
  const attachments = (draft['resolutionCenterMessageAttachments'] ?? []) as Denormalized[];
  const rule = '─'.repeat(72);

  return [
    '',
    `  thread:      ${threadId}`,
    `  draft:       ${draft.id}`,
    `  message:     ${body.length} characters`,
    ...attachments.map((file) => `  attachment:  ${String(file['fileName'] ?? file.id)}`),
    '',
    rule,
    body.trimEnd(),
    rule,
    '',
  ];
}

/**
 * What `resolve-item` shows before it asks. Reached through the parent submission, since
 * iris answers a direct GET of an item with a 403. It's a nicety: if the id won't decode
 * or the read fails, the prompt is thinner and the command still works.
 */
async function describeItem(session: Session, itemId: string): Promise<string[]> {
  try {
    const document = await api.findSubmissionItems(session, itemId);
    if (!document) return [];
    const item = denormalizeAll(document).find((candidate) => candidate.id === itemId);
    if (!item) return [];

    const version = item['appStoreVersion'] as Denormalized | undefined;
    return [
      `  submission: ${api.submissionIdFromItemId(itemId)}`,
      `  state:      ${String(item['state'] ?? 'unknown')}`,
      ...(version ? [`  version:    ${String(version['versionString'] ?? version.id)}`] : []),
    ];
  } catch (error) {
    log.debug('item.describe.failed', { itemId, error });
    return [];
  }
}

function requireArg(value: string | undefined, name: string, example: string): string {
  if (!value) throw new Error(`Missing <${name}>. Example: asc ${example}`);
  return value;
}

/** Parses trailing `key=value` pairs for the `get` command. Repeat a key to build a list. */
function parseQueryArgs(args: string[]): Query {
  const query: Query = {};

  for (const arg of args) {
    const sep = arg.indexOf('=');
    if (sep === -1) throw new Error(`Query argument "${arg}" must be key=value`);
    const key = arg.slice(0, sep);
    const value = arg.slice(sep + 1);
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else query[key] = Array.isArray(existing) ? [...existing, value] : [String(existing), value];
  }

  return query;
}

/**
 * Pulls every `--name value` pair out of the arguments, returning the values and what was
 * left. Repeatable, unlike the bare flags: --attach one.png --attach two.png.
 */
function takeOption(argv: string[], name: string): { values: string[]; rest: string[] } {
  const values: string[] = [];
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== name) {
      rest.push(argv[i]!);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${name} needs a value: ${name} <file>`);
    values.push(value);
    i++;
  }

  return { values, rest };
}

async function main(argv: string[]): Promise<number> {
  const { values: attach, rest: positional } = takeOption(argv, '--attach');
  const raw = positional.includes('--raw');
  const json = positional.includes('--json');
  const force = positional.includes('--force');
  const reveal = positional.includes('--reveal');
  const yes = positional.includes('--yes');
  const flags = new Set(['--raw', '--json', '--force', '--reveal', '--yes']);
  const args = positional.filter((arg) => !flags.has(arg));
  const [command, ...rest] = args;

  // Arguments are ids and file paths — the one secret, a piped-in capture, arrives on
  // stdin and never appears here.
  log.debug('command.start', { command, args: rest });

  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE);
      return 0;

    case 'status': {
      const path = rest[0] ?? CURL_PATH;
      const session = loadSession(path);
      console.log(`file:      ${path}\n${describeSession(session)}`);
      return 0;
    }

    case 'report': {
      const session = loadSession();
      const reports = await buildReport(session, requireAppId(session, rest[0]));
      console.log(json ? JSON.stringify(reports, null, 2) : formatReport(reports));
      return 0;
    }

    case 'apps': {
      const session = loadSession();
      emit(await api.listApps(session), raw);
      return 0;
    }

    case 'inbox': {
      const session = loadSession();
      emit(await api.listAppMetrics(session), raw);
      return 0;
    }

    case 'app': {
      const session = loadSession();
      emit(await api.getApp(session, requireAppId(session, rest[0])) as Document, raw);
      return 0;
    }

    case 'submissions': {
      const session = loadSession();
      emit(await api.listReviewSubmissions(session, requireAppId(session, rest[0])), raw);
      return 0;
    }

    case 'submission': {
      const session = loadSession();
      const id = requireArg(rest[0], 'submissionId', 'submission <submissionId>');
      emit(await api.getReviewSubmission(session, id) as Document, raw);
      return 0;
    }

    case 'version': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      emit(await api.getVersion(session, versionId) as Document, raw);
      return 0;
    }

    case 'builds': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      const builds = await fetchBuilds(session, versionId);
      console.log(json ? JSON.stringify(builds, null, 2) : formatBuilds(builds));
      return 0;
    }

    case 'history': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      const changes = await fetchHistory(session, versionId);
      console.log(json ? JSON.stringify(changes, null, 2) : formatHistory(changes));
      return 0;
    }

    case 'privacy': {
      const session = loadSession();
      const privacy = await fetchPrivacy(session, requireAppId(session, rest[0]));
      console.log(json ? JSON.stringify(privacy, null, 2) : formatPrivacy(privacy));
      return 0;
    }

    case 'versions': {
      const session = loadSession();
      emit(await api.listAppVersions(session, requireAppId(session, rest[0])), raw);
      return 0;
    }

    case 'set-build': {
      const session = loadSession();
      const versionId = requireArg(rest[0], 'versionId', 'set-build <versionId> <buildId>');
      const buildId = requireArg(rest[1], 'buildId', 'set-build <versionId> <buildId>');
      const document = await api.setVersionBuild(session, versionId, buildId === 'none' ? null : buildId);
      emit(document as Document, raw);
      return 0;
    }

    case 'screenshot-set': {
      const session = loadSession();
      const locId = requireArg(rest[0], 'localizationId', 'screenshot-set <localizationId> APP_IPHONE_65');
      const displayType = requireArg(rest[1], 'displayType', 'screenshot-set <localizationId> APP_IPHONE_65');
      const document = await api.createScreenshotSet(session, locId, displayType);
      emit(document as Document, raw);
      return 0;
    }

    case 'upload-screenshot': {
      const session = loadSession();
      const example = 'upload-screenshot <localizationId> APP_IPHONE_65 shot.png';
      const screenshot = await api.uploadScreenshot(session, {
        localizationId: requireArg(rest[0], 'localizationId', example),
        displayType: requireArg(rest[1], 'displayType', example),
        filePath: requireArg(rest[2], 'file', example),
        force,
      });
      console.log(JSON.stringify(screenshot, null, 2));
      return 0;
    }

    case 'delete-screenshot': {
      const session = loadSession();
      const id = requireArg(rest[0], 'screenshotId', 'delete-screenshot <screenshotId>');
      await confirm({ question: `Delete screenshot ${id}?`, yes });
      await api.deleteScreenshot(session, id);
      return 0;
    }

    case 'save-draft': {
      const session = loadSession();
      const example = 'save-draft <threadId> "We have fixed..." --attach shot.png';
      const threadId = requireArg(rest[0], 'threadId', example);
      const text = requireArg(rest[1], 'text', example);
      // "-" for stdin: a reply to App Review runs to paragraphs, and quoting all of that
      // into a shell argument is how newlines get lost.
      const body = text === '-' ? readStdin() : text;
      if (!body.trim()) {
        throw new Error('Refusing to save an empty draft — pass the reply text, or "-" to read it from stdin');
      }

      const document = await api.saveDraftReply(session, { threadId, body, attach });
      emit(document, raw);
      console.error('Saved as a draft. Nothing has been sent — "asc send-reply" does that.');
      return 0;
    }

    case 'send-reply': {
      const session = loadSession();
      const threadId = requireArg(rest[0], 'threadId', 'send-reply <threadId>');

      // Read the draft here rather than letting the API call do it, because what's in the
      // box is the whole of what the confirmation is about.
      const document = await api.getDraftMessage(session, threadId);
      if (!document.data) throw new Error(`Thread ${threadId} has no draft to send`);
      const draft = denormalize(document as Document, document.data);
      if (!String(draft['messageBody'] ?? '').trim()) {
        throw new Error(`The draft on thread ${threadId} is empty — nothing to send`);
      }

      await confirm({
        question: 'Send this to App Review? It cannot be edited or taken back.',
        detail: describeDraft(threadId, draft),
        yes,
      });

      const sent = await api.sendDraftMessage(session, draft.id);
      emit(sent as Document, raw);
      console.error(`Sent. Message ${sent.data.id} is on thread ${threadId}.`);
      return 0;
    }

    case 'resolve-item': {
      const session = loadSession();
      const itemId = requireArg(rest[0], 'itemId', 'resolve-item <itemId>');

      await confirm({
        question: 'Tell App Review this is fixed and put it back in the queue?',
        detail: ['', `  item:       ${itemId}`, ...(await describeItem(session, itemId)), ''],
        yes,
      });

      const resolved = await api.resolveSubmissionItem(session, itemId);
      emit(resolved as Document, raw);
      console.error(`Item ${itemId} is now ${String(resolved.data.attributes?.state ?? 'updated')}.`);
      return 0;
    }

    case 'delete-draft': {
      const session = loadSession();
      const threadId = requireArg(rest[0], 'threadId', 'delete-draft <threadId>');
      await confirm({
        question: `Delete the draft on thread ${threadId}, attachments and all?`,
        yes,
      });
      const draftId = await api.discardDraftReply(session, threadId);
      console.error(`Deleted draft ${draftId} and its attachments.`);
      return 0;
    }

    case 'delete-attachment': {
      const session = loadSession();
      const id = requireArg(rest[0], 'attachmentId', 'delete-attachment <attachmentId>');
      await confirm({ question: `Delete attachment ${id}?`, yes });
      await api.deleteMessageAttachment(session, id);
      return 0;
    }

    case 'patch': {
      const session = loadSession();
      const path = requireArg(rest[0], 'path', 'patch appStoreVersions/<id> \'{"data":...}\'');
      const body = requireArg(rest[1], 'json', 'patch appStoreVersions/<id> \'{"data":...}\'');
      console.log(JSON.stringify(await api.rawPatch(session, path, JSON.parse(body)), null, 2));
      return 0;
    }

    case 'metadata': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      console.log(JSON.stringify(await fetchMetadata(session, appId, versionId), null, 2));
      return 0;
    }

    case 'screenshots': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      emit(await api.listVersionLocalizationsWithAssets(session, versionId), raw);
      return 0;
    }

    case 'previews': {
      const session = loadSession();
      const id = requireArg(rest[0], 'localizationId', 'previews <localizationId>');
      emit(await api.listPreviewSets(session, id), raw);
      return 0;
    }

    case 'review-details': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      const document = await api.findReviewDetails(session, versionId);
      if (!document) {
        log.error('reviewDetails.notFound', { versionId });
        return 1;
      }
      emit(reveal ? document : api.redactReviewDetails(document), raw);
      return 0;
    }

    case 'threads': {
      const session = loadSession();
      emit(await api.listThreads(session, requireAppId(session, rest[0])), raw);
      return 0;
    }

    case 'thread': {
      const session = loadSession();
      const id = requireArg(rest[0], 'submissionId', 'thread <submissionId>');
      const thread = await api.findThreadForSubmission(session, id);
      if (!thread) {
        log.error('thread.notFound', { submissionId: id });
        return 1;
      }
      console.log(JSON.stringify(thread, null, 2));
      return 0;
    }

    case 'items': {
      const session = loadSession();
      emit(await api.listSubmissionItems(session, requireArg(rest[0], 'submissionId', 'items <submissionId>')), raw);
      return 0;
    }

    case 'messages': {
      const session = loadSession();
      emit(await api.listMessages(session, requireArg(rest[0], 'threadId', 'messages <threadId>')), raw);
      return 0;
    }

    case 'draft': {
      const session = loadSession();
      const document = await api.getDraftMessage(session, requireArg(rest[0], 'threadId', 'draft <threadId>'));
      emit(document as Document, raw);
      return 0;
    }

    case 'rejections': {
      const session = loadSession();
      emit(await api.listRejections(session, requireArg(rest[0], 'threadId', 'rejections <threadId>')), raw);
      return 0;
    }

    case 'get': {
      const session = loadSession();
      const path = requireArg(rest[0], 'path', 'get resolutionCenterThreads/<id>');
      emit(await api.raw(session, path, parseQueryArgs(rest.slice(1))), raw);
      return 0;
    }

    default:
      log.error('command.unknown', { command });
      console.log(USAGE);
      return 1;
  }
}

const invoked = process.argv.slice(2);

main(invoked)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Declining isn't a failure worth a stack of log fields — say so plainly, but still
    // exit non-zero so a script that expected the write to happen notices.
    if (error instanceof Cancelled) {
      console.error(`${error.message} Nothing was changed.`);
      process.exitCode = 1;
      return;
    }

    log.error('command.failed', {
      command: invoked[0],
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
