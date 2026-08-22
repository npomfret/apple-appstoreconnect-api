/**
 * Xcode Cloud, for the four things on it Apple's official API cannot answer: whether a
 * build is handed to testers automatically, how much compute the team has left, where the
 * team stands with the Apple Developer Program, and what this session is permitted to do.
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
 * say so.
 *
 * The second is compute against the plan. Re-checked the same way on 2026-08-21:
 * `usage_in_minutes`, `number_of_builds`, `reset_date` and `can_view_all_products` occur
 * **zero** times in 4.4.1, and the only official `usage` paths — `betaTesterUsages`,
 * `betaBuildUsages`, `publicLinkUsages` — are about TestFlight testers, not build minutes.
 * `CiBuildRun` carries `startedDate` and `finishedDate`, so wall-clock per run is derivable
 * one build at a time; billed compute, an allowance, and a reset date are not.
 *
 * The third is the team's standing in the Developer Program. Checked the same way on
 * 2026-08-22: `wwdr`, `programState` and `program_state` occur **zero** times in 4.4.1, and
 * the only `team` anywhere in the specification is `gameCenterMatchmakingTeams`, which is a
 * matchmaking concept rather than a developer account. The two license-agreement schemas
 * are `BetaLicenseAgreement` and `EndUserLicenseAgreement`, each carrying nothing but
 * `agreementText` — the TestFlight tester agreement and the customer EULA, neither of them
 * the Program License Agreement. So there is no official way to see an unsigned PLA coming.
 *
 * The fourth is what the signed-in session may do in Xcode Cloud. Checked the same way on
 * 2026-08-22: `canConfigure`, `canTrigger`, `canEdit`, `canRemove`, `canChange`, `canManage`,
 * `canOnboard`, `canRestrict`, `restrictedWorkflow` and `infrastructureValidation` occur
 * **zero** times in 4.4.1, and `privilege` zero as well. What Apple does serve is
 * `/v1/users`, whose `User` carries `roles` — thirteen coarse `UserRole` values, `ADMIN`
 * through `GENERATE_INDIVIDUAL_KEYS` — beside `username`, `firstName` and `lastName`. That
 * is a directory of people and their job titles; this is thirteen resolved booleans about
 * one session, with no identity attached and no official route to them. Turning a role into
 * these booleans is a mapping Apple publishes in prose, not in the API, and hardcoding it
 * would be exactly the guess this repository refuses. The 93 occurrences of `capabilit` are
 * all `BundleIdCapability`, which is App ID entitlements, and the four of `notariz` are the
 * `NOTARIZATION` release destination and a `STAPLED_NOTARIZED_ARCHIVE` artifact type —
 * neither of them a permission to configure or trigger anything.
 *
 * All four are reads, and that is all this module does.
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
 * Not discovered, and not a flag. On all 34 `/ci/api` requests recorded from the browser
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

/**
 * The compute allowance, and what is left of it.
 *
 * `GET ci/api/teams/{teamId}/usage/summary`, recorded from the browser's Xcode Cloud Usage
 * page on 2026-08-21. No query, and the response is `{plan, links}`; `links` is a set of
 * web URLs for the page's own buttons and is not read.
 */
export interface ComputePlan {
  /** Apple's name for the tier, passed through. */
  name: string;
  /**
   * Minutes, not hours.
   *
   * Nothing in the field names says so, and getting it wrong would misreport the allowance
   * by sixtyfold. What settles it: in the recording `total` is exactly one of Apple's
   * published compute-hour tiers multiplied by 60, `used + available === total`, and the
   * per-day series beside it is labelled `minutes` and is of the same order.
   */
  totalMinutes: number;
  usedMinutes: number;
  availableMinutes: number;
  /**
   * The day the allowance rolls over, `YYYY-MM-DD`.
   *
   * Apple sends `reset_date_time` beside it, the same day with a time on it. The day is the
   * part that means anything to a plan that resets monthly.
   */
  resetDate: string;
}

