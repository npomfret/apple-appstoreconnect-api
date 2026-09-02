/** A TestFlight group's builds, against invented official-API fixtures and a stubbed client. */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { OfficialClient, WriteMethod } from '../src/official/client';
import {
  addBuilds,
  addReady,
  fetchAddPlan,
  fetchPrunePlan,
  findBetaGroup,
  findBuilds,
  formatAddPlan,
  formatAddResult,
  formatPrunePlan,
  formatPruneResult,
  pruneBuilds,
  pruneReady,
} from '../src/official/testflight';
import { Query } from '../src/shared/query';
import { withStderr } from './helpers';

interface Call {
  method: 'GET' | WriteMethod;
  path: string;
  query?: Query;
  body?: unknown;
}

function group(id: string, name: string, hasAccessToAllBuilds = false): object {
  return {
    type: 'betaGroups',
    id,
    attributes: { name, isInternalGroup: true, hasAccessToAllBuilds },
  };
}

function build(id: string, buildNumber: string, uploadedDate: string, extra: object = {}): object {
  return {
    type: 'builds',
    id,
    attributes: { version: buildNumber, uploadedDate, expired: false, processingState: 'VALID', ...extra },
    relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'prv-invented' } } },
  };
}

const PRE_RELEASE = {
  type: 'preReleaseVersions',
  id: 'prv-invented',
  attributes: { version: '1.2.3', platform: 'IOS' },
};

function groupsReply(...groups: object[]): object {
  return { data: groups };
}

function buildsReply(builds: object[], next: string | null = null): object {
  return { data: builds, included: [PRE_RELEASE], links: { next } };
}

/** Three builds, deliberately out of order and stamped with different offsets. */
const THREE = [
  build('build-old', '43', '2026-08-01T10:00:00-07:00'),
  build('build-new', '45', '2026-08-03T09:00:00+01:00'),
  build('build-mid', '44', '2026-08-02T10:00:00Z', { expired: true }),
];

function clientFor(replies: unknown[]): { client: OfficialClient; calls: Call[] } {
  const calls: Call[] = [];
  const next = (path: string): unknown => {
    if (!replies.length) throw new Error(`No invented reply for ${path}`);
    return replies.shift();
  };
  return {
    calls,
    client: {
      async get(path: string, query?: Query): Promise<unknown> {
        calls.push({ method: 'GET', path, ...(query ? { query } : {}) });
        return next(path);
      },
      async write(method: WriteMethod, path: string, body: unknown): Promise<unknown> {
        calls.push({ method, path, body });
        return next(path);
      },
    },
  };
}

describe('group lookup', () => {
  test('filters by app and name, and matches the name exactly', async () => {
    const { client, calls } = clientFor([
      groupsReply(group('group-other', 'Internal (old)'), group('group-invented', 'Internal')),
    ]);
    const found = await findBetaGroup(client, 'app-invented', 'Internal');
    assert.equal(found.id, 'group-invented');
    assert.equal(calls[0].path, '/v1/betaGroups');
    assert.equal(calls[0].query?.['filter[app]'], 'app-invented');
    assert.equal(calls[0].query?.['filter[name]'], 'Internal');
  });

  test('does not guess when no group matches, and says what Apple offered', async () => {
    const { client } = clientFor([groupsReply(group('group-other', 'External'))]);
    await assert.rejects(
      () => findBetaGroup(client, 'app-invented', 'Internal'),
      /No TestFlight group[^\n]*"Internal"[^\n]*"External"/
    );
  });

  test('a uuid is looked up as an id, still within the app', async () => {
    const id = 'e4840ac3-284b-4b6c-a41f-b400d6d0fac1';
    const { client, calls } = clientFor([groupsReply(group(id, 'Internal'))]);
    const found = await findBetaGroup(client, 'app-invented', id.toUpperCase());
    assert.equal(found.name, 'Internal');
    assert.equal(calls[0].query?.['filter[app]'], 'app-invented');
    assert.equal(calls[0].query?.['filter[id]'], id.toUpperCase());
    assert.equal(calls[0].query?.['filter[name]'], undefined);
  });

  test('an id Apple did not return for this app is no group, not another app\'s', async () => {
    const { client } = clientFor([groupsReply()]);
    await assert.rejects(
      () => findBetaGroup(client, 'app-invented', 'e4840ac3-284b-4b6c-a41f-b400d6d0fac1'),
      /No TestFlight group on app app-invented has id e4840ac3/
    );
  });

  test('refuses to choose between two groups of one name', async () => {
    const { client } = clientFor([groupsReply(group('group-a', 'Internal'), group('group-b', 'Internal'))]);
    await assert.rejects(() => findBetaGroup(client, 'app-invented', 'Internal'), /More than one/);
  });
});

