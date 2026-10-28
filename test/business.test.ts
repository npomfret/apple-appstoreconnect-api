/**
 * The Business pane: two bases, three reads, and what each refuses.
 *
 * The bases are read-only and do not read a 403 as a dead session, since no recording shows
 * how they report one. The readers refuse what they cannot read rather than defaulting it,
 * and never carry the contracting legal entity an agreement arrives with — the fixture below
 * gives it a name, an address and a phone number precisely so a test can say none of them
 * came back.
 *
 * Nothing here reaches the network, no recording is used as a fixture, and every id, name
 * and address below is invented in the shape the browser was recorded receiving.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  fetchAccountMessages,
  fetchAgreements,
  fetchComplianceRequirements,
  formatAgreements,
  formatComplianceRequirements,
} from '../src/gap/business';
import { PPM, RA, request, SessionExpiredError } from '../src/gap/http';
import { ApiError } from '../src/shared/errors';
import { SESSION, stubFetch, withStderr } from './helpers';

const ACCOUNT = 'account-0000';
const LOOKUP = { accountId: ACCOUNT, teamType: 'ITC', teamId: SESSION.teamId };

/** An agreement in the shape `ra/v1/contentProviders/{team}/agreements` returns one. */
function agreement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerType: 'PurpleSoftware',
    contractId: 'contract-paid',
    legalEntity: {
      legalEntityId: 'entity-0000',
      legalEntityName: 'Invented Person Ltd',
      address: { addressLine1: '1 Invented Street', city: 'Nowhere', phoneNumber: '+00 0000 000000' },
      ofacInfo: { status: 'CLEARED', transactionId: 'txn-0000' },
    },
    configId: 'config-1',
    configIsLatestVersion: false,
    configValidUntilDate: '2026-12-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    expirationDate: '2027-01-01T00:00:00Z',
    expireSoon: false,
    isInEffect: false,
    isFreeContract: false,
    isPreGracePeriod: true,
    isPostGracePeriod: false,
    status: 'ITC.ATB.Agmnt.Status.PendingUserInfoNewAgreementAvailable',
    applicableActions: { view: ['ITC.ATB.Agmnt.Action.view.AgreeToTerms'], edit: [], setup: [], extLink: [] },
    contractType: 'PPM.Agreements.agreement.contractConfigDisplay.PaidApplications',
    contractDisplayName: 'Paid Applications',
    ...overrides,
  };
}

function agreements(rows: unknown[], messages: unknown = []): unknown {
  return { data: { agreements: rows, messages, contactsRequired: false, hasEarningData: false }, messages: [], constraints: {} };
}

/** Runs `call` with every request answered by `reply`, and hands back the result or the error. */
async function run<T>(reply: (url: string) => unknown, call: () => Promise<T>) {
  const stub = stubFetch((made) => ({ body: reply(made.url) }));
  try {
    return { result: await withStderr(() => call().catch((error: unknown) => error)), calls: stub.calls };
  } finally {
    stub.restore();
  }
}

describe('what the Business-pane bases refuse', () => {
  /**
   * The writes recorded beside these reads are a DSA trader declaration, its validation echo
   * and a W-8BEN tax form — legal filings. The bases refuse the method rather than trusting
   * that no function here happens to use one.
   */
  for (const api of [RA, PPM]) {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      test(`a ${method} to ${api.name} is refused before a request is built`, async () => {
        const stub = stubFetch();
        try {
          await assert.rejects(() => request(SESSION, 'v1/anything', { api, method, body: {} }), /read-only/);
        } finally {
          stub.restore();
        }
        assert.deepEqual(stub.calls, []);
      });
    }
  }

  test('a path that climbs out of the ppm base never carries the session anywhere', async () => {
    const stub = stubFetch();
    try {
      await assert.rejects(() => request(SESSION, '../iris/v1/apps', { api: PPM }), /outside/);
    } finally {
      stub.restore();
    }
    assert.deepEqual(stub.calls, []);
  });

  test('a session with no team id is refused before any request', async () => {
    const { result, calls } = await run(() => LOOKUP, () => fetchAccountMessages({ ...SESSION, teamId: undefined }));
    assert.match(String(result), /no team id/);
    assert.deepEqual(calls, []);
  });

  test('an account id from the lookup that is not one path segment never becomes a path', async () => {
    const { result, calls } = await run(
      () => ({ ...LOOKUP, accountId: '../../v1/apps' }),
      () => fetchComplianceRequirements(SESSION)
    );
    assert.match(String(result), /not a payments account id/);
    assert.equal(calls.length, 1, 'only the lookup went out');
  });

  test('a lookup with no account id is refused rather than guessed from the team id', async () => {
    const { result, calls } = await run(() => ({ teamType: 'ITC' }), () => fetchAccountMessages(SESSION));
    assert.match(String(result), /accountId/);
    assert.equal(calls.length, 1);
  });
});

