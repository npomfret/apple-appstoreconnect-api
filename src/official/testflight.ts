/**
 * A TestFlight group's builds: prune the group down to its newest, or add builds to it.
 *
 * Evidence: OpenAPI 4.4.1 defines every call here — `GET /v1/betaGroups` with
 * `filter[app]` and `filter[name]`; `GET /v1/builds` with `filter[app]`, `filter[id]`,
 * `filter[version]` and `filter[betaGroups]`, a `-uploadedDate` sort and
 * `include=preReleaseVersion`; and `POST` and `DELETE /v1/betaGroups/{id}/relationships/builds`,
 * both taking `BetaGroupBuildsLinkagesRequest`, a list of `{type: "builds", id}`. Checked
 * on 2026-09-02. **Neither write has been run by this client**; what each sends is the
 * documented body, and `docs/evidence.md` says so.
 *
 * These are the first writes on the official transport, and they are each other's undo: a
 * build removed from a group is still in App Store Connect, and the `POST` puts it back.
 * Expiring a build (`PATCH /v1/builds/{id}` with `expired`) is a different operation with
 * no documented undo, and is deliberately not here.
 *
 * Remove-from-group is also what the browser does: a recording of the TestFlight page
 * removing a build sends exactly the `DELETE` body above to the private `iris/v1` spelling
 * of the same route. Apple serves the route officially, so the private one is not used.
 */

import { denormalizeAll, Denormalized } from '../shared/jsonapi';
import { audited } from '../shared/log';
import { Query } from '../shared/query';
import { OfficialClient } from './client';
import { asBoolean, asCollection, asObject, asRows, asString, hasNextPage } from './parse';

/** Apple's documented maximum page, and the one page each read here asks for. */
const PAGE = 200;

export interface BetaGroupRef {
  readonly id: string;
  readonly name: string;
  readonly isInternalGroup: boolean;
  /** Apple's own flag for a group that receives every build automatically. */
  readonly hasAccessToAllBuilds: boolean;
}

export interface GroupBuild {
  readonly id: string;
  /** Apple's `version` attribute on a build: the build number. */
  readonly buildNumber: string;
  /** The marketing version, off the sideloaded pre-release version when Apple sent it. */
  readonly version?: string;
  readonly platform?: string;
  /** Exactly as Apple stamped it. */
  readonly uploadedDate: string;
  readonly expired: boolean;
  readonly processingState: string;
}

function groupRow(value: unknown, index: number): BetaGroupRef {
  const row = asObject(value, `beta group row ${index}`);
  const attributes = asObject(row.attributes, `beta group row ${index}.attributes`);
  return {
    id: asString(row.id, `beta group row ${index}.id`),
    name: asString(attributes.name, `beta group row ${index}.name`),
    isInternalGroup: asBoolean(attributes.isInternalGroup, `beta group row ${index}.isInternalGroup`),
    hasAccessToAllBuilds: asBoolean(
      attributes.hasAccessToAllBuilds,
      `beta group row ${index}.hasAccessToAllBuilds`
    ),
  };
}

/** The shape of an Apple id for a build or a group, as opposed to a name a person would type. */
const APPLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve one group by name or by id, within one app.
 *
 * A uuid is an id and anything else is a name, since a group name is any string a person
 * chooses and nobody chooses a uuid. The rows that come back are compared against the
 * reference exactly, whatever `filter[name]` matched on: the specification says the filter
 * exists and not how it compares, and a group called "Beta" must not resolve to
 * "Beta (old)". None or several is an error rather than a choice — the reference is the
 * whole of what says which group's builds change. `filter[app]` goes on both lookups, so
 * an id from another app's group is "no such group" rather than that group.
 */
export async function findBetaGroup(
  client: OfficialClient,
  appId: string,
  reference: string
): Promise<BetaGroupRef> {
  if (!appId.trim()) throw new Error('A non-empty app ID is required.');
  const wanted = reference.trim();
  if (!wanted) throw new Error('A non-empty group name or group id is required.');
  const byId = APPLE_ID.test(wanted);

  const document = await client.get('/v1/betaGroups', {
    'filter[app]': appId.trim(),
    ...(byId ? { 'filter[id]': wanted } : { 'filter[name]': wanted }),
    'fields[betaGroups]': ['name', 'isInternalGroup', 'hasAccessToAllBuilds'],
    limit: PAGE,
  });
  const groups = asRows(document, 'beta groups response').map(groupRow);
  const matching = groups.filter((group) =>
    byId ? group.id.toLowerCase() === wanted.toLowerCase() : group.name === wanted
  );
  const described = byId ? `has id ${wanted}` : `is named "${wanted}"`;

  if (matching.length === 0) {
    throw new Error(
      `No TestFlight group on app ${appId.trim()} ${described}` +
        (groups.length ? `; Apple offered ${groups.map((group) => `"${group.name}"`).join(', ')}.` : '.')
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `More than one TestFlight group on app ${appId.trim()} ${described} ` +
        `(${matching.map((group) => group.id).join(', ')}); name the one you mean by id.`
    );
  }
  return matching[0]!;
}

