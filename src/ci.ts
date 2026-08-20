import { Session } from './session';
import { getCi } from './http';

/**
 * The Xcode Cloud tab of App Store Connect.
 *
 * A separate module because it is a separate API. `iris/v1` is JSON:API — typed resources,
 * `include`, sideload limits, `meta.paging` — and none of that exists here: `ci/api` returns
 * plain objects, names its fields in snake_case, and pages as `{ items: [...] }`. Nothing in
 * `api.ts` applies, so nothing from it is reused.
 *
 * Field names are left exactly as Apple sends them. Camel-casing them would be this client
 * inventing a vocabulary for an API it does not own, and would quietly hide the day Apple
 * renames one.
 *
 * Everything here is a read. The one write the browser was recorded making — replacing a
 * workflow with `PUT workflows-v15/{id}` — is deliberately not mapped yet; see
 * [xcode cloud](../docs/xcode-cloud.md).
 */

/**
 * A product is Xcode Cloud's word for a thing it builds. For an app it is a second
 * identifier beside the App Store one: a UUID, and the id every other call in this file
 * wants. `app_id` is the numeric App Store id it corresponds to.
 */
export interface CiProduct {
  id: string;
  app_id: string;
  name: string;
  bundle_id: string;
  /** "app" is the only value recorded. */
  product_type: string;
  /** "solo" is the only value recorded. */
  type: string;
  created_at: string;
  modified_at: string;
  /** Deep links back into the web UI. Recorded, but nothing here reads them. */
  links?: Record<string, string>;
}

/** One step of a workflow: build, test, archive, analyze. Only test and archive recorded. */
export interface CiAction {
  id: string;
  default_name: string;
  action_type: string;
  scheme: string;
  platform: { name: string };
  is_required: boolean;
  /** Present on a test action. */
  test_config?: {
    kind: string;
    test_plan_name?: string;
    test_destinations?: {
      name: string;
      device_type: string;
      kind: string;
      runtime: { name: string; identifier: string };
    }[];
  };
  /** Present on an archive action. */
  archive_config?: { distribution_type: string };
}

/**
 * What a workflow *is*, as against what Apple records about it.
 *
 * The recorded fields are typed; the index signature is not slack. The browser edits a
 * workflow by sending this whole object back — a full replace, not a patch — so a client
 * that ever writes one has to carry fields it doesn't understand through unchanged rather
 * than drop them. Reading keeps them for the same reason.
 */
export interface CiWorkflowContent {
  name: string;
  description: string;
  disabled: boolean;
  locked: boolean;
  clean: boolean;
  /** Repo id, matching `primary_repos[].repo.id` from `listRepos`. */
  repo: string;
  container_file_path: string;
  macos_version: { build: string; name: string };
  xcode_version: { build: string; name: string };
  actions: CiAction[];
  post_actions: unknown[];
  environment_variables: unknown[];
  product_environment_variables: unknown[];
  /** Only a `branch` condition was recorded; Apple's UI also offers tags and pull requests. */
  start_conditions: Record<string, unknown>;
  [field: string]: unknown;
}

export interface CiWorkflow {
  id: string;
  content: CiWorkflowContent;
  metadata: {
    is_deleted: boolean;
    last_modified_by: string;
    last_modified_at: string;
  };
}

/** A run of a workflow against one commit. Several builds share a group. */
export interface CiBuildGroup {
  id: string;
  workflow_id: string;
  git_ref: { id: string; display_name: string; kind: string; repo_id: string; is_deleted: boolean };
  last_modified_at: string;
  last_triggered_at: string;
  last_triggered_by_me_at?: string;
  favorite: boolean;
  finalized: boolean;
  expires_at: string;
}

/** Counts Xcode Cloud keeps on a build and on each of its stages. */
export interface CiMetadataSummary {
  warnings: number;
  errors: number;
  test_failures: number;
  analyzer_warnings: number;
}

export interface CiBuild {
  id: string;
  number: number;
  group_id: string;
  workflow_id: string;
  /** "running", "succeeded" and "failed" recorded. */
  state: string;
  /** Only while running. */
  progress_percentage?: number;
  /** Only once it has stopped. */
  finished_at?: string;
  started_at?: string;
  created_at: string;
  modified_at: string;
  expires_at: string;
  is_clean_build: boolean;
  is_merge_commit_build: boolean;
  metadata_summary: CiMetadataSummary;
  git_ref: { id: string; display_name: string; kind: string; repo_id: string; is_deleted: boolean };
  commit: {
    commit_sha: string;
    message: string;
    html_url: string;
    author: { display_name: string; avatar_url?: string };
  };
}

/** The builds of one group, as `build-summaries-v2` groups them. */
export interface CiBuildSummary {
  group_id: string;
  builds: CiBuild[];
}

