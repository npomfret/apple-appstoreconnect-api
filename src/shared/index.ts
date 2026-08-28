/**
 * What both transports may use.
 *
 * Nothing here holds a credential, a host, or a session — that is the admission test. A
 * module that fails it belongs to whichever side owns the credential it carries, because a
 * shared module is reachable from both sides at once and would be the one place the two
 * authentication systems could meet.
 */

export * from './confirm';
export * from './errors';
export * from './jsonapi';
export * from './log';
export * from './query';