/**
 * A group that receives every build automatically has no membership to edit, and Apple
 * does not say so: the first live write, on 2026-09-02, sent a documented `DELETE` naming
 * twelve builds in such a group, was answered `204`, and the read-back listed all twelve
 * still there. So the write is accepted and ignored, and it is refused here before any
 * build is listed. The flag cannot be cleared through the official API — it is not among
 * `BetaGroupUpdateRequest`'s attributes in 4.4.1 — so the way through is TestFlight itself.
 *
 * This refusal was here, was removed on the strength of a browser recording that sends
 * the same request to such a group, and is back: a recording of a request is not a
 * recording of its effect, and that one was a curl with no response in it.
 */
function refuseAutomatic(group: BetaGroupRef, doing: string): void {
  if (!group.hasAccessToAllBuilds) return;
  throw new Error(
    `Group "${group.name}" receives every build automatically (hasAccessToAllBuilds), so ` +
      `${doing} changes nothing: Apple accepts the request and leaves the group as it was — ` +
      'observed live on 2026-09-02. Turn off automatic distribution for the group in ' +
      'TestFlight first; the official API cannot.'
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function buildRow(row: Denormalized, index: number): GroupBuild {
  const where = `build row ${index}`;
  const uploadedDate = asString(row.uploadedDate, `${where}.uploadedDate`);
  if (Number.isNaN(Date.parse(uploadedDate))) {
    throw new Error(`Apple changed ${where}.uploadedDate; "${uploadedDate}" is not a date.`);
  }

  // The pre-release version is a sideload. Denormalizing leaves a bare `{type, id}` stub
  // where Apple did not include it, and that stub has no `version` — so both fields are
  // optional, and a build with no marketing version is still a build with an id.
  const preRelease = typeof row.preReleaseVersion === 'object' && row.preReleaseVersion !== null
    ? (row.preReleaseVersion as Record<string, unknown>)
    : {};
  const version = optionalString(preRelease.version);
  const platform = optionalString(preRelease.platform);

  return {
    id: row.id,
    buildNumber: asString(row.version, `${where}.version`),
    ...(version ? { version } : {}),
    ...(platform ? { platform } : {}),
    uploadedDate,
    expired: asBoolean(row.expired, `${where}.expired`),
    processingState: asString(row.processingState, `${where}.processingState`),
  };
}

/**
 * One page of builds matching a filter, newest first.
 *
 * Sorted by Apple on the way out and again here on the instant — not the text, since Apple
 * stamps dates with an offset — so the order a plan is built on is one this code has
 * checked rather than one it trusts. The sort on the request still matters: when more than
 * a page matches, it decides which 200 arrive, and newest-first is what makes the newest
 * builds certain to be on the page.
 */
async function fetchBuilds(
  client: OfficialClient,
  filter: Query
): Promise<{ builds: GroupBuild[]; more: boolean }> {
  const document = await client.get('/v1/builds', {
    ...filter,
    sort: '-uploadedDate',
    limit: PAGE,
    include: 'preReleaseVersion',
    'fields[builds]': ['version', 'uploadedDate', 'expired', 'processingState', 'preReleaseVersion'],
    'fields[preReleaseVersions]': ['version', 'platform'],
  });
  const where = 'builds response';
  const rows = denormalizeAll(asCollection(document, where));
  const builds = rows
    .map(buildRow)
    .sort((left, right) => Date.parse(right.uploadedDate) - Date.parse(left.uploadedDate));
  return { builds, more: hasNextPage(document, where) };
}

/** The builds a group holds, newest first. */
export function fetchGroupBuilds(
  client: OfficialClient,
  groupId: string
): Promise<{ builds: GroupBuild[]; more: boolean }> {
  return fetchBuilds(client, { 'filter[betaGroups]': groupId });
}

/**
 * Resolve builds named the way a person names them.
 *
 * A reference is a build number — Apple's `version`, the `CFBundleVersion`, which is what
 * TestFlight shows in brackets — or an Apple build id, told apart by shape: a uuid is an
 * id and anything else is a number, since a build number is any string a project chooses
 * and no project chooses a uuid. Each is looked up within the app with the documented
 * filter for its kind, and each must match exactly one build: a number reused across two
 * marketing versions is refused with both ids, so the id form is always a way through.
 */
export async function findBuilds(
  client: OfficialClient,
  appId: string,
  references: readonly string[]
): Promise<GroupBuild[]> {
  if (!appId.trim()) throw new Error('A non-empty app ID is required.');
  const wanted = references.map((reference) => reference.trim());
  if (wanted.length === 0 || wanted.some((reference) => !reference)) {
    throw new Error('At least one non-empty build number or build id is required.');
  }

  const ids = wanted.filter((reference) => APPLE_ID.test(reference));
  const numbers = wanted.filter((reference) => !APPLE_ID.test(reference));
  const found: GroupBuild[] = [];
  if (ids.length) {
    found.push(...(await fetchBuilds(client, { 'filter[app]': appId.trim(), 'filter[id]': ids })).builds);
  }
  if (numbers.length) {
    found.push(...(await fetchBuilds(client, { 'filter[app]': appId.trim(), 'filter[version]': numbers })).builds);
  }

  return wanted.map((reference) => {
    const matches = APPLE_ID.test(reference)
      ? found.filter((build) => build.id.toLowerCase() === reference.toLowerCase())
      : found.filter((build) => build.buildNumber === reference);
    if (matches.length === 0) {
      throw new Error(`No build on app ${appId.trim()} is ${describeReference(reference)}.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `More than one build on app ${appId.trim()} is ${describeReference(reference)}: ` +
          `${matches.map((build) => `${label(build)} ${build.id}`).join(', ')}. Name it by id.`
      );
    }
    return matches[0]!;
  });
}

function describeReference(reference: string): string {
  return APPLE_ID.test(reference) ? `build id ${reference}` : `build number ${reference}`;
}

// ---------------------------------------------------------------------------------------
// Pruning: keep the newest, remove the rest from the group.

export interface PruneOptions {
  readonly appId: string;
  /** The group's name as shown in TestFlight, or its id. Matched exactly, within the app. */
  readonly group: string;
  /** How many of the newest builds stay. Defaults to one at the CLI. */
  readonly keep: number;
}

export interface PrunePlan {
  readonly appId: string;
  readonly group: BetaGroupRef;
  /** How many of the newest builds stay, **per platform**. */
  readonly keep: number;
  /** Newest first: the newest `keep` builds of each platform in the group. */
  readonly kept: readonly GroupBuild[];
  /** Newest first: everything else on the page. */
  readonly remove: readonly GroupBuild[];
  /**
   * Apple paged the list: the group holds more than one page of 200, and the older builds
   * beyond it are in neither list. A second run after this one reaches them.
   */
  readonly more: boolean;
}

export interface PruneResult {
  readonly plan: PrunePlan;
  /** The ids sent in the `DELETE`. Empty when there was nothing to remove and nothing was sent. */
  readonly removed: readonly string[];
  /** What Apple lists in the group on the read after the write. */
  readonly remaining: readonly GroupBuild[];
  /** Asked to leave and still listed afterwards. Empty is the only good answer. */
  readonly stillInGroup: readonly string[];
}

/**
 * Which builds stay and which go. A read: nothing here changes anything.
 *
 * `keep` counts **per platform**. The first live dry run, on 2026-09-02, met a group holding
 * iOS and macOS builds together, and "keep the newest one" counted across both: it kept the
 * iOS build and would have taken the only current Mac build out of the group. A tester on
 * one platform installs only that platform's builds, so the newest of each is what "the
 * newest" means. A build with no platform — the sideload did not arrive — is its own bucket
 * rather than a member of every one.
 */
export async function fetchPrunePlan(client: OfficialClient, options: PruneOptions): Promise<PrunePlan> {
  const { appId, keep } = options;
  if (!Number.isInteger(keep) || keep < 0) {
    throw new Error(`keep must be a whole number of builds, not ${String(keep)}.`);
  }

  const group = await findBetaGroup(client, appId, options.group);
  refuseAutomatic(group, 'removing builds');
  const { builds, more } = await fetchGroupBuilds(client, group.id);

  const seen = new Map<string, number>();
  const kept: GroupBuild[] = [];
  const remove: GroupBuild[] = [];
  for (const build of builds) {
    const platform = build.platform ?? '';
    const already = seen.get(platform) ?? 0;
    seen.set(platform, already + 1);
    (already < keep ? kept : remove).push(build);
  }

  return { appId: appId.trim(), group, keep, kept, remove, more };
}

/**
 * `--check` is green only when the group is already the size asked for and Apple sent the
 * whole of it. A further page is not ready: what is on it has not been seen.
 */
export function pruneReady(plan: PrunePlan): boolean {
  return plan.remove.length === 0 && !plan.more;
}

function linkages(builds: readonly string[]): { data: { type: 'builds'; id: string }[] } {
  return { data: builds.map((id) => ({ type: 'builds', id })) };
}

function relationshipPath(group: BetaGroupRef): string {
  return `/v1/betaGroups/${encodeURIComponent(group.id)}/relationships/builds`;
}

/**
 * The write, then the read that says whether it took.
 *
 * One `DELETE` naming every build to remove, which is the shape Apple documents; the ids
 * are the plan's, so what leaves the group is exactly what the plan showed, whatever was
 * uploaded to the group in the meantime. Nothing is sent for an empty plan.
 *
 * The read-back is the evidence this client has that the write did what the `204` says.
 * It is reported rather than trusted: an id still listed afterwards is in `stillInGroup`,
 * and the CLI exits nonzero on it.
 */
export async function pruneBuilds(client: OfficialClient, plan: PrunePlan): Promise<PruneResult> {
  const removed = plan.remove.map((build) => build.id);
  if (removed.length === 0) {
    return { plan, removed, remaining: plan.kept, stillInGroup: [] };
  }

  await audited(
    'testflight.prune',
    { appId: plan.appId, groupId: plan.group.id, keep: plan.keep, builds: removed },
    () => client.write('DELETE', relationshipPath(plan.group), linkages(removed))
  );

  const { builds: remaining } = await fetchGroupBuilds(client, plan.group.id);
  const left = new Set(remaining.map((build) => build.id));
  return {
    plan,
    removed,
    remaining,
    stillInGroup: removed.filter((id) => left.has(id)),
  };
}

// ---------------------------------------------------------------------------------------
// Adding: put named builds into the group.

export interface AddOptions {
  readonly appId: string;
  /** The group's name as shown in TestFlight, or its id. Matched exactly, within the app. */
  readonly group: string;
  /** Build numbers or Apple build ids, in any mix. */
  readonly builds: readonly string[];
}

export interface AddPlan {
  readonly appId: string;
  readonly group: BetaGroupRef;
  /** Resolved and not yet in the group, in the order they were named. */
  readonly add: readonly GroupBuild[];
  /** Resolved and already in the group; nothing is sent for these. */
  readonly alreadyInGroup: readonly GroupBuild[];
}

export interface AddResult {
  readonly plan: AddPlan;
  /** The ids sent in the `POST`. Empty when every build named was already there. */
  readonly added: readonly string[];
  /** What Apple lists in the group on the read after the write. */
  readonly remaining: readonly GroupBuild[];
  /** Asked to join and not listed afterwards. Empty is the only good answer. */
  readonly notInGroup: readonly string[];
}

/**
 * Which of the named builds the group lacks. A read: nothing here changes anything.
 *
 * The group is listed first so that a build already in it is reported rather than sent
 * again — what Apple does with a linkage that already exists is not documented, and a
 * plan that says "already there" is an answer where a `409` is a guess. The membership
 * read is one page; a build beyond it on a group of more than 200 is reported as absent
 * and sent, which is the harmless direction to be wrong in.
 */
export async function fetchAddPlan(client: OfficialClient, options: AddOptions): Promise<AddPlan> {
  const { appId } = options;
  const group = await findBetaGroup(client, appId, options.group);
  refuseAutomatic(group, 'adding builds');
  const builds = await findBuilds(client, appId, options.builds);
  const { builds: members } = await fetchGroupBuilds(client, group.id);
  const present = new Set(members.map((build) => build.id));

  // Named twice is one build, not two linkages.
  const seen = new Set<string>();
  const unique = builds.filter((build) => !seen.has(build.id) && seen.add(build.id));

  return {
    appId: appId.trim(),
    group,
    add: unique.filter((build) => !present.has(build.id)),
    alreadyInGroup: unique.filter((build) => present.has(build.id)),
  };
}

/** Green when every build named is already in the group. */
export function addReady(plan: AddPlan): boolean {
  return plan.add.length === 0;
}

/**
 * The write, then the read that says whether it took — `pruneBuilds` the other way round.
 * One `POST` naming every build to add. Nothing is sent for an empty plan.
 */
export async function addBuilds(client: OfficialClient, plan: AddPlan): Promise<AddResult> {
  const added = plan.add.map((build) => build.id);
  if (added.length === 0) {
    return { plan, added, remaining: plan.alreadyInGroup, notInGroup: [] };
  }

  await audited(
    'testflight.add',
    { appId: plan.appId, groupId: plan.group.id, builds: added },
    () => client.write('POST', relationshipPath(plan.group), linkages(added))
  );

  const { builds: remaining } = await fetchGroupBuilds(client, plan.group.id);
  const listed = new Set(remaining.map((build) => build.id));
  return {
    plan,
    added,
    remaining,
    notInGroup: added.filter((id) => !listed.has(id)),
  };
}

// ---------------------------------------------------------------------------------------
// Rendering.

function label(build: GroupBuild): string {
  return build.version ? `${build.version} (${build.buildNumber})` : `build ${build.buildNumber}`;
}

function describe(build: GroupBuild): string {
  const flags = [build.platform, build.processingState.toLowerCase(), build.expired ? 'expired' : undefined]
    .filter((flag): flag is string => flag !== undefined)
    .join(', ');
  return `  ${build.uploadedDate}  ${label(build)}  ${flags}  ${build.id}`;
}

/**
 * The flag is stated in both directions, since it decides whether a write can do anything:
 * a plan is only ever printed for a group with it off, and saying so is what tells a reader
 * that the refusal did not apply rather than leaving them to infer it.
 */
function groupLine(group: BetaGroupRef): string {
  const kind = group.isInternalGroup ? 'internal' : 'external';
  const automatic = `automatic distribution ${group.hasAccessToAllBuilds ? 'on' : 'off'}`;
  return `group      ${group.name}  (${kind}, ${automatic}, ${group.id})`;
}

function section(heading: string, builds: readonly GroupBuild[]): string[] {
  return [`${heading} (${builds.length}):`, ...(builds.length ? builds.map(describe) : ['  none'])];
}

/** Stable human-readable output; `--json` carries the same plan for machines. */
export function formatPrunePlan(plan: PrunePlan): string {
  const lines = [
    `app        ${plan.appId}`,
    groupLine(plan.group),
    `keep       ${plan.keep} newest per platform`,
    '',
    ...section('keep', plan.kept),
    '',
    ...section('remove from group', plan.remove),
  ];
  if (plan.more) {
    lines.push(
      '',
      `Apple paged the list at ${PAGE}: the group holds older builds beyond this page that are ` +
        'in neither list above. Run again after this one to reach them.'
    );
  }
  return lines.join('\n');
}

/**
 * The read-back is the verdict, not the status code. "Removed 12; 20 remain" is what this
 * printed on 2026-09-02 over a `204` that removed nothing, and it read as success with a
 * footnote. The first line now counts what actually left.
 */
export function formatPruneResult(result: PruneResult): string {
  const { plan } = result;
  const total = plan.kept.length + plan.remove.length;
  const left = result.removed.length - result.stillInGroup.length;
  const lines = [
    `${left} of ${result.removed.length} builds asked to leave group "${plan.group.name}" are gone; ` +
      `${result.remaining.length} of ${total} remain.`,
  ];
  if (result.stillInGroup.length) {
    lines.push(
      '',
      `Apple answered the removal with success and still lists ${result.stillInGroup.length} of them:`,
      ...result.stillInGroup.map((id) => `  ${id}`)
    );
  }
  return lines.join('\n');
}

export function formatAddPlan(plan: AddPlan): string {
  return [
    `app        ${plan.appId}`,
    groupLine(plan.group),
    '',
    ...section('add to group', plan.add),
    '',
    ...section('already in group', plan.alreadyInGroup),
  ].join('\n');
}

export function formatAddResult(result: AddResult): string {
  const { plan } = result;
  const joined = result.added.length - result.notInGroup.length;
  const lines = [
    `${joined} of ${result.added.length} builds asked to join group "${plan.group.name}" are in it; ` +
      `it now holds ${result.remaining.length}.`,
  ];
  if (result.notInGroup.length) {
    lines.push(
      '',
      `Apple answered the addition with success and does not list ${result.notInGroup.length} of them:`,
      ...result.notInGroup.map((id) => `  ${id}`)
    );
  }
  return lines.join('\n');
}
