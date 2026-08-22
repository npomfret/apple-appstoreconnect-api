import { Session } from './session';
import * as api from './api';
import { denormalizeAll, Denormalized } from './jsonapi';

export interface Guideline {
  /**
   * Apple's own guideline number, `4.1.0` — the whole of what identifies the rule cited.
   *
   * The reason it arrives on carries a `reasonSection` beside it, and that is this with the
   * last segment cut off rather than a second fact: `4.1` against `4.1.0`, digits and dots
   * both. It is read here only as a fallback for a reason with no code at all.
   */
  code: string;
  /**
   * Apple's own wording, `Design: Copycats` — the section's name and the rule's, as sent.
   * The readable half of `4.1` is in here, not in a field of its own.
   */
  description: string;
}

export interface Attachment {
  /** iris's own id for the file, which is what makes two of them different. */
  id: string;
  /**
   * What iris called the file, where it called it anything.
   *
   * Optional because a name is a label rather than an identity: a file with none is still
   * on the thread, still countable, and still downloadable by the id above. It was
   * required until 2026-08-22, and the effect of requiring it was that a nameless file was
   * dropped — off a list whose own heading is a count. Every attachment recorded from the
   * browser has a name.
   */
  fileName?: string;
  fileSize?: number;
  downloadUrl?: string;
}

/** A version a report is about: the id always, the number when the response carried one. */
export interface VersionRef {
  versionId: string;
  version?: string;
}

export interface SubmissionReport {
  /**
   * The submission the report was asked about, echoed back — only `buildReport`'s
   * `{ submissionId }` route has one.
   *
   * Nothing here reads a submission. Its `state`, `platform` and dates live on
   * `reviewSubmissions`, which Apple serves officially at
   * `GET /v1/apps/{id}/reviewSubmissions`; read them there rather than expecting them on a
   * report.
   */
  submissionId?: string;
  /**
   * The version under review, when the report is about exactly one. A thread relates to
   * versions to-many, so one naming several leaves this unsaid and lists them all in
   * `versions` rather than picking between them.
   */
  version?: string;
  /** Id of that version — feed it to `asc history`. */
  versionId?: string;
  /** Every version the report is about. Empty when its source named none. */
  versions: VersionRef[];
  threadId?: string;
  /** Apple's stamp, verbatim. `--json` carries it as it arrived; only the digest shortens it. */
  lastMessageDate?: string;
  /**
   * True when Apple sent the last message, false when your side did. Absent when there is
   * no last message *or* when its actor was neither of the two kinds the captures show —
   * the two are told apart by `lastMessageDate`, which is set in the second case and not
   * the first. It is deliberately not a plain boolean: see `senderOf`.
   */
  lastMessageFromApple?: boolean;
  /** Apple's most recent message, tags stripped. */
  lastAppleMessage?: string;
  guidelines: Guideline[];
  attachments: Attachment[];
  hasDraftReply: boolean;
}

/**
 * The entities Apple's editor emits, decoded in one pass.
 *
 * One pass because a chain of replacements is not a decoder: `&amp;` has to run somewhere
 * in it, and everything after it then reads its output. `&amp;lt;` — which is how a
 * reviewer who typed the four characters `&lt;` arrives here — came out as `&lt;` and then
 * as `<`, a character nobody wrote. Anything outside this set is left exactly as it stands
 * rather than guessed at; these are the ones the message bodies have shown.
 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Apple sends message bodies as fragments of HTML; the digest wants readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  - ')
    // Tags first, so that a decoded "<" is read as the text it is and not as markup.
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Who sent a message. `unknown` is a real answer here, not a placeholder — see `senderOf`. */
type Sender = 'apple' | 'you' | 'unknown';

