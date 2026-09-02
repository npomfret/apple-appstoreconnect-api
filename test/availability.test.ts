/** Storefront availability parsing and reporting, using invented official-API fixtures. */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  availabilityReady,
  fetchAvailability,
  formatAvailability,
  territoryState,
} from '../src/official/availability';
import { OfficialClient } from '../src/official/client';
import { Query } from '../src/shared/query';

interface Call {
  path: string;
  query?: Query;
}

function territory(id: string, available: boolean, contentStatuses: string[]): object {
  return {
    type: 'territoryAvailabilities',
    id: `availability-${id}`,
    attributes: { available, contentStatuses, releaseDate: '2026-01-01' },
    relationships: { territory: { data: { type: 'territories', id } } },
  };
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
        throw new Error('availability is a read, and never writes');
      },
    },
  };
}

describe('availability report', () => {
  test('counts and groups available, blocked, pending and unselected storefronts', async () => {
    const { client, calls } = clientFor([
      {
        data: {
          type: 'appAvailabilities',
          id: 'availability-invented',
          attributes: { availableInNewTerritories: true },
        },
      },
      {
        data: [
          territory('USA', true, ['AVAILABLE']),
          territory('FRA', true, ['TRADER_STATUS_VERIFICATION_FAILED', 'CANNOT_SELL']),
          territory('CAN', true, ['PROCESSING_TO_AVAILABLE']),
          territory('DEU', true, ['PROCESSING_TO_AVAILABLE', 'CANNOT_SELL']),
          territory('GBR', false, []),
        ],
        links: { next: null },
      },
    ]);

    const report = await fetchAvailability(client, 'app-invented');
    assert.deepEqual(
      {
        total: report.total,
        selected: report.selected,
        available: report.available,
        blocked: report.blocked,
        pending: report.pending,
        unselected: report.unselected,
      },
      { total: 5, selected: 4, available: 1, blocked: 2, pending: 1, unselected: 1 }
    );
    assert.equal(report.availableInNewTerritories, true);
    assert.equal(availabilityReady(report), false);
    assert.match(formatAvailability(report), /TRADER_STATUS_VERIFICATION_FAILED, CANNOT_SELL: FRA/);
    assert.match(formatAvailability(report), /PROCESSING_TO_AVAILABLE, CANNOT_SELL: DEU/);
    assert.match(formatAvailability(report), /PROCESSING_TO_AVAILABLE: CAN/);
    assert.match(formatAvailability(report), /unselected: GBR/);

    assert.equal(calls[0].path, '/v1/apps/app-invented/appAvailabilityV2');
    assert.equal(
      calls[1].path,
      '/v2/appAvailabilities/availability-invented/territoryAvailabilities'
    );
    assert.equal(calls[1].query?.limit, 200);
    assert.equal(calls[1].query?.include, 'territory');
  });

  test('is ready when every selected territory reports available', async () => {
    const { client } = clientFor([
      {
        data: {
          id: 'availability-invented',
          attributes: { availableInNewTerritories: false },
        },
      },
      { data: [territory('USA', true, ['AVAILABLE'])], links: {} },
    ]);
    assert.equal(availabilityReady(await fetchAvailability(client, 'app-invented')), true);
  });

  test('refuses a paged response rather than reporting a clipped storefront count', async () => {
    const { client } = clientFor([
      {
        data: {
          id: 'availability-invented',
          attributes: { availableInNewTerritories: true },
        },
      },
      {
        data: [territory('USA', true, ['AVAILABLE'])],
        links: { next: 'https://api.appstoreconnect.apple.com/v2/next' },
      },
    ]);
    await assert.rejects(() => fetchAvailability(client, 'app-invented'), /under-report/);
  });
});

describe('storefront classification', () => {
  test('a storefront being withdrawn is not reported as a benign pending change', async () => {
    const { client } = clientFor([
      { data: { id: 'availability-invented', attributes: { availableInNewTerritories: false } } },
      {
        data: [
          territory('USA', true, ['AVAILABLE']),
          territory('FRA', true, ['PROCESSING_TO_NOT_AVAILABLE']),
        ],
        links: {},
      },
    ]);

    const report = await fetchAvailability(client, 'app-invented');
    assert.equal(report.leaving, 1);
    assert.equal(report.pending, 0);
    assert.equal(report.blocked, 0);
    assert.equal(availabilityReady(report), false);
    assert.match(formatAvailability(report), /being withdrawn by status:\n {2}PROCESSING_TO_NOT_AVAILABLE: FRA/);
  });

  test('both of the pre-order spellings Apple uses are pending, and neither is withdrawal', () => {
    assert.equal(territoryState(['PROCESSING_TO_PRE_ORDER']), 'pending');
    assert.equal(territoryState(['PREORDER_ON_UNRELEASED_APP']), 'pending');
    assert.equal(territoryState(['AVAILABLE_FOR_PREORDER']), 'pending');
    assert.equal(territoryState(['AVAILABLE_FOR_PREORDER_ON_DATE']), 'pending');
    assert.equal(territoryState(['PROCESSING_TO_AVAILABLE']), 'pending');
    assert.equal(territoryState(['PROCESSING_TO_NOT_AVAILABLE']), 'leaving');
  });

  test('the worst status in a row wins, so a blocker is never hidden by a change in flight', () => {
    assert.equal(territoryState(['PROCESSING_TO_AVAILABLE', 'CANNOT_SELL']), 'blocked');
    assert.equal(territoryState(['AVAILABLE', 'MISSING_RATING']), 'blocked');
    assert.equal(territoryState(['PROCESSING_TO_NOT_AVAILABLE', 'PROCESSING_TO_AVAILABLE']), 'leaving');
    assert.equal(territoryState(['AVAILABLE']), 'available');
  });

  test('a status added after 4.4.1 is unknown and verbatim, never guessed into a bucket', async () => {
    const { client } = clientFor([
      { data: { id: 'availability-invented', attributes: { availableInNewTerritories: false } } },
      {
        data: [
          territory('USA', true, ['AVAILABLE']),
          territory('FRA', true, ['CANNOT_SELL_INVENTED_FUTURE_STATUS']),
        ],
        links: {},
      },
    ]);

    const report = await fetchAvailability(client, 'app-invented');
    assert.equal(report.unknown, 1);
    assert.equal(report.blocked, 0);
    assert.equal(report.available, 1);
    assert.equal(availabilityReady(report), false);
    assert.match(formatAvailability(report), /unrecognised status[^\n]*\n {2}CANNOT_SELL_INVENTED_FUTURE_STATUS: FRA/);
  });

  test('a selected storefront with no status at all is unknown rather than silently blocked', async () => {
    const { client } = clientFor([
      { data: { id: 'availability-invented', attributes: { availableInNewTerritories: false } } },
      { data: [territory('USA', true, [])], links: {} },
    ]);

    const report = await fetchAvailability(client, 'app-invented');
    assert.equal(report.unknown, 1);
    assert.equal(report.blocked, 0);
    assert.equal(availabilityReady(report), false);
    assert.match(formatAvailability(report), /unrecognised status[^\n]*\n {2}\(no status\): USA/);
  });

  test('every selected storefront available is the only ready state', async () => {
    const { client } = clientFor([
      { data: { id: 'availability-invented', attributes: { availableInNewTerritories: false } } },
      {
        data: [territory('USA', true, ['AVAILABLE']), territory('GBR', false, [])],
        links: {},
      },
    ]);
    const report = await fetchAvailability(client, 'app-invented');
    assert.equal(availabilityReady(report), true);
    assert.equal(report.unselected, 1);
  });
});
