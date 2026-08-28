/**
 * The capabilities Apple serves nowhere else, on a browser-derived session cookie.
 *
 * Adding a module here asserts a gap: that Apple's official specification has no schema for
 * the field being read. It is not a statement about which route is convenient. When Apple
 * publishes an equivalent, the capability moves to `official/` and the call here goes —
 * that direction only, and never the reverse.
 *
 * Nothing here may import from `official/`, and nothing there may import from here.
 * `test/module-boundary.test.ts` enforces it.
 */

export * from './api';
export * from './ci';
export * from './curl';
export * from './http';
export * from './report';
export * from './session';
