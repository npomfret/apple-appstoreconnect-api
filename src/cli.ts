import { readFileSync } from 'fs';
import { CURL_PATH, describeSession, loadSession, Session } from './session';
import { Cancelled, confirm } from './confirm';
import { denormalize, denormalizeAll, Denormalized, Document } from './jsonapi';
import { Query } from './http';
import {
  buildReport,
  fetchHistory,
  fetchPrivacy,
  formatHistory,
  formatPrivacy,
  formatReport,
  ReportTarget,
} from './report';
import { log } from './log';
import * as api from './api';

const USAGE = `App Store Connect review-centre client (unofficial, session-scraped).

  asc status [file]           Show the captured session and how long it has left
  asc report [appId]          Digest of every Resolution Center thread: version, guidelines,
                              Apple's latest message
  asc report --thread <id>    The same digest for one thread
  asc report --submission <id>
                              The same, starting from a submission id you already have
  asc inbox                   Unread message counts per app — where to look first
  asc history <versionId>     The version's submission history: every state it passed through,
                              who moved it, and how long each one lasted
  asc privacy [appId]         App Privacy declarations and whether they are published
  asc threads [appId]         List Resolution Center threads on an app
  asc thread <submissionId>   Find the thread behind a review submission
  asc messages <threadId>     List Resolution Center messages in a thread
  asc draft <threadId>        Show the thread's unsent draft reply, with its attachments
  asc rejections <threadId>   List guideline rejections for a thread

  asc get <path> [k=v ...]    Raw GET against /iris/v1 for probing unmapped endpoints

Writes (these change your live App Store Connect data):
  asc save-draft <threadId> <text|-> [--attach file ...]
                              Write the reply to Apple into the thread's draft box, with
                              attachments. "-" reads the text from stdin. This does NOT
                              send it — see send-reply
  asc delete-attachment <id>  Remove one attachment from a draft
  asc delete-draft <threadId> Throw the thread's draft away, attachments and all
  asc patch <path> <json>     Raw PATCH against /iris/v1 with a hand-written body

This reaches Apple and cannot be undone. It shows what it is about to send and asks first;
--yes answers for you:
  asc send-reply <threadId>   Send the thread's draft to App Review. No unsend, no edit

Options:
  --raw                       Print the untouched JSON:API document instead of denormalizing it
  --json                      For "report", "history" and "privacy": emit JSON
                              instead of the digest
  --yes                       Skip the confirmation prompt on the commands that ask
  --attach <file>             For "save-draft": a file to attach. Repeat for several

Logging goes to stderr as one JSON object per line, so stdout stays pipeable:
  ASC_LOG=debug|info|warn|error|off   default info
Every change to live data is logged whatever the level, marked "audit":true. To keep just
the audit trail:  asc send-reply ... 2>&1 >/dev/null | jq -c 'select(.audit)'

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
 * itself, and a here-doc that expanded to nothing looks exactly like deliberately blank
 * text: it would put an empty body in the draft box, over whatever was in it, and nothing
 * keeps a copy of that. Emptying a field is not an operation any capture covers, so it
 * isn't one this offers by accident — `asc patch` is there for that.
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

/**
 * Which end of the review conversation `report` starts from.
 *
 * All three are private routes: an app id lists the app's Resolution Center threads, and a
 * thread or submission id skips even that. None of them reads a resource Apple's official
 * API serves, which is why the app id can stay the default.
 *
 * Naming more than one is refused rather than ranked: they are three different questions,
 * and picking one for you would report on something other than what was asked about.
 */
function reportTarget(
  session: Session,
  appIdArg: string | undefined,
  threadIds: string[],
  submissionIds: string[]
): ReportTarget {
  const named = [
    ...threadIds.map((threadId) => ({ label: '--thread', target: { threadId } as ReportTarget })),
    ...submissionIds.map((submissionId) => ({ label: '--submission', target: { submissionId } as ReportTarget })),
  ];

  if (named.length > 1) {
    throw new Error(
      `report takes one starting point, not ${named.length}: ${named.map((one) => one.label).join(' and ')}`
    );
  }
  if (appIdArg && named.length) {
    throw new Error(`report takes an app id or ${named[0]!.label}, not both`);
  }
  if (named.length) return named[0]!.target;

  return { appId: requireAppId(session, appIdArg) };
}

function requireAppId(session: Session, given: string | undefined): string {
  const appId = given ?? session.appId;
  if (!appId) {
    throw new Error('No app id given and none recorded in the session — pass one: asc threads <appId>');
  }
  return appId;
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

async function main(argv: string[]): Promise<number> {
  const { values: attach, rest: afterAttach } = takeOption(argv, '--attach');
  const { values: threadIds, rest: afterThread } = takeOption(afterAttach, '--thread');
  const { values: submissionIds, rest: positional } = takeOption(afterThread, '--submission');
  const raw = positional.includes('--raw');
  const json = positional.includes('--json');
  const yes = positional.includes('--yes');
  const flags = new Set(['--raw', '--json', '--yes']);
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
      const reports = await buildReport(session, reportTarget(session, rest[0], threadIds, submissionIds));
      console.log(json ? JSON.stringify(reports, null, 2) : formatReport(reports));
      return 0;
    }

    case 'inbox': {
      const session = loadSession();
      emit(await api.listAppMetrics(session), raw);
      return 0;
    }

    case 'history': {
      const session = loadSession();
      const versionId = requireArg(rest[0], 'versionId', 'history <versionId>');
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
