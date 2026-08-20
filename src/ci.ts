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
  metadata_summary: {
    warnings: number;
    errors: number;
    test_failures: number;
    analyzer_warnings: number;
  };
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
  options: { limit?: number } = {}
): Promise<CiPage<CiBuildGroup>> {
  return getCi<CiPage<CiBuildGroup>>(session, teamPath(session, `products/${productId}/build-groups-v4`), {
    limit: options.limit ?? 10,
  });
}

/**
 * The builds inside named groups — state, progress, warning and test-failure counts, and
 * the commit each one came from. The group ids come from `listBuildGroups`.
 */
export async function listBuildSummaries(
  session: Session,
  productId: string,
  groupIds: readonly string[],
  options: { limit?: number } = {}
): Promise<CiPage<CiBuildSummary>> {
  if (!groupIds.length) {
    throw new Error('listBuildSummaries needs at least one build group id');
  }

  return getCi<CiPage<CiBuildSummary>>(session, teamPath(session, `products/${productId}/build-summaries-v2`), {
    build_group_ids: [...groupIds],
    limit: options.limit ?? 4,
  });
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
