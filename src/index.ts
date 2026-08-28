/**
 * The library contract, namespaced by credential.
 *
 * The three names are the boundary this project is built around, so they are the shape
 * callers see: `official` needs an API key, `gap` needs a browser session, and `shared`
 * needs neither. A flat re-export would hide which of those a given import commits you to.
 */

export * as gap from './gap';
export * as official from './official';
export * as shared from './shared';
