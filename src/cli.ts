import { readFileSync } from 'fs';
import { sessionFromCurl } from './curl';
import { describeSession, loadSession, saveSession, SESSION_PATH, Session } from './session';
import { denormalizeAll, Document } from './jsonapi';
import { Query } from './http';
import { buildReport, fetchMetadata, formatReport } from './report';
import * as api from './api';

const USAGE = `App Store Connect review-centre client (unofficial, session-scraped).

  asc login [file]            Read a "Copy as cURL" command from file (or stdin) and store the session
  asc status                  Show the stored session and how long it has left
  asc report [appId]          Digest of every open submission: state, guidelines, Apple's latest message
  asc apps                    List every app on the account
  asc inbox                   Unread message counts per app — where to look first
  asc app [appId]             Show one app
  asc submissions [appId]     List review submissions for an app
  asc submission <id>         Show one review submission
  asc items <submissionId>    List the items bundled into a submission
  asc version [versionId]     Show one App Store version and everything hanging off it
  asc builds <versionId>      List the builds behind an App Store version
  asc metadata [versionId]    Per-locale name, subtitle, description and keywords (defaults
                              to the version under review)
  asc screenshots <locId>     Screenshot sets for a localization (id from "asc metadata")
  asc threads [appId]         List Resolution Center threads on an app
  asc thread <submissionId>   Find the thread behind a review submission
  asc messages <threadId>     List Resolution Center messages in a thread
  asc draft <threadId>        Show the thread's unsent draft reply
  asc rejections <threadId>   List guideline rejections for a thread
  asc get <path> [k=v ...]    Raw GET against /iris/v1 for probing unmapped endpoints

Writes (these change your live App Store Connect data):
  asc set-build <versionId> <buildId|none>
                              Attach a build to a version — the version page's Save button
  asc patch <path> <json>     Raw PATCH against /iris/v1 with a hand-written body

Options:
  --raw                       Print the untouched JSON:API document instead of denormalizing it
  --json                      For "report": emit JSON instead of the readable digest

The session lives at ${SESSION_PATH} (override with ASC_SESSION_PATH).
Capture a new one whenever Apple expires it — log in with your passkey, open dev tools,
right-click any /iris/v1 request and "Copy as cURL".`;

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
  if (!report?.versionId) {
    throw new Error('No open submission to take a version from — pass one: asc metadata <versionId>');
  }
  return report.versionId;
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

async function main(argv: string[]): Promise<number> {
  const raw = argv.includes('--raw');
  const json = argv.includes('--json');
  const args = argv.filter((arg) => arg !== '--raw' && arg !== '--json');
  const [command, ...rest] = args;

  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE);
      return 0;

    case 'login': {
      const source = rest[0] ? readFileSync(rest[0], 'utf8') : readStdin();
      if (!source.trim()) {
        throw new Error('Nothing to read. Pass a file: asc login curl.txt — or pipe it: pbpaste | asc login');
      }
      const session = sessionFromCurl(source);
      saveSession(session);
      console.log(`Saved session to ${SESSION_PATH}\n${describeSession(session)}`);
      return 0;
    }

    case 'status':
      console.log(describeSession(loadSession()));
      return 0;

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
      emit(await api.listBuilds(session, requireArg(rest[0], 'versionId', 'builds <versionId>')), raw);
      return 0;
    }

    case 'set-build': {
      const session = loadSession();
      const versionId = requireArg(rest[0], 'versionId', 'set-build <versionId> <buildId>');
      const buildId = requireArg(rest[1], 'buildId', 'set-build <versionId> <buildId>');
      const document = await api.setVersionBuild(session, versionId, buildId === 'none' ? null : buildId);
      console.error(`Saved version ${versionId}: build ${buildId}`);
      emit(document as Document, raw);
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
      const id = requireArg(rest[0], 'localizationId', 'screenshots <localizationId>');
      emit(await api.listScreenshotSets(session, id), raw);
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
        console.error(`No Resolution Center thread found for submission ${id}`);
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
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