/**
 * A number Apple was expected to send, refused rather than defaulted.
 *
 * A missing allowance is not a zero allowance, and the difference between "you have none
 * left" and "Apple did not say" is the whole value of the call.
 */
function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `Xcode Cloud did not send a usable ${what}. This is a private endpoint with no schema ` +
        'behind it, so a changed response is a real possibility — re-capture the Usage page.'
    );
  }
  return value;
}

/** How much Xcode Cloud compute the team has, has used, and has left. */
export async function fetchPlan(session: Session): Promise<ComputePlan> {
  const body = await request<unknown>(session, `teams/${teamOf(session)}/usage/summary`, { api: CI });
  const plan = record(record(body)?.['plan']);

  if (!plan) {
    throw new Error('Xcode Cloud returned no "plan" on the usage summary, so there is nothing to report.');
  }

  return {
    name: text(plan['name']) ?? '(unnamed)',
    totalMinutes: count(plan['total'], 'plan total'),
    usedMinutes: count(plan['used'], 'used total'),
    availableMinutes: count(plan['available'], 'available total'),
    resetDate: text(plan['reset_date']) ?? '(not stated)',
  };
}

/** One day of the series, as Apple sends it. */
export interface UsageDay {
  /** `YYYY-MM-DD`. The series is contiguous and ascending in the recording. */
  date: string;
  minutes: number;
  builds: number;
}

/** One product's share of the window. */
export interface ProductUsage {
  /**
   * Apple's Xcode Cloud product id — which may name a product that no longer exists.
   *
   * In the recording the breakdown carried seven products where `products-v4` returned two,
   * and only those two ids matched. Consumed compute outlives the product that consumed it,
   * so this is not resolved to a name here and a lookup of one may find nothing. The lookup
   * itself is `GET /v1/ciProducts`, which Apple serves officially.
   */
  productId: string;
  /** Apple sends both. `minutes` is `floor(seconds / 60)` for every row in the recording. */
  minutes: number;
  seconds: number;
  builds: number;
  /** The same product over the window immediately before this one. */
  previousMinutes: number;
  previousBuilds: number;
}

/**
 * A window of Xcode Cloud usage, and the products that filled it.
 *
 * **Not the plan's window.** `GET usage/days` answers for the dates asked for; the plan
 * answers for the billing period ending at its own `resetDate`. In the recording the two
 * disagree, as they should. Nothing here adds one to the other or reconciles them.
 */
export interface UsageWindow {
  /** Inclusive, `YYYY-MM-DD`, exactly as sent. */
  start: string;
  end: string;
  days: UsageDay[];
  products: ProductUsage[];
  /**
   * Apple's own `can_view_all_products`: false means the signed-in user sees a partial
   * breakdown, so the per-product rows do not have to add up to the day series.
   */
  allProducts: boolean;
}

/** `YYYY-MM-DD` in UTC, which is the format both query parameters and every date field use. */
function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The last `days` days ending today, inclusive at both ends.
 *
 * UTC, so the window a command asks for does not depend on where it runs. Apple's own page
 * asked for 31 days; nothing observed says what it does with a longer range, and it is not
 * capped here because a cap invented from one recording is as much a guess as no cap.
 */
function windowOf(days: number): { start: string; end: string } {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`A usage window is a whole number of days, at least 1 — not "${days}".`);
  }

  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { start: day(start), end: day(end) };
}

function readDay(entry: unknown): UsageDay | undefined {
  const source = record(entry);
  const date = text(source?.['date']);
  if (!source || !date) return undefined;

  return {
    date,
    minutes: typeof source['minutes'] === 'number' ? source['minutes'] : 0,
    builds: typeof source['number_of_builds'] === 'number' ? source['number_of_builds'] : 0,
  };
}

