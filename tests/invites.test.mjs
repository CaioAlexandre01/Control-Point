import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }, ...globals });
  return exports;
}

const validation = load('src/lib/invite-validation.ts');
const now = Date.parse('2026-10-03T20:30:00Z');
const validInvite = { email: 'employee@example.com', active: true, used: false,
  expiresAt: { toMillis: () => Date.parse('2026-10-10T20:30:00Z') } };

test('expiration boundary, canceled, used and missing invites remain blocked', () => {
  assert.equal(validation.validateInvite(validInvite, now), null);
  assert.match(validation.validateInvite(validInvite, validInvite.expiresAt.toMillis()), /expirou/);
  assert.match(validation.validateInvite({ ...validInvite, expiresAt: undefined }, now), /expirou/);
  assert.match(validation.validateInvite({ ...validInvite, active: false }, now), /cancelado/);
  assert.match(validation.validateInvite({ ...validInvite, used: true, active: false }, now), /utilizado/);
  assert.match(validation.validateInvite(undefined, now), /inválido/);
});

test('public validation uses server time, disables caching and does not disclose unavailable invite data', async () => {
  for (const outcome of ['valid', 'expired', 'used', 'missing', 'offline', 'bad-token']) {
    let reads = 0;
    const { GET } = load('src/app/api/convites/[token]/route.ts', {
      'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers }) } },
      '@/lib/invite-validation': validation,
      '@/lib/activate-invite': {},
      '@/lib/firebase-admin': { getAdminDb: () => ({ doc: () => ({ get: async () => {
        reads++;
        if (outcome === 'offline') throw new Error('unavailable');
        return { data: () => outcome === 'missing' ? undefined : {
          ...validInvite,
          used: outcome === 'used',
          expiresAt: outcome === 'expired' ? { toMillis: () => now } : validInvite.expiresAt,
        } };
      } }) }) },
    }, { Date: { now: () => now } });
    const response = await GET({}, { params: Promise.resolve({ token: outcome === 'bad-token' ? '../invalid' : 'a'.repeat(48) }) });
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.status, { valid: 200, expired: 410, used: 410, missing: 410, offline: 503, 'bad-token': 400 }[outcome]);
    if (outcome === 'valid') assert.equal(response.body.email, validInvite.email);
    else assert.equal(response.body.email, undefined);
    if (outcome === 'used') assert.equal(response.body.code, 'already-activated');
    assert.equal(reads, outcome === 'bad-token' ? 0 : 1);
  }
});