/**
 * Which side a message came from, which is the most consequential thing the digest says.
 *
 * `fromActor` is in the include list, so the actor arrives with its attributes rather than
 * as a reference, and `actorType` is the field that answers this. Every actor in every
 * Resolution Center response recorded from the browser carries it, and it is `APPLE` or
 * `USER`: 29 actors across five recordings, no third value. Apple's is additionally the
 * literal id `APPLE`, with no name or email against it, and that id is the fallback below
 * for a `fromActor` that arrived as a bare reference because nothing sideloaded it.
 *
 * Neither test is a prefix match, and this does not read the id when it has the attribute.
 * It used to do both — `id.toUpperCase().startsWith('APPLE')` — which was a guess about a
 * field that never had to carry the question, since `actorType` was beside it the whole
 * time and says so outright.
 *
 * The third answer is not padding. An `apiKeyId` attribute sits beside `actorType`, null in
 * every capture, so an actor standing for an API key is probably a value nobody here has
 * seen — and the digest must not print a sender it does not recognise as though it were
 * you. That mistake is the tool saying the thread is waiting on Apple when it is waiting on
 * you, which is the one thing it exists to get right.
 */
function senderOf(message: Denormalized): Sender {
  const from = message['fromActor'];
  if (!from || typeof from !== 'object') return 'unknown';

  const { actorType, id } = from as { actorType?: unknown; id?: unknown };
  if (actorType === 'APPLE') return 'apple';
  if (actorType === 'USER') return 'you';
  if (actorType !== undefined) return 'unknown';

  // No attributes: this is a bare reference, and the id is all there is to go on.
  return id === 'APPLE' ? 'apple' : 'unknown';
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

/**
 * The guidelines a thread's rejections cite, lowest number first and each one once.
 *
 * **There is no section field, because `reasonSection` was never one.** Every reason in
 * every recording carries exactly `reasonCode`, `reasonSection` and `reasonDescription`,
 * all three strings and none of them null — and the section is the code with its last
 * segment removed, `4.1` beside `4.1.0`, digits and dots in both. So it is a prefix of a
 * field already here and tells a caller nothing. What anyone reading `guideline.section`
 * would expect from the name is the section's *title*, and that is the first word of
 * `reasonDescription`, ahead of a colon: `Design: Copycats`. This type carried a `section`
 * holding `4.1` until 2026-08-21 — printed by nothing, and promising the half it did not
 * have.
 *
 * It is still read once, as the code for a reason that arrived without one, since `4.1` is
 * a guideline you can look up and nothing is not. No recorded reason is missing a code, so
 * that branch is a guard rather than an observation.
 *
 * **What cannot be dropped.** A reason names a guideline or it names nothing, and the digest
 * prints this block only when it has rows — so a reason skipped here is a thread that reads
 * as citing no guideline at all, on a report whose entire subject is why the submission was
 * rejected. Until 2026-08-22 two shapes were skipped in exactly that way: a rejection whose
 * `reasons` was not a list, and a reason carrying neither a code nor a section. Both are
 * refused now, the way `collectAttachments` refuses a file with no id and for the same
 * reason — a missing identity is not a missing label. The description *is* the label, and an
 * absent one still lists: a guideline number with no title is the half you can look up.
 *
 * Counted across the recordings on 2026-08-22: four distinct rejections, each re-served in
 * all 16 and carrying one, two, two and three reasons — 64 rejection resources and 128 reason
 * objects as they appear on the wire. Every one has `reasons` as its only attribute and every
 * one of those is a list; every reason carries exactly `reasonCode`, `reasonSection` and
 * `reasonDescription`, all three non-empty strings. So both refusals decide shapes Apple has
 * not been seen to send rather than correcting ones it has.
 *
 * **Deduplicating by code** is what the map is for, and both duplicates it covers are
 * recorded: one rejection cites the same code twice inside its own `reasons`, and the four
 * rejections on the recorded thread cite two codes between them. The first wording wins,
 * and there is no better rule available — `reasons` is a rejection's *only* attribute, so
 * nothing dates them and nothing says which citation came last.
 */
function collectGuidelines(rejections: Denormalized[]): Guideline[] {
  const byCode = new Map<string, Guideline>();

  for (const rejection of rejections) {
    const reasons = rejection['reasons'];
    if (!Array.isArray(reasons)) {
      throw new Error(
        'A review rejection arrived with no list of reasons, which is the only attribute iris ' +
          'puts on one. Refusing the report rather than reading it as a rejection that cited ' +
          'no guideline, which is what skipping it would print.'
      );
    }
    for (const entry of reasons) {
      const reason = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined;
      const code = reason && (asString(reason['reasonCode']) ?? asString(reason['reasonSection']));
      if (!code) {
        throw new Error(
          'A rejection reason arrived with neither a reasonCode nor a reasonSection, so it names ' +
            'no guideline and there is nothing to tell it from another reason by. Refusing the ' +
            'report rather than dropping it: the guidelines are printed only when there are ' +
            'rows, so a dropped reason is a rejection that reads as citing nothing.'
        );
      }
      if (byCode.has(code)) continue;
      byCode.set(code, { code, description: asString(reason['reasonDescription']) ?? '' });
    }
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/**
 * The two relationships a file arrives on, which is two because Apple hangs files off two
 * different records.
 *
 * A message carries what the reviewer sent with it. A rejection carries what the rejection
 * itself is showing you — and both sideload the same resource type, with the same
 * attributes, so one reader does both. The names differ because the relationships do:
 * `include=rejectionAttachments` is on the rejections query and nothing else.
 */
const ATTACHMENT_RELATIONSHIPS = ['resolutionCenterMessageAttachments', 'rejectionAttachments'] as const;

/**
 * Everything Apple attached to the conversation, from both places it attaches things,
 * keyed by the id iris gave it.
 *
 * **Both places.** The rejections query has asked for `rejectionAttachments` since it was
 * copied from the browser, with a page size of 1000 — and the digest read none of them. In
 * the recorded thread that is two files fetched and dropped, and they are the ones a
 * rejection is answered with: 60 KB and 56 KB beside the messages' 2 MB videos, which is
 * what a screenshot of the offending screen weighs. A digest of a review conversation that
 * silently omits the screenshots Apple marked up is missing the part you act on.
 *
 * **Keyed by id.** The id is the identity, and a file name is not. Every messages response
 * recorded from the browser carries three attachments under two names: two of them sit on
 * the same message with the same name and the same byte count, and have different ids and
 * different download URLs. Keying this by name collapsed those two into one, so the digest
 * said "attachments (2)" where iris had said three and dropped one of the two download URLs
 * — and a reviewer attaching `IMG_4821.png` in one round and a different `IMG_4821.png` in
 * the next is the same collapse over files that are not alike at all.
 *
 * Nothing is lost by keying on the id: no id occurs twice in any recording, and the message
 * files and the rejection files are disjoint in the two recordings that carry both. The map
 * is what stops a record sideloaded twice from being listed twice, which is the only
 * duplicate there is evidence for.
 *
 * **A file with no name is still a file, and an id is the one thing that cannot be missing.**
 * Until 2026-08-22 a missing `fileName` was skipped in the same expression as the duplicate
 * above, so a nameless attachment left the digest with no trace at all — while `asc draft`
 * listed the same resource as `(no file name)` and `draftState` counted it into the change
 * fingerprint. One resource type, three readers, and only this one made it disappear; the
 * heading it disappeared from is a count, which is the failure the paragraph above is about
 * arrived at by another route. A missing `id` is the opposite case and is refused rather
 * than listed: there is nothing to deduplicate on, nothing to fetch the file with, and the
 * line would name no file. All 34 attachment rows across the recordings carry an id, a name
 * and a size — one, on a draft, carries no `downloadUrl` — so both of these decide shapes
 * Apple has not been seen to send rather than fixing ones it has.
 */
function collectAttachments(sources: Denormalized[]): Attachment[] {
  const byId = new Map<string, Attachment>();

  for (const source of sources) {
    for (const relationship of ATTACHMENT_RELATIONSHIPS) {
      const attachments = source[relationship];
      if (!Array.isArray(attachments)) continue;
      for (const attachment of attachments as Array<Record<string, unknown>>) {
        const id = asString(attachment['id']);
        if (!id) {
          throw new Error(
            'iris sideloaded an attachment with no id, so there is nothing to tell it from ' +
              'another file by and nothing "delete-attachment" could be given. Refusing the ' +
              'report rather than printing a line that identifies no file, or dropping it and ' +
              'printing a count that is short by one.'
          );
        }
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          fileName: asString(attachment['fileName']),
          fileSize: typeof attachment['fileSize'] === 'number' ? attachment['fileSize'] : undefined,
          downloadUrl: asString(attachment['downloadUrl']),
        });
      }
    }
  }

  return [...byId.values()];
}

/**
 * Where a report starts. All three routes are private ones: Apple's official API has no
 * Resolution Center, so no starting point here duplicates a call it serves.
 *
 * - `threadId` — nothing is discovered; the report is the thread.
 * - `submissionId` — the thread is found by `resolutionCenterThreads?filter[reviewSubmission]`,
 *   a private filter. The submission's own state and dates are not fetched; the id you
 *   passed is reported back as given.
 * - `appId` — every Resolution Center thread on the app, from
 *   `apps/{id}/resolutionCenterThreads`. The version each thread is about comes off the
 *   thread's own `appStoreVersions`, so this route reads no submission either. What it
 *   cannot supply is the submission id, state and dates: those live on `reviewSubmissions`,
 *   which Apple serves officially, and are left unsaid rather than read from here.
 */
export type ReportTarget =
  | { readonly appId: string }
  | { readonly submissionId: string }
  | { readonly threadId: string };

/**
 * Digests a review conversation: one report per Resolution Center thread when given an app,
 * or the single one behind a submission or thread id.
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

  const threads = denormalizeAll(await api.listThreads(session, target.appId));
  return Promise.all(threads.map((thread) => reportForThread(session, thread)));
}

/** A report with nothing in it yet — everything a thread cannot tell you is left unsaid. */
function blankReport(): SubmissionReport {
  return { guidelines: [], attachments: [], hasDraftReply: false, versions: [] };
}

/**
 * The versions a thread is about, off its own `appStoreVersions` relationship.
 *
 * That relationship is to-many — the recorded threads query asks for up to 2000 of them —
 * so this is a list, and a thread naming more than one is reported as naming more than one
 * rather than reduced to whichever came back first. A reference the response did not expand
 * arrives as a bare `{type, id}` and contributes an id with no version number.
 */
function versionsOf(thread: Denormalized): VersionRef[] {
  const related = thread['appStoreVersions'];
  if (!Array.isArray(related)) return [];

  return related.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const versionId = asString(record['id']);
    return versionId ? [{ versionId, version: asString(record['versionString']) }] : [];
  });
}

