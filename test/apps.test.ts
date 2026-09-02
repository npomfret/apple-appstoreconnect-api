/** Resolving an app by bundle ID or by name, against invented official-API fixtures. */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { findAppId, findAppIdByName } from '../src/official/apps';
import { OfficialClient } from '../src/official/client';
import { Query } from '../src/shared/query';

interface Call {
  path: string;
  query?: Query;
}

function app(id: string, name: string, bundleId: string): object {
  return { type: 'apps', id, attributes: { name, bundleId } };
}

function clientFor(replies: unknown[]): { client: OfficialClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async get(path: string, query?: Query): Promise<unknown> {
        calls.push({ path, ...(query ? { query } : {}) });
        if (!replies.length) throw new Error(`No invented reply for ${path}`);
        return replies.shift();
      },
      async write(): Promise<unknown> {
        throw new Error('an app lookup never writes');
      },
    },
  };
}

describe('app lookup', () => {
  test('resolves a bundle ID with the documented official filter, matched exactly', async () => {
    const { client, calls } = clientFor([
      { data: [app('app-other', 'Other', 'com.example.app.extension'), app('app-invented', 'Invented', 'com.example.app')] },
    ]);
    assert.equal(await findAppId(client, 'com.example.app'), 'app-invented');
    assert.deepEqual(calls, [
      {
        path: '/v1/apps',
        query: { 'filter[bundleId]': 'com.example.app', 'fields[apps]': ['name', 'bundleId'], limit: 200 },
      },
    ]);
  });

  test('resolves a name with filter[name], matched exactly, so a prefix is not the app', async () => {
    const { client, calls } = clientFor([
      { data: [app('app-gp', 'No Spoilers - Grand Prix', 'com.example.gp'), app('app-base', 'No Spoilers', 'com.example.base')] },
    ]);
    assert.equal(await findAppIdByName(client, 'No Spoilers'), 'app-base');
    assert.equal(calls[0].query?.['filter[name]'], 'No Spoilers');
  });

  test('does not guess when no app matches, and says what Apple offered', async () => {
    const { client } = clientFor([{ data: [app('app-other', 'Other', 'com.example.other')] }]);
    await assert.rejects(
      () => findAppIdByName(client, 'Missing'),
      /No app has name "Missing"; Apple offered "Other" \(com\.example\.other\)\./
    );
    const empty = clientFor([{ data: [] }]);
    await assert.rejects(() => findAppId(empty.client, 'com.example.missing'), /No app has bundle ID/);
  });

  test('refuses to choose between two apps of one name', async () => {
    const { client } = clientFor([
      { data: [app('app-a', 'Twin', 'com.example.a'), app('app-b', 'Twin', 'com.example.b')] },
    ]);
    await assert.rejects(() => findAppIdByName(client, 'Twin'), /More than one app[^\n]*app-a[^\n]*app-b[^\n]*use its app ID/);
  });

  test('refuses an empty reference before any request', async () => {
    const { client, calls } = clientFor([]);
    await assert.rejects(() => findAppIdByName(client, ' '), /non-empty name/);
    await assert.rejects(() => findAppId(client, ''), /non-empty bundle ID/);
    assert.deepEqual(calls, []);
  });
});
