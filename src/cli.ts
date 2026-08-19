import { readFileSync } from 'fs';
import { CURL_PATH, describeSession, loadSession, Session } from './session';
import { Cancelled, confirm } from './confirm';
import { denormalize, denormalizeAll, Denormalized, Document, Resource } from './jsonapi';
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
  asc app-info [appId]        The whole App Information page in one request: both app info
                              records with their categories and age-rating declarations
  asc categories [appId]      The app's App Store categories: primary and secondary, each
                              with the two subcategory slots only games use
  asc age-rating [appId]      The age-rating questionnaire as JSON, in the shape
                              "set-age-rating" reads back — pipe it to a file and edit it
  asc territory-ratings [appId]
                              The rating Apple worked out for each territory from that
                              questionnaire
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
  asc invites                 Pending invitations to the developer account, by surname
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

  asc set-metadata <locale> <field> <value|-> [versionId]
                              Change one metadata field for one locale. name, subtitle and
                              the privacy URLs are app-wide; description, keywords,
                              promotionalText, whatsNew, marketingUrl and supportUrl belong
                              to the version. Shows you the old value and asks

  asc set-categories [--primary X] [--primary-sub-1 X] [--primary-sub-2 X]
                     [--secondary X] [--secondary-sub-1 X] [--secondary-sub-2 X] [appId]
                              Change the app's App Store categories. Only the slots you
                              name are touched; "none" clears one. Categories belong to the
                              app, so a change is live at once, not when a version ships.
                              Shows the before and after and asks

  asc set-age-rating <file|-> [appId]
                              Replace the age-rating questionnaire from a JSON object of
                              answers. Every question has to be present — start from
                              "asc age-rating". Shows which answers change and asks. Apple
                              recomputes every territory's rating from it
  asc set-content-rights <declaration> [appId]
                              Answer the third-party content question.
                              DOES_NOT_USE_THIRD_PARTY_CONTENT is the captured value;
                              USES_THIRD_PARTY_CONTENT comes from Apple's public API docs
                              and is unproven here. Shows the old answer and asks

These reach Apple and cannot be undone. Each shows what it is about to do and asks first;
--yes answers for you:
  asc send-reply <threadId>   Send the thread's draft to App Review. No unsend, no edit
  asc resolve-item <itemId>   Mark a submission item fixed and put it back in the review
                              queue — what you press after answering a rejection. Item ids
                              come from "asc items <submissionId>"
  asc submit [versionId]      Submit a version for review: create the submission, add the
                              version to it, hand it to Apple. --dry-run prints the steps
                              and sends nothing. NOT captured from the browser — read
                              docs/evidence.md before the first real run
  asc cancel-submission <id>  Withdraw a submission from the queue. Refused once review has
                              started. Also not captured
  asc invite <email> <firstName> <lastName> --role ROLE [--role ...] --all-apps
                              Invite someone to the developer account. Apple emails them,
                              and this client cannot cancel it — only the People page can.
                              --all-apps is required: it says the invitee sees every app,
                              which is the only shape recorded from the browser.
                              --provisioning also gives them certificates and profiles.
                              CUSTOMER_SUPPORT is the recorded role; the other names come
                              from Apple's public API docs and are unproven here

