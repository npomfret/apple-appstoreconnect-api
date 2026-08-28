/**
 * The library contract, namespaced by credential.
 *
 * Three of the names are the boundary this project is built around, so they are the shape
 * callers see: `official` needs an API key, `gap` needs a browser session, and `shared`
 * needs neither. A flat re-export would hide which of those a given import commits you to.
 *
 * `accounts` is the fourth and is not an area: it is what decides *which* account's
 * credentials the other two are handed, and it reads neither of them.
 */

export * as accounts from './accounts';
export * as gap from './gap';
export * as official from './official';
export * as shared from './shared';
