export interface ResourceIdentifier {
  type: string;
  id: string;
}

export interface Resource extends ResourceIdentifier {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: ResourceIdentifier | ResourceIdentifier[] | null }>;
}

export interface Document<T extends Resource | Resource[] | null = Resource | Resource[] | null> {
  data: T;
  included?: Resource[];
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

/** A resource with its `included` relationships spliced in, ready to read. */
export interface Denormalized {
  type: string;
  id: string;
  [key: string]: unknown;
}

function key(ref: ResourceIdentifier): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Splices `included` resources into their referencing relationships so callers can
 * walk `submission.items[0].appStoreVersion.versionString` instead of hand-joining
 * the sideloaded array. Cycles resolve to a bare {type, id} stub on the second visit.
 */
export function denormalize(document: Document, resource: Resource, seen = new Set<string>()): Denormalized {
  const index = new Map<string, Resource>();
  for (const item of document.included ?? []) index.set(key(item), item);
  for (const item of Array.isArray(document.data) ? document.data : [document.data]) {
    if (item) index.set(key(item), item);
  }
  return expand(resource, index, seen);
}

function expand(resource: Resource, index: Map<string, Resource>, seen: Set<string>): Denormalized {
  const self = key(resource);
  if (seen.has(self)) return { type: resource.type, id: resource.id };

  const nextSeen = new Set(seen).add(self);
  // What the document said this resource is. Held apart from the merge below and written
  // again at the end, for the reason on the return.
  const identity = { type: resource.type, id: resource.id };
  const out: Denormalized = { ...identity, ...(resource.attributes ?? {}) };

  for (const [name, relationship] of Object.entries(resource.relationships ?? {})) {
    const data = relationship?.data;
    if (data === undefined) continue;
    if (data === null) {
      out[name] = null;
    } else if (Array.isArray(data)) {
      out[name] = data.map((ref) => {
        const target = index.get(key(ref));
        return target ? expand(target, index, nextSeen) : { ...ref };
      });
    } else {
      const target = index.get(key(data));
      out[name] = target ? expand(target, index, nextSeen) : { ...data };
    }
  }

  /**
   * The identity is the document's, and a field does not get to rewrite it — it did until
   * 2026-08-21, when attributes were spliced in over the top of `type` and `id` and the
   * relationships after them.
   *
   * Flattening a resource this way is only safe because JSON:API puts attributes,
   * relationships, `type` and `id` in one namespace and forbids the collision. Apple does
   * not always hold to it: a `providers` resource recorded from the browser carries an
   * attribute *named* `type`, and merging that lifted a display string over the resource
   * type that `key`, the cycle guard and every caller walking the result read. Those five
   * recordings are sideloaded into `olympus/v1/actors`, which this client never calls — so
   * nothing reaches it today, and the reason to fix it is not that something does. It is
   * that the shape is Apple's rather than hypothetical, the merge is exported for callers
   * that are not this repo's, and `asc get` prints what comes out of here as data.
   *
   * The colliding attribute is dropped, which is the same answer JSON:API's own rule gives:
   * a member named `type` or `id` is not a field. Keeping both would need somewhere else to
   * put it, which is an output shape nothing has asked for. `type` and `id` keep the
   * position they were given above and the value they are given here.
   */
  return { ...out, ...identity };
}

/** Denormalizes a whole document's primary data. */
export function denormalizeAll(document: Document): Denormalized[] {
  const primary = Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
  return primary.map((resource) => denormalize(document, resource));
}
