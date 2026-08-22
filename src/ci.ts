/**
 * Xcode Cloud, for the one thing on it Apple's official API cannot answer: whether a build
 * is handed to testers automatically.
 *
 * Everything else about Xcode Cloud — products, workflows, repositories, build runs,
 * actions, issues, test results, and creating or updating a workflow — Apple serves
 * officially at
 * [xcode-cloud-workflows-and-builds](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds),
 * and none of it is here. What is not there is `post_actions`: re-checked on 2026-08-21
 * against specification 4.4.1 (generated 2026-07-15, 966 paths, 1,393 schemas), where
 * `post_action`, `postAction`, `deployment_config`, `archive_action_id` and
 * `testFlight_internal` occur **zero** times, and `CiWorkflow` has no post-action attribute
 * and no `betaGroups` relationship — its relationships are `buildRuns`, `macOsVersion`,
 * `product`, `repository` and `xcodeVersion`.
 *
 * So a workflow can hand every build to a TestFlight group and the official API will not
 * say so. That is what this module reads, and it is all it reads.
 *
 * **It reads. There is no write here, and the base it uses cannot carry one** — see `CI` in
 * `http.ts`. The `PUT` that sets `post_actions` is recorded in both directions, so the gap
 * on the write side is evidence rather than ignorance; what stops it is that the `PUT` is a
 * full-document replace of the whole workflow, and a client that does not model every key
 * destroys what it failed to send back.
 */

import { CI, request } from './http';
import { Session } from './session';

/**
 * A path segment, checked before it is one.
 *
 * Every id here arrives from a command line or a caller and is interpolated into a path.
 * `apiUrl` would catch a segment that climbs out of the base, since it compares the
 * resolved URL — but it would report it as a path that resolves somewhere odd, which is a
 * confusing way to say "that is not an id". Apple's own are uuids; the pattern is wider
 * than that on purpose, since the format is Apple's to change and this only has to exclude
 * the characters that make a segment stop being one.
 */
function segment(value: string, what: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`"${value}" is not a ${what}: it has to be one path segment of letters, digits, ".", "_" or "-"`);
  }
  return value;
}

/**
 * The team every `/ci/api` path is scoped by, taken from the session.
 *
 * Not discovered, and not a flag. On all 22 `/ci/api` requests recorded from the browser
 * the `teams/{id}` path segment is the same value as the `X-Connect-Team-ID` header, which
 * `src/curl.ts` already keeps from the capture and otherwise decodes from the `itctx`
 * cookie. So this costs no request: in particular it does not need `olympus/v1/actors`,
 * which would be a third base and which carries names and email addresses this client has
 * no reason to hold.
 */
function teamOf(session: Session): string {
  if (!session.teamId) {
    throw new Error(
      'The session has no team id, and every Xcode Cloud path is scoped by one. Capture a ' +
        'fresh request as cURL — the team id is in the cookie, and in the X-Connect-Team-ID header.'
    );
  }
  return segment(session.teamId, 'team id');
}

/** The workflows collection as Xcode Cloud sends it: a plain JSON object, not JSON:API. */
export interface WorkflowsPage {
  items?: unknown[];
}

/**
 * The page size the browser asks for on this read, and the flag it sends beside it:
 * `?limit=100&include_deleted=false`. Deleted workflows are left out because a deleted
 * workflow's post-actions describe nothing that will run.
 */
const WORKFLOW_LIMIT = 100;

/**
 * Every workflow on a product, untouched.
 *
 * The product id is explicit rather than looked up from an app id. Apple serves the lookup
 * officially — `ciProducts` carries the `app` relationship — so doing it here would put
 * back exactly the duplication the boundary exists to prevent. Take the id from the
 * official API, or from the Xcode Cloud URL in the browser.
 *
 * `async` so that a refused id is a rejected promise. The checks above run before any
 * request is built, and a function that returns a promise but throws synchronously is one
 * a caller's `.catch` does not catch.
 */
export async function listWorkflows(
  session: Session,
  productId: string,
  limit = WORKFLOW_LIMIT
): Promise<WorkflowsPage> {
  const path = `teams/${teamOf(session)}/products/${segment(productId, 'product id')}/workflows-v15`;
  return request<WorkflowsPage>(session, path, { api: CI, query: { limit, include_deleted: false } });
}

/** One thing a workflow does when a build finishes. */
export interface PostAction {
  id: string;
  /** Whatever whoever configured it typed in. */
  name: string;
  /**
   * Apple's own spelling, passed through rather than narrowed to a union.
   * `testFlight_internal` — mixed case — is the only value ever observed, and its name
   * implies an external counterpart that nothing here has seen. A union of one observed
   * member would claim to know the set.
   */
  type: string;
  /** The build step this hangs off: a post-action follows an action, not the workflow. */
  archiveActionId?: string;
  /** That action's name, where it is one of this workflow's own. */
  archiveAction?: string;
  /** TestFlight groups the build goes to. Ids only — see `formatPostActions`. */
  betaGroupIds: string[];
  /** Individual testers. Present and empty in every recording. */
  betaTesterIds: string[];
  /**
   * Keys Apple sent that this client does not model, by name only.
   *
   * The private API is unstable and this is the field with no official schema to check
   * against, so a new key appearing is worth saying rather than dropping in silence.
   */
  unmodelled: string[];
}

