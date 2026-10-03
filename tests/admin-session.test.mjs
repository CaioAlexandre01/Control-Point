import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function actions(statuses) {
  const refreshed = [], requests = [];
  const auth = { currentUser: { uid: 'admin', getIdToken: async force => { refreshed.push(force); return force ? 'fresh' : 'cached'; } } };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/admin-actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert.equal(name, './firebase'); return { auth };
  }, fetch: async (path, init) => {
    requests.push({ path, init });
    const status = statuses.shift();
    return { status, ok: status === 200, json: async () => status === 200 ? { invites: [], ok: true } : { error: `Server error ${status}` } };
  } });
  return { ...exports, auth, refreshed, requests };
}

test('admin requests renew a rejected cached session once and then succeed', async () => {
  const api = actions([401, 200]);
  await api.listInvites();
  assert.deepEqual(api.refreshed, [false, true]);
  assert.equal(api.requests[1].init.headers.Authorization, 'Bearer fresh');
});

test('valid sessions and permission errors are not retried', async () => {
  for (const status of [200, 403, 500]) {
    const api = actions([status]);
    if (status === 200) await api.listInvites();
    else await assert.rejects(api.listInvites(), new RegExp(`Server error ${status}`));
    assert.deepEqual(api.refreshed, [false]);
  }
});

test('a second rejection terminates; logout cannot retry using a stale identity', async () => {
  const api = actions([401, 401]);
  await assert.rejects(api.listInvites(), /Server error 401/);
  assert.equal(api.requests.length, 2);
  const loggedOut = actions([]);
  loggedOut.auth.currentUser = null;
  await assert.rejects(loggedOut.listInvites(), /sessão expirou/);
  assert.equal(loggedOut.requests.length, 0);
});