describe('prune plan', () => {
  test('keeps the newest builds by instant, not by text, and removes the rest', async () => {
    const { client, calls } = clientFor([groupsReply(group('group-invented', 'Internal')), buildsReply(THREE)]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1 });

    assert.deepEqual(plan.kept.map((row) => row.id), ['build-new']);
    assert.deepEqual(plan.remove.map((row) => row.id), ['build-mid', 'build-old']);
    assert.equal(plan.more, false);
    assert.equal(pruneReady(plan), false);

    const builds = calls[1];
    assert.equal(builds.path, '/v1/builds');
    assert.equal(builds.query?.['filter[betaGroups]'], 'group-invented');
    assert.equal(builds.query?.sort, '-uploadedDate');
    assert.equal(builds.query?.limit, 200);
    assert.equal(builds.query?.include, 'preReleaseVersion');
  });

  test('keep counts per platform, so the newest Mac build survives beside a newer iOS one', async () => {
    const mac = {
      type: 'preReleaseVersions',
      id: 'prv-mac',
      attributes: { version: '1.2.3', platform: 'MAC_OS' },
    };
    const macBuild = (id: string, buildNumber: string, uploadedDate: string): object => ({
      ...build(id, buildNumber, uploadedDate),
      relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'prv-mac' } } },
    });
    const { client } = clientFor([
      groupsReply(group('group-invented', 'Internal')),
      {
        data: [
          ...THREE,
          macBuild('mac-old', '40', '2026-07-30T00:00:00Z'),
          macBuild('mac-new', '42', '2026-08-02T00:00:00Z'),
        ],
        included: [PRE_RELEASE, mac],
        links: {},
      },
    ]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1 });
    assert.deepEqual(plan.kept.map((row) => row.id), ['build-new', 'mac-new']);
    assert.deepEqual(plan.remove.map((row) => row.id), ['build-mid', 'build-old', 'mac-old']);
    assert.match(formatPrunePlan(plan), /keep {7}1 newest per platform/);
  });

  test('joins the marketing version off the sideload and keeps Apple\'s flags', async () => {
    const { client } = clientFor([groupsReply(group('group-invented', 'Internal')), buildsReply(THREE)]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1 });
    const mid = plan.remove.find((row) => row.id === 'build-mid');
    assert.deepEqual(mid, {
      id: 'build-mid',
      buildNumber: '44',
      version: '1.2.3',
      platform: 'IOS',
      uploadedDate: '2026-08-02T10:00:00Z',
      expired: true,
      processingState: 'VALID',
    });
  });

  test('a build whose pre-release version was not sideloaded is still a build', async () => {
    const orphan = { ...build('build-lone', '46', '2026-08-04T00:00:00Z'), relationships: {} };
    const { client } = clientFor([
      groupsReply(group('group-invented', 'Internal')),
      { data: [orphan], links: {} },
    ]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 0 });
    assert.equal(plan.remove[0].version, undefined);
    assert.equal(plan.remove[0].buildNumber, '46');
  });

  test('a group already at size has nothing to remove and is ready', async () => {
    const { client } = clientFor([groupsReply(group('group-invented', 'Internal')), buildsReply(THREE)]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 5 });
    assert.equal(plan.kept.length, 3);
    assert.equal(plan.remove.length, 0);
    assert.equal(pruneReady(plan), true);
  });

  test('a further page is reported, and is not ready', async () => {
    const { client } = clientFor([
      groupsReply(group('group-invented', 'Internal')),
      buildsReply(THREE, 'https://api.appstoreconnect.apple.com/v1/builds?cursor=invented'),
    ]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 5 });
    assert.equal(plan.more, true);
    assert.equal(plan.remove.length, 0);
    assert.equal(pruneReady(plan), false);
    assert.match(formatPrunePlan(plan), /paged the list at 200/);
  });

  test('a group that receives every build automatically is pruned like any other, and says so', async () => {
    const { client } = clientFor([groupsReply(group('group-invented', 'Internal', true)), buildsReply(THREE)]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1 });
    assert.equal(plan.remove.length, 2);
    assert.match(formatPrunePlan(plan), /group {6}Internal {2}\(internal, receives every new build automatically, group-invented\)/);
  });

  test('refuses a keep count that is not a whole number', async () => {
    const { client, calls } = clientFor([]);
    await assert.rejects(
      () => fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1.5 }),
      /whole number/
    );
    await assert.rejects(
      () => fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: -1 }),
      /whole number/
    );
    assert.deepEqual(calls, []);
  });

  test('refuses a build Apple sent without the fields the plan is built on', async () => {
    const bare = { type: 'builds', id: 'build-bare', attributes: { version: '47' } };
    const { client } = clientFor([groupsReply(group('group-invented', 'Internal')), { data: [bare] }]);
    await assert.rejects(
      () => fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1 }),
      /uploadedDate/
    );
  });

  test('prints every build on both sides with its id', async () => {
    const { client } = clientFor([groupsReply(group('group-invented', 'Internal')), buildsReply(THREE)]);
    const plan = await fetchPrunePlan(client, { appId: 'app-invented', group: 'Internal', keep: 1 });
    const text = formatPrunePlan(plan);
    assert.match(text, /group {6}Internal {2}\(internal, group-invented\)/);
    assert.match(text, /keep \(1\):\n {2}2026-08-03T09:00:00\+01:00 {2}1\.2\.3 \(45\) {2}IOS, valid {2}build-new/);
    assert.match(text, /remove from group \(2\):\n[^\n]*build-mid\n[^\n]*build-old/);
    assert.match(text, /1\.2\.3 \(44\) {2}IOS, valid, expired {2}build-mid/);
  });
});

