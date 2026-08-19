/**
 * The two People-page calls, pinned to the recording they were copied from.
 *
 * An invitation grants a person access to the developer account and cannot be taken back
 * from here, so the thing worth asserting is that the request going out is the one the
 * browser was recorded sending — attribute order included — rather than something merely
 * equivalent. Nothing here reaches the network.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { inviteUser, listUserInvitations } from '../src/api';
import { SESSION, stubFetch, withStderr } from './helpers';

/** The invitation body recorded from the browser, with the personal details replaced. */
const RECORDED_BODY =
  '{"data":{"type":"userInvitations","attributes":{"email":"someone@example.com",' +
  '"firstName":"Ada","lastName":"Lovelace","roles":["CUSTOMER_SUPPORT"],' +
  '"provisioningAllowed":false,"allAppsVisible":true}}}';

const INVITE = {
  email: 'someone@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: ['CUSTOMER_SUPPORT'],
  provisioningAllowed: false,
  allAppsVisible: true,
};

async function sent(body: unknown, run: () => Promise<unknown>) {
  const stub = stubFetch(() => ({ status: 201, body }));
  try {
    await withStderr(() => run());
    return stub.calls;
  } finally {
    stub.restore();
  }
}

describe('listing invitations', () => {
  test('sends the People page query, apps identified rather than expanded', async () => {
    const calls = await sent({ data: [] }, () => listUserInvitations(SESSION));

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]!.url,
      'https://appstoreconnect.apple.com/iris/v1/userInvitations' +
        '?limit=1000&sort=lastName&include=visibleApps&limit[visibleApps]=3&fields[apps]='
    );
    assert.equal(calls[0]!.method, 'GET');
  });

  test('every part of the query is an option', async () => {
    const calls = await sent({ data: [] }, () =>
      listUserInvitations(SESSION, { limit: 10, sort: 'email', sideloads: { visibleApps: 50 } })
    );

    assert.match(calls[0]!.url, /limit=10&sort=email&/);
    assert.match(calls[0]!.url, /limit\[visibleApps\]=50/);
  });
});

describe('inviting someone', () => {
  test('sends the recorded body, byte for byte', async () => {
    const calls = await sent({ data: { type: 'userInvitations', id: 'invite-1' } }, () =>
      inviteUser(SESSION, INVITE)
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, 'https://appstoreconnect.apple.com/iris/v1/userInvitations');
    assert.equal(calls[0]!.body, RECORDED_BODY);
  });

  test('sends the vnd.api+json the recording used, not the application/json most writes send', async () => {
    const calls = await sent({ data: { type: 'userInvitations', id: 'invite-1' } }, () =>
      inviteUser(SESSION, INVITE)
    );

    assert.equal(calls[0]!.headers['content-type'], 'application/vnd.api+json');
  });

  test('is audited, because it grants account access', async () => {
    const stub = stubFetch(() => ({ status: 201, body: { data: { type: 'userInvitations', id: 'invite-1' } } }));
    try {
      const records = await withStderr(async (captured) => {
        await inviteUser(SESSION, INVITE);
        return captured.records();
      });

      const invite = records.filter((record) => record['event'] === 'user.invite');
      assert.deepEqual(
        invite.map((record) => record['phase']),
        ['start', 'ok'],
        'the grant is bracketed by its own audit record, not only the transport one'
      );
      assert.equal(invite[0]!['email'], 'someone@example.com');
    } finally {
      stub.restore();
    }
  });

  test('a role-less invitation sends nothing', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => inviteUser(SESSION, { ...INVITE, roles: [] }), /at least one role/);
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });

  test('a blank name sends nothing — the invitation would be addressed to nobody', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => inviteUser(SESSION, { ...INVITE, lastName: '  ' }), /needs lastName/);
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });
});
