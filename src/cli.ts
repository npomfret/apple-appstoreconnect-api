import { readFileSync } from 'fs';
import { CURL_PATH, describeSession, loadSession, Session } from './gap/session';
import { Cancelled, confirm } from './shared/confirm';
import { denormalize, denormalizeAll, Denormalized, Document } from './shared/jsonapi';
import {
  buildReport,
  fetchHistory,
  fetchPrivacy,
  formatHistory,
  formatPrivacy,
  formatReport,
  ReportTarget,
} from './gap/report';
import { Query } from './shared/query';
import { log } from './shared/log';
import { findAppId, findAppIdByName } from './official/apps';
import { availabilityReady, fetchAvailability, formatAvailability } from './official/availability';
import { OfficialClient, officialClient } from './official/client';
import {
  addBuilds,
  addReady,
  fetchAddPlan,
  fetchPrunePlan,
  formatAddPlan,
  formatAddResult,
  formatPrunePlan,
  formatPruneResult,
  pruneBuilds,
  pruneReady,
} from './official/testflight';
import { capturePathFor, configPath, describeAccounts, officialCredentialsFor, readAccounts, Resolution } from './accounts';
import * as api from './gap/api';
import * as ci from './gap/ci';

const USAGE = `App Store Connect CLI: Apple's official API plus private API gaps.

Accounts (which App Store Connect account a command is about):
  asc accounts                List the configured accounts, which is the default, and what
                              each one is equipped for. Prints no identifiers and no keys
  --account <name>            Use that account's credentials for this command

Official API (uses ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY_PATH, or an account).
Every command here takes the app as <appId>, or --bundle-id <bundleId>, or --app <name>
— the name App Store Connect shows, matched exactly — and resolves the rest itself:

  asc availability <appId>   Storefront availability, blocks and pending changes
                              Add --json for every territory row; --check exits nonzero
                              while any selected storefront is blocked or pending

  asc prune-builds --app <name> --group <name> [--keep <n>]
                              Remove every build but the newest <n> per platform (default
                              1) from the TestFlight group. The builds stay in App Store Connect
                              and can be added back; nothing is expired or deleted. Shows
                              the plan and asks first. --dry-run prints the plan and stops;
                              --check does the same and exits nonzero while there is
                              anything to remove

  asc add-builds --app <name> --group <name> --build <ref> [--build <ref> ...]
                              Add builds to the named TestFlight group. A <ref> is the
                              build number TestFlight shows in brackets, or an Apple build
                              id; a number matching two builds is refused with both ids.
                              Adding to an external group hands the build to those
                              testers, which may put it through Beta App Review. Shows
                              the plan and asks first; --dry-run and --check as above

Private API gaps (uses the browser capture described below, or an account's):

  asc status [file]           Show the captured session and how long it has left
  asc report <appId>          Digest of every Resolution Center thread: version, guidelines,
                              Apple's latest message
  asc report --thread <id>    The same digest for one thread
  asc report --submission <id>
                              The same, starting from a submission id you already have
  asc inbox                   Unread message counts per app — where to look first
  asc history <versionId>     The version's submission history: every state it passed through,
                              who moved it, and how long each one lasted
  asc privacy <appId>         App Privacy declarations and whether they are published
  asc threads <appId>         List Resolution Center threads on an app
  asc thread <submissionId>   Find the thread behind a review submission
  asc messages <threadId>     List Resolution Center messages in a thread
  asc draft <threadId>        Show the thread's unsent draft reply, with its attachments
  asc rejections <threadId>   List guideline rejections for a thread
  asc post-actions <productId>
                              Xcode Cloud: what each of the product's workflows does when a
                              build finishes — the TestFlight hand-off Apple's official API
                              has no field for. Read-only. The product id is Apple's to
                              serve: GET /v1/ciProducts on the official API

  asc usage [days]            Xcode Cloud compute: how many build minutes the plan has, how
                              many are left, and when it resets. With a day count, also the
                              per-day and per-product breakdown for that window. Read-only.
                              Apple's official API has no compute-usage resource at all

  asc team                    Where the team stands with the Apple Developer Program: its
                              name, the membership state, whether the Program License
                              Agreement is waiting for a signature, and the Developer
                              Program team id. Read-only. The official API has no team
                              resource and never mentions the PLA

  asc capabilities            What Xcode Cloud says this session is permitted to do:
                              thirteen booleans covering restricted workflows, external
                              deployments, notarization and the rest. Read-only, and returns
                              no identity — not a name, an email address or a user id. The
                              official API serves roles on /v1/users, not resolved
                              permissions, and none of these thirteen has an official schema

  asc infrastructure-validation [productId]
                              Whether builds run against Apple's pre-release macOS and
                              Xcode: the team switch, then each product's, and each
                              workflow's for the one product named. Read-only — the writes
                              that set it were never recorded, so this reports the switches
                              and cannot throw one. No official schema for any of it

  asc get <path> [k=v ...]    Raw GET, for a query the commands above don't send. Confined
                              to the private families this client is for; an officially
                              served path is refused rather than duplicated

Writes (these change your live App Store Connect data):
  asc save-draft <threadId> <text|-> [--attach file ...]
                              Write the reply to Apple into the thread's draft box, with
                              attachments. "-" reads the text from stdin. This does NOT
                              send it — see send-reply. Text already in the box is printed
                              and asked about first, since the write replaces it
  asc delete-attachment <id>  Remove one attachment from a draft
  asc delete-draft <threadId> Throw the thread's draft away, attachments and all — printed
                              in full first, since nothing keeps a copy

This reaches Apple and cannot be undone. It shows what it is about to send and asks first;
--yes answers for you:
  asc send-reply <threadId>   Send the thread's draft to App Review. No unsend, no edit

Options:
  --raw                       Print the untouched JSON:API document instead of denormalizing it
  --json                      For "report", "history", "privacy", "post-actions",
                              "usage", "team", "capabilities" and
                              "infrastructure-validation", plus "availability": emit JSON
                              instead of the digest
  --check                     For "availability": exit nonzero if a selected storefront
                              cannot currently distribute. For "prune-builds" and
                              "add-builds": exit nonzero if there is anything to change,
                              without changing it
  --bundle-id <id>            For the official commands: find the app by bundle ID
  --app <name>                For the official commands: find the app by its exact name
  --group <name|id>           For "prune-builds" and "add-builds": the TestFlight group,
                              by its exact name or its id
  --keep <n>                  For "prune-builds": how many of the newest builds of each
                              platform stay (1)
  --build <ref>               For "add-builds": a build number or build id. Repeatable
  --dry-run                   For "prune-builds" and "add-builds": print the plan and
                              change nothing
  --yes                       Skip the confirmation prompt on the commands that ask
  --attach <file>             For "save-draft": a file to attach. Repeat for several

Logging goes to stderr as one JSON object per line, so stdout stays pipeable:
  ASC_LOG=debug|info|warn|error|off   default info
Every change to live data is logged whatever the level, marked "audit":true. To keep just
the audit trail:  asc send-reply ... 2>&1 >/dev/null | jq -c 'select(.audit)'

Credentials are resolved in one order, for both APIs: --account first, then the
environment (ASC_ISSUER_ID/ASC_KEY_ID/ASC_PRIVATE_KEY_PATH, ASC_CURL_PATH), then the
default account in the accounts file, then the built-in capture path. The accounts file
lives at ${configPath()} (override with ASC_CONFIG) and holds paths, never keys:

  {"defaultAccount": "acme",
   "accounts": {"acme": {"issuerId": "…", "keyId": "…",
                         "privateKeyPath": "~/keys/AuthKey_….p8",
                         "capturePath": "~/.config/asc/acme.curl.txt"}}}

With no accounts file, the environment variables work exactly as they always have.

The session is read from ${CURL_PATH} unless something above says otherwise, fresh on every
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
 * isn't one this offers by accident, and there is no longer a raw PATCH to do it with
 * either.
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
 * API serves.
 *
 * **The app id is never defaulted.** It used to come from the capture's Referer, and a
 * curl copied from another app's page silently reported on that app instead; see
 * `buildSession` in `gap/curl.ts`.
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

  return { appId: requireAppId(appIdArg, 'report') };
}

/**
 * The app is always an argument. The capture is a way of getting a cookie into a file,
 * not a statement about which app the next command is about.
 */
function requireAppId(given: string | undefined, command: string): string {
  if (!given) {
    throw new Error(`No app id given — pass one: asc ${command} <appId>`);
  }
  return given;
}

/**
 * What the commands that act on a draft show before they ask. The whole body, not a preview
 * of it: it is the last look anyone gets at those words — `send-reply` can't be edited or
 * taken back afterwards, `delete-draft` leaves no copy of what it threw away, and
 * `save-draft` writes over the text without keeping one either.
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
    // The id, then the name — not the name falling back to the id. Two attachments under
    // one name is the ordinary case rather than the odd one (seven of the 21 attachment
    // groups in the recordings, each pair sharing a byte count as well as a name), so a line
    // showing only the name is a line that cannot be told from the one above it. It matters
    // here more than in the digest: `delete-attachment` takes exactly this id, and this is
    // the only place a draft's attachments are shown, so a name-only list left no way to
    // name the one of the two you meant.
    ...attachments.map((file) => {
      const fileName = file['fileName'];
      return `  attachment:  ${file.id}  ${typeof fileName === 'string' ? fileName : '(no file name)'}`;
    }),
    '',
    rule,
    body.trimEnd(),
    rule,
    '',
  ];
}

/**
 * The app an official command is about: one app id as an argument, one `--bundle-id`, or
 * one `--app` name, the last two resolved through the official API. Exactly one of the
 * three — the same rule for every official command, so it is decided once.
 */
async function officialAppId(
  client: OfficialClient,
  command: string,
  bundleIds: string[],
  appNames: string[],
  positional: string[]
): Promise<string> {
  if (bundleIds.length > 1) throw new Error(`${command} takes one --bundle-id, not several.`);
  if (appNames.length > 1) throw new Error(`${command} takes one --app, not several.`);
  if (positional.length > 1) {
    throw new Error(`${command} takes one app ID, or one --bundle-id, or one --app, not extra arguments.`);
  }
  const given = [
    ...positional.map((appId) => () => Promise.resolve(appId)),
    ...bundleIds.map((bundleId) => () => findAppId(client, bundleId)),
    ...appNames.map((name) => () => findAppIdByName(client, name)),
  ];
  if (given.length > 1) {
    throw new Error(`Choose one of an app ID, --bundle-id or --app for ${command}, not several.`);
  }
  if (given.length === 0) {
    throw new Error(`${command} needs an app ID, --bundle-id <bundleId> or --app <name>.`);
  }
  return given[0]!();
}

/** Exactly one `--group`: the name is the whole of what says which group's builds change. */
function requireGroup(groups: string[], example: string): string {
  if (groups.length !== 1) {
    throw new Error(`${example.split(' ')[0]} takes exactly one --group <name|id>. Example: asc ${example}`);
  }
  return groups[0]!;
}

/** `--keep` as a count: a whole number of builds, zero included, and a typo reported as one. */
function keepCount(keeps: string[]): number {
  if (keeps.length > 1) throw new Error(`--keep takes one number, not ${keeps.length}.`);
  const [given] = keeps;
  if (given === undefined) return 1;
  const keep = Number(given);
  if (!Number.isInteger(keep) || keep < 0) {
    throw new Error(`"${given}" is not a number of builds to keep. Example: --keep 3`);
  }
  return keep;
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

/**
 * Options out, command and arguments left — separated from running them so the failure
 * handler can name the command.
 *
 * It used to name `argv[0]`, which is the command only when no option comes first. Every
 * `asc --json report` already logged `"command":"--json"`, and `--account` made that the
 * usual case rather than the odd one, since naming an account is the first thing you type.
 */
interface Invocation {
  readonly account: string | undefined;
  readonly bundleIds: string[];
  readonly appNames: string[];
  readonly attach: string[];
  readonly threadIds: string[];
  readonly submissionIds: string[];
  readonly groups: string[];
  readonly keeps: string[];
  readonly builds: string[];
  readonly raw: boolean;
  readonly json: boolean;
  readonly check: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly command: string | undefined;
  readonly rest: string[];
}

function parseArgs(argv: string[]): Invocation {
  const { values: accountNames, rest: afterAccount } = takeOption(argv, '--account');
  if (accountNames.length > 1) {
    throw new Error(`--account takes one name, not ${accountNames.length}. Run one command per account.`);
  }
  const { values: bundleIds, rest: afterBundle } = takeOption(afterAccount, '--bundle-id');
  const { values: appNames, rest: afterApp } = takeOption(afterBundle, '--app');
  const { values: attach, rest: afterAttach } = takeOption(afterApp, '--attach');
  const { values: threadIds, rest: afterThread } = takeOption(afterAttach, '--thread');
  const { values: submissionIds, rest: afterSubmission } = takeOption(afterThread, '--submission');
  const { values: groups, rest: afterGroup } = takeOption(afterSubmission, '--group');
  const { values: keeps, rest: afterKeep } = takeOption(afterGroup, '--keep');
  const { values: builds, rest: positional } = takeOption(afterKeep, '--build');
  const flags = new Set(['--raw', '--json', '--check', '--dry-run', '--yes']);
  const args = positional.filter((arg) => !flags.has(arg));
  const [command, ...rest] = args;

  return {
    account: accountNames[0],
    bundleIds,
    appNames,
    attach,
    threadIds,
    submissionIds,
    groups,
    keeps,
    builds,
    raw: positional.includes('--raw'),
    json: positional.includes('--json'),
    check: positional.includes('--check'),
    dryRun: positional.includes('--dry-run'),
    yes: positional.includes('--yes'),
    command,
    rest,
  };
}

async function main(invocation: Invocation): Promise<number> {
  const {
    account, bundleIds, appNames, attach, threadIds, submissionIds, groups, keeps, builds,
    raw, json, check, dryRun, yes, command, rest,
  } = invocation;

  // Arguments are ids and file paths — the one secret, a piped-in capture, arrives on
  // stdin and never appears here. The account is a name from the config file, not a
  // credential: what it selects is which paths the credentials are read from.
  log.debug('command.start', { command, args: rest, account });

  const resolution: Resolution = {
    ...(account ? { account } : {}),
    env: process.env,
    ...(() => {
      const file = readAccounts();
      return file ? { file } : {};
    })(),
    defaultCapturePath: CURL_PATH,
  };

  // One resolution for the whole command, read lazily: the official commands must not
  // require a capture and the private ones must not require an API key, so neither
  // resolution may run until something actually needs it.
  const openSession = (): Session => loadSession(capturePathFor(resolution));

  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE);
      return 0;

    case 'accounts': {
      // Names and locations, never identifiers: see `describeAccounts`.
      console.log(describeAccounts(readAccounts(), configPath()));
      return 0;
    }

    case 'status': {
      const path = rest[0] ?? capturePathFor(resolution);
      const session = loadSession(path);
      console.log(`file:      ${path}\n${describeSession(session)}`);
      return 0;
    }

    case 'availability': {
      const client = officialClient(officialCredentialsFor(resolution));
      const appId = await officialAppId(client, 'availability', bundleIds, appNames, rest);
      const report = await fetchAvailability(client, appId);
      console.log(json ? JSON.stringify(report, null, 2) : formatAvailability(report));
      return check && !availabilityReady(report) ? 1 : 0;
    }

    /**
     * The first write on the official transport, and the reversible kind: a build removed
     * from a group is still in App Store Connect, and TestFlight can add it back. Nothing
     * here expires or deletes a build.
     *
     * The plan is printed before the question, whole — every build kept and every build
     * removed, with its id — because the ids in the `DELETE` are the plan's own. So what
     * leaves the group is exactly what was on screen, whatever was uploaded meanwhile, and
     * there is no second read between the answer and the write to re-check. The read that
     * matters comes after: the group is listed again, and an id still there exits nonzero.
     */
    case 'prune-builds': {
      const group = requireGroup(groups, 'prune-builds --app "My App" --group "Internal" --keep 3');
      const keep = keepCount(keeps);
      const client = officialClient(officialCredentialsFor(resolution));
      const appId = await officialAppId(client, 'prune-builds', bundleIds, appNames, rest);
      const plan = await fetchPrunePlan(client, { appId, group, keep });

      // --check never writes, --dry-run never writes, and an empty plan has nothing to
      // write; all three print the plan to stdout, where a script can read it.
      if (dryRun || check || plan.remove.length === 0) {
        console.log(json ? JSON.stringify(plan, null, 2) : formatPrunePlan(plan));
        if (plan.remove.length === 0) console.error(`Nothing to remove from group "${plan.group.name}".`);
        return check && !pruneReady(plan) ? 1 : 0;
      }

      await confirm({
        question:
          `Remove ${plan.remove.length} build${plan.remove.length === 1 ? '' : 's'} from group ` +
          `"${plan.group.name}"? They stay in App Store Connect and can be added back.`,
        detail: ['', ...formatPrunePlan(plan).split('\n'), ''],
        yes,
      });

      const result = await pruneBuilds(client, plan);
      console.log(json ? JSON.stringify(result, null, 2) : formatPruneResult(result));
      console.error(
        `Removed ${result.removed.length} from group "${plan.group.name}"; ${result.remaining.length} remain.`
      );
      return result.stillInGroup.length ? 1 : 0;
    }

    /**
     * `prune-builds` the other way round, on the same documented route with `POST` for
     * `DELETE`. Confirmed for a different reason: removing a build takes it away from
     * testers, and adding one hands it to them — on an external group, to people outside
     * the team, and possibly through Beta App Review first. That is outward-facing.
     */
    case 'add-builds': {
      const example = 'add-builds --app "My App" --group "Beta" --build 45';
      const group = requireGroup(groups, example);
      if (builds.length === 0) {
        throw new Error(`add-builds needs at least one --build <ref>. Example: asc ${example}`);
      }
      const client = officialClient(officialCredentialsFor(resolution));
      const appId = await officialAppId(client, 'add-builds', bundleIds, appNames, rest);
      const plan = await fetchAddPlan(client, { appId, group, builds });

      if (dryRun || check || plan.add.length === 0) {
        console.log(json ? JSON.stringify(plan, null, 2) : formatAddPlan(plan));
        if (plan.add.length === 0) console.error(`Nothing to add to group "${plan.group.name}".`);
        return check && !addReady(plan) ? 1 : 0;
      }

      await confirm({
        question:
          `Add ${plan.add.length} build${plan.add.length === 1 ? '' : 's'} to group "${plan.group.name}"? ` +
          `${plan.group.isInternalGroup ? 'Its testers get them' : 'External testers get them, and Apple may review them first'}.`,
        detail: ['', ...formatAddPlan(plan).split('\n'), ''],
        yes,
      });

      const result = await addBuilds(client, plan);
      console.log(json ? JSON.stringify(result, null, 2) : formatAddResult(result));
      console.error(`Added ${result.added.length} to group "${plan.group.name}"; it now holds ${result.remaining.length}.`);
      return result.notInGroup.length ? 1 : 0;
    }

    case 'report': {
      const session = openSession();
      const reports = await buildReport(session, reportTarget(session, rest[0], threadIds, submissionIds));
      console.log(json ? JSON.stringify(reports, null, 2) : formatReport(reports));
      return 0;
    }

    case 'inbox': {
      const session = openSession();
      emit(await api.listAppMetrics(session), raw);
      return 0;
    }

    case 'history': {
      const session = openSession();
      const versionId = requireArg(rest[0], 'versionId', 'history <versionId>');
      const changes = await fetchHistory(session, versionId);
      console.log(json ? JSON.stringify(changes, null, 2) : formatHistory(changes));
      return 0;
    }

    case 'privacy': {
      const session = openSession();
      const privacy = await fetchPrivacy(session, requireAppId(rest[0], 'privacy'));
      console.log(json ? JSON.stringify(privacy, null, 2) : formatPrivacy(privacy));
      return 0;
    }

    case 'save-draft': {
      const session = openSession();
      const example = 'save-draft <threadId> "We have fixed..." --attach shot.png';
      const threadId = requireArg(rest[0], 'threadId', example);
      // "-" for stdin: a reply to App Review runs to paragraphs, and quoting all of that
      // into a shell argument is how newlines get lost.
      const body = requireText(requireArg(rest[1], 'text', example), 'draft');

      // The PATCH behind this replaces the draft's text outright — it is the autosave, not
      // an append — and nothing keeps what was there. So the box is read first, and the
      // question is asked about the words in it rather than about the thread id. A thread
      // with no draft is not asked: the write there creates one and destroys nothing.
      const existing = await api.getDraftMessage(session, threadId);
      if (existing.data) {
        const shown = denormalize(existing, existing.data);
        await confirm({
          question: `Replace the text of this draft on thread ${threadId}? Its attachments stay.`,
          detail: describeDraft(threadId, shown),
          yes,
        });

        // The same window as send-reply's, for the same reason: the box autosaves as you
        // type, so a browser open on this thread moves it while the question is on screen,
        // and what was agreed to was writing over the words printed above. Read it once
        // more and refuse if they are not the words still there. A draft that vanished
        // counts as changed — the save would quietly create one instead of replacing, and
        // somebody else acting on the thread is exactly when to stop.
        const now = await api.getDraftMessage(session, threadId);
        if (!now.data || api.draftState(denormalize(now, now.data)) !== api.draftState(shown)) {
          throw new Error(
            `The draft on thread ${threadId} changed while the question was on screen, so the ` +
              'words that would be written over are not the ones you were shown. Nothing was ' +
              'written. Check it with "asc draft" and save again.'
          );
        }
      }

      const document = await api.saveDraftReply(session, { threadId, body, attach });
      emit(document, raw);
      console.error('Saved as a draft. Nothing has been sent — "asc send-reply" does that.');
      return 0;
    }

    case 'send-reply': {
      const session = openSession();
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
      if (api.draftState(denormalize(now, now.data)) !== api.draftState(draft)) {
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
      const session = openSession();
      const threadId = requireArg(rest[0], 'threadId', 'delete-draft <threadId>');

      // Read here rather than letting `discardDraftReply` do it in one call, for the same
      // reason as send-reply: what is in the box is the whole of what the question is
      // about. A thread id names the draft but says nothing about the words in it, and
      // nothing keeps a copy of those once the answer is yes.
      const document = await api.findDeletableDraft(session, threadId);
      const draft = denormalize(document, document.data);

      await confirm({
        question: `Delete this draft on thread ${threadId}, attachments and all?`,
        detail: describeDraft(threadId, draft),
        yes,
      });

      await api.deleteDraftMessage(session, draft.id);
      console.error(`Deleted draft ${draft.id} and its attachments.`);
      return 0;
    }

    case 'delete-attachment': {
      const session = openSession();
      const id = requireArg(rest[0], 'attachmentId', 'delete-attachment <attachmentId>');
      // The id is the whole of the preview: nothing here reads one attachment on its own,
      // so there is no file name to show you that didn't come off the draft in the first
      // place. `asc draft <threadId>` is where the ids and their names are listed together.
      await confirm({ question: `Delete attachment ${id}?`, yes });
      await api.deleteMessageAttachment(session, id);
      console.error(`Deleted attachment ${id}.`);
      return 0;
    }

    case 'threads': {
      const session = openSession();
      emit(await api.listThreads(session, requireAppId(rest[0], 'threads')), raw);
      return 0;
    }

    case 'thread': {
      const session = openSession();
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
      const session = openSession();
      emit(await api.listMessages(session, requireArg(rest[0], 'threadId', 'messages <threadId>')), raw);
      return 0;
    }

    case 'draft': {
      const session = openSession();
      const document = await api.getDraftMessage(session, requireArg(rest[0], 'threadId', 'draft <threadId>'));
      emit(document as Document, raw);
      return 0;
    }

    case 'rejections': {
      const session = openSession();
      emit(await api.listRejections(session, requireArg(rest[0], 'threadId', 'rejections <threadId>')), raw);
      return 0;
    }

    /**
     * The one Xcode Cloud read, and deliberately not `asc workflows`.
     *
     * Named for the field rather than for the resource it arrives on, because the resource
     * is Apple's — `ciWorkflows` is official, and a command called `workflows` would read
     * as general Xcode Cloud support and invite exactly the duplication that is out of
     * scope. What is not official is `post_actions`, and that is what this prints.
     *
     * There is no `--raw` here, unlike the Resolution Center reads. The workflow document
     * carries `environment_variables` and `product_environment_variables` alongside the
     * field this wants, and nothing recorded shows whether their values come back or only
     * their names. A command whose whole subject is one field has no reason to print a
     * workflow's secrets on the chance that it can.
     */
    case 'post-actions': {
      const session = openSession();
      const productId = requireArg(rest[0], 'productId', 'post-actions <productId>');
      const workflows = await ci.fetchPostActions(session, productId);
      console.log(json ? JSON.stringify(workflows, null, 2) : ci.formatPostActions(workflows));
      return 0;
    }

    /**
     * Team-scoped rather than app-scoped, which is a boundary this client did not cross
     * before: compute minutes describe the account, not one app. That was the open question
     * in `tasks/xcode-cloud-usage-gap.md` — since deleted, its findings folded into
     * `docs/evidence.md` — and it was decided deliberately, not in passing.
     *
     * The day count is optional because the two reads answer different questions and cost a
     * request each. Bare, this is "how much is left", which is the whole point of the
     * command; with a window it is also "where did it go".
     */
    case 'usage': {
      const session = openSession();
      const plan = await ci.fetchPlan(session);
      const given = rest[0];
      // Parsed here so that a typo is reported as a typo. `Number("last month")` is NaN,
      // and NaN reaches the window check as a number that simply is not a whole one.
      if (given !== undefined && !Number.isInteger(Number(given))) {
        throw new Error(`"${given}" is not a number of days. Example: asc usage 30`);
      }
      const window = given === undefined ? undefined : await ci.fetchUsage(session, Number(given));
      console.log(json ? JSON.stringify({ plan, window }, null, 2) : ci.formatUsage(plan, window));
      return 0;
    }

    /**
     * Team-scoped, like `asc usage` and for the same reason: an unsigned Program License
     * Agreement is a fact about the account rather than about one app, and it has no
     * per-app form to read instead.
     *
     * Deliberately not folded into `asc status`. That command is about the captured session
     * — whose cookie it is and how long it has left — and answers without a request. This
     * one costs a request to Apple and reports Apple's state, not the capture's.
     */
    case 'team': {
      const session = openSession();
      const team = await ci.fetchTeam(session);
      console.log(json ? JSON.stringify(team, null, 2) : ci.formatTeam(team));
      return 0;
    }

    /**
     * Team-scoped in the path, like `asc usage` and `asc team`, but the reason it is not a
     * *person*-scoped read — the boundary this client has never crossed — is the response:
     * thirteen booleans and nothing else. It answers "what may this cookie do", not "who is
     * on this team", and it carries nobody's name or address to answer it.
     *
     * A `yes` here is Apple's word about the account, not a promise from this client, which
     * does none of the thirteen: the `/ci/api` base is read-only and every one of them is a
     * write. The value is knowing what the account may do before going somewhere that can.
     */
    case 'capabilities': {
      const session = openSession();
      const capabilities = await ci.fetchCapabilities(session);
      console.log(json ? JSON.stringify(capabilities, null, 2) : ci.formatCapabilities(capabilities));
      return 0;
    }

    /**
     * Two requests, or three when a product is named, because Apple keeps three switches
     * rather than one and the team-level boolean does not say what is under it. The product
     * id stays explicit for the reason `post-actions` takes one: asking every listed product
     * for its workflows is a fan-out, and a command should not decide to make one on a
     * caller's behalf.
     *
     * Read-only in a stronger sense than the other Xcode Cloud commands. The `/ci/api` base
     * refuses any method but GET, and here the write is not merely unreachable but
     * unrecorded — nothing in any capture shows how `opt_in` is set. So this says where the
     * switches stand, in the way `asc team` says the Program License Agreement is unsigned
     * without offering to sign it.
     */
    case 'infrastructure-validation': {
      const session = openSession();
      const validation = await ci.fetchInfrastructureValidation(session, rest[0]);
      console.log(
        json ? JSON.stringify(validation, null, 2) : ci.formatInfrastructureValidation(validation)
      );
      return 0;
    }

    case 'get': {
      const session = openSession();
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

let invocation: Invocation | undefined;

Promise.resolve()
  .then(() => {
    // Inside the chain so a parse failure lands in the same handler. `command` stays
    // undefined there, which is the truth: the arguments never resolved to one.
    invocation = parseArgs(process.argv.slice(2));
    return main(invocation);
  })
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
      command: invocation?.command,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