describe('how a Business-pane refusal is read', () => {
  test('a 403 is a refusal, not an expired session', async () => {
    const stub = stubFetch(() => ({ status: 403, text: '' }));
    try {
      const error = await withStderr(() => fetchAgreements(SESSION).catch((thrown: unknown) => thrown));
      assert.ok(error instanceof ApiError, 'a Business-pane 403 should not be a SessionExpiredError');
      assert.equal(error.status, 403);
      assert.match(error.message, /asc status/);
    } finally {
      stub.restore();
    }
  });

  test('a 401 is still an expired session', async () => {
    const stub = stubFetch(() => ({ status: 401, text: '' }));
    try {
      await assert.rejects(() => withStderr(() => fetchAgreements(SESSION)), SessionExpiredError);
    } finally {
      stub.restore();
    }
  });
});

describe('fetchAgreements', () => {
  test('carries whether each agreement is in force and what is waiting on it', async () => {
    const { result } = await run(
      () => agreements([agreement()], [{ messageKey: 'ITC.Agreements.amendable', attributeName: 'x', params: {}, type: 'warning' }]),
      () => fetchAgreements(SESSION)
    );

    assert.deepEqual(result, {
      agreements: [
        {
          contractId: 'contract-paid',
          name: 'Paid Applications',
          status: 'ITC.ATB.Agmnt.Status.PendingUserInfoNewAgreementAvailable',
          inEffect: false,
          latestVersion: false,
          currentVersionValidUntil: '2026-12-01T00:00:00Z',
          expiresSoon: false,
          preGracePeriod: true,
          postGracePeriod: false,
          effectiveDate: '2026-01-01T00:00:00Z',
          expirationDate: '2027-01-01T00:00:00Z',
          actions: ['ITC.ATB.Agmnt.Action.view.AgreeToTerms'],
        },
      ],
      notices: [{ type: 'warning', messageKey: 'ITC.Agreements.amendable' }],
    });
  });

  test('never carries the contracting legal entity, in the result or the digest', async () => {
    const { result } = await run(() => agreements([agreement()]), () => fetchAgreements(SESSION));
    assert.ok(!(result instanceof Error));

    const json = JSON.stringify(result);
    const digest = formatAgreements(result as Parameters<typeof formatAgreements>[0]);
    for (const personal of ['Invented Person Ltd', '1 Invented Street', 'Nowhere', '+00 0000 000000', 'txn-0000', 'entity-0000']) {
      assert.ok(!json.includes(personal), `${personal} reached the result`);
      assert.ok(!digest.includes(personal), `${personal} reached the digest`);
    }
  });

  test('the digest says a newer version is waiting, and until when the current one holds', async () => {
    const { result } = await run(() => agreements([agreement()]), () => fetchAgreements(SESSION));
    const digest = formatAgreements(result as Parameters<typeof formatAgreements>[0]);

    assert.match(digest, /a newer version is waiting to be accepted; this one is valid until 2026-12-01T00:00:00Z/);
    assert.match(digest, /pre-grace period/);
    assert.match(digest, /action {5}ITC\.ATB\.Agmnt\.Action\.view\.AgreeToTerms/);
  });

  /** Each of these, defaulted, would read back as an answer Apple did not give. */
  for (const [key, why] of [
    ['isInEffect', 'in effect'],
    ['configIsLatestVersion', 'latest version'],
    ['isPreGracePeriod', 'pre-grace'],
    ['status', 'status'],
    ['applicableActions', 'applicable actions'],
    ['contractId', 'contractId'],
  ] as const) {
    test(`an agreement without ${key} is refused, not defaulted`, async () => {
      const { result } = await run(() => agreements([agreement({ [key]: undefined })]), () => fetchAgreements(SESSION));
      assert.ok(result instanceof Error);
      assert.match(result.message, new RegExp(why));
    });
  }

  test('an action list Apple reshaped is refused rather than read as nothing to do', async () => {
    const { result } = await run(
      () => agreements([agreement({ applicableActions: { view: { key: 'ITC.ATB.Agmnt.Action.view.AgreeToTerms' } } })]),
      () => fetchAgreements(SESSION)
    );
    assert.ok(result instanceof Error);
    assert.match(result.message, /"view" actions/);
    assert.match(result.message, /asc status/);
  });

  test('a response with no notices list is refused rather than read as none', async () => {
    const { result } = await run(() => ({ data: { agreements: [] } }), () => fetchAgreements(SESSION));
    assert.ok(result instanceof Error);
    assert.match(result.message, /notices/);
  });
});