describe('prune write', () => {
  async function planFor(keep: number, ...afterPlan: unknown[]) {
    const stub = clientFor([groupsReply(group('group-invented', 'Internal')), buildsReply(THREE), ...afterPlan]);
    const plan = await fetchPrunePlan(stub.client, { appId: 'app-invented', group: 'Internal', keep });
    return { ...stub, plan };
  }

  test('sends one documented DELETE naming exactly the builds the plan showed, then reads back', async () => {
    const { client, calls, plan } = await planFor(1, undefined, buildsReply([THREE[1]]));
    const result = await withStderr(() => pruneBuilds(client, plan));

    const write = calls[2];
    assert.equal(write.method, 'DELETE');
    assert.equal(write.path, '/v1/betaGroups/group-invented/relationships/builds');
    assert.deepEqual(write.body, {
      data: [
        { type: 'builds', id: 'build-mid' },
        { type: 'builds', id: 'build-old' },
      ],
    });

    assert.equal(calls[3].method, 'GET');
    assert.equal(calls[3].path, '/v1/builds');
    assert.deepEqual(result.removed, ['build-mid', 'build-old']);
    assert.deepEqual(result.remaining.map((row) => row.id), ['build-new']);
    assert.deepEqual(result.stillInGroup, []);
    assert.match(formatPruneResult(result), /Removed 2 of 3 builds from group "Internal"; 1 remain\./);
  });

  test('brackets the write with a semantic audit record that names the group and the builds', async () => {
    const { client, plan } = await planFor(1, undefined, buildsReply([THREE[1]]));
    const records = await withStderr(async (captured) => {
      await pruneBuilds(client, plan);
      return captured.records();
    });
    const prune = records.filter((record) => record.event === 'testflight.prune');
    assert.deepEqual(prune.map((record) => record.phase), ['start', 'ok']);
    assert.equal(prune[0].audit, true);
    assert.equal(prune[0].groupId, 'group-invented');
    assert.deepEqual(prune[0].builds, ['build-mid', 'build-old']);
  });

  test('reports a build Apple still lists after accepting its removal', async () => {
    const { client, plan } = await planFor(1, undefined, buildsReply([THREE[1], THREE[0]]));
    const result = await withStderr(() => pruneBuilds(client, plan));
    assert.deepEqual(result.stillInGroup, ['build-old']);
    assert.match(formatPruneResult(result), /still lists 1 of them[^\n]*\n {2}build-old/);
  });

  test('sends nothing for a plan with nothing to remove', async () => {
    const { client, calls, plan } = await planFor(5);
    const result = await pruneBuilds(client, plan);
    assert.equal(calls.length, 2, 'the two reads that built the plan, and no write');
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.remaining.map((row) => row.id), ['build-new', 'build-mid', 'build-old']);
  });
});