/** A git repository Xcode Cloud has been given access to. */
export interface CiRepo {
  id: string;
  repo_id: string;
  repo_name: string;
  owner_name: string;
  provider: string;
  default_branch: string;
  http_clone_url: string;
  ssh_clone_url: string;
  scp_clone_url: string;
  main_branch?: { id: string; name: string; is_deleted: boolean };
}

export interface CiRepos {
  primary_repos: { repo: CiRepo; authorization_state: string; last_accessed_at: string }[];
  additional_repos: unknown[];
  unauthorized_repos: unknown[];
  revoked_repos: unknown[];
}

/**
 * One step of a build, as it actually ran — the executed counterpart of a `CiAction`.
 *
 * Its `id` is what the test-result and issue reads are keyed by, so a caller wanting to
 * know why a build failed starts here and not at the build. `stage_sections.sections` is
 * the browser's own guide to which of those reads apply: only a stage listing "tests" has
 * test results to fetch.
 */
export interface CiBuildStage {
  id: string;
  name: string;
  /** "action" is the only value recorded. */
  kind: string;
  /** "archive" and "test" recorded. */
  stage_type: string;
  /** "succeeded" and "failed" recorded. */
  state: string;
  is_required: boolean;
  scheme: string;
  platform: { name: string };
  /** Empty string on a stage that runs no test plan. */
  testplan_name: string;
  /** Billed machine seconds. */
  usage_time: number;
  started_at?: string;
  finished_at?: string;
  metadata_summary: CiMetadataSummary;
  stage_sections?: { sections: string[]; available_code_coverage_types: unknown[] };
}

/** A build with everything the build page shows about it, stages included. */
export interface CiBuildDetail {
  build: CiBuild;
  build_stages: CiBuildStage[];
  /** "push" recorded. */
  triggered_from: string;
  triggered_by_user: string;
  container_file_path: string;
  /** The Xcode that ran it, e.g. "Xcode 26.6 (17F113)" — resolved, not the workflow's alias. */
  builder_name: string;
  os_name: string;
  total_usage_time: number;
}

/** One test case on one destination. */
export interface CiDeviceRun {
  device_name: string;
  os_version: string;
  /** "success" and "failure" recorded. */
  status: string;
  duration: number;
  /** The failure text, empty when it passed. */
  message: string;
  uuid: string;
}

/**
 * One test case, with a run per destination underneath it.
 *
 * This is where "what did the build actually execute on" lives, and it is the reason a
 * build report cannot be assembled from the workflow: `device_runs` is the record of the
 * destinations in force *when the build started*, which is not necessarily what the
 * workflow says now. A `status` of "mixed" is a case that passed on some and failed on
 * others — so a per-case pass/fail is not enough to describe one either.
 */
export interface CiTestResult {
  name: string;
  class_name: string;
  target: string;
  /** "success" and "mixed" recorded. */
  status: string;
  device_runs: CiDeviceRun[];
  location?: { file_path: string; line_number?: number };
  message?: string;
}

/** A warning or failure Xcode reported during a stage. */
export interface CiIssue {
  message: string;
  /** "warning" and "testFailure" recorded. */
  issue_type: string;
  group?: string;
  group_type: string;
  /** Only on a test failure. */
  test_case_name?: string;
  /** `file_path` is the literal string "undefined" on some warnings — Apple's, not ours. */
  location?: { file_path: string; line_number?: number };
}

/** One page of anything under `ci/api`. */
interface CiPage<T> {
  items: T[];
}

/**
 * Every path here hangs off the team, and the team is a UUID rather than the numeric
 * provider id — the same value the browser sends as `X-Connect-Team-ID`, which is where
 * this comes from. A capture with no team id is refused rather than sent teamless: the
 * path would be malformed and the error would be about a URL, not about the session.
 *
 * Every call below is `async` because of this and the group-ids check: a function declared
 * to return a promise has to reject, not throw past the caller's `.catch`.
 */
function teamPath(session: Session, path: string): string {
  const team = session.teamId;
  if (!team) {
    throw new Error(
      'The capture carries no team id, and every Xcode Cloud path is scoped to one. Copy a ' +
        'request as cURL while the team is selected — see "asc status" for what was found.'
    );
  }

  return `teams/${team}/${path}`;
}

/** Everything about a product is keyed by its UUID, so most commands start here. */
export async function getProductForApp(session: Session, appId: string): Promise<CiProduct> {
  return getCi<CiProduct>(session, teamPath(session, `asc-products/${appId}`));
}

/** The same record, by the product's own id — what the page reloads after an edit. */
export async function getProduct(session: Session, productId: string): Promise<CiProduct> {
  return getCi<CiProduct>(session, teamPath(session, `products-v3/${productId}`));
}

/**
 * The product's workflows, deleted ones left out, as the Xcode Cloud tab lists them.
 *
 * The limit is the browser's own. A page that comes back exactly that long is reported as
 * `read.atLimit` by the transport rather than passed off as the whole list.
 */
