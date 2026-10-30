import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { loadTypescript } from './load-typescript.mjs';

function client(statuses, onRequest = () => {}) {
  const calls = [], tokens = [];
  const auth = { currentUser: { uid: 'employee', getIdToken: async force => {
    tokens.push(force === true);
    return force ? 'renewed' : 'cached';
  } } };
  const workday = { userId: 'employee', companyId: 'company', date: '2026-10-30' };
  const api = loadTypescript('src/lib/workday.ts', {
    './firebase': { auth, db: {} },
    './utils': { randomToken: () => 'stable-request-id' },
    'firebase/firestore': {
      Timestamp, doc: () => ({}),
      getDocFromServer: async () => ({ exists: () => true, id: 'overnight', data: () => workday }),
    },
  }, {
    navigator: { userAgent: 'test' },
    fetch: async (path, init) => {
      calls.push({ path, ...init });
      onRequest(auth);
      const status = statuses.shift();
      assert.ok(status, 'Unexpected extra request');
      return { status, ok: status === 200, json: async () => status === 200
        ? { workdayId: 'overnight', officialTimestampMillis: Date.parse('2026-10-31T00:01:00-03:00') }
        : { error: `HTTP ${status}` } };
    },
  });
  return { calls, tokens, punch: () => api.registerPunch('employee', 'company', 'clock_out', {
    company: { id: 'company' }, validatedAt: Date.now(), qrCodeId: 'qr',
    latitude: -23.5, longitude: -46.6, accuracy: 5,
  }, 'overnight') };
}

test('an expired session retries the same overnight punch once with a renewed token', async () => {
  const app = client([401, 200]);
  const result = await app.punch();
  assert.equal(result.workday.id, 'overnight');
  assert.equal(result.officialTimestamp.toDate().toISOString(), '2026-10-31T03:01:00.000Z');
  assert.deepEqual(app.tokens, [false, true]);
  assert.equal(app.calls[0].headers.Authorization, 'Bearer cached');
  assert.equal(app.calls[1].headers.Authorization, 'Bearer renewed');
  assert.equal(app.calls[0].body, app.calls[1].body);
});

test('punch retries are bounded and never bypass permission or sequence errors', async () => {
  for (const statuses of [[401, 401], [403], [409], [500]]) {
    const expectedCalls = statuses.length;
    const app = client([...statuses]);
    await assert.rejects(app.punch(), /HTTP/);
    assert.equal(app.calls.length, expectedCalls);
  }
});

test('a rejected punch cannot retry after logout or switching accounts', async () => {
  for (const currentUser of [null, { uid: 'other' }]) {
    const app = client([401], auth => { auth.currentUser = currentUser; });
    await assert.rejects(app.punch(), /HTTP 401/);
    assert.equal(app.calls.length, 1);
    assert.deepEqual(app.tokens, [false]);
  }
});
