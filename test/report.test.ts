/**
 * The digest, which is where Apple's own strings get read by a person.
 *
 * Three kinds of thing go wrong here and none of them raises anything. Timestamps arrive as
 * local wall-clock time with the offset of that moment, so twice a year the string order and
 * the chronological order disagree: sorting the text put the states in the wrong order and
 * made the "held for" column negative. A message body arrives as HTML, where the difference
 * between what a reviewer typed and what is shown to you is a decoding step. And a span gets
 * rounded twice, which prints lengths that do not exist: "60m", "23h 60m". All three are
 * wrong answers rather than errors, which is why they are worth a test.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { Document, Resource } from '../src/jsonapi';
import {
  fetchHistory,
  formatHistory,
  formatReport,
  htmlToText,
  StateChange,
  SubmissionReport,
} from '../src/report';
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

describe('how long a state was held', () => {
  // The last column of the timeline. Rounding it down to a unit and up in the remainder
  // decides the two independently, so the remainder could reach a whole unit and be printed
  // as one — a length nobody can read back as a time.
  const waiting: StateChange = {
    state: 'WAITING_FOR_REVIEW',
    date: '2026-04-25T05:46:00-07:00',
    byApple: false,
  };

  function held(seconds: number): string {
    const line = formatHistory([{ ...waiting, heldForSeconds: seconds }]).split('\n')[0];

    return line.trim().split(/\s{2,}/).pop() ?? '';
  }

  test('a state held just under an hour is an hour, not sixty minutes', () => {
    assert.equal(held(3599), '1h');
    assert.equal(held(3570), '1h');
  });

  test('the carry keeps going, so just under a day is a day', () => {
    assert.equal(held(86399), '1d');
    // 1d 23h 40m, which used to round its own remainder up to "1d 24h".
    assert.equal(held(171600), '2d');
  });

  test('a span that does not land on a unit still shows the remainder', () => {
    assert.equal(held(3660), '1h 1m');
    assert.equal(held(90000), '1d 1h');
    assert.equal(held(1180800), '13d 16h');
  });

  test('under a minute is counted in seconds, exactly', () => {
    assert.equal(held(0), '0s');
    assert.equal(held(45), '45s');
    assert.equal(held(59), '59s');
  });

  test('the state it is in now has no length to report', () => {
    const line = formatHistory([waiting]);

    assert.equal(line.trim().split(/\s{2,}/).pop(), '(current)');
  });
});

describe('decoding a message body', () => {
  test('tags become the layout they stood for', () => {
    assert.equal(
      htmlToText('<p>Your app crashed.</p><ul><li>iPad Air</li><li>iOS 18.2</li></ul>'),
      'Your app crashed.\n  - iPad Air\n  - iOS 18.2'
    );
  });

  test('the entities Apple sends are decoded', () => {
    assert.equal(
      htmlToText('<p>Terms&nbsp;&amp; Conditions &quot;as&#39;is&quot; &lt;b&gt;</p>'),
      'Terms & Conditions "as\'is" <b>'
    );
  });

  test('an escaped entity is decoded once, not twice', () => {
    // "&amp;lt;" is how a reviewer who typed the characters "&lt;" reaches us. Decoding the
    // ampersand first and then re-reading the result showed them a "<" they never wrote.
    assert.equal(
      htmlToText('<p>Write &amp;lt;name&amp;gt; where the name goes, and &amp;amp; for an and.</p>'),
      'Write &lt;name&gt; where the name goes, and &amp; for an and.'
    );
  });

  test('an entity outside the set is left alone rather than guessed at', () => {
    assert.equal(htmlToText('<p>Waiting&hellip;</p>'), 'Waiting&hellip;');
  });

  test('a decoded angle bracket is text, not a tag to strip', () => {
    assert.equal(htmlToText('<p>Remove &lt;script&gt; from the page</p>'), 'Remove <script> from the page');
  });
});

describe('rendering the digest', () => {
  function report(lastMessageDate: string | undefined): SubmissionReport {
    return {
      threadId: 'thread-1',
      lastMessageDate,
      lastMessageFromApple: true,
      versions: [],
      guidelines: [],
      attachments: [],
      hasDraftReply: false,
    };
  }

  function lastMessageLine(date: string | undefined): string | undefined {
    return formatReport([report(date)])
      .split('\n')
      .find((line) => line.trim().startsWith('last msg'));
  }

  test('a stamp with an offset keeps the offset', () => {
    const line = lastMessageLine('2026-04-25T07:34:29-07:00');

    assert.equal(line, '  last msg   2026-04-25 07:34-07:00 (from Apple)');
  });

  test('a UTC stamp with a fraction of a second is shortened, not mangled', () => {
    // Cutting at fixed positions made this "2026-05-17 12:25.31Z", which reads as a time
    // and is not one.
    const line = lastMessageLine('2026-05-17T12:25:06.31Z');

    assert.equal(line, '  last msg   2026-05-17 12:25Z (from Apple)');
  });

  test('a stamp in neither shape is shown as it arrived', () => {
    const line = lastMessageLine('sometime on Tuesday');

    assert.equal(line, '  last msg   sometime on Tuesday (from Apple)');
  });

  test('no last message means no line about one', () => {
    assert.equal(lastMessageLine(undefined), undefined);
  });
});