export async function listWorkflows(
  session: Session,
  productId: string,
  options: { limit?: number; includeDeleted?: boolean } = {}
): Promise<CiPage<CiWorkflow>> {
  return getCi<CiPage<CiWorkflow>>(session, teamPath(session, `products/${productId}/workflows-v15`), {
    limit: options.limit ?? 100,
    include_deleted: options.includeDeleted ?? false,
  });
}

export async function getWorkflow(session: Session, productId: string, workflowId: string): Promise<CiWorkflow> {
  return getCi<CiWorkflow>(session, teamPath(session, `products/${productId}/workflows-v15/${workflowId}`));
}

/** Recent runs, newest first, one entry per commit-and-workflow rather than per build. */
export async function listBuildGroups(
  session: Session,
  productId: string,
  options: { limit?: number; partial?: boolean } = {}
): Promise<CiPage<CiBuildGroup>> {
  return getCi<CiPage<CiBuildGroup>>(
    session,
    teamPath(session, `products/${productId}/build-groups-v4`),
    { limit: options.limit ?? 10 },
    { partial: options.partial }
  );
}

/**
 * The builds inside named groups — state, progress, warning and test-failure counts, and
 * the commit each one came from. The group ids come from `listBuildGroups`.
 */
export async function listBuildSummaries(
  session: Session,
  productId: string,
  groupIds: readonly string[],
  options: { limit?: number; partial?: boolean } = {}
): Promise<CiPage<CiBuildSummary>> {
  if (!groupIds.length) {
    throw new Error('listBuildSummaries needs at least one build group id');
  }

  return getCi<CiPage<CiBuildSummary>>(
    session,
    teamPath(session, `products/${productId}/build-summaries-v2`),
    { build_group_ids: [...groupIds], limit: options.limit ?? 4 },
    { partial: options.partial }
  );
}

/** Which repositories Xcode Cloud can reach, and whether its access still works. */
export async function listRepos(session: Session, productId: string): Promise<CiRepos> {
  return getCi<CiRepos>(session, teamPath(session, `products/${productId}/repos-v3`));
}

/**
 * What this account may change in Xcode Cloud — thirteen booleans, all recorded true on an
 * Account Holder session. Worth reading before a write: the UI hides buttons on these.
 */
export async function getUserCapabilities(session: Session): Promise<Record<string, boolean>> {
  return getCi<Record<string, boolean>>(session, teamPath(session, 'user-capabilities'));
}

/** One build group by id, as the build page reloads it. */
export async function getBuildGroup(
  session: Session,
  productId: string,
  groupId: string
): Promise<CiBuildGroup> {
  return getCi<CiBuildGroup>(session, teamPath(session, `products/${productId}/build-groups-v2/${groupId}`));
}

/** A build and its stages. The stage ids in here key the two reads below. */
export async function getBuild(
  session: Session,
  productId: string,
  buildId: string
): Promise<CiBuildDetail> {
  return getCi<CiBuildDetail>(session, teamPath(session, `products/${productId}/builds/${buildId}/details-v3`));
}

/**
 * Every test case a stage ran, with its per-destination runs.
 *
 * The limit is the browser's own, and it is not a page size in any useful sense: 60001 is
 * the web UI asking for the lot in one request, and the response carries no total and no
 * cursor to follow. Nothing here pages, because nothing was recorded paging. If a response
 * ever comes back exactly this long the transport says so as `read.atLimit`, which is the
 * only warning available.
 */
export async function listTestResults(
  session: Session,
  productId: string,
  buildId: string,
  stageId: string,
  options: { limit?: number } = {}
): Promise<CiPage<CiTestResult>> {
  return getCi<CiPage<CiTestResult>>(
    session,
    teamPath(session, `products/${productId}/builds/${buildId}/stages/${stageId}/test-results-v4`),
    { limit: options.limit ?? 60001 }
  );
}

/** The warnings and failures Xcode reported in a stage. */
export async function listStageIssues(
  session: Session,
  productId: string,
  buildId: string,
  stageId: string,
  options: { limit?: number } = {}
): Promise<CiPage<CiIssue>> {
  return getCi<CiPage<CiIssue>>(
    session,
    teamPath(session, `products/${productId}/builds/${buildId}/stages/${stageId}/issues`),
    { limit: options.limit ?? 2000 }
  );
}

/**
 * The last thing Xcode Cloud ran, or undefined if it never has.
 *
 * Two requests, because the build list is grouped: groups come back newest first and so do
 * the builds inside one, so the first build of the first group is the newest. Both ask for
 * a single row and both say so — the list really is clipped, and being told that on every
 * run would be noise about the one thing this function is certain of.
 */
export async function getLatestBuild(session: Session, productId: string): Promise<CiBuild | undefined> {
  const groups = await listBuildGroups(session, productId, { limit: 1, partial: true });
  const group = groups.items[0];
  if (!group) return undefined;

  const summaries = await listBuildSummaries(session, productId, [group.id], { limit: 1, partial: true });
  return summaries.items[0]?.builds[0];
}