/** A workflow, reduced to the question this module exists to answer. */
export interface WorkflowPostActions {
  workflowId: string;
  name: string;
  /** A disabled workflow runs for nothing, post-actions included. */
  disabled: boolean;
  /** Empty means no build from this workflow is handed on automatically. */
  postActions: PostAction[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** A list of ids, keeping only what is actually one. */
function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

const MODELLED = new Set(['id', 'name', 'type', 'deployment_config']);

function readPostAction(entry: unknown, actions: Map<string, string>): PostAction | undefined {
  const source = record(entry);
  const id = text(source?.['id']);
  if (!source || !id) return undefined;

  const deployment = record(source['deployment_config']);
  const testflight = record(deployment?.['testflight_deployment_ids']);
  const archiveActionId = text(deployment?.['archive_action_id']);

  return {
    id,
    name: text(source['name']) ?? '(unnamed)',
    type: text(source['type']) ?? '(no type)',
    archiveActionId,
    archiveAction: archiveActionId === undefined ? undefined : actions.get(archiveActionId),
    betaGroupIds: ids(testflight?.['beta_group_ids']),
    betaTesterIds: ids(testflight?.['beta_tester_ids']),
    unmodelled: Object.keys(source).filter((key) => !MODELLED.has(key)),
  };
}

/**
 * The workflow's own actions by id, so a post-action can say which build step it follows.
 *
 * `archive_action_id` names an action in the same workflow — true of every post-action in
 * the recording — and the id on its own says nothing a reader can use.
 */
function actionNames(content: Record<string, unknown>): Map<string, string> {
  const actions = new Map<string, string>();
  const list = Array.isArray(content['actions']) ? content['actions'] : [];

  for (const entry of list) {
    const action = record(entry);
    const id = text(action?.['id']);
    if (!action || !id) continue;
    const type = text(action['action_type']);
    const name = text(action['default_name']);
    actions.set(id, [type, name && `(${name})`].filter(Boolean).join(' ') || id);
  }

  return actions;
}

function readWorkflow(entry: unknown): WorkflowPostActions | undefined {
  const source = record(entry);
  const content = record(source?.['content']);
  const workflowId = text(source?.['id']);
  if (!content || !workflowId) return undefined;

  const actions = actionNames(content);
  const list = Array.isArray(content['post_actions']) ? content['post_actions'] : [];

  return {
    workflowId,
    name: text(content['name']) ?? '(unnamed)',
    disabled: content['disabled'] === true,
    postActions: list
      .map((entry) => readPostAction(entry, actions))
      .filter((action): action is PostAction => action !== undefined),
  };
}

/**
 * What every workflow on a product does when a build finishes.
 *
 * Parsed leniently, which is the right posture for a private field with no schema behind
 * it: a workflow missing an id or a content block is dropped rather than throwing, and a
 * post-action carrying keys this client has never seen keeps them — by name — in
 * `unmodelled` rather than being refused.
 */
export async function fetchPostActions(
  session: Session,
  productId: string,
  limit?: number
): Promise<WorkflowPostActions[]> {
  const page = await listWorkflows(session, productId, limit);
  const items = Array.isArray(page.items) ? page.items : [];

  return items.map(readWorkflow).filter((workflow): workflow is WorkflowPostActions => workflow !== undefined);
}

/**
 * The digest.
 *
 * Beta groups print as ids and are not resolved to names. That lookup is
 * `GET /v1/betaGroups`, which Apple serves officially and which carries `name` and
 * `isInternalGroup` — so anything needing the name has a supported way to get it, and
 * doing it here would trade the gap this module is for against a duplicate of a call Apple
 * already answers.
 */
export function formatPostActions(workflows: WorkflowPostActions[]): string {
  if (workflows.length === 0) return 'No workflows on this product.';

  const lines: string[] = [];

  for (const workflow of workflows) {
    lines.push(`${workflow.name}${workflow.disabled ? '  (disabled)' : ''}   ${workflow.workflowId}`);

    if (workflow.postActions.length === 0) {
      lines.push('    no post-actions — a build from this workflow is not handed on automatically');
      lines.push('');
      continue;
    }

    for (const action of workflow.postActions) {
      lines.push(`    ${action.name}   ${action.type}`);
      lines.push(`      after        ${action.archiveAction ?? action.archiveActionId ?? '(no action named)'}`);
      lines.push(`      beta groups  ${action.betaGroupIds.join(', ') || 'none'}`);
      lines.push(`      testers      ${action.betaTesterIds.join(', ') || 'none'}`);
      if (action.unmodelled.length) {
        lines.push(`      also sent    ${action.unmodelled.join(', ')}`);
      }
    }
    lines.push('');
  }

  const configured = workflows.filter((workflow) => workflow.postActions.length > 0).length;
  lines.push(
    configured === 0
      ? 'Nothing on this product hands a build on automatically.'
      : `${configured} of ${workflows.length} workflows hand a build on automatically.`
  );

  return lines.join('\n');
}
