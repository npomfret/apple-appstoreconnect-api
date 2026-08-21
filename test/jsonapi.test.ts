/**
 * Splicing `included` back into the relationships that point at it. Everything the CLI
 * prints and every field the digest reads comes through here, so a relationship that
 * silently resolves to the wrong thing is a wrong answer everywhere at once.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { Document, Resource, denormalize, denormalizeAll } from '../src/jsonapi';

const DOCUMENT: Document<Resource> = {
  data: {
    type: 'resolutionCenterThreads',
    id: 'thread-1',
    attributes: { threadType: 'REJECTION_REVIEW_SUBMISSION' },
    relationships: {
      app: { data: { type: 'apps', id: 'app-1' } },
      resolutionCenterMessages: {
        data: [
          { type: 'resolutionCenterMessages', id: 'msg-1' },
          { type: 'resolutionCenterMessages', id: 'msg-2' },
        ],
      },
      appMessageThreadDetail: { data: null },
    },
  },
  included: [
    { type: 'apps', id: 'app-1', attributes: { name: 'Funmax' } },
    { type: 'resolutionCenterMessages', id: 'msg-1', attributes: { messageBody: 'first' } },
  ],
};

describe('denormalize', () => {
  const thread = denormalize(DOCUMENT, DOCUMENT.data);

  test('attributes are lifted onto the resource', () => {
    assert.equal(thread.type, 'resolutionCenterThreads');
    assert.equal(thread.id, 'thread-1');
    assert.equal(thread.threadType, 'REJECTION_REVIEW_SUBMISSION');
  });

  test('a to-one relationship becomes the resource it names', () => {
    assert.equal((thread.app as Record<string, unknown>).name, 'Funmax');
  });

  test('a to-many relationship keeps its order', () => {
    const messages = thread.resolutionCenterMessages as Record<string, unknown>[];
    assert.deepEqual(
      messages.map((message) => message.id),
      ['msg-1', 'msg-2']
    );
    assert.equal(messages[0].messageBody, 'first');
  });

  // The include list decides what was sideloaded, so a linkage with nothing behind it is
  // ordinary. It stays as the identifier rather than becoming undefined: the id is still
  // an answer, and losing it would look like the relationship wasn't there at all.
  test('a linkage with nothing included stays a bare identifier', () => {
    const messages = thread.resolutionCenterMessages as Record<string, unknown>[];
    assert.deepEqual(messages[1], { type: 'resolutionCenterMessages', id: 'msg-2' });
  });

  test('an explicitly empty relationship is null, not missing', () => {
    assert.equal(thread.appMessageThreadDetail, null);
    assert.ok('appMessageThreadDetail' in thread);
  });

  test('a cycle stops at a stub instead of recurring forever', () => {
    const document: Document<Resource> = {
      data: {
        type: 'threads',
        id: 't1',
        relationships: { draft: { data: { type: 'drafts', id: 'd1' } } },
      },
      included: [
        {
          type: 'drafts',
          id: 'd1',
          attributes: { messageBody: 'hello' },
          relationships: { thread: { data: { type: 'threads', id: 't1' } } },
        },
      ],
    };

    const cyclic = denormalize(document, document.data);
    const draft = cyclic.draft as Record<string, unknown>;
    assert.equal(draft.messageBody, 'hello');
    assert.deepEqual(draft.thread, { type: 'threads', id: 't1' });
  });
});

describe('denormalizeAll', () => {
  test('a collection comes back one entry per primary resource', () => {
    const document: Document = {
      data: [
        { type: 'apps', id: '1', attributes: { name: 'One' } },
        { type: 'apps', id: '2', attributes: { name: 'Two' } },
      ],
    };

    assert.deepEqual(
      denormalizeAll(document).map((app) => app.name),
      ['One', 'Two']
    );
  });

  test('an empty draft box — data: null — is no resources, not a crash', () => {
    assert.deepEqual(denormalizeAll({ data: null }), []);
  });
});