function readProduct(entry: unknown): ProductUsage | undefined {
  const source = record(entry);
  const productId = text(source?.['product_id']);
  if (!source || !productId) return undefined;

  const number = (key: string): number => (typeof source[key] === 'number' ? (source[key] as number) : 0);

  return {
    productId,
    minutes: number('usage_in_minutes'),
    seconds: number('usage_in_seconds'),
    builds: number('number_of_builds'),
    previousMinutes: number('previous_usage_in_minutes'),
    previousBuilds: number('previous_number_of_builds'),
  };
}

/**
 * Compute over the last `days` days, by day and by product.
 *
 * Parsed leniently, unlike the plan: these are lists, and a row Apple sends in a shape this
 * client does not recognise is one row missing from a breakdown rather than an answer that
 * cannot be given at all.
 */
export async function fetchUsage(session: Session, days: number): Promise<UsageWindow> {
  const { start, end } = windowOf(days);
  const body = await request<unknown>(session, `teams/${teamOf(session)}/usage/days`, {
    api: CI,
    query: { start, end },
  });

  const source = record(body);
  const info = record(source?.['info']);
  const list = (key: string): unknown[] => (Array.isArray(source?.[key]) ? (source![key] as unknown[]) : []);

  return {
    start,
    end,
    days: list('usage')
      .map(readDay)
      .filter((entry): entry is UsageDay => entry !== undefined),
    products: list('product_usage')
      .map(readProduct)
      .filter((entry): entry is ProductUsage => entry !== undefined),
    allProducts: record(info)?.['can_view_all_products'] === true,
  };
}

/** Thousands separators, so six thousand minutes does not read as sixty. */
function amount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * The digest.
 *
 * The plan and the window are printed as two separate things because they are two separate
 * things: the plan counts the billing period ending at its reset date, the window counts
 * the dates asked for, and in the recording the totals differ. Adding them together, or
 * showing one as a percentage of the other, would invent a relationship nothing observed
 * supports.
 */
export function formatUsage(plan: ComputePlan, window?: UsageWindow): string {
  const share = plan.totalMinutes > 0 ? Math.round((plan.usedMinutes / plan.totalMinutes) * 100) : 0;
  const lines = [
    `plan       ${plan.name}`,
    `used       ${amount(plan.usedMinutes)} of ${amount(plan.totalMinutes)} minutes  (${share}%)`,
    `left       ${amount(plan.availableMinutes)} minutes`,
    `resets     ${plan.resetDate}`,
  ];

  if (!window) return lines.join('\n');

  const minutes = window.days.reduce((total, entry) => total + entry.minutes, 0);
  const builds = window.days.reduce((total, entry) => total + entry.builds, 0);
  const busiest = window.days.reduce<UsageDay | undefined>(
    (worst, entry) => (worst === undefined || entry.minutes > worst.minutes ? entry : worst),
    undefined
  );

  lines.push('', `${window.start} to ${window.end}, counted separately from the plan above:`);
  lines.push(`  minutes  ${amount(minutes)}`);
  lines.push(`  builds   ${amount(builds)}`);
  if (busiest && busiest.minutes > 0) {
    lines.push(`  busiest  ${busiest.date}  ${amount(busiest.minutes)} minutes, ${amount(busiest.builds)} builds`);
  }

  if (window.products.length === 0) {
    lines.push('  products none in this window');
  } else {
    lines.push('', '  per product, against the window before it:');
    for (const product of window.products) {
      lines.push(
        `    ${product.productId}  ${amount(product.minutes).padStart(7)} min ` +
          `${amount(product.builds).padStart(5)} builds   ` +
          `(was ${amount(product.previousMinutes)} min, ${amount(product.previousBuilds)} builds)`
      );
    }
  }

  if (!window.allProducts) {
    lines.push('', 'Apple says this account cannot see every product, so the breakdown is partial.');
  }

  return lines.join('\n');
}

/**
 * Where the team stands with the Apple Developer Program.
 *
 * Read from `GET ci/api/teams/{teamId}`, whose response has eight keys. Three are not
 * carried here: `id` is by construction the id that was sent, `public_provider_id` is an
 * identifier nothing observed explains, and `links` are web URLs for the page's own buttons
 * — one of which carries a person id — which this never reads and never follows.
 */