describe('build lookup', () => {
  const ID = '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d';

  test('a build number is looked up with filter[version] and an id with filter[id], within the app', async () => {
    const byId = { ...build(ID, '99', '2026-08-05T00:00:00Z') };
    const { client, calls } = clientFor([buildsReply([byId]), buildsReply([THREE[1]])]);
    const found = await findBuilds(client, 'app-invented', [ID, '45']);

    assert.deepEqual(found.map((row) => row.id), [ID, 'build-new']);
    assert.equal(calls[0].query?.['filter[app]'], 'app-invented');
    assert.deepEqual(calls[0].query?.['filter[id]'], [ID]);
    assert.equal(calls[1].query?.['filter[app]'], 'app-invented');
    assert.deepEqual(calls[1].query?.['filter[version]'], ['45']);
  });

  test('a build number is matched exactly, and one Apple did not return is an error', async () => {
    const { client } = clientFor([buildsReply([THREE[1]])]);
    await assert.rejects(() => findBuilds(client, 'app-invented', ['4']), /No build on app app-invented is build number 4\./);
  });

  test('a build number reused across two builds is refused with both ids', async () => {
    const twin = build('build-twin', '45', '2026-07-01T00:00:00Z');
    const { client } = clientFor([buildsReply([THREE[1], twin])]);
    await assert.rejects(
      () => findBuilds(client, 'app-invented', ['45']),
      /More than one build[^\n]*build-new[^\n]*build-twin[^\n]*Name it by id/
    );
  });

  test('refuses an empty reference before any request', async () => {
    const { client, calls } = clientFor([]);
    await assert.rejects(() => findBuilds(client, 'app-invented', ['45', ' ']), /non-empty/);
    await assert.rejects(() => findBuilds(client, 'app-invented', []), /At least one/);
    assert.deepEqual(calls, []);
  });
});

