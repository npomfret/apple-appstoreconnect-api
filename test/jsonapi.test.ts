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
    type: 'reviewSubmissions',
    id: 'sub-1',
    attributes: { state: 'UNRESOLVED_ISSUES' },
    relationships: {
      appStoreVersionForReview: { data: { type: 'appStoreVersions', id: 'v1' } },
      items: {
        data: [
          { type: 'reviewSubmissionItems', id: 'item-1' },
          { type: 'reviewSubmissionItems', id: 'item-2' },
        ],
      },
      lastUpdatedByActor: { data: null },
    },
  },
  included: [
    { type: 'appStoreVersions', id: 'v1', attributes: { versionString: '1.1.1' } },
    { type: 'reviewSubmissionItems', id: 'item-1', attributes: { resolved: false } },
  ],
};

describe('denormalize', () => {
  const submission = denormalize(DOCUMENT, DOCUMENT.data);

  test('attributes are lifted onto the resource', () => {
    assert.equal(submission.type, 'reviewSubmissions');
    assert.equal(submission.id, 'sub-1');
    assert.equal(submission.state, 'UNRESOLVED_ISSUES');
  });

  test('a to-one relationship becomes the resource it names', () => {
    assert.equal((submission.appStoreVersionForReview as Record<string, unknown>).versionString, '1.1.1');
  });

  test('a to-many relationship keeps its order', () => {
    const items = submission.items as Record<string, unknown>[];
    assert.deepEqual(
      items.map((item) => item.id),
      ['item-1', 'item-2']
    );
    assert.equal(items[0].resolved, false);
  });

  // The include list decides what was sideloaded, so a linkage with nothing behind it is
  // ordinary. It stays as the identifier rather than becoming undefined: the id is still
  // an answer, and losing it would look like the relationship wasn't there at all.
  test('a linkage with nothing included stays a bare identifier', () => {
    const items = submission.items as Record<string, unknown>[];
    assert.deepEqual(items[1], { type: 'reviewSubmissionItems', id: 'item-2' });
  });

  test('an explicitly empty relationship is null, not missing', () => {
    assert.equal(submission.lastUpdatedByActor, null);
    assert.ok('lastUpdatedByActor' in submission);
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

    const thread = denormalize(document, document.data);
    const draft = thread.draft as Record<string, unknown>;
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
