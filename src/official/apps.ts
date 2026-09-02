/**
 * Which app an official command is about, resolved from something a person knows.
 *
 * Evidence: OpenAPI 4.4.1 defines `GET /v1/apps` with `filter[bundleId]` and `filter[name]`,
 * and `fields[apps]` naming `name` and `bundleId`. The bundle-id lookup was confirmed by the
 * approved live read of 2026-08-26; the name lookup by the approved dry run of 2026-09-02.
 *
 * Neither lookup puts an account- or app-specific identifier in configuration, and neither
 * guesses: a reference that matches no app, or more than one, is an error naming what
 * Apple offered, so the caller picks by id.
 */

import { OfficialClient } from './client';
import { asObject, asRows, asString } from './parse';

/** Apple's documented maximum page, and the one page each lookup asks for. */
const PAGE = 200;

interface AppRow {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string;
}

function appRow(value: unknown, index: number): AppRow {
  const row = asObject(value, `apps response.data[${index}]`);
  const attributes = asObject(row.attributes, `apps response.data[${index}].attributes`);
  return {
    id: asString(row.id, `apps response.data[${index}].id`),
    name: asString(attributes.name, `apps response.data[${index}].name`),
    bundleId: asString(attributes.bundleId, `apps response.data[${index}].bundleId`),
  };
}

/**
 * One app, by one filter, compared exactly on the way back.
 *
 * The specification says each filter exists and not how it compares, so the rows are
 * matched here as well: "No Spoilers" must not resolve to "No Spoilers - Grand Prix".
 */
async function findApp(
  client: OfficialClient,
  filter: 'filter[bundleId]' | 'filter[name]',
  wanted: string,
  pick: (app: AppRow) => string,
  what: string
): Promise<string> {
  if (!wanted.trim()) throw new Error(`A non-empty ${what} is required.`);
  const document = await client.get('/v1/apps', {
    [filter]: wanted.trim(),
    'fields[apps]': ['name', 'bundleId'],
    limit: PAGE,
  });
  const apps = asRows(document, 'apps response').map(appRow);
  const matching = apps.filter((app) => pick(app) === wanted.trim());

  if (matching.length === 0) {
    throw new Error(
      `No app has ${what} ${JSON.stringify(wanted.trim())}` +
        (apps.length ? `; Apple offered ${apps.map((app) => `${JSON.stringify(app.name)} (${app.bundleId})`).join(', ')}.` : '.')
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `More than one app has ${what} ${JSON.stringify(wanted.trim())}: ` +
        `${matching.map((app) => `${app.id} (${app.bundleId})`).join(', ')}; use its app ID.`
    );
  }
  return matching[0]!.id;
}

/** Resolve one app by bundle ID. */
export function findAppId(client: OfficialClient, bundleId: string): Promise<string> {
  return findApp(client, 'filter[bundleId]', bundleId, (app) => app.bundleId, 'bundle ID');
}

/** Resolve one app by the name App Store Connect shows for it, matched exactly. */
export function findAppIdByName(client: OfficialClient, name: string): Promise<string> {
  return findApp(client, 'filter[name]', name, (app) => app.name, 'name');
}
