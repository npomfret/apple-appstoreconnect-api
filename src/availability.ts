/**
 * Storefront availability from Apple's official App Store Connect API.
 *
 * Evidence: OpenAPI 4.4.1 defines `GET /v1/apps/{id}/appAvailabilityV2` and
 * `GET /v2/appAvailabilities/{id}/territoryAvailabilities`. A live read was explicitly
 * approved and confirmed both routes on 2026-08-26; it made no change to App Store data.
 */

import { OfficialClient } from './official';

/**
 * Every `TerritoryAvailability.contentStatuses` value in Apple's OpenAPI specification
 * 4.4.1, in the order the schema lists them.
 *
 * This is a union rather than a set of patterns because the states are finite, Apple
 * publishes them, and neighbouring values mean opposite things:
 * `PROCESSING_TO_AVAILABLE` is a storefront arriving and `PROCESSING_TO_NOT_AVAILABLE` is
 * one leaving. Both spellings of pre-order — `PREORDER` and `PRE_ORDER` — are Apple's, so
 * neither can be normalised away.
 */
const CONTENT_STATUSES = [
  'AVAILABLE',
  'AVAILABLE_FOR_PREORDER_ON_DATE',
  'PROCESSING_TO_NOT_AVAILABLE',
  'PROCESSING_TO_AVAILABLE',
  'PROCESSING_TO_PRE_ORDER',
  'AVAILABLE_FOR_SALE_UNRELEASED_APP',
  'PREORDER_ON_UNRELEASED_APP',
  'AVAILABLE_FOR_PREORDER',
  'MISSING_RATING',
  'CANNOT_SELL_RESTRICTED_RATING',
  'BRAZIL_REQUIRED_TAX_ID',
  'BRAZIL_GAMBLING_NOT_VERIFIED',
  'MISSING_GRN',
  'UNVERIFIED_GRN',
  'ICP_NUMBER_INVALID',
  'ICP_NUMBER_MISSING',
  'TRADER_STATUS_NOT_PROVIDED',
  'TRADER_STATUS_VERIFICATION_FAILED',
  'TRADER_STATUS_VERIFICATION_STATUS_MISSING',
  'CANNOT_SELL_SEVENTEEN_PLUS_APPS',
  'CANNOT_SELL_SEXUALLY_EXPLICIT',
  'CANNOT_SELL_NON_IOS_GAMES',
  'CANNOT_SELL_SEVENTEEN_PLUS_GAMES',
  'CANNOT_SELL_CASINO',
  'CANNOT_SELL_CASINO_WITHOUT_GRAC',
  'CANNOT_SELL_CASINO_WITHOUT_AGE_VERIFICATION',
  'CANNOT_SELL_ADULT_ONLY',
  'CANNOT_SELL_GAMBLING_CONTESTS',
  'CANNOT_SELL_GAMBLING',
  'CANNOT_SELL_CONTESTS',
  'CANNOT_SELL_NINETEEN_PLUS_WITHOUT_GRAC',
  'CANNOT_SELL',
  'CANNOT_SELL_FREQUENT_INTENSE_GAMBLING',
  'CANNOT_SELL_FREQUENT_INTENSE_ALCOHOL_TOBACCO_DRUGS',
  'CANNOT_SELL_FREQUENT_INTENSE_VIOLENCE',
  'CANNOT_SELL_FREQUENT_INTENSE_SEXUAL_CONTENT_NUDITY',
  'CANNOT_SELL_INFREQUENT_MILD_ALCOHOL_TOBACCO_DRUGS',
  'CANNOT_SELL_INFREQUENT_MILD_SEXUAL_CONTENT_NUDITY',
  'CANNOT_SELL_FREQUENT_INTENSE',
  'CANNOT_SELL_FREQUENT_INTENSE_WITHOUT_GRAC',
  'CANNOT_SELL_FREQUENT_GAMBLING',
  'CANNOT_SELL_FREQUENT_ALCOHOL_TOBACCO_DRUGS',
  'CANNOT_SELL_FREQUENT_VIOLENCE',
  'CANNOT_SELL_FREQUENT_SEXUAL_CONTENT_NUDITY',
  'CANNOT_SELL_INFREQUENT_ALCOHOL_TOBACCO_DRUGS',
  'CANNOT_SELL_INFREQUENT_SEXUAL_CONTENT_NUDITY',
  'CANNOT_SELL_FREQUENT',
  'CANNOT_SELL_FREQUENT_WITHOUT_GRAC',
] as const;

/** A storefront content status Apple's 4.4.1 schema defines. */
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * What a storefront is doing, worst-first.
 *
 * `unknown` is load-bearing: a status Apple adds after 4.4.1, or a row that carries none at
 * all, must not be counted as either working or broken. It keeps `--check` red, because
 * claiming a storefront is ready is the answer that cannot be taken back.
 */
