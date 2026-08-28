/**
 * The fingerprint that stands between a confirmation and a write that cannot be undone.
 *
 * `send-reply` and `save-draft` both print the draft box and ask about the words in it —
 * one copies them to Apple, the other writes over them, and neither keeps a copy. Between
 * the answer and the write is a round trip, and App Store Connect autosaves that box as you
 * type, so a browser open on the same thread can move it while the prompt is on screen.
 * Both writes compare `draftState` before and after to notice.
 *
 * So this is a comparison whose failure is silent in both directions. Too sensitive and a
 * save that nobody touched is refused; not sensitive enough and the words that were agreed
 * to are not the words that go. Neither shows up as an error, which is why they are here.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { draftState } from '../src/gap/api';
import { Denormalized } from '../src/shared/jsonapi';

function draft(body: string, attachments: Array<{ id: string; fileName: string }> = []): Denormalized {
  return {
    type: 'resolutionCenterDraftMessages',
    id: 'draft-1',
    messageBody: body,
    resolutionCenterMessageAttachments: attachments.map((file) => ({
      type: 'resolutionCenterMessageAttachments',
      id: file.id,
      fileName: file.fileName,
    })),
  };
}

describe('what counts as the same draft', () => {
  test('the same box read twice is the same draft', () => {
    assert.equal(draftState(draft('We have fixed the crash.')), draftState(draft('We have fixed the crash.')));
  });

  test('an edit while the question was on screen is a different draft', () => {
    assert.notEqual(draftState(draft('We have fixed it.')), draftState(draft('We have fixed it!')));
  });

  test('whitespace counts, since it is the reply Apple gets verbatim', () => {
    assert.notEqual(draftState(draft('Fixed.')), draftState(draft('Fixed. ')));
  });

  test('an attachment added or taken away is a different draft', () => {
    const one = draft('See the video.', [{ id: 'a-1', fileName: 'crash.mp4' }]);
    const two = draft('See the video.', [
      { id: 'a-1', fileName: 'crash.mp4' },
      { id: 'a-2', fileName: 'log.txt' },
    ]);

    assert.notEqual(draftState(one), draftState(two));
  });

  test('the order iris listed the attachments in is not a change', () => {
    // Two reads of one unedited draft can sideload the same set in either order, and
    // refusing that would refuse a send nobody had touched.
    const one = draft('See both.', [
      { id: 'a-1', fileName: 'crash.mp4' },
      { id: 'a-2', fileName: 'log.txt' },
    ]);
    const two = draft('See both.', [
      { id: 'a-2', fileName: 'log.txt' },
      { id: 'a-1', fileName: 'crash.mp4' },
    ]);

    assert.equal(draftState(one), draftState(two));
  });

  test('a file swapped for another of the same name is a different draft', () => {
    const one = draft('Here it is.', [{ id: 'a-1', fileName: 'screenshot.png' }]);
    const two = draft('Here it is.', [{ id: 'a-2', fileName: 'screenshot.png' }]);

    assert.notEqual(draftState(one), draftState(two));
  });

  test('a draft deleted and started again is a different draft, despite the shared id', () => {
    // The id is derived from the thread, so it comes back identical — see docs/replying.md.
    // What changes is the body, which is why the body is in here and the id is not enough.
    const one = draft('First attempt.');
    const two = draft('');

    assert.notEqual(draftState(one), draftState(two));
  });

  test('a draft with no attachments relationship reads as one with none', () => {
    // A POST/PATCH response carries no attachments at all; a fresh GET carries an empty
    // list. Those are the same draft, and a comparison across the two must not say
    // otherwise.
    const bare: Denormalized = { type: 'resolutionCenterDraftMessages', id: 'draft-1', messageBody: 'Fixed.' };

    assert.equal(draftState(bare), draftState(draft('Fixed.')));
  });
});
