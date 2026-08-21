/**
 * What must never reach the log. Both scrubs are here — by field name and by value —
 * because the point of having two is that each catches what the other misses.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { audit, log, redactSignedUrls } from '../src/log';
import { withStderr } from './helpers';

function logged(run: () => void): Promise<Record<string, unknown>[]> {
  return withStderr((captured) => {
    run();
    return captured.records();
  });
}

/** Restores ASC_LOG afterwards — an unset variable is not the same as one set to "undefined". */
async function atLevel(level: string, run: () => void): Promise<Record<string, unknown>[]> {
  const before = process.env.ASC_LOG;
  process.env.ASC_LOG = level;
  try {
    return await logged(run);
  } finally {
    if (before === undefined) delete process.env.ASC_LOG;
    else process.env.ASC_LOG = before;
  }
}

describe('secrets by field name', () => {
  test('a cookie is redacted however deep it is buried', async () => {
    const [record] = await logged(() =>
      log.warn('probe', { request: { headers: { cookie: 'myacinfo=real', 'x-csrf-itc': 'real' } } })
    );

    assert.equal(JSON.stringify(record).includes('myacinfo=real'), false);
    const request = record.request as { headers: Record<string, string> };
    assert.equal(request.headers.cookie, '[redacted]');
    assert.equal(request.headers['x-csrf-itc'], '[redacted]');
  });

  // Not a header: it arrives as a body attribute, nested wherever the response put it.
  // Nothing in this client reads the record that carries it any more — the scrub is a
  // standing rule about the field name, which is exactly what this pins.
  test('the demo account password is redacted wherever it arrives', async () => {
    const [record] = await logged(() =>
      log.warn('probe', { body: { data: { attributes: { demoAccountPassword: 'hunter2' } } } })
    );

    assert.equal(JSON.stringify(record).includes('hunter2'), false);
  });
});

describe('secrets by value', () => {
  const signed =
    'https://object-storage.apple.com/part?AWSAccessKeyId=AKIAEXAMPLE&Signature=abc%2Fdef&partNumber=1';

  test('the parameters that authorise an upload are replaced, and the rest is left alone', () => {
    const safe = redactSignedUrls(signed);

    assert.equal(safe.includes('abc%2Fdef'), false);
    assert.equal(safe.includes('AKIAEXAMPLE'), false);
    assert.ok(safe.includes('Signature=[redacted]'));
    assert.ok(safe.includes('partNumber=1'));
  });

  test('SigV4 names count too', () => {
    assert.ok(redactSignedUrls('?X-Amz-Signature=deadbeef&x=1').includes('X-Amz-Signature=[redacted]'));
  });

  // Storage hosts quote the request they refused back inside the error body, so this is
  // applied to whole strings rather than to things that parse as a URL.
  test('a signature quoted inside an error body is caught as well', async () => {
    const [record] = await logged(() =>
      log.error('probe', { body: `<Error><Resource>/part?Signature=abc</Resource></Error>` })
    );

    assert.equal(String(record.body).includes('Signature=abc'), false);
  });

  test('an error message goes through the same scrub', async () => {
    const [record] = await logged(() => log.error('probe', { error: new Error(`refused: ${signed}`) }));
    const error = record.error as { name: string; message: string };

    assert.equal(error.message.includes('abc%2Fdef'), false);
    assert.equal(error.name, 'Error');
  });
});

describe('the log as a whole', () => {
  test('a long string is truncated rather than burying the rest', async () => {
    const [record] = await logged(() => log.warn('probe', { body: 'x'.repeat(3000) }));

    assert.ok(String(record.body).endsWith('… (3000 chars)'));
    assert.ok(String(record.body).length < 3000);
  });

  test('a body that cannot be serialised degrades to a note', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const [record] = await logged(() => log.warn('probe', { body: circular }));
    assert.equal(record.event, 'log.unserializable');
    assert.equal(record.of, 'probe');
  });

  test('an event below the level is not written', async () => {
    const records = await atLevel('warn', () => log.info('quiet'));
    assert.deepEqual(records, []);
  });

  // An audit trail you can turn down isn't one.
  test('an audit record is written even with logging off', async () => {
    const records = await atLevel('off', () => {
      log.error('quiet');
      audit('version.build.set', 'start', { versionId: 'v1' });
    });

    assert.deepEqual(
      records.map((record) => record.event),
      ['version.build.set']
    );
    assert.equal(records[0].audit, true);
    assert.equal(records[0].phase, 'start');
  });
});
