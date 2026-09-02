/** The official API transport: JWT credentials never cross into the browser-session path. */

import { strict as assert } from 'node:assert';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  OfficialCredentials,
  officialClient,
  officialCredentials,
  officialToken,
} from '../src/official/client';
import { stubFetch, withStderr } from './helpers';

/**
 * An invented P-256 key on disk for the duration of one test.
 *
 * The `await` before `finally` is load-bearing: the client reads the key at request time,
 * so returning the promise unawaited would delete the file out from under a test still
 * using it.
 */
async function withKey<T>(
  run: (
    credentials: OfficialCredentials,
    publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']
  ) => T | Promise<T>
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'asc-official-test-'));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPath = join(directory, 'AuthKey_TEST.p8');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  try {
    return await run(
      { issuerId: 'issuer-invented', keyId: 'key-invented', privateKeyPath },
      publicKey
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
}

describe('official credentials', () => {
  test('requires every account-specific value rather than supplying defaults', () => {
    assert.throws(() => officialCredentials({}), /ASC_ISSUER_ID/);
    assert.throws(
      () => officialCredentials({ ASC_ISSUER_ID: 'issuer' }),
      /ASC_KEY_ID/
    );
    assert.throws(
      () => officialCredentials({ ASC_ISSUER_ID: 'issuer', ASC_KEY_ID: 'key' }),
      /ASC_PRIVATE_KEY_PATH/
    );
  });

  test('uses exactly the configured values', () => {
    assert.deepEqual(
      officialCredentials({
        ASC_ISSUER_ID: ' issuer ',
        ASC_KEY_ID: ' key ',
        ASC_PRIVATE_KEY_PATH: ' /keys/key.p8 ',
      }),
      { issuerId: 'issuer', keyId: 'key', privateKeyPath: '/keys/key.p8' }
    );
  });
});

describe('official JWT', () => {
  test('is ES256, fixed-width JOSE and valid for twenty minutes', async () => {
    await withKey((credentials, publicKey) => {
      const token = officialToken(credentials, new Date('2026-08-26T12:00:00Z'));
      const [headerPart, claimsPart, signaturePart] = token.split('.');
      const header = JSON.parse(Buffer.from(headerPart!, 'base64url').toString()) as Record<string, unknown>;
      const claims = JSON.parse(Buffer.from(claimsPart!, 'base64url').toString()) as Record<string, unknown>;
      const signature = Buffer.from(signaturePart!, 'base64url');

      assert.deepEqual(header, { alg: 'ES256', kid: 'key-invented', typ: 'JWT' });
      assert.equal(Number(claims.exp) - Number(claims.iat), 1200);
      assert.equal(claims.iss, 'issuer-invented');
      assert.equal(claims.aud, 'appstoreconnect-v1');
      assert.equal(signature.length, 64);
      assert.equal(
        verify(
          'sha256',
          Buffer.from(`${headerPart}.${claimsPart}`),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signature
        ),
        true
      );
    });
  });
});

describe('official GET transport', () => {
  test('sends a bearer token only to the official host', async () => {
    await withKey(async (credentials) => {
      const stub = stubFetch(() => ({ body: { data: [] } }));
      try {
        await withStderr(() =>
          officialClient(credentials).get('/v1/apps', {
            'filter[bundleId]': 'com.example.app',
            limit: 2,
          })
        );
      } finally {
        stub.restore();
      }

      assert.equal(stub.calls.length, 1);
      assert.equal(
        stub.calls[0].url,
        'https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.example.app&limit=2'
      );
      assert.equal(stub.calls[0].method, 'GET');
      assert.match(stub.calls[0].headers.authorization ?? '', /^Bearer [^.]+\.[^.]+\.[^.]+$/);
      assert.equal(stub.calls[0].headers.cookie, undefined);
    });
  });

  test('reuses one token inside its lifetime and re-mints it before expiry', async () => {
    await withKey(async (credentials) => {
      let clock = new Date('2026-08-26T12:00:00Z');
      const stub = stubFetch(() => ({ body: { data: [] } }));
      const client = officialClient(credentials, () => clock);
      const bearers: string[] = [];
      try {
        await withStderr(async () => {
          await client.get('/v1/apps');
          clock = new Date('2026-08-26T12:10:00Z');
          await client.get('/v1/apps');
          clock = new Date('2026-08-26T12:19:30Z');
          await client.get('/v1/apps');
        });
      } finally {
        stub.restore();
      }

      for (const call of stub.calls) bearers.push(call.headers.authorization ?? '');
      assert.equal(bearers.length, 3);
      assert.equal(bearers[0], bearers[1], 'a token ten minutes old is still used');
      assert.notEqual(
        bearers[1],
        bearers[2],
        'a token inside the refresh margin is replaced rather than sent'
      );
    });
  });

  test('refuses an absolute URL before any bearer token leaves', async () => {
    await withKey(async (credentials) => {
      const stub = stubFetch();
      try {
        await assert.rejects(
          () => officialClient(credentials).get('https://example.invalid/collect'),
          /outside/
        );
      } finally {
        stub.restore();
      }
      assert.deepEqual(stub.calls, []);
    });
  });
});

describe('official write transport', () => {
  const body = { data: [{ type: 'builds', id: 'build-invented' }] };

  test('sends a documented body as JSON, with the bearer, to the official host only', async () => {
    await withKey(async (credentials) => {
      const stub = stubFetch(() => ({ status: 204, text: '' }));
      let result: unknown = 'not returned';
      try {
        result = await withStderr(() =>
          officialClient(credentials).write('DELETE', '/v1/betaGroups/group-invented/relationships/builds', body)
        );
      } finally {
        stub.restore();
      }

      assert.equal(stub.calls.length, 1);
      const [call] = stub.calls;
      assert.equal(call.url, 'https://api.appstoreconnect.apple.com/v1/betaGroups/group-invented/relationships/builds');
      assert.equal(call.method, 'DELETE');
      assert.equal(call.body, JSON.stringify(body));
      assert.equal(call.headers['content-type'], 'application/json');
      assert.match(call.headers.authorization ?? '', /^Bearer /);
      assert.equal(call.headers.cookie, undefined);
      assert.equal(result, undefined, 'a 204 has no body to return');
    });
  });

  test('is audited whatever the log level, before it leaves and after it lands', async () => {
    await withKey(async (credentials) => {
      const stub = stubFetch(() => ({ status: 204, text: '' }));
      const previous = process.env.ASC_LOG;
      process.env.ASC_LOG = 'off';
      try {
        const records = await withStderr(async (captured) => {
          await officialClient(credentials).write('DELETE', '/v1/betaGroups/g/relationships/builds', body);
          return captured.records();
        });
        const writes = records.filter((record) => record.event === 'official.http.write');
        assert.deepEqual(writes.map((record) => record.phase), ['start', 'ok']);
        assert.equal(writes[0].audit, true);
        assert.equal(writes[0].method, 'DELETE');
        assert.deepEqual(writes[0].body, body);
        assert.equal(writes[1].status, 204);
        assert.equal(typeof writes[0].authorization, 'undefined', 'the token is not a field of the record');
      } finally {
        stub.restore();
        if (previous === undefined) delete process.env.ASC_LOG;
        else process.env.ASC_LOG = previous;
      }
    });
  });

  test('records a refusal as an error and throws it scrubbed', async () => {
    await withKey(async (credentials) => {
      const stub = stubFetch(() => ({ status: 409, body: { errors: [{ code: 'STATE_ERROR' }] } }));
      try {
        const records = await withStderr(async (captured) => {
          await assert.rejects(
            () => officialClient(credentials).write('DELETE', '/v1/betaGroups/g/relationships/builds', body),
            /HTTP 409/
          );
          return captured.records();
        });
        const writes = records.filter((record) => record.event === 'official.http.write');
        assert.deepEqual(writes.map((record) => record.phase), ['start', 'error']);
      } finally {
        stub.restore();
      }
    });
  });

  test('refuses an absolute URL before any request or audit record is made', async () => {
    await withKey(async (credentials) => {
      const stub = stubFetch();
      try {
        const records = await withStderr(async (captured) => {
          await assert.rejects(
            () => officialClient(credentials).write('DELETE', 'https://example.invalid/collect', body),
            /outside/
          );
          return captured.records();
        });
        assert.deepEqual(records.filter((record) => record.audit), []);
      } finally {
        stub.restore();
      }
      assert.deepEqual(stub.calls, []);
    });
  });
});

