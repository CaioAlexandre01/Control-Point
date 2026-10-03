import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { initializeApp as adminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore as adminDb, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, updateDoc, serverTimestamp, onSnapshot, collection, getDocs, query, where, writeBatch, runTransaction } from 'firebase/firestore';

for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  assert.match(process.env[key] || '', /^127\.0\.0\.1:\d+$/, 'Only loopback emulators are allowed');
}
const projectId = 'demo-ponto-uau';
const app = adminApp({ projectId });
const db = adminDb(app);
const clients = [];
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function client(email) {
  const app = initializeApp({ projectId, apiKey: 'fake-key' }, randomBytes(8).toString('hex'));
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port));
  const user = (await createUserWithEmailAndPassword(auth, email, 'Test-pass-123!')).user;
  return { auth, store, user, token: await user.getIdToken() };
}
async function api(path, token, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:3107${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
let admin, employee, inviteToken;
const companyId = 'test-company';
try {
  admin = await client('admin@example.test');
  await check('initial setup atomically creates the company and administrator then closes setup', async () => {
    const batch = writeBatch(admin.store);
    batch.set(doc(admin.store, 'system', 'config'), { initialized: true, createdAt: serverTimestamp() });
    batch.set(doc(admin.store, 'companies', companyId), { active: true, name: 'Test company', latitude: -23.5, longitude: -46.6, radiusMeters: 100, qrCodeId: 'test-qr', createdAt: serverTimestamp() });
    batch.set(doc(admin.store, 'users', admin.user.uid), { active: true, role: 'admin', companyId, name: 'Admin', email: admin.user.email, createdAt: serverTimestamp() });
    await batch.commit();
    assert.equal((await getDocFromServer(doc(admin.store, 'system', 'config'))).exists(), true);
    assert.equal((await getDocFromServer(doc(admin.store, 'companies', companyId))).exists(), true);
  });
  await check('admin creates a seven-day invite using server time', async () => {
    const before = Date.now();
    const result = await api('/api/admin/convites', admin.token, 'POST', { email: ' Employee@example.test ' });
    assert.equal(result.status, 200, JSON.stringify(result));
    inviteToken = result.body.token;
    const invite = (await db.doc(`invites/${inviteToken}`).get()).data();
    assert.equal(invite.email, 'employee@example.test');
    assert.ok(invite.expiresAt.toMillis() >= before + 7 * 86400000);
    assert.equal((await api(`/api/convites/${inviteToken}`)).status, 200);
  });
  employee = await client('employee@example.test');
  await check('profile appears in the same signed-in session after activation', async () => {
    let unsubscribe;
    let listening;
    const initialSnapshot = new Promise(resolve => { listening = resolve; });
    const profileReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Profile listener timed out')), 45000);
      unsubscribe = onSnapshot(doc(employee.store, 'users', employee.user.uid), snapshot => {
        listening();
        if (snapshot.exists()) { clearTimeout(timeout); resolve(snapshot.data()); }
      }, reject);
    });
    await Promise.race([initialSnapshot, profileReady]);
    const result = await api(`/api/convites/${inviteToken}`, employee.token, 'POST', { name: 'Employee Test' });
    assert.equal(result.status, 200, JSON.stringify(result));
    const profile = await profileReady;
    unsubscribe();
    assert.equal(profile.inviteId, inviteToken);
    assert.equal((await db.doc(`invites/${inviteToken}`).get()).get('used'), true);
  });
  await check('retry after a lost response is idempotent; used link directs to login', async () => {
    const path = `/api/convites/${inviteToken}`;
    assert.equal((await api(path, employee.token, 'POST', { name: 'Must not overwrite' })).status, 200);
    assert.equal((await db.doc(`users/${employee.user.uid}`).get()).get('name'), 'Employee Test');
    const used = await api(path);
    assert.equal(used.status, 410);
    assert.match(used.body.error, /utilizado/);
    assert.equal((await api('/api/admin/convites', admin.token, 'PATCH', { token: inviteToken, action: 'renew' })).status, 409);
  });
  await check('logout and login restore employee access', async () => {
    await signOut(employee.auth);
    await signInWithEmailAndPassword(employee.auth, 'employee@example.test', 'Test-pass-123!');
    assert.equal((await getDocFromServer(doc(employee.store, 'users', employee.user.uid))).data().active, true);
  });
  await check('expired and canceled invites differ, renewal preserves the same link', async () => {
    const created = await api('/api/admin/convites', admin.token, 'POST', { email: 'second@example.test' });
    const token = created.body.token;
    await db.doc(`invites/${token}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    assert.match((await api(`/api/convites/${token}`)).body.error, /expirou/);
    const listed = await api('/api/admin/convites', admin.token);
    assert.equal(listed.body.invites.find(x => x.id === token).status, 'expired');
    assert.equal((await api('/api/admin/convites', admin.token, 'PATCH', { token, action: 'renew' })).status, 200);
    assert.equal((await api(`/api/convites/${token}`)).status, 200);
    await api('/api/admin/convites', admin.token, 'PATCH', { token, action: 'cancel' });
    assert.match((await api(`/api/convites/${token}`)).body.error, /cancelado/);
  });
  await check('an interrupted signup resumes after renewal; concurrent retries create one profile', async () => {
    const pending = await client('pending@example.test');
    const created = await api('/api/admin/convites', admin.token, 'POST', { email: pending.user.email });
    const path = `/api/convites/${created.body.token}`;
    await db.doc(`invites/${created.body.token}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    assert.equal((await api(path, pending.token, 'POST', { name: 'Pending Test' })).status, 410);
    assert.equal((await db.doc(`users/${pending.user.uid}`).get()).exists, false);
    assert.equal((await db.doc(`invites/${created.body.token}`).get()).get('used'), false);
    await signOut(pending.auth);
    await signInWithEmailAndPassword(pending.auth, 'pending@example.test', 'Test-pass-123!');
    await api('/api/admin/convites', admin.token, 'PATCH', { token: created.body.token, action: 'renew' });
    const results = await Promise.all([1, 2].map(() => api(path, pending.token, 'POST', { name: 'Pending Test' })));
    assert.deepEqual(results.map(x => x.status), [200, 200]);
    assert.equal((await db.doc(`invites/${created.body.token}`).get()).get('usedBy'), pending.user.uid);
  });
  await check('wrong client clock cannot expire a valid invite', async () => {
    const created = await api('/api/admin/convites', admin.token, 'POST', { email: 'clock@example.test' });
    const realNow = Date.now;
    try {
      Date.now = () => Date.parse('2040-01-01T00:00:00Z');
      assert.equal((await api(`/api/convites/${created.body.token}`)).status, 200);
    } finally { Date.now = realNow; }
  });
  await check('invalid payloads and foreign-company renewal are rejected', async () => {
    assert.equal((await api('/api/admin/convites', admin.token, 'POST', { email: 'invalid' })).status, 400);
    assert.equal((await api(`/api/convites/${inviteToken}`, employee.token, 'POST', { name: ' ' })).status, 400);
    assert.equal((await api(`/api/convites/${inviteToken}`, undefined, 'POST', { name: 'Test' })).status, 401);
    const token = randomBytes(24).toString('hex');
    await db.doc(`invites/${token}`).set({ companyId: 'other', used: false });
    assert.equal((await api('/api/admin/convites', admin.token, 'PATCH', { token, action: 'renew' })).status, 404);
  });
  await check('a new employee can read an absent workday and empty history', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const snapshot = await getDocFromServer(doc(employee.store, 'workdays', `${companyId}_${employee.user.uid}_${date}`));
    assert.equal(snapshot.exists(), false);
    const history = await getDocs(query(collection(employee.store, 'workdays'), where('companyId', '==', companyId), where('userId', '==', employee.user.uid)));
    assert.equal(history.empty, true);
  });
  await check('punch flow enforces GPS, QR, order, duplicate rejection and completion', async () => {
    const body = { companyId, type: 'clock_in', qrCodeId: 'test-qr', latitude: -23.5, longitude: -46.6, accuracy: 5, clientTimestamp: Date.now(), userAgent: 'QA' };
    assert.equal((await api('/api/ponto/registrar', employee.token, 'POST', { ...body, qrCodeId: 'wrong' })).status, 422);
    assert.equal((await api('/api/ponto/registrar', employee.token, 'POST', { ...body, latitude: 0 })).status, 422);
    assert.equal((await api('/api/ponto/registrar', employee.token, 'POST', { ...body, accuracy: 999 })).status, 422);
    assert.equal((await api('/api/ponto/registrar', employee.token, 'POST', { ...body, type: 'clock_out' })).status, 409);
    for (const type of ['clock_in', 'break_start', 'break_end', 'clock_out']) {
      const result = await api('/api/ponto/registrar', employee.token, 'POST', { ...body, type });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.ok(Number.isFinite(result.body.officialTimestampMillis));
      assert.equal((await api('/api/ponto/registrar', employee.token, 'POST', { ...body, type })).status, 409);
    }
    const days = await db.collection('workdays').where('userId', '==', employee.user.uid).get();
    assert.equal(days.docs[0].get('status'), 'finished');
    assert.equal((await days.docs[0].ref.collection('events').get()).size, 4);
  });
  await check('employee cannot administer invites or consume one without a profile', async () => {
    assert.equal((await api('/api/admin/convites', employee.token)).status, 403);
    assert.equal((await api('/api/admin/convites', undefined)).status, 401);
    const stranger = await client('stranger@example.test');
    const created = await api('/api/admin/convites', admin.token, 'POST', { email: stranger.user.email });
    await assert.rejects(updateDoc(doc(stranger.store, 'invites', created.body.token), {
      active: false, used: true, usedBy: stranger.user.uid, usedAt: serverTimestamp(),
    }), /permission|PERMISSION/i);
    const wrongEmail = await api(`/api/convites/${created.body.token}`, employee.token, 'POST', { name: 'Wrong person' });
    assert.equal(wrongEmail.status, 403);
    // Existing tabs using the previous client transaction must remain compatible.
    await runTransaction(stranger.store, async transaction => {
      const ref = doc(stranger.store, 'invites', created.body.token);
      await transaction.get(ref);
      transaction.set(doc(stranger.store, 'users', stranger.user.uid), {
        email: stranger.user.email, companyId, role: 'employee', active: true,
        name: 'Legacy user', inviteId: created.body.token, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      transaction.update(ref, { active: false, used: true, usedBy: stranger.user.uid, usedAt: serverTimestamp() });
    });
    assert.equal((await db.doc(`users/${stranger.user.uid}`).get()).exists, true);
  });
  await check('administrator can read the dashboard and save an audited workday correction', async () => {
    for (const name of ['users', 'workdays', 'invites', 'auditLogs']) {
      await getDocs(query(collection(admin.store, name), where('companyId', '==', companyId)));
    }
    const days = await db.collection('workdays').where('companyId', '==', companyId).get();
    const id = days.docs[0].id;
    const auditId = 'test-correction';
    const batch = writeBatch(admin.store);
    batch.set(doc(admin.store, 'auditLogs', auditId), { companyId, adminId: admin.user.uid, workdayId: id, reason: 'Correção de teste', createdAt: serverTimestamp() });
    batch.update(doc(admin.store, 'workdays', id), { correctionAuditId: auditId, totalWorkedMinutes: 480, updatedAt: serverTimestamp() });
    await batch.commit();
    assert.equal((await getDocFromServer(doc(admin.store, 'workdays', id))).get('totalWorkedMinutes'), 480);
    await updateDoc(doc(admin.store, 'companies', companyId), { radiusMeters: 110, updatedAt: serverTimestamp() });
  });
  await check('deactivated employees cannot register points or read another employee history', async () => {
    await assert.rejects(getDocFromServer(doc(employee.store, 'workdays', `${companyId}_someone-else_2026-10-03`)), /permission|PERMISSION/i);
    await db.doc(`users/${employee.user.uid}`).update({ active: false });
    const body = { companyId, type: 'clock_in', qrCodeId: 'test-qr', latitude: -23.5, longitude: -46.6, accuracy: 5, clientTimestamp: Date.now() };
    assert.equal((await api('/api/ponto/registrar', employee.token, 'POST', body)).status, 403);
  });
  console.log(`Integration complete: ${checks.length} flows passed against isolated emulators.`);
} finally {
  await Promise.all(clients.map(deleteApp));
  await deleteAdminApp(app);
}