describe('add plan', () => {
  test('separates the builds the group lacks from the ones already in it, in the order named', async () => {
    const { client, calls } = clientFor([
      groupsReply(group('group-invented', 'Beta')),
      buildsReply([THREE[0], THREE[1]]),
      buildsReply([THREE[1]]),
    ]);
    const plan = await fetchAddPlan(client, { appId: 'app-invented', group: 'Beta', builds: ['43', '45'] });

    assert.deepEqual(plan.add.map((row) => row.id), ['build-old']);
    assert.deepEqual(plan.alreadyInGroup.map((row) => row.id), ['build-new']);
    assert.equal(addReady(plan), false);
    assert.equal(calls[2].query?.['filter[betaGroups]'], 'group-invented');
    assert.match(formatAddPlan(plan), /add to group \(1\):\n[^\n]*build-old\n\nalready in group \(1\):\n[^\n]*build-new/);
  });

  test('a build named twice is one linkage', async () => {
    const { client } = clientFor([
      groupsReply(group('group-invented', 'Beta')),
      buildsReply([THREE[0]]),
      buildsReply([]),
    ]);
    const plan = await fetchAddPlan(client, { appId: 'app-invented', group: 'Beta', builds: ['43', '43'] });
    assert.deepEqual(plan.add.map((row) => row.id), ['build-old']);
  });

  test('a group that receives every build automatically still takes a named build', async () => {
    const { client } = clientFor([
      groupsReply(group('group-invented', 'Beta', true)),
      buildsReply([THREE[0]]),
      buildsReply([]),
    ]);
    const plan = await fetchAddPlan(client, { appId: 'app-invented', group: 'Beta', builds: ['43'] });
    assert.deepEqual(plan.add.map((row) => row.id), ['build-old']);
    assert.match(formatAddPlan(plan), /receives every new build automatically/);
  });
});

describe('add write', () => {
  async function planFor(...afterPlan: unknown[]) {
    const stub = clientFor([
      groupsReply(group('group-invented', 'Beta')),
      buildsReply([THREE[0], THREE[2]]),
      buildsReply([THREE[1]]),
      ...afterPlan,
    ]);
    const plan = await fetchAddPlan(stub.client, { appId: 'app-invented', group: 'Beta', builds: ['43', '44'] });
    return { ...stub, plan };
  }

  test('sends one documented POST naming exactly the builds the plan showed, then reads back', async () => {
    const { client, calls, plan } = await planFor(undefined, buildsReply(THREE));
    const result = await withStderr(() => addBuilds(client, plan));

    const write = calls[3];
    assert.equal(write.method, 'POST');
    assert.equal(write.path, '/v1/betaGroups/group-invented/relationships/builds');
    assert.deepEqual(write.body, {
      data: [
        { type: 'builds', id: 'build-old' },
        { type: 'builds', id: 'build-mid' },
      ],
    });
    assert.equal(calls[4].method, 'GET');
    assert.deepEqual(result.added, ['build-old', 'build-mid']);
    assert.equal(result.remaining.length, 3);
    assert.deepEqual(result.notInGroup, []);
    assert.match(formatAddResult(result), /Added 2 builds to group "Beta"; it now holds 3\./);
  });

  test('brackets the write with an audit record, and reports a build Apple did not list afterwards', async () => {
    const { client, plan } = await planFor(undefined, buildsReply([THREE[1], THREE[0]]));
    const { result, records } = await withStderr(async (captured) => ({
      result: await addBuilds(client, plan),
      records: captured.records(),
    }));
    const add = records.filter((record) => record.event === 'testflight.add');
    assert.deepEqual(add.map((record) => record.phase), ['start', 'ok']);
    assert.equal(add[0].audit, true);
    assert.deepEqual(add[0].builds, ['build-old', 'build-mid']);
    assert.deepEqual(result.notInGroup, ['build-mid']);
    assert.match(formatAddResult(result), /does not list 1 of them[^\n]*\n {2}build-mid/);
  });

  test('sends nothing when every build named is already in the group', async () => {
    const stub = clientFor([
      groupsReply(group('group-invented', 'Beta')),
      buildsReply([THREE[1]]),
      buildsReply([THREE[1]]),
    ]);
    const plan = await fetchAddPlan(stub.client, { appId: 'app-invented', group: 'Beta', builds: ['45'] });
    assert.equal(addReady(plan), true);
    const result = await addBuilds(stub.client, plan);
    assert.equal(stub.calls.length, 3);
    assert.deepEqual(result.added, []);
  });
});