Options:
  --raw                       Print the untouched JSON:API document instead of denormalizing it
  --json                      For "report", "builds", "history" and "privacy": emit JSON
                              instead of the digest
  --yes                       Skip the confirmation prompt on the commands that ask
  --dry-run                   For "submit": work out and print the steps, send nothing
  --force                     For "upload-screenshot": upload despite failed checks
  --reveal                    For "review-details": print the demo account password
  --attach <file>             For "save-draft": a file to attach. Repeat for several
  --role <role>               For "invite": a role to grant. Repeat for several
  --all-apps                  For "invite": the invitee may see every app on the account
  --provisioning              For "invite": the invitee may manage certificates and
                              provisioning profiles
  --primary <category>        For "set-categories", with --primary-sub-1, --primary-sub-2,
                              --secondary, --secondary-sub-1 and --secondary-sub-2: the
                              category name Apple uses as the id, e.g. GAMES, GAMES_TRIVIA,
                              MUSIC. "none" clears the slot

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
  } catch (error) {
    // Not swallowed: "-" means the text is arriving on stdin, and a read that failed is
    // not the same thing as text that was empty. Treating them alike is how a write ends
    // up sending nothing at all.
    throw new Error(
      `Could not read from stdin, which is where "-" expects the text: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * The text behind a `<text|->` argument — typed, or piped in — and never empty.
 *
 * Empty is refused from either source. An empty reply is refused by App Store Connect
 * itself, and an empty metadata value is the destructive case: a here-doc that expanded to
 * nothing looks exactly like deliberately blank text, and with `--yes` it would overwrite a
 * description Apple keeps no copy of. Clearing a field is not an operation any capture
 * covers, so it isn't one this offers by accident — `asc patch` is there for that.
 */
function requireText(given: string, what: string): string {
  const text = given === '-' ? readStdin() : given;
  if (text.trim()) return text;

  throw new Error(
    `Refusing to write an empty ${what}. Pass the text as an argument, or "-" to read it ` +
      'from stdin — where nothing arriving reads as empty text, not as "leave it alone".'
  );
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

/**
 * The version attached to an open review submission, read off the submission's own
 * relationship.
 *
 * Not through `buildReport`: the digest walks the whole Resolution Center — a thread
 * lookup plus messages, rejections and the draft for every open submission — and all that
 * is wanted here is one id, which the submissions call already carries. It also stops a
 * thread that won't read from failing a command that has nothing to do with threads.
 *
 * The linkage is used rather than a sideloaded record, so this doesn't depend on the
 * version being included in the response.
 */
async function versionInReview(session: Session, appId: string): Promise<string | undefined> {
  const submissions = await api.listReviewSubmissions(session, appId);

  for (const submission of submissions.data) {
    const version = submission.relationships?.appStoreVersionForReview?.data;
    if (version && !Array.isArray(version)) return version.id;
  }

  return undefined;
}

/** Falls back to the version attached to the first open review submission. */
async function versionUnderReview(session: Session, appId: string): Promise<string> {
  const inReview = await versionInReview(session, appId);
  if (inReview) return inReview;

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
 * The version to act on: the one named on the command line, or else the one under review.
 *
 * The app id is only looked up when that fallback is actually needed. Asking for it up
 * front refuses `asc version <versionId>` on a capture that carries no app — a bare
 * `Cookie:` line makes one of those, and it is a supported way to do it — and refuses it
 * with advice there is no argument to follow.
 */
async function requireVersionId(session: Session, given: string | undefined): Promise<string> {
  return given ?? versionUnderReview(session, requireAppId(session, undefined));
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
 * The part of a draft the confirmation was about: the text, and which files go with it.
 *
 * Ordering the attachments makes this about the set rather than the order iris happened to
 * list it in. The draft's own id is in there because a delete-and-recreate returns the same
 * id — see [replying](../docs/replying.md) — so it wouldn't catch that on its own, but a
 * changed one is certainly a different draft.
 */
function draftState(draft: Denormalized): string {
  const attachments = (draft['resolutionCenterMessageAttachments'] ?? []) as Denormalized[];

  return JSON.stringify({
    id: draft.id,
    body: String(draft['messageBody'] ?? ''),
    attachments: attachments.map((file) => `${file.id}:${String(file['fileName'] ?? '')}`).sort(),
  });
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

/**
 * What `set-metadata` shows before it asks. Both values in full: Apple keeps no history,
 * so this printout is the only copy of the old text anyone gets.
 */
function describeMetadataChange(target: api.MetadataField, value: string): string[] {
  const rule = '─'.repeat(72);
  const scope =
    target.resource === 'appInfoLocalizations'
      ? 'the app itself — this changes what is on the store now'
      : 'this version — it ships when the version does';

  return [
    '',
    `  field:   ${target.field} (${target.locale})`,
    `  record:  ${target.resource}/${target.localizationId}`,
    `  scope:   ${scope}`,
    '',
    '  now:',
    rule,
    target.current ?? '(empty)',
    rule,
    '  becomes:',
    rule,
    value.trimEnd(),
    rule,
    '',
  ];
}

/** What `submit` is about to do, step by step — also the whole of `--dry-run`. */
function describePlan(plan: api.SubmissionPlan): string[] {
  const version = `${plan.versionString ?? plan.versionId} (${plan.platform})`;

  if (plan.inFlight) {
    return [
      '',
      `  Submission ${plan.inFlight.id} is already with Apple: ${plan.inFlight.state}.`,
      '  Nothing to submit.',
      '  Cancel it first if you mean to replace it.',
      '',
    ];
  }

  // A rejection isn't a dead submission — it's the same one, waiting on you. It can go
  // back, but not while Apple still has an item open on it.
  if (plan.unresolvedItemIds?.length) {
    return [
      '',
      `  Submission ${plan.submissionId} came back from Apple with ` +
        `${plan.unresolvedItemIds.length} item(s) still open.`,
      '  Fix what Apple asked for, then resolve each one:',
      '',
      ...plan.unresolvedItemIds.map((id) => `    asc resolve-item ${id}`),
      '',
      '  Then "asc submit" hands it back.',
      '',
    ];
  }

  return [
    '',
    `  app:      ${plan.appId}`,
    `  version:  ${version}`,
    '',
    plan.submissionId
      ? `  1. reuse submission ${plan.submissionId}`
      : '  1. POST reviewSubmissions — create one',
    plan.itemId
      ? `  2. the version is already on it as item ${plan.itemId}`
      : '  2. POST reviewSubmissionItems — add the version to it',
    '  3. PATCH reviewSubmissions/{id} {"submitted":true} — hand it to App Review',
    '',
    '  Step 3 is confirmed against a live submission; steps 1-2 are not captured from the',
    '  browser: see docs/evidence.md.',
    '',
  ];
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
    if (value === undefined) throw new Error(`${name} needs a value`);
    values.push(value);
    i++;
  }

  return { values, rest };
}

/** The flag that sets each category slot, in the order the App Information page lists them. */
const CATEGORY_FLAGS: ReadonlyArray<{ flag: string; slot: api.AppCategorySlot; label: string }> = [
  { flag: '--primary', slot: 'primaryCategory', label: 'primary' },
  { flag: '--primary-sub-1', slot: 'primarySubcategoryOne', label: '  sub 1' },
  { flag: '--primary-sub-2', slot: 'primarySubcategoryTwo', label: '  sub 2' },
  { flag: '--secondary', slot: 'secondaryCategory', label: 'secondary' },
  { flag: '--secondary-sub-1', slot: 'secondarySubcategoryOne', label: '  sub 1' },
  { flag: '--secondary-sub-2', slot: 'secondarySubcategoryTwo', label: '  sub 2' },
];

/**
 * Reads the `--primary`/`--secondary` family out of the arguments. Unlike `--attach` these
 * are one-shot: naming a slot twice is a typo, not two categories.
 */
function takeCategoryOptions(argv: string[]): { update: api.AppCategoryUpdate; rest: string[] } {
  const update: api.AppCategoryUpdate = {};
  let rest = argv;

  for (const { flag, slot } of CATEGORY_FLAGS) {
    const taken = takeOption(rest, flag);
    rest = taken.rest;
    if (taken.values.length > 1) throw new Error(`${flag} was given more than once`);
    const value = taken.values[0];
    if (value !== undefined) update[slot] = value === 'none' ? null : value;
  }

  return { update, rest };
}

/**
 * The App Information page in one request, narrowed to the record that can be edited.
 * Everything on that page — categories, age rating, and the ids the writes need — comes
 * out of this.
 *
 * The document is kept alongside the record because the two commands built on it want
 * different things. Categories are relationships and read best spliced in; the age-rating
 * declaration is a record in its own right, and splicing it into anything would mix its
 * relationships in among the answers.
 */
interface AppInfoPage {
  document: Document<Resource[]>;
  appInfo: Resource;
}

async function readAppInfoPage(session: Session, appId: string): Promise<AppInfoPage> {
  const document = await api.listAppInfoPage(session, appId);
  return { document, appInfo: api.pickEditableAppInfo(document.data, appId) };
}

/** The editable record with its six category relationships resolved, ready to print. */
function withCategories(page: AppInfoPage): Denormalized {
  return denormalize(page.document, page.appInfo);
}

/**
 * The age-rating declaration on that page: the id a write goes to, and the questionnaire as
 * `age-rating` prints it and `set-age-rating` reads it back in.
 *
 * The questions are whatever the declaration's own attributes are — the recorded set is one
 * app's, so reading them back is the only way to know what this app was asked.
 */
function ageRatingOn(page: AppInfoPage): { id: string; answers: api.AgeRatingAnswers } {
  const declaration = api.findAgeRatingDeclaration(page.document, page.appInfo);
  return { id: declaration.id, answers: api.ageRatingAnswersFrom(declaration.attributes ?? {}) };
}

/** Only the questions whose answers differ, as the confirmation lists them. */
function describeAgeRatingChange(before: api.AgeRatingAnswers, after: api.AgeRatingAnswers): string[] {
  const changed = Object.keys(after).filter((question) => before[question] !== after[question]);
  const width = Math.max(0, ...changed.map((question) => question.length));

  return [
    ...changed.map((q) => `  ${q.padEnd(width)}  ${JSON.stringify(before[q])} -> ${JSON.stringify(after[q])}`),
    ...(changed.length ? [] : ['  (no answer differs from what is there now)']),
    '',
    `  All ${Object.keys(after).length} answers are resent, as the browser sends them.`,
  ];
}

/** The category in a slot, or undefined if the record doesn't carry that relationship. */
function categoryIn(appInfo: Denormalized, slot: api.AppCategorySlot): string | null | undefined {
  const value = appInfo[slot];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return (value as Denormalized).id;
}

/** The six slots as `asc categories` prints them, and as the confirmation shows them. */
function describeCategories(appInfo: Denormalized, update: api.AppCategoryUpdate = {}): string[] {
  return CATEGORY_FLAGS.map(({ slot, label }) => {
    const value = slot in update ? update[slot] : categoryIn(appInfo, slot);
    return `  ${label.padEnd(11)} ${value ?? '—'}`;
  });
}

async function main(argv: string[]): Promise<number> {
  const { values: attach, rest: afterAttach } = takeOption(argv, '--attach');
  const { values: roles, rest: afterRoles } = takeOption(afterAttach, '--role');
  const { update: categories, rest: positional } = takeCategoryOptions(afterRoles);
  const raw = positional.includes('--raw');
  const json = positional.includes('--json');
  const force = positional.includes('--force');
  const reveal = positional.includes('--reveal');
  const yes = positional.includes('--yes');
  const dryRun = positional.includes('--dry-run');
  const allApps = positional.includes('--all-apps');
  const provisioning = positional.includes('--provisioning');
  const flags = new Set([
    '--raw',
    '--json',
    '--force',
    '--reveal',
    '--yes',
    '--dry-run',
    '--all-apps',
    '--provisioning',
  ]);
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
      const versionId = await requireVersionId(session, rest[0]);
      emit(await api.getVersion(session, versionId) as Document, raw);
      return 0;
    }

    case 'builds': {
      const session = loadSession();
      const builds = await fetchBuilds(session, await requireVersionId(session, rest[0]));
      console.log(json ? JSON.stringify(builds, null, 2) : formatBuilds(builds));
      return 0;
    }

    case 'history': {
      const session = loadSession();
      const changes = await fetchHistory(session, await requireVersionId(session, rest[0]));
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
      // "-" for stdin: a reply to App Review runs to paragraphs, and quoting all of that
      // into a shell argument is how newlines get lost.
      const body = requireText(requireArg(rest[1], 'text', example), 'draft');

      const document = await api.saveDraftReply(session, { threadId, body, attach });
      emit(document, raw);
      console.error('Saved as a draft. Nothing has been sent — "asc send-reply" does that.');
      return 0;
    }

    case 'send-reply': {
      const session = loadSession();
      const threadId = requireArg(rest[0], 'threadId', 'send-reply <threadId>');

      // Read the draft here rather than letting `sendDraftReply` do it in one call, because
      // what's in the box is the whole of what the confirmation is about. Same check either
      // way — `findSendableDraft` is what both go through.
      const document = await api.findSendableDraft(session, threadId);
      const draft = denormalize(document, document.data);

      await confirm({
        question: 'Send this to App Review? It cannot be edited or taken back.',
        detail: describeDraft(threadId, draft),
        yes,
      });

      // Send posts a *reference* to the draft, so what Apple copies is whatever is in the
      // box when the POST lands — not the text printed above. Those are two different
      // reads with a question in between, and App Store Connect autosaves the box as you
      // type, so a browser open on this thread moves it under you. Read it again and
      // refuse if it moved. That doesn't close the window — nothing here can, there is no
      // conditional write — it shortens it from however long the prompt was on screen to
      // the round trip below.
      const now = await api.findSendableDraft(session, threadId);
      if (draftState(denormalize(now, now.data)) !== draftState(draft)) {
        throw new Error(
          `The draft on thread ${threadId} changed while the question was on screen, so what ` +
            'was agreed to is not what would have been sent. Nothing was sent. Check it with ' +
            '"asc draft" and send again.'
        );
      }

      const sent = await api.sendDraftMessage(session, draft.id);
      emit(sent as Document, raw);
      console.error(`Sent. Message ${sent.data.id} is on thread ${threadId}.`);
      return 0;
    }

    case 'set-metadata': {
      const session = loadSession();
      const example = 'set-metadata en-GB subtitle "Race weekend times"';
      const locale = requireArg(rest[0], 'locale', example);
      const field = requireArg(rest[1], 'field', example);
      // Descriptions run to paragraphs, same as a reply — "-" keeps their newlines intact.
      const value = requireText(requireArg(rest[2], 'value', example), `${field} (${locale})`);

      const appId = requireAppId(session, undefined);
      const versionId = rest[3] ?? (await versionUnderReview(session, appId));
      const target = await api.findMetadataField(session, { appId, versionId, locale, field });

      await confirm({
        question: `Replace ${target.field} (${target.locale})? The old text is not recoverable.`,
        detail: describeMetadataChange(target, value),
        yes,
      });

      emit((await api.setMetadataField(session, target, value)) as Document, raw);
      return 0;
    }

    case 'submit': {
      const session = loadSession();
      const appId = requireAppId(session, undefined);
      const versionId = rest[0] ?? (await versionUnderReview(session, appId));
      const plan = await api.planSubmission(session, appId, versionId);
      const steps = describePlan(plan);

      if (dryRun) {
        console.log(steps.join('\n'));
        return 0;
      }
      if (plan.inFlight) {
        // Refused either way, but saying so before the prompt beats asking a question
        // whose only honest answer is "no".
        log.error('submission.inFlight', plan.inFlight);
        console.error(steps.join('\n'));
        return 1;
      }

      await confirm({ question: 'Submit this to App Review?', detail: steps, yes });

      const submission = await api.runSubmission(session, plan);
      console.log(JSON.stringify(submission, null, 2));
      console.error(`Submitted. Submission ${submission.id} is with Apple.`);
      return 0;
    }

    case 'cancel-submission': {
      const session = loadSession();
      const id = requireArg(rest[0], 'submissionId', 'cancel-submission <submissionId>');
      await confirm({ question: `Withdraw submission ${id} from the review queue?`, yes });
      emit((await api.cancelReviewSubmission(session, id)) as Document, raw);
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

    case 'invite': {
      const session = loadSession();
      const usage = 'invite <email> <firstName> <lastName> --role ROLE --all-apps';
      const email = requireArg(rest[0], 'email', usage);
      const firstName = requireArg(rest[1], 'firstName', usage);
      const lastName = requireArg(rest[2], 'lastName', usage);
      if (!roles.length) throw new Error(`An invitation needs at least one --role. Example: asc ${usage}`);
      if (!allApps) {
        throw new Error(
          'Pass --all-apps to say the invitee may see every app on the account. Restricting an ' +
            'invitation to named apps is not supported: the browser was never recorded sending ' +
            'that shape, so there is no body to copy.'
        );
      }

      await confirm({
        question: `Invite ${email} to the developer account?`,
        detail: [
          '',
          `  person:       ${firstName} ${lastName} <${email}>`,
          `  roles:        ${roles.join(', ')}`,
          '  apps:         every app on the account',
          `  provisioning: ${provisioning ? 'yes — certificates and profiles' : 'no'}`,
          '',
          '  Apple emails them. This client has no way to cancel an invitation; the People',
          '  page in the browser does.',
          '',
        ],
        yes,
      });

      const invited = await api.inviteUser(session, {
        email,
        firstName,
        lastName,
        roles,
        provisioningAllowed: provisioning,
        allAppsVisible: true,
      });
      emit(invited as Document, raw);
      const expires = invited.data.attributes?.['expirationDate'];
      console.error(`Invited ${email}${expires ? `. The invitation expires ${String(expires)}` : ''}.`);
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

    case 'app-info': {
      const session = loadSession();
      const appId = requireAppId(session, rest[0]);
      const document = await api.listAppInfoPage(session, appId);
      emit(document, raw);
      return 0;
    }

    case 'categories': {
      const session = loadSession();
      const page = await readAppInfoPage(session, requireAppId(session, rest[0]));
      console.log(describeCategories(withCategories(page)).join('\n'));
      return 0;
    }

    case 'set-categories': {
      const session = loadSession();
      const appId = requireAppId(session, rest[0]);
      if (!Object.keys(categories).length) {
        throw new Error(
          'Nothing to change. Name at least one slot: set-categories --primary GAMES --primary-sub-1 GAMES_TRIVIA'
        );
      }

      const current = withCategories(await readAppInfoPage(session, appId));

      await confirm({
        question: "Change this app's App Store categories? They are live as soon as this lands.",
        detail: [
          '',
          `  record:  appInfos/${current.id}`,
          '  scope:   the app itself — categories are not held back until a version ships',
          '',
          '  now:',
          ...describeCategories(current),
          '  becomes:',
          ...describeCategories(current, categories),
          '',
        ],
        yes,
      });

      await api.setAppCategories(session, current.id, categories);
      // Read back rather than trust the PATCH's own echo — the browser does the same.
      emit(await api.getAppInfoCategories(session, current.id), raw);
      return 0;
    }

    case 'age-rating': {
      const session = loadSession();
      const page = await readAppInfoPage(session, requireAppId(session, rest[0]));
      console.log(JSON.stringify(ageRatingOn(page).answers, null, 2));
      return 0;
    }

    case 'territory-ratings': {
      const session = loadSession();
      const page = await readAppInfoPage(session, requireAppId(session, rest[0]));
      emit(await api.listTerritoryAgeRatings(session, page.appInfo.id), raw);
      return 0;
    }

    case 'set-age-rating': {
      const session = loadSession();
      const source = requireArg(rest[0], 'file|-', 'set-age-rating answers.json');
      const appId = requireAppId(session, rest[1]);
      const text = source === '-' ? readStdin() : readFileSync(source, 'utf8');

      // The current declaration is read first because it defines the questionnaire: which
      // questions this app was asked is Apple's answer to give, not this client's.
      const current = ageRatingOn(await readAppInfoPage(session, appId));
      const answers = api.parseAgeRatingAnswers(JSON.parse(text), current.answers);

      await confirm({
        question: "Replace this app's age-rating answers?",
        detail: [
          '',
          `  record:  ageRatingDeclarations/${current.id}`,
          '  scope:   the app itself — Apple recomputes every territory rating from this',
          '',
          ...describeAgeRatingChange(current.answers, answers),
          '',
        ],
        yes,
      });

      emit(await api.setAgeRating(session, current.id, answers), raw);
      return 0;
    }

    case 'set-content-rights': {
      const session = loadSession();
      const declaration = requireArg(
        rest[0],
        'declaration',
        'set-content-rights DOES_NOT_USE_THIRD_PARTY_CONTENT'
      );
      const appId = requireAppId(session, rest[1]);
      const document = await api.getApp(session, appId);
      const app = denormalize(document, document.data);

      await confirm({
        question: "Change this app's third-party content declaration?",
        detail: [
          '',
          `  record:  apps/${appId}`,
          `  now:     ${String(app['contentRightsDeclaration'] ?? '(unanswered)')}`,
          `  becomes: ${declaration}`,
          '',
        ],
        yes,
      });

      emit(await api.setContentRights(session, appId, declaration), raw);
      return 0;
    }

    case 'screenshots': {
      const session = loadSession();
      const versionId = await requireVersionId(session, rest[0]);
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
      const versionId = await requireVersionId(session, rest[0]);
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

    case 'invites': {
      const session = loadSession();
      emit(await api.listUserInvitations(session), raw);
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
