/**
 * The developer portal, for the one thing on it this client reads: the catalogue of
 * capabilities and services a bundle ID can have.
 *
 * Checked against specification **4.5.1** (1,001 paths, 1,473 schemas) on 2026-11-06. The
 * official API has `CapabilityType`, an enum of 28, and `bundleIdCapabilities` to set one —
 * and no resource listing what exists. `weather`, `MUSIC_KIT`, `SHAZAM`, `entitlementKeys` and
 * `includeRequestable` occur nowhere in the specification. The portal's catalogue has 221 rows,
 * among them WeatherKit, which the official enum cannot name, and says per row which
 * entitlements it writes, on which platforms and distribution types it applies, and whether it
 * can be enabled or must be requested.
 *
 * Read-only, on a base that can carry nothing else — see `portalRead` in `http.ts`. The write
 * recorded beside it, enabling WeatherKit on a bundle ID, is not mapped.
 */

import { portalRead } from './http';
import { record, segment, text } from './parse';
import { PortalSession } from './session';

/**
 * The query the browser sent, on the one catalogue request recorded: the type filter and
 * `includeRequestable` in the URL, the bundle ID and the platforms in the body. The platforms
 * are the browser's literal for an iOS/macOS bundle ID; what other values change is not
 * established, so this sends exactly what was recorded.
 */
const CATALOGUE_QUERY = { 'filter[capabilityType]': ['capability', 'service'], 'filter[includeRequestable]': 'true' };
const CATALOGUE_PLATFORMS = ['IOS', 'MACOS'];

/** A value Apple was expected to send, refused rather than defaulted — the rule `ci.ts` keeps. */
function missing(what: string): Error {
  return new Error(
    `The developer portal did not send ${what}. This is a private endpoint with no schema ` +
      "behind it, so a changed response is a real possibility — re-capture a bundle ID's edit page."
  );
}

/**
 * One capability or service, as the catalogue describes it.
 *
 * The flags kept are the ones every one of the 221 recorded rows carries. The three that only
 * steer the page — `associatedToRequestForms`, `hasExistingFeatureRequest`,
 * `displaySupportedSDKs` — and the two that were `null` on every row are not carried.
 */
export interface CatalogueEntry {
  /** Apple's id, upper snake case: the `capability` id a bundle ID capability links to. */
  id: string;
  name: string;
  /** Apple's `capabilityType`, verbatim: `capability` (218 recorded) or `service` (3). */
  type: string;
  description: string;
  /** `supportedSDKs[].name`: `IOS`, `MAC_OS`, `TV_OS`, `WATCH_OS`, `VISION_OS` recorded. */
  platforms: string[];
  /**
   * `distributionTypes[].name`: `DEVELOPMENT`, `AD_HOC`, `STORE`, `DEVELOPER_ID` recorded.
   * Absent where Apple sent none — five of the 221 rows — which is not the same as empty.
   */
  distributionTypes?: string[];
  /** The entitlement keys it writes into a profile. Absent on five rows, as above. */
  entitlementKeys?: string[];
  documentationUrl?: string;
  editable: boolean;
  enabledByDefault: boolean;
  optional: boolean;
  isPublic: boolean;
  optInRequired: boolean;
  canRequestFromPortal: boolean;
  distributionApprovalRequired: boolean;
  developmentOnly: boolean;
  supportsWildcard: boolean;
}

function flag(source: Record<string, unknown>, key: string, id: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') throw missing(`${key} on capability ${id}`);
  return value;
}

/** `[{name, displayValue}]` to its names, refusing an entry without one. */
function names(value: unknown, key: string, id: string): string[] {
  if (!Array.isArray(value)) throw missing(`a ${key} list on capability ${id}`);
  return value.map((entry) => {
    const name = text(record(entry)?.['name']);
    if (name === undefined) throw missing(`a name on an entry of ${key} on capability ${id}`);
    return name;
  });
}

/** A list of strings where Apple sent one, `undefined` where it sent nothing, refused otherwise. */
function optionalStrings(value: unknown, key: string, id: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw missing(`a readable ${key} list on capability ${id}`);
  }
  return value;
}

