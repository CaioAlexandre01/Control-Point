import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual components with controlled hooks and deferred Firebase reads.
function load(file, mocks) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function provider() {
  let state, listener, cleanup;
  const reads = [];
  const persistence = [];
  const components = load('src/contexts/AuthContext.tsx', {
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useContext: () => state,
      useState: initial => { state = initial; return [state, next => { state = next; }]; },
      useEffect: effect => { cleanup = effect(); },
    },
    '@/lib/firebase': { auth: {}, db: {} },
    'firebase/auth': {
      browserLocalPersistence: 'local',
      setPersistence: async (_, mode) => { persistence.push(mode); },
      onAuthStateChanged: (_, callback) => { listener = callback; return () => {}; },
      signOut: async () => { await listener(null); },
    },
    'firebase/firestore': {
      doc: (_, collection, uid) => uid,
      getDoc: uid => { const read = deferred(); reads.push({ uid, ...read }); return read.promise; },
    },
  });
  const tree = components.AuthProvider({ children: null });
  await Promise.resolve();
  return { state: () => state, emit: user => listener(user), reads, cleanup, logout: tree.props.value.logout, persistence };
}
const snapshot = (uid, role = 'employee') => ({ exists: () => true, id: uid, data: () => ({ active: true, role }) });
function destination(state, component = 'protected', isSubmitting = false, role) {
  const routes = [];
  const mocks = {
    react: { useEffect: effect => effect(), useState: () => ['', () => {}] },
    'next/navigation': { useRouter: () => ({ replace: route => routes.push(route) }) },
    '@/contexts/AuthContext': { useAuth: () => state },
    './ui': { Loading: 'loading' },
  };
  if (component === 'protected') {
    load('src/components/Protected.tsx', mocks).Protected({ children: 'home', role });
  } else {
    const schema = { email: () => schema, min: () => schema };
    Object.assign(mocks, {
      '@hookform/resolvers/zod': { zodResolver: () => null },
      'firebase/auth': {}, 'firebase/firestore': {}, 'lucide-react': {}, '@/lib/firebase': {},
      '@/components/ui': {}, zod: { z: { object: () => schema, string: () => schema } },
      'react-hook-form': { useForm: () => ({ register: () => ({}), handleSubmit: () => {}, formState: { errors: {}, isSubmitting } }) },
    });
    load('src/app/login/page.tsx', mocks).default();
  }
  return routes;
}

test('login waits for the profile, then navigates by role without a protected-route bounce', async () => {
  for (const role of ['employee', 'admin']) {
    const app = await provider();
    await app.emit(null);
    const pending = app.emit({ uid: role });
    assert.equal(app.state().loading, true);
    assert.deepEqual(destination(app.state()), []);
    assert.deepEqual(destination(app.state(), 'login'), []);
    app.reads[0].resolve(snapshot(role, role));
    await pending;
    assert.deepEqual(destination(app.state(), 'login', true), []);
    assert.deepEqual(destination(app.state(), 'login'), [role === 'admin' ? '/admin' : '/ponto']);
    assert.deepEqual(destination(app.state()), []);
  }
});
test('restored session waits for Firebase and profile, keeping local persistence', async () => {
  const app = await provider();
  assert.deepEqual(app.persistence, ['local']);
  assert.deepEqual(destination(app.state()), []);
  const pending = app.emit({ uid: 'saved' });
  assert.deepEqual(destination(app.state()), []);
  app.reads[0].resolve(snapshot('saved'));
  await pending;
  assert.equal(app.state().profile.uid, 'saved');
  assert.deepEqual(destination(app.state(), 'login'), ['/ponto']);
});
test('logout clears session and late profile cannot restore it; anonymous route goes to login', async () => {
  const app = await provider();
  const pending = app.emit({ uid: 'old' });
  await app.logout();
  app.reads[0].resolve(snapshot('old'));
  await pending;
  assert.equal(app.state().firebaseUser, null);
  assert.equal(app.state().profile, null);
  assert.equal(app.state().loading, false);
  assert.deepEqual(destination(app.state()), ['/login']);
});
test('an older read cannot overwrite a newer session or update after unmount', async () => {
  const app = await provider();
  const old = app.emit({ uid: 'old' });
  const current = app.emit({ uid: 'current' });
  app.reads[1].resolve(snapshot('current'));
  await current;
  app.reads[0].resolve(snapshot('old'));
  await old;
  assert.equal(app.state().profile.uid, 'current');
  const pending = app.emit({ uid: 'unmounted' });
  app.cleanup();
  app.reads[2].resolve(snapshot('unmounted'));
  await pending;
  assert.equal(app.state().profile, null);
});
test('failed or missing profiles end loading and expose an error without allowing access', async () => {
  for (const missing of [true, false]) {
    const app = await provider();
    const pending = app.emit({ uid: 'invalid' });
    if (missing) app.reads[0].resolve({ exists: () => false });
    else app.reads[0].reject(new Error('offline'));
    await pending;
    assert.equal(app.state().loading, false);
    assert.ok(app.state().authError);
    assert.deepEqual(destination(app.state(), 'login'), []);
    assert.deepEqual(destination(app.state()), ['/login']);
  }
});
test('inactive profiles do not redirect from login and role restrictions remain enforced', () => {
  const state = { firebaseUser: { uid: 'u' }, profile: { active: false, role: 'employee' }, loading: false };
  assert.deepEqual(destination(state, 'login'), []);
  state.profile.active = true;
  assert.deepEqual(destination(state, 'protected', false, 'admin'), ['/ponto']);
});