export interface TeamStanding {
  /** Apple's name for the team, passed through. */
  name: string;
  /**
   * Apple's word for the state of the membership, passed through un-interpreted.
   *
   * One lowercase value was observed and nothing says what the whole set is, so this is a
   * string rather than a union and is never compared against a literal.
   */
  programState: string;
  /**
   * Whether the Program License Agreement is waiting for a signature.
   *
   * The reason the call is worth making: an unsigned PLA is a thing that happens to an
   * account rather than to a release, and no official resource mentions one.
   */
  plaNeedsSigning: boolean;
  /** Apple's own `wwdr_team_within_pla_grace_period`, passed through. */
  plaWithinGracePeriod: boolean;
  /**
   * Ten characters of letters and digits — the shape Apple uses for the Developer Program
   * team id that appears on certificates and provisioning profiles. It is not the uuid the
   * `/ci/api` paths are scoped by, which is 36 characters and a different value.
   */
  developerTeamId: string;
}

/**
 * A boolean Apple was expected to send, refused rather than defaulted.
 *
 * Defaulting a missing `wwdr_pla_needs_signing` to `false` would answer "nothing to sign"
 * to a question that was not answered, and that is the one wrong answer this call can give.
 * The same reasoning as `count()` above, for the same reason.
 */
function flag(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(
      `Xcode Cloud did not say whether ${what}. This is a private endpoint with no schema ` +
        'behind it, so a changed response is a real possibility — re-capture an Xcode Cloud page.'
    );
  }
  return value;
}

/** The team's Developer Program standing, including whether the PLA needs signing. */
export async function fetchTeam(session: Session): Promise<TeamStanding> {
  const body = record(await request<unknown>(session, `teams/${teamOf(session)}`, { api: CI }));

  if (!body) {
    throw new Error('Xcode Cloud returned no team document, so there is nothing to report.');
  }

  return {
    name: text(body['name']) ?? '(unnamed)',
    programState: text(body['program_state']) ?? '(not stated)',
    plaNeedsSigning: flag(body['wwdr_pla_needs_signing'], 'the Program License Agreement needs signing'),
    plaWithinGracePeriod: flag(body['wwdr_team_within_pla_grace_period'], 'the team is inside the PLA grace period'),
    developerTeamId: text(body['wwdr_team_id']) ?? '(not stated)',
  };
}

/**
 * The digest.
 *
 * Both booleans were `false` in the only recording, so what this prints when either is true
 * has never been seen rendered against real data. The wording is therefore a description of
 * the fields and not of their consequences: nothing observed here says what Apple stops
 * when a PLA goes unsigned, or how long a grace period runs, and the digest does not claim
 * to know. Apple's documentation is where that belongs.
 */
export function formatTeam(team: TeamStanding): string {
  const lines = [
    `team       ${team.name}`,
    `program    ${team.programState}`,
    `PLA        ${team.plaNeedsSigning ? 'signature outstanding' : 'signed'}`,
  ];

  if (team.plaWithinGracePeriod) {
    lines.push('           Apple reports the team inside the PLA grace period');
  }

  lines.push(`dev team   ${team.developerTeamId}`);
  return lines.join('\n');
}

/**
 * The thirteen things Xcode Cloud says this session may do, in the order the digest prints
 * them: the wire key, and the phrase that names the capability.
 *
 * One table rather than two. It is what `fetchCapabilities` reads the response with, what
 * the fail-fast message quotes when a key is missing, and what `formatCapabilities` labels
 * its lines with, so a capability cannot be parsed under one name and printed under
 * another. Apple's `can_` prefix is kept on the field names because these are permissions
 * and `canRemoveProducts` reads as one where `removeProducts` reads as an instruction.
 *
 * The set is closed on purpose. Thirteen keys arrived in each of the three recordings and a
 * fourteenth would be Apple changing the response, which is a re-capture rather than
 * something to absorb silently.
 */
