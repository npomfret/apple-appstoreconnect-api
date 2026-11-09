/**
 * Which bundle ID resource an identifier names, through Apple's official API.
 *
 * Evidence: OpenAPI 4.5.1 defines `GET /v1/bundleIds` with `filter[identifier]` and
 * `fields[bundleIds]` naming `identifier`. Never sent by this client before 2026-11-06. That the
 * id it returns is the id the developer portal filters its capability catalogue by — the
 * 10-character id in a bundle ID's edit-page URL — is the shape both were recorded in, not a
 * side-by-side comparison of one bundle ID on both hosts; `docs/evidence.md` says so.
 *
 * Exact on the way back, like `apps.ts`: the specification says the filter exists and not how
 * it compares, and `com.example.app` must not resolve to `com.example.app.widget`.
 */

import { OfficialClient } from './client';
import { asObject, asRows, asString } from './parse';

/** Apple's documented maximum page, and the one page the lookup asks for. */
const PAGE = 200;

/** The resource id of the bundle ID registered as `identifier`. */
export async function findBundleIdResourceId(client: OfficialClient, identifier: string): Promise<string> {
  const wanted = identifier.trim();
  if (!wanted) throw new Error('A non-empty bundle ID is required.');

  const document = await client.get('/v1/bundleIds', {
    'filter[identifier]': wanted,
    'fields[bundleIds]': ['identifier'],
    limit: PAGE,
  });
  const rows = asRows(document, 'bundleIds response').map((value, index) => {
    const row = asObject(value, `bundleIds response.data[${index}]`);
    const attributes = asObject(row.attributes, `bundleIds response.data[${index}].attributes`);
    return {
      id: asString(row.id, `bundleIds response.data[${index}].id`),
      identifier: asString(attributes.identifier, `bundleIds response.data[${index}].identifier`),
    };
  });
  const matching = rows.filter((row) => row.identifier === wanted);
  const [only, ...others] = matching;

  if (!only) {
    throw new Error(
      `No bundle ID is registered as ${JSON.stringify(wanted)}` +
        (rows.length ? `; Apple offered ${rows.map((row) => row.identifier).join(', ')}.` : '.')
    );
  }
  if (others.length) {
    throw new Error(
      `More than one bundle ID resource is registered as ${JSON.stringify(wanted)}: ` +
        `${matching.map((row) => row.id).join(', ')}.`
    );
  }
  return only.id;
}