async function reportForThread(session: Session, thread: Denormalized): Promise<SubmissionReport> {
  const versions = versionsOf(thread);
  // One version is the ordinary case and the one the digest can name; several is reported
  // as several. No submission is read, so there is no state or submitted date to carry.
  const only = versions.length === 1 ? versions[0] : undefined;

  const report = { ...blankReport(), version: only?.version, versionId: only?.versionId, versions };
  return addThread(session, report, thread.id);
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
  const rejections = denormalizeAll(rejectionsDoc);
  // Newest message first, then the rejections, so the most recent thing Apple sent heads
  // the list and the files a rejection is arguing with stay together at the end of it.
  report.attachments = collectAttachments([...messages, ...rejections]);
  report.guidelines = collectGuidelines(rejections);
  report.hasDraftReply = draftDoc.data !== null && draftDoc.data !== undefined;

  const latest = messages[0];
  if (latest) {
    report.lastMessageDate = asString(latest['createdDate']);
    // Left unset when the sender is not one of the two recorded kinds, so that a caller
    // reading the JSON cannot mistake "we could not tell" for "not Apple".
    const sender = senderOf(latest);
    if (sender !== 'unknown') report.lastMessageFromApple = sender === 'apple';
  }

  const latestFromApple = messages.find((message) => senderOf(message) === 'apple');
  const body = latestFromApple && asString(latestFromApple['messageBody']);
  if (body) report.lastAppleMessage = htmlToText(body);

  return report;
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
        // appStoreState and appVersionState have agreed on every capture so far, and the
        // first is the one the History tab shows. They are not interchangeable in general:
        // 4.4.1 deprecates appStoreState, and the two enums diverge once a version ships
        // (READY_FOR_SALE against READY_FOR_DISTRIBUTION), so the fallback is a real second
        // answer rather than a copy of the first.
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

/** Day, minute, and the zone it was said in — with the seconds and any fraction dropped. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * "2026-04-25T07:34:29-07:00" -> "2026-04-25 07:34-07:00", keeping the offset honest.
 *
 * Apple stamps two ways and both are rendered here. A version's state change carries a local
 * offset, as above; a Resolution Center message carries `Z` and a fraction of a second, and
 * `2026-05-17T12:25:06.31Z` shortens to `2026-05-17 12:25Z`. Cutting at fixed positions did
 * the first shape and made the second read `12:25.31Z`, so the parts are matched instead.
 *
 * The zone is shown rather than resolved into whichever one the reader is sitting in: around
 * a daylight-saving change that is the difference between two stamps that look an hour apart
 * and two that are, and this is read beside Apple's own UI. A stamp in neither shape is
 * printed as it arrived — one this doesn't recognise is one to show, not one to cut into
 * something that is no longer a time.
 */
function shortDate(date: string | undefined): string {
  if (!date) return 'unknown date';
  return date.replace(TIMESTAMP, '$1 $2$3');
}

/**
 * Rounds a span to its largest useful unit — exact seconds mean nothing after a day.
 *
 * The rounding happens before the split, not after. Taking the whole part of the large unit
 * and then rounding what was left over separately means the two are decided independently,
 * so the remainder can round up to a full unit and be printed as one: 59m 59s came out as
 * "60m", 23h 59m 59s as "23h 60m", and 1d 23h 40m as "1d 24h". Every one of those is a
 * carry that was calculated and then not made.
 */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  const hours = Math.round(minutes / 60);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/**
 * The states that mean Apple sent the version back, which is what "rejected" counts.
 *
 * Three of them, not one. `appStoreState` and `appVersionState` are Apple's own fields and
 * carry Apple's own vocabulary — every value in the recording is spelled exactly as
 * `AppStoreVersionState` and `AppVersionState` spell it in specification 4.4.1 — and both
 * enums list `REJECTED` and `METADATA_REJECTED` as separate states. Counting only the first
 * missed every metadata rejection, which is the kind this client is mostly *for*: a 4.1
 * thread is a metadata rejection, so the tally could read "rejected once" under a timeline
 * showing three, and the one number in `asc history` nobody reads twice was the wrong one.
 *
 * `DEVELOPER_REJECTED` is deliberately not here. That is your own withdrawal and it has its
 * own state, so the two never have to be told apart by who initiated them. `INVALID_BINARY`
 * is not here either — a build Apple would not process is not a review outcome — and both
 * still print in the timeline above like any other state.
 *
 * Only `REJECTED` occurs in any recording. The other is read off Apple's enum for the same
 * field rather than observed, which is why the set is exactly two: a state that means a
 * rejection and is spelled some third way would still be missed.
 */
const REJECTED_BY_APPLE = new Set(['REJECTED', 'METADATA_REJECTED']);

/** Renders the history as a timeline. */
export function formatHistory(changes: StateChange[]): string {
  if (changes.length === 0) return 'No recorded state changes for this version.';

  const lines = changes.map((change) => {
    const who = change.byApple ? 'Apple' : (change.initiator ?? 'unknown');
    const held = change.heldForSeconds === undefined ? '(current)' : duration(change.heldForSeconds);

    return [shortDate(change.date), change.state.padEnd(22), who.padEnd(28), held].join('  ');
  });

  const reviews = changes.filter((change) => change.state === 'IN_REVIEW').length;
  const rejections = changes.filter((change) => REJECTED_BY_APPLE.has(change.state)).length;
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
  /**
   * True when the app declares it collects nothing at all, and that is the whole of what it
   * declares. A "collects nothing" row arriving beside a declared collection leaves this
   * `false`, since the app plainly collects something; the rows are all in `usages`.
   */
  collectsNothing: boolean;
  usages: DataUsage[];
}

/**
 * The row Apple uses to say "nothing at all", which is not the same as an empty list.
 *
 * Recorded once, from an app that declares nothing: one row with no category, no grouping,
 * no purpose, and this protection. Shared by the field and the digest so that what
 * `collectsNothing` is computed from and what the digest calls a contradiction cannot drift.
 */
function declaresNothingCollected(usage: DataUsage): boolean {
  return usage.protection === 'DATA_NOT_COLLECTED' && !usage.category;
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

  // Apple stores "nothing collected" as one row with no category and this protection, not
  // as an empty list — an empty list would mean "not filled in yet". It is only an answer
  // while it is the *whole* answer: a marker row sitting beside a declared collection is a
  // label that contradicts itself, and saying `true` there would report an app that
  // collects something as collecting nothing.
  const marker = usages.some(declaresNothingCollected);
  const declared = usages.filter((usage) => !declaresNothingCollected(usage));

  return {
    published: state['published'] === true,
    lastPublished: asString(state['lastPublished']),
    lastPublishedBy: asString(state['lastPublishedBy']),
    collectsNothing: marker && declared.length === 0,
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

  // The contradiction is shown rather than refused, unlike the missing fields in `ci.ts`.
  // Nothing is absent here: Apple sent both claims, and the rows below are what make the
  // contradiction visible, so failing the read would withhold the evidence for it. What is
  // not available is the one-line summary above, which would be false either way round.
  if (privacy.usages.some(declaresNothingCollected)) {
    lines.push(
      'Contradictory: the "collects nothing" row arrived alongside declared collections. ' +
        'Both are below, that row included.'
    );
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

/** Renders the digest for a terminal. */
export function formatReport(reports: SubmissionReport[]): string {
  if (reports.length === 0) return 'No Resolution Center conversations.';

  return reports
    .map((report) => {
      // The thread heads the block, since that is what the digest is of. Only the
      // submission route has a submission id, and it heads the block instead — you asked
      // about that submission, so that is what the answer is labelled with.
      const lines = report.submissionId
        ? [`submission ${report.submissionId}`]
        : [`thread     ${report.threadId ?? 'none'}`];

      // A thread naming several versions lists them all: choosing between them would
      // report on a version that was not asked about.
      if (report.versions.length) {
        lines.push(`  version    ${report.versions.map((one) => one.version ?? one.versionId).join(', ')}`);
      }
      if (report.submissionId) lines.push(`  thread     ${report.threadId ?? 'none'}`);

      if (report.lastMessageDate) {
        const who =
          report.lastMessageFromApple === undefined
            ? 'sender not recognised'
            : `from ${report.lastMessageFromApple ? 'Apple' : 'you'}`;
        lines.push(`  last msg   ${shortDate(report.lastMessageDate)} (${who})`);
      }
      if (report.hasDraftReply) lines.push('  draft      an unsent reply is waiting');

      if (report.guidelines.length) {
        lines.push('  guidelines');
        for (const guideline of report.guidelines) {
          lines.push(`    ${guideline.code.padEnd(7)} ${guideline.description}`);
        }
      }

      // The id leads the line because the name does not identify the file. Seven of the 21
      // attachment groups in the recordings hold two files under one name, and in all seven
      // the two also share a byte count — so a list of names alone prints two lines that are
      // identical in every field, and a reader cannot tell two files from one listed twice.
      // `collectAttachments` keys on the id for that reason; this is the same fact rendered.
      // The size is left out for the same evidence: it never separates the pairs it would
      // need to.
      if (report.attachments.length) {
        lines.push(`  attachments (${report.attachments.length})`);
        for (const attachment of report.attachments) {
          lines.push(`    ${attachment.id.padEnd(36)}  ${attachment.fileName ?? '(no file name)'}`);
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