function readEntry(row: unknown): CatalogueEntry {
  const source = record(row);
  const id = text(source?.['id']);
  const attributes = record(source?.['attributes']);
  if (!id || !attributes) throw missing('an id and attributes on a catalogue row');

  const name = text(attributes['name']);
  const type = text(attributes['capabilityType']);
  const description = attributes['description'];
  if (name === undefined) throw missing(`a name on capability ${id}`);
  if (type === undefined) throw missing(`a capabilityType on capability ${id}`);
  if (typeof description !== 'string') throw missing(`a description on capability ${id}`);

  const entitlementKeys = optionalStrings(attributes['entitlementKeys'], 'entitlementKeys', id);
  const documentationUrl = text(attributes['documentationURL']);

  return {
    id,
    name,
    type,
    description,
    platforms: names(attributes['supportedSDKs'], 'supportedSDKs', id),
    ...(attributes['distributionTypes'] === undefined
      ? {}
      : { distributionTypes: names(attributes['distributionTypes'], 'distributionTypes', id) }),
    ...(entitlementKeys === undefined ? {} : { entitlementKeys }),
    ...(documentationUrl === undefined ? {} : { documentationUrl }),
    editable: flag(attributes, 'editable', id),
    enabledByDefault: flag(attributes, 'enabledByDefault', id),
    optional: flag(attributes, 'optional', id),
    isPublic: flag(attributes, 'isPublic', id),
    optInRequired: flag(attributes, 'optInRequired', id),
    canRequestFromPortal: flag(attributes, 'canRequestFromPortal', id),
    distributionApprovalRequired: flag(attributes, 'distributionApprovalRequired', id),
    developmentOnly: flag(attributes, 'developmentOnly', id),
    supportsWildcard: flag(attributes, 'supportsWildcard', id),
  };
}

/** Which bundle ID, on which developer team, the catalogue is asked about. */
export interface CatalogueScope {
  /**
   * The bundle ID's resource id — the 10-character id in its edit page's URL — not its
   * identifier. The CLI resolves it from the identifier through the official API.
   */
  readonly bundleIdResourceId: string;
  /** The 10-character developer team id: the account's `portalTeamId`. */
  readonly teamId: string;
}

/**
 * Every capability and service the portal offers a bundle ID.
 *
 * One request, unpaged: the recorded response carried all 221 rows with
 * `meta.paging` of `{total: 0, limit: 0}`, so the paging block says nothing about the rows and
 * is not read.
 */
export async function fetchCapabilityCatalogue(session: PortalSession, scope: CatalogueScope): Promise<CatalogueEntry[]> {
  const document = record(
    await portalRead(session, 'capabilities', {
      query: CATALOGUE_QUERY,
      bodyQuery: {
        'filter[bundleId]': segment(scope.bundleIdResourceId, 'bundle ID resource id'),
        'filter[platform]': CATALOGUE_PLATFORMS,
      },
      teamId: segment(scope.teamId, 'developer team id'),
    })
  );
  const rows = document?.['data'];
  if (!Array.isArray(rows)) throw missing('a list of capabilities');
  return rows.map(readEntry);
}

/** One line per entry, with a second for what it applies to and how it is turned on. */
export function formatCapabilityCatalogue(entries: CatalogueEntry[]): string {
  if (entries.length === 0) return 'No capabilities.';

  return entries
    .map((entry) => {
      const notes = [
        entry.editable ? undefined : 'not editable',
        entry.canRequestFromPortal ? 'requested from the portal' : undefined,
        entry.optInRequired ? 'opt-in required' : undefined,
        entry.distributionApprovalRequired ? 'distribution needs approval' : undefined,
        entry.developmentOnly ? 'development only' : undefined,
        entry.enabledByDefault ? 'on by default' : undefined,
      ].filter((note): note is string => note !== undefined);
      return [
        `${entry.id.padEnd(40)} ${entry.type.padEnd(10)} ${entry.name}`,
        `    platforms ${entry.platforms.join(', ') || '(none)'}` +
          (entry.entitlementKeys?.length ? `; entitlements ${entry.entitlementKeys.join(', ')}` : ''),
        ...(notes.length ? [`    ${notes.join('; ')}`] : []),
      ].join('\n');
    })
    .join('\n');
}
