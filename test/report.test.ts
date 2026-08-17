/**
 * The history timeline, which is where Apple's timestamps have to be treated as moments
 * rather than as text.
 *
 * Apple stamps them in local wall-clock time with the offset of that moment, so twice a
 * year the string order and the chronological order disagree. Sorting the text put the
 * states in the wrong order and made the "held for" column negative — no error, just a
 * wrong answer about how long a review took.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { Document, Resource } from '../src/jsonapi';
import { fetchHistory } from '../src/report';
import { SESSION, stubFetch, withStderr } from './helpers';

function change(id: string, state: string, date: string | undefined, initiator: string): Resource {
  return { type: 'appStoreVersionStateChanges', id, attributes: { appStoreState: state, date, initiator } };
}

async function history(data: Resource[]) {
  const document: Document<Resource[]> = { data };
  const stub = stubFetch(() => ({ body: document }));
  try {
    return await withStderr(() => fetchHistory(SESSION, 'v1'));
  } finally {
    stub.restore();
  }
}

describe('ordering state changes', () => {
  // 01:30-07:00 is 08:30Z and happened first; 01:00-08:00 is 09:00Z and happened second.
  // Sorted as text they come back the other way round.
  const dst = [
    change('2', 'IN_REVIEW', '2026-11-01T01:00:00-08:00', 'Apple'),
    change('1', 'WAITING_FOR_REVIEW', '2026-11-01T01:30:00-07:00', 'nick@example.com'),
  ];

  test('a clock change does not invert the timeline', async () => {
    assert.deepEqual(
      (await history(dst)).map((state) => state.state),
      ['WAITING_FOR_REVIEW', 'IN_REVIEW']
    );
  });

  test('how long a state was held is a real duration', async () => {
    const changes = await history(dst);

    assert.equal(changes[0].heldForSeconds, 1800);
    // The state it is in now has no end, so there is nothing to report.
    assert.equal(changes[1].heldForSeconds, undefined);
  });

  test('who moved it is kept, since that is what tells a rejection from your own', async () => {
    const changes = await history(dst);

    assert.equal(changes[0].byApple, false);
    assert.equal(changes[0].initiator, 'nick@example.com');
    assert.equal(changes[1].byApple, true);
  });

  test('ordinary dates order the ordinary way', async () => {
    const changes = await history([
      change('2', 'IN_REVIEW', '2026-04-27T15:40:00-07:00', 'Apple'),
      change('1', 'PREPARE_FOR_SUBMISSION', '2026-04-25T05:46:00-07:00', 'nick@example.com'),
      change('3', 'REJECTED', '2026-04-27T15:51:00-07:00', 'Apple'),
    ]);

    assert.deepEqual(
      changes.map((state) => state.state),
      ['PREPARE_FOR_SUBMISSION', 'IN_REVIEW', 'REJECTED']
    );
    assert.equal(changes[1].heldForSeconds, 660);
  });

  test('a date that will not parse gives no duration rather than a wrong one', async () => {
    const changes = await history([
      change('1', 'PREPARE_FOR_SUBMISSION', undefined, 'nick@example.com'),
      change('2', 'WAITING_FOR_REVIEW', '2026-04-25T07:34:00-07:00', 'nick@example.com'),
    ]);

    // Unusable dates sort to the far past — where an empty string put them — and neither
    // end of a span that includes one gets a made-up length.
    assert.equal(changes[0].state, 'PREPARE_FOR_SUBMISSION');
    assert.equal(changes[0].heldForSeconds, undefined);
  });

  test('no recorded changes is an empty history, not an error', async () => {
    assert.deepEqual(await history([]), []);
  });
});