export type TerritoryState = 'available' | 'pending' | 'leaving' | 'unknown' | 'blocked';

const STATE_RANK: Readonly<Record<TerritoryState, number>> = {
  available: 0,
  pending: 1,
  leaving: 2,
  unknown: 3,
  blocked: 4,
};

/** On sale, or on its way to being on sale or on pre-order. Nothing to fix. */
const PENDING_STATUSES: ReadonlySet<string> = new Set<ContentStatus>([
  'AVAILABLE_FOR_PREORDER_ON_DATE',
  'PROCESSING_TO_AVAILABLE',
  'PROCESSING_TO_PRE_ORDER',
  'AVAILABLE_FOR_SALE_UNRELEASED_APP',
  'PREORDER_ON_UNRELEASED_APP',
  'AVAILABLE_FOR_PREORDER',
]);

/** In flight the other way: the app is being withdrawn from this storefront. */
const LEAVING_STATUSES: ReadonlySet<string> = new Set<ContentStatus>([
  'PROCESSING_TO_NOT_AVAILABLE',
]);

const KNOWN_STATUSES: ReadonlySet<string> = new Set<string>(CONTENT_STATUSES);

function statusState(status: string): TerritoryState {
  if (status === 'AVAILABLE') return 'available';
  if (PENDING_STATUSES.has(status)) return 'pending';
  if (LEAVING_STATUSES.has(status)) return 'leaving';
  return KNOWN_STATUSES.has(status) ? 'blocked' : 'unknown';
}

/**
 * A row is only as good as its worst status.
 *
 * Apple sends an array, and the entries are not alternatives:
 * `['PROCESSING_TO_AVAILABLE', 'CANNOT_SELL']` is a change in flight towards a storefront
 * that still cannot sell, and reporting it as merely pending would hide the blocker.
 */
export function territoryState(contentStatuses: readonly string[]): TerritoryState {
  if (contentStatuses.length === 0) return 'unknown';

  let worst: TerritoryState = 'available';
  for (const status of contentStatuses) {
    const state = statusState(status);
    if (STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  }
  return worst;
}

export interface TerritoryAvailability {
  readonly territory: string;
  readonly selected: boolean;
  /** Exactly the strings Apple sent, including any this build does not recognise. */
  readonly contentStatuses: readonly string[];
  readonly state: TerritoryState;
  readonly releaseDate?: string;
}

export interface AvailabilityReport {
  readonly appId: string;
  readonly availableInNewTerritories: boolean;
  readonly total: number;
  readonly selected: number;
  readonly available: number;
  readonly pending: number;
  readonly leaving: number;
  readonly unknown: number;
  readonly blocked: number;
  readonly unselected: number;
  readonly territories: readonly TerritoryAvailability[];
}

type ObjectValue = Record<string, unknown>;

function object(value: unknown, where: string): ObjectValue {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as ObjectValue;
  }
  throw new Error(`Apple omitted or changed ${where}; expected an object.`);
}

function string(value: unknown, where: string): string {
  if (typeof value === 'string' && value) return value;
  throw new Error(`Apple omitted or changed ${where}; expected a non-empty string.`);
}

function boolean(value: unknown, where: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`Apple omitted or changed ${where}; expected a boolean.`);
}

function strings(value: unknown, where: string): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  throw new Error(`Apple omitted or changed ${where}; expected a list of strings.`);
}

function data(document: unknown, where: string): ObjectValue {
  return object(object(document, where).data, `${where}.data`);
}

function appIdFrom(document: unknown, bundleId: string): string {
  const rows = object(document, 'apps response').data;
  if (!Array.isArray(rows)) throw new Error('Apple omitted or changed apps response.data.');
  if (rows.length === 0) throw new Error(`No app has bundle ID ${bundleId}.`);
  if (rows.length > 1) throw new Error(`More than one app has bundle ID ${bundleId}; use its app ID.`);
  return string(object(rows[0], 'apps response.data[0]').id, 'apps response.data[0].id');
}

/** Resolve one app without putting an account- or app-specific identifier in configuration. */
export async function findAppId(client: OfficialClient, bundleId: string): Promise<string> {
  if (!bundleId.trim()) throw new Error('A non-empty bundle ID is required.');
  const document = await client.get('/v1/apps', {
    'filter[bundleId]': bundleId.trim(),
    limit: 2,
  });
  return appIdFrom(document, bundleId);
}

function availabilityId(document: unknown): { id: string; newTerritories: boolean } {
  const row = data(document, 'app availability response');
  const attributes = object(row.attributes, 'app availability attributes');
  return {
    id: string(row.id, 'app availability id'),
    newTerritories: boolean(
      attributes.availableInNewTerritories,
      'app availability availableInNewTerritories'
    ),
  };
}

