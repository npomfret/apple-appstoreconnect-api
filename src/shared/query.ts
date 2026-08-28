/**
 * Query-string construction, shared by both transports.
 *
 * This lives outside either transport because both of Apple's APIs speak the same query
 * dialect and neither one owns it. Sharing the encoder is not the same as sharing a
 * transport: nothing here holds a credential, a host, or a session, so a module on one
 * side of the boundary can use it without reaching across to the other.
 */

export type QueryValue = string | number | boolean | string[] | undefined;
export type Query = Record<string, QueryValue>;

/**
 * Apple's endpoints use literal brackets and commas — `filter[state]=A,B` — and
 * URLSearchParams would percent-encode both. Mirror what the browser sends instead.
 */
export function buildQuery(query: Query): string {
  const parts: string[] = [];

  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const flat = Array.isArray(value) ? value.join(',') : String(value);
    parts.push(`${name}=${encodeURIComponent(flat).replace(/%2C/g, ',')}`);
  }

  return parts.length ? `?${parts.join('&')}` : '';
}
