/**
 * The query encoder both transports share.
 *
 * It lives in `shared/` rather than in either transport because Apple speaks the same
 * dialect on both hosts, and it is tested on its own because nothing about it depends on
 * which credential the request will carry.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { buildQuery } from '../src/shared/query';

describe('query strings', () => {
  test('brackets and commas are sent as the browser sends them', () => {
    assert.equal(
      buildQuery({ 'filter[state]': ['A', 'B'], 'fields[apps]': 'name' }),
      '?filter[state]=A,B&fields[apps]=name'
    );
  });

  test('an undefined value is left out entirely', () => {
    assert.equal(buildQuery({ limit: undefined, include: 'app' }), '?include=app');
  });

  test('nothing to send is no question mark', () => {
    assert.equal(buildQuery({}), '');
  });

  test('a value that would change the url is encoded', () => {
    assert.equal(buildQuery({ 'filter[name]': 'a&b=c' }), '?filter[name]=a%26b%3Dc');
  });
});
