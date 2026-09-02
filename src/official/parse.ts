/**
 * Narrowing what Apple's official API sent, one field at a time.
 *
 * Every wrapper in this directory reads `unknown` off the transport and must decide, field
 * by field, whether what arrived is what the specification promised. These helpers make
 * that decision the same way everywhere: a value of the wrong shape is refused with the
 * name of the field, never defaulted — a missing boolean is not `false`, a missing list is
 * not empty. They were private to `availability.ts` until the second wrapper needed them.
 *
 * Only `id` and `type` are required on most of Apple's schemas, so a wrapper asks for the
 * attributes it relies on explicitly and fails fast when one is absent.
 */

import { Document, Resource } from '../shared/jsonapi';

export type ObjectValue = Record<string, unknown>;

export function asObject(value: unknown, where: string): ObjectValue {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as ObjectValue;
  }
  throw new Error(`Apple omitted or changed ${where}; expected an object.`);
}

export function asString(value: unknown, where: string): string {
  if (typeof value === 'string' && value) return value;
  throw new Error(`Apple omitted or changed ${where}; expected a non-empty string.`);
}

export function asBoolean(value: unknown, where: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`Apple omitted or changed ${where}; expected a boolean.`);
}

export function asStrings(value: unknown, where: string): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  throw new Error(`Apple omitted or changed ${where}; expected a list of strings.`);
}

/** The single primary resource of a document. */
export function asData(document: unknown, where: string): ObjectValue {
  return asObject(asObject(document, where).data, `${where}.data`);
}

/** The primary resources of a collection document. */
export function asRows(document: unknown, where: string): unknown[] {
  const rows = asObject(document, where).data;
  if (!Array.isArray(rows)) throw new Error(`Apple omitted or changed ${where}.data.`);
  return rows;
}

/**
 * Whether a collection has a page after this one.
 *
 * Apple's `PagedDocumentLinks.next` is present only when there is more; a wrapper decides
 * for itself what to do about that, since "refuse rather than under-report" and "say the
 * list continues" are both honest and are different answers.
 */
export function hasNextPage(document: unknown, where: string): boolean {
  const next = asObject(asObject(document, where).links ?? {}, `${where}.links`).next;
  return next !== undefined && next !== null;
}

function asResource(value: unknown, where: string): Resource {
  const row = asObject(value, where);
  const resource: Resource = { type: asString(row.type, `${where}.type`), id: asString(row.id, `${where}.id`) };
  if (row.attributes !== undefined) resource.attributes = asObject(row.attributes, `${where}.attributes`);
  if (row.relationships !== undefined) {
    resource.relationships = asObject(row.relationships, `${where}.relationships`) as Resource['relationships'];
  }
  return resource;
}

/**
 * A collection response as a JSON:API document, so `shared/jsonapi` can splice its
 * `included` resources into the rows. The join lives there rather than here; this only
 * establishes that every row and every sideload carries the identity the join keys on.
 */
export function asCollection(document: unknown, where: string): Document<Resource[]> {
  const root = asObject(document, where);
  const data = asRows(root, where).map((row, index) => asResource(row, `${where}.data[${index}]`));
  const included = root.included;
  if (included !== undefined && !Array.isArray(included)) {
    throw new Error(`Apple omitted or changed ${where}.included; expected a list.`);
  }
  return {
    data,
    ...(included ? { included: included.map((row, index) => asResource(row, `${where}.included[${index}]`)) } : {}),
    ...(root.links !== undefined ? { links: asObject(root.links, `${where}.links`) } : {}),
    ...(root.meta !== undefined ? { meta: asObject(root.meta, `${where}.meta`) } : {}),
  };
}