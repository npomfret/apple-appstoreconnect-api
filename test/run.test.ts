/**
 * The build digest, and the one thing it exists to prevent: reading a green run as proof
 * that the workflow as it stands today works.
 *
 * Every fixture is invented, in the shape the browser was recorded receiving.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { fetchRun, formatRun, RunReport } from '../src/report';
import { SESSION, stubFetch } from './helpers';

const PRODUCT = 'product-uuid';
const BUILD = 'build-uuid';
const TEST_STAGE = 'stage-test';

function deviceRun(device: string, status: string, message = '') {
  return { device_name: device, os_version: '26.5', status, duration: 1, message, uuid: `${device}-${status}` };
}

const ARCHIVE_STAGE = {
  id: 'stage-archive',
  name: 'Archive - iOS',
  kind: 'action',
  stage_type: 'archive',
  state: 'succeeded',
  is_required: true,
  scheme: 'Thing',
  platform: { name: 'iOS' },
  testplan_name: '',
  usage_time: 152,
  metadata_summary: { warnings: 8, errors: 0, test_failures: 0, analyzer_warnings: 0 },
  stage_sections: { sections: ['artifacts', 'logs'], available_code_coverage_types: [] },
};

const UNIT_STAGE = {
  ...ARCHIVE_STAGE,
  id: TEST_STAGE,
  name: 'UnitTests - iOS',
  stage_type: 'test',
  state: 'failed',
  testplan_name: 'UnitTests',
  usage_time: 1172,
  metadata_summary: { warnings: 14, errors: 0, test_failures: 1, analyzer_warnings: 0 },
  stage_sections: { sections: ['artifacts', 'logs', 'tests'], available_code_coverage_types: [] },
};

interface Fixture {
  results?: unknown[];
  issues?: unknown[];
  stages?: unknown[];
  savedDestinations?: { name: string; device_type: string; kind: string; runtime: { name: string; identifier: string } }[];
  workflowSavedAt?: string;
  startedAt?: string;
}

async function run(fixture: Fixture): Promise<RunReport> {
  const stub = stubFetch((call) => {
    if (call.url.includes('test-results-v4')) return { body: { items: fixture.results ?? [] } };
    if (call.url.includes('/issues')) return { body: { items: fixture.issues ?? [] } };
    if (call.url.includes('workflows-v15')) {
      return {
        body: {
          id: 'workflow-uuid',
          content: {
            name: 'Thing iOS',
            actions: [
              {
                id: 'a',
                action_type: 'test',
                test_config: {
                  kind: 'specific_test_plans',
                  test_plan_name: 'UnitTests',
                  test_destinations: fixture.savedDestinations ?? [
                    { name: 'iPhone 16', device_type: 'sim.iPhone-16', kind: 'simulator', runtime: { name: 'iOS 26.5', identifier: 'default' } },
                  ],
                },
              },
            ],
          },
          metadata: {
            is_deleted: false,
            last_modified_by: 'Nick Pomfret',
            last_modified_at: fixture.workflowSavedAt ?? '2026-08-20T08:00:00.000Z',
          },
        },
      };
    }
    return {
      body: {
        build: {
          id: BUILD,
          number: 48,
          state: 'failed',
          workflow_id: 'workflow-uuid',
          created_at: '2026-08-20T08:06:31.657Z',
          started_at: fixture.startedAt ?? '2026-08-20T08:06:40.764Z',
          finished_at: '2026-08-20T08:13:39.725Z',
          git_ref: { display_name: 'main', id: 'r', kind: 'branch', repo_id: 'repo', is_deleted: false },
          commit: { commit_sha: 'abcdef0123456789', message: 'Make the meter feel alive', author: { display_name: 'npomfret' } },
          metadata_summary: { warnings: 14, errors: 0, test_failures: 1, analyzer_warnings: 0 },
        },
        build_stages: fixture.stages ?? [ARCHIVE_STAGE, UNIT_STAGE],
        triggered_from: 'push',
        triggered_by_user: 'Nick Pomfret',
        container_file_path: 'apple/Thing/Thing.xcodeproj',
        builder_name: 'Xcode 26.6 (17F113)',
        os_name: 'macOS Tahoe 26.6.2',
        total_usage_time: 1324,
      },
    };
  });

  try {
    return await fetchRun(SESSION, PRODUCT, BUILD);
  } finally {
    stub.restore();
  }
}

describe('counting what actually executed', () => {
  test('a destination is counted from the device runs, not from the workflow', async () => {
    const report = await run({
      results: [
        { name: 'a()', class_name: 'T', target: '', status: 'success', device_runs: [deviceRun('iPhone 16', 'success'), deviceRun('iPhone SE (3rd generation)', 'success')] },
        { name: 'b()', class_name: 'T', target: '', status: 'success', device_runs: [deviceRun('iPhone 16', 'success'), deviceRun('iPhone SE (3rd generation)', 'success')] },
      ],
    });

    const [stage] = report.tests;
    assert.equal(stage!.cases, 2);
    assert.deepEqual(
      stage!.destinations.map((d) => [d.device, d.executed, d.passed, d.failed]),
      [
        ['iPhone 16', 2, 2, 0],
        ['iPhone SE (3rd generation)', 2, 2, 0],
      ]
    );
  });

  test('the same failure on several devices is one failure, listing them', async () => {
    const report = await run({
      results: [
        {
          name: 'theTick()',
          class_name: 'ClockTests',
          target: '',
          status: 'mixed',
          location: { file_path: '/w/ClockTests.swift', line_number: 34 },
          message: 'Expectation failed',
          device_runs: [
            deviceRun('iPhone 16 Pro Max', 'failure', 'Expectation failed'),
            deviceRun('iPhone SE (3rd generation)', 'success'),
            deviceRun('iPhone 16', 'success'),
            deviceRun('iPhone 16 Pro', 'failure', 'Expectation failed'),
          ],
        },
      ],
    });

    const failures = report.tests[0]!.failures;
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.test, 'ClockTests.theTick()');
    assert.deepEqual(failures[0]!.devices.sort(), ['iPhone 16 Pro', 'iPhone 16 Pro Max']);
    assert.equal(failures[0]!.line, 34);

    // A "mixed" case still counts as executed everywhere, and passed on the two that passed.
    const byDevice = Object.fromEntries(report.tests[0]!.destinations.map((d) => [d.device, d.failed]));
    assert.deepEqual(byDevice, {
      'iPhone 16': 0,
      'iPhone 16 Pro': 1,
      'iPhone 16 Pro Max': 1,
      'iPhone SE (3rd generation)': 0,
    });
  });

  test('an archive stage is reported but never asked for test results', async () => {
    const stub = stubFetch((call) => {
      if (call.url.includes('workflows-v15')) {
        return { body: { id: 'w', content: { name: 'n', actions: [] }, metadata: { is_deleted: false, last_modified_by: 'x', last_modified_at: '2026-01-01T00:00:00.000Z' } } };
      }
      return {
        body: {
          build: { id: BUILD, number: 1, state: 'succeeded', workflow_id: 'w', created_at: '2026-08-20T08:00:00.000Z', git_ref: { display_name: 'main', id: 'r', kind: 'branch', repo_id: 'r', is_deleted: false }, commit: { commit_sha: 'a', message: 'm', author: { display_name: 'n' } }, metadata_summary: { warnings: 0, errors: 0, test_failures: 0, analyzer_warnings: 0 } },
          build_stages: [ARCHIVE_STAGE],
          triggered_from: 'push', triggered_by_user: 'n', container_file_path: '', builder_name: 'x', os_name: 'y', total_usage_time: 1,
        },
      };
    });

    try {
      const report = await fetchRun(SESSION, PRODUCT, BUILD);
      assert.equal(report.stages.length, 1);
      assert.equal(report.tests.length, 0);
      assert.equal(stub.calls.some((call) => call.url.includes('test-results-v4')), false);
    } finally {
      stub.restore();
    }
  });
});

describe('what the digest refuses to let you believe', () => {
  test('a stage that reported no tests is called out, not rendered as a pass', async () => {
    const text = formatRun(await run({ results: [] }));

    assert.match(text, /NO TESTS REPORTED/);
    assert.match(text, /is not a passing stage/);
  });

  test('a run that predates the current workflow says so, with both timestamps', async () => {
    const report = await run({
      startedAt: '2026-08-20T08:06:40.764Z',
      workflowSavedAt: '2026-08-20T08:09:34.186Z',
      results: [{ name: 'a()', class_name: 'T', target: '', status: 'success', device_runs: [deviceRun('iPhone 16', 'success')] }],
    });

    assert.equal(report.savedAfterRun, true);
    const text = formatRun(report);
    assert.match(text, /NOT EVIDENCE FOR THE WORKFLOW AS IT STANDS/);
    assert.match(text, /2026-08-20T08:09:34\.186Z, after this build started/);
  });

  test('executed destinations that differ from the saved ones are spelled out', async () => {
    const text = formatRun(
      await run({
        results: [
          {
            name: 'a()', class_name: 'T', target: '', status: 'success',
            device_runs: [deviceRun('iPhone 16', 'success'), deviceRun('iPhone 16 Pro', 'success')],
          },
        ],
        savedDestinations: [
          { name: 'iPhone 16', device_type: 'sim.iPhone-16', kind: 'simulator', runtime: { name: 'iOS 26.5', identifier: 'default' } },
        ],
      })
    );

    assert.match(text, /It executed on:  iPhone 16, iPhone 16 Pro/);
    assert.match(text, /It now names:    iPhone 16/);
  });

  test('a run that matches the workflow it belongs to says nothing alarming', async () => {
    const text = formatRun(
      await run({
        workflowSavedAt: '2026-08-20T08:00:00.000Z',
        results: [{ name: 'a()', class_name: 'T', target: '', status: 'success', device_runs: [deviceRun('iPhone 16', 'success')] }],
      })
    );

    assert.equal(/NOT EVIDENCE/.test(text), false);
    assert.match(text, /1 test case, executed on 1 destination/);
  });
});