const CAPABILITIES = {
  canEditRestrictedWorkflows: ['can_edit_restricted_workflows', 'edit restricted workflows'],
  canRestrictWorkflows: ['can_restrict_workflows', 'restrict a workflow to fewer people'],
  canRemoveProducts: ['can_remove_products', 'remove products'],
  canChangeNextBuildNumber: ['can_change_next_build_number', "change a product's next build number"],
  canManageSubscriptions: ['can_manage_subscriptions', 'manage the Xcode Cloud subscription'],
  canConfigureExternalDeployments: ['can_configure_external_deployments', 'configure external deployments'],
  canTriggerExternalDeployments: ['can_trigger_external_deployments', 'trigger an external deployment'],
  canConfigureNotarization: ['can_configure_notarization', 'configure notarization'],
  canTriggerNotarization: ['can_trigger_notarization', 'trigger notarization'],
  canConfigureLockedVersionAliases: ['can_configure_locked_version_aliases', 'configure locked version aliases'],
  canConfigureLockedProductEnvironmentVariables: [
    'can_configure_locked_product_environment_variables',
    'configure locked product environment variables',
  ],
  canConfigureInfrastructureValidation: [
    'can_configure_infrastructure_validation',
    'configure infrastructure validation',
  ],
  canOnboardToDistribution: ['can_onboard_to_distribution', 'onboard the team to distribution'],
} as const satisfies Record<string, readonly [string, string]>;

/**
 * What Xcode Cloud says the holder of this session may do.
 *
 * Read from `GET ci/api/teams/{teamId}/user-capabilities`, which despite its name returns
 * **no identity at all** — thirteen booleans, no name, no email address, no user id. That is
 * what makes it a read this client will make: it does not describe a person, it describes
 * what the captured cookie is permitted to do, and the answer arrives with nobody's personal
 * details attached. Reading *who is on the team* remains out of scope and unchanged.
 *
 * Derived from the type above so the field set and the wire keys cannot drift apart.
 */
export type SessionCapabilities = { -readonly [K in keyof typeof CAPABILITIES]: boolean };

/**
 * What Apple says this session is allowed to do in Xcode Cloud.
 *
 * Every one of the thirteen is required. A capability Apple did not mention is not a
 * capability that is withheld — defaulting a missing key to `false` would report a
 * permission as denied on the strength of Apple having said nothing, and defaulting it to
 * `true` would be worse. `flag()` refuses both, for the reason it was written.
 */
export async function fetchCapabilities(session: Session): Promise<SessionCapabilities> {
  const path = `teams/${teamOf(session)}/user-capabilities`;
  const body = record(await request<unknown>(session, path, { api: CI }));

  if (!body) {
    throw new Error('Xcode Cloud returned no capabilities document, so there is nothing to report.');
  }

  const capabilities = {} as SessionCapabilities;
  for (const field of Object.keys(CAPABILITIES) as (keyof SessionCapabilities)[]) {
    const [key, phrase] = CAPABILITIES[field];
    capabilities[field] = flag(body[key], `this session may ${phrase}`);
  }
  return capabilities;
}

/**
 * The digest.
 *
 * All thirteen were `true` in all three recordings, so a withheld capability has never been
 * seen rendered against real data — the same caveat `formatTeam` carries, and for the same
 * reason. The wording is therefore a report of what Apple said and not a prediction: a `no`
 * here has never been observed to precede a refusal, because no `no` has been observed.
 *
 * It is also not a promise about *this* client, which performs none of these operations —
 * the `CI` base is read-only and every one of the thirteen is a write. What this answers is
 * what the account may do, wherever it is done from.
 */
export function formatCapabilities(capabilities: SessionCapabilities): string {
  const lines = ['Xcode Cloud says this session may:'];
  for (const field of Object.keys(CAPABILITIES) as (keyof SessionCapabilities)[]) {
    const [, phrase] = CAPABILITIES[field];
    lines.push(`  ${capabilities[field] ? 'yes' : ' no'}  ${phrase}`);
  }
  return lines.join('\n');
}
