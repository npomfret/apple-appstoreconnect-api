/**
 * Apple's documented API, on a JWT signed by a `.p8` key.
 *
 * Everything Apple specifies belongs here, and this is where the convenience wrappers grow:
 * one module per capability, folding a multi-call sequence into a single typed answer.
 *
 * Nothing here may import from `gap/`, and nothing there may import from here.
 * `test/module-boundary.test.ts` enforces it.
 */

export * from './apps';
export * from './availability';
export * from './client';
export * from './testflight';