function territoryRow(value: unknown, index: number): TerritoryAvailability {
  const row = object(value, `territory availability row ${index}`);
  const attributes = object(row.attributes, `territory availability row ${index}.attributes`);
  const relationships = object(
    row.relationships,
    `territory availability row ${index}.relationships`
  );
  const territory = data(
    object(relationships.territory, `territory availability row ${index}.territory`),
    `territory availability row ${index}.territory`
  );
  const releaseDate = attributes.releaseDate;
  if (releaseDate !== undefined && releaseDate !== null && typeof releaseDate !== 'string') {
    throw new Error(`Apple changed territory availability row ${index}.releaseDate.`);
  }

  const contentStatuses = strings(
    attributes.contentStatuses,
    `territory availability row ${index}.contentStatuses`
  );

  return {
    territory: string(territory.id, `territory availability row ${index}.territory.id`),
    selected: boolean(attributes.available, `territory availability row ${index}.available`),
    contentStatuses,
    state: territoryState(contentStatuses),
    ...(typeof releaseDate === 'string' ? { releaseDate } : {}),
  };
}

/** Read every storefront row. The documented maximum of 200 covers Apple's 175 rows. */
export async function fetchAvailability(
  client: OfficialClient,
  appId: string
): Promise<AvailabilityReport> {
  if (!appId.trim()) throw new Error('A non-empty app ID is required.');
  const app = encodeURIComponent(appId.trim());
  const availability = availabilityId(
    await client.get(`/v1/apps/${app}/appAvailabilityV2`)
  );
  const document = object(
    await client.get(`/v2/appAvailabilities/${encodeURIComponent(availability.id)}/territoryAvailabilities`, {
      limit: 200,
      include: 'territory',
      'fields[territoryAvailabilities]': [
        'available',
        'releaseDate',
        'contentStatuses',
        'territory',
      ],
    }),
    'territory availabilities response'
  );
  const rows = document.data;
  if (!Array.isArray(rows)) {
    throw new Error('Apple omitted or changed territory availabilities response.data.');
  }
  const next = object(document.links ?? {}, 'territory availabilities response.links').next;
  if (next !== undefined && next !== null) {
    throw new Error(
      'Apple paged territory availability beyond 200 rows. Refusing to under-report; ' +
        'the official API paging path needs to be implemented from current schema evidence.'
    );
  }

  const territories = rows.map(territoryRow).sort((left, right) =>
    left.territory.localeCompare(right.territory)
  );
  const selected = territories.filter((row) => row.selected);
  const count = (state: TerritoryState): number =>
    selected.filter((row) => row.state === state).length;

  return {
    appId: appId.trim(),
    availableInNewTerritories: availability.newTerritories,
    total: territories.length,
    selected: selected.length,
    available: count('available'),
    pending: count('pending'),
    leaving: count('leaving'),
    unknown: count('unknown'),
    blocked: count('blocked'),
    unselected: territories.length - selected.length,
    territories,
  };
}

function grouped(rows: readonly TerritoryAvailability[]): string[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const status = row.contentStatuses.length ? row.contentStatuses.join(', ') : '(no status)';
    groups.set(status, [...(groups.get(status) ?? []), row.territory]);
  }
  return [...groups.entries()].map(([status, territories]) => `  ${status}: ${territories.join(', ')}`);
}

/** Stable human-readable output; `--json` exposes the complete rows for machines. */
export function formatAvailability(report: AvailabilityReport): string {
  const lines = [
    `app             ${report.appId}`,
    `storefronts     ${report.total}`,
    `selected        ${report.selected}`,
    `available       ${report.available}`,
    `pending         ${report.pending}`,
    `leaving         ${report.leaving}`,
    `unknown         ${report.unknown}`,
    `blocked         ${report.blocked}`,
    `unselected      ${report.unselected}`,
    `new territories ${report.availableInNewTerritories ? 'automatic' : 'not automatic'}`,
  ];

  const section = (state: TerritoryState, heading: string): void => {
    const rows = report.territories.filter((row) => row.selected && row.state === state);
    if (rows.length) lines.push('', heading, ...grouped(rows));
  };

  section('blocked', 'blocked by status:');
  section('unknown', 'unrecognised status (not in specification 4.4.1):');
  section('leaving', 'being withdrawn by status:');
  section('pending', 'pending by status:');

  const unselected = report.territories.filter((row) => !row.selected);
  if (unselected.length) lines.push('', `unselected: ${unselected.map((row) => row.territory).join(', ')}`);
  return lines.join('\n');
}

/**
 * `--check` is green only when every selected storefront is on sale right now.
 *
 * Pending and leaving rows are changes in flight and unknown rows are not understood, so
 * none of them is reported as ready. Comparing against `selected` covers every state at
 * once, including one added later.
 */
export function availabilityReady(report: AvailabilityReport): boolean {
  return report.available === report.selected;
}
