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
  const out: Denormalized = { type: resource.type, id: resource.id, ...(resource.attributes ?? {}) };

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

  return out;
}

/** Denormalizes a whole document's primary data. */
export function denormalizeAll(document: Document): Denormalized[] {
  const primary = Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
  return primary.map((resource) => denormalize(document, resource));
}