describe('fetchAccountMessages', () => {
  test('carries each warning as Apple\'s severity and message key, and nothing from its params', async () => {
    const { result } = await run(
      (url) =>
        url.includes('/accountLookup/')
          ? LOOKUP
          : {
              accountId: ACCOUNT,
              message: [
                { type: 'info', messageKey: 'PPM.banking.bankingAccount.setup.message', params: { legalEntityId: 'entity-0000', showOnBusinessPage: 'false' } },
              ],
            },
      () => fetchAccountMessages(SESSION)
    );

    assert.deepEqual(result, [{ type: 'info', messageKey: 'PPM.banking.bankingAccount.setup.message' }]);
  });

  test('a response with no message list is refused rather than read as a clean account', async () => {
    const { result } = await run(
      (url) => (url.includes('/accountLookup/') ? LOOKUP : { accountId: ACCOUNT }),
      () => fetchAccountMessages(SESSION)
    );
    assert.ok(result instanceof Error);
    assert.match(result.message, /account messages/);
  });
});

describe('fetchComplianceRequirements', () => {
  function requirements(requirementData: unknown) {
    return (url: string) => (url.includes('/accountLookup/') ? LOOKUP : { accountId: ACCOUNT, requirementData });
  }

  test('flattens the per-app and legal-entity groups, keeping which is which', async () => {
    const { result } = await run(
      requirements([
        { contentId: '1000000001', requirements: [{ name: 'MEDICAL_DEVICE', id: 'r', ref: 'u', status: 'PENDING_COLLECTION' }] },
        {
          legalEntityId: 'entity-0000',
          requirements: [{ name: 'MEDICAL_DEVICE', id: 'r', ref: 'u', status: 'PENDING_COLLECTION', countries: ['AT', 'BE'] }],
        },
      ]),
      () => fetchComplianceRequirements(SESSION)
    );

    assert.deepEqual(result, [
      { scope: 'app', scopeId: '1000000001', name: 'MEDICAL_DEVICE', status: 'PENDING_COLLECTION', countries: [] },
      { scope: 'legalEntity', scopeId: 'entity-0000', name: 'MEDICAL_DEVICE', status: 'PENDING_COLLECTION', countries: ['AT', 'BE'] },
    ]);
    assert.equal(
      formatComplianceRequirements(result as Parameters<typeof formatComplianceRequirements>[0]),
      'app 1000000001     MEDICAL_DEVICE  PENDING_COLLECTION\n' +
        'legal entity       MEDICAL_DEVICE  PENDING_COLLECTION  in 2 countries'
    );
  });

  test('a group naming neither an app nor the legal entity is refused', async () => {
    const { result } = await run(
      requirements([{ requirements: [{ name: 'MEDICAL_DEVICE', status: 'PENDING_COLLECTION' }] }]),
      () => fetchComplianceRequirements(SESSION)
    );
    assert.ok(result instanceof Error);
    assert.match(result.message, /exactly one of an app id or a legal entity id/);
  });

  test('a requirement without a status is refused rather than read as met', async () => {
    const { result } = await run(
      requirements([{ contentId: '1000000001', requirements: [{ name: 'MEDICAL_DEVICE' }] }]),
      () => fetchComplianceRequirements(SESSION)
    );
    assert.ok(result instanceof Error);
    assert.match(result.message, /status/);
  });
});
