import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import QRCode from 'qrcode';
const require = createRequire(import.meta.url);
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || '')) throw new Error('UI tests require local emulators.');
}
const app = initializeApp({ projectId: 'demo-ponto-uau' });
const db = getFirestore(app);
const auth = getAuth(app);
const companyId = 'ui-company';
const password = 'Test-pass-123!';
const qrCodeId = '1234567890abcdef1234567890abcdef';
const uniqueEmail = () => `ui-${randomBytes(6).toString('hex')}@example.test`;

async function invite(email = uniqueEmail(), extra = {}) {
  const token = randomBytes(24).toString('hex');
  await db.doc(`invites/${token}`).set({
    token, email, companyId, role: 'employee', active: true, used: false,
    createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000), ...extra,
  });
  return { token, email, path: `/ativar?token=${token}` };
}
async function register(page, link, name = 'Funcionário QA') {
  await page.goto(link.path);
  await expect(page.getByRole('heading', { name: 'Crie seu acesso' })).toBeVisible();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue(link.email);
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ativar minha conta' }).click();
  await expect(page).toHaveURL(/\/ponto$/);
  await expect(page.getByRole('heading', { name: 'Registrar ponto', exact: true })).toBeVisible();
}
async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test.beforeAll(async () => {
  await db.doc('system/config').set({ initialized: true, createdAt: FieldValue.serverTimestamp() });
  await db.doc(`companies/${companyId}`).set({ active: true, name: 'Empresa QA', document: '12345678', latitude: -23.5, longitude: -46.6, radiusMeters: 100, qrCodeId });
  const user = await auth.getUserByEmail('ui-admin@example.test').catch(() => auth.createUser({ email: 'ui-admin@example.test', password }));
  await db.doc(`users/${user.uid}`).set({ name: 'Admin QA', email: user.email, role: 'admin', active: true, companyId });
});
test.afterAll(async () => { await deleteApp(app); });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Browser error:', error.message));
});

test('mobile signup, reopening the link, refresh, profile, history and login', async ({ page }) => {
  const link = await invite();
  await register(page, link);
  await page.goto(link.path);
  await expect(page).toHaveURL(/\/ponto$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'entrada', exact: true })).toBeVisible();
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Funcionário QA', exact: true })).toBeVisible();
  await page.goto('/historico');
  await expect(page.getByRole('heading', { name: 'Meu histórico', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(link.path);
  await expect(page.getByRole('heading', { name: 'Continue seu acesso' })).toBeVisible();
  await expect(page.getByText('Este convite expirou.')).toHaveCount(0);
  await login(page, link.email);
  await expect(page).toHaveURL(/\/ponto$/);
});

test('expired, canceled, invalid and valid invites display distinct outcomes, even with a wrong device clock', async ({ page }) => {
  const expired = await invite(undefined, { expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  const canceled = await invite(undefined, { active: false });
  const valid = await invite();
  await page.goto(expired.path);
  await expect(page.getByText('Este convite expirou.')).toBeVisible();
  await page.goto(canceled.path);
  await expect(page.getByText('Este convite foi cancelado.')).toBeVisible();
  await page.goto('/ativar?token=invalid');
  await expect(page.getByText('Link de ativação inválido.')).toBeVisible();
  await page.clock.setFixedTime(new Date('2040-01-01T12:00:00Z'));
  await page.goto(valid.path);
  await expect(page.getByRole('heading', { name: 'Crie seu acesso' })).toBeVisible();
});

test('signup resumes an existing Auth identity and survives a lost activation response', async ({ page }) => {
  const link = await invite();
  await auth.createUser({ email: link.email, password });
  let dropped = false;
  await page.route(`**/api/convites/${link.token}`, async route => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await register(page, link);
  await expect(page.getByRole('heading', { name: 'entrada', exact: true })).toBeVisible();
  const snapshot = await db.doc(`invites/${link.token}`).get();
  expect(snapshot.get('used')).toBe(true);
  expect((await db.doc(`users/${snapshot.get('usedBy')}`).get()).exists).toBe(true);
});

test('password recovery is requested only by clicking the button', async ({ page, request }) => {
  const email = uniqueEmail();
  await auth.createUser({ email, password });
  const codes = () => request.get(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/demo-ponto-uau/oobCodes`).then(r => r.json());
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  expect((await codes()).oobCodes?.filter(c => c.email === email) || []).toHaveLength(0);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByText(/Se houver uma conta com esse e-mail/)).toBeVisible();
  expect((await codes()).oobCodes.filter(c => c.email === email)).toHaveLength(1);
});

test('administrator creates, cancels and renews the same link; all admin screens load', async ({ page }) => {
  await login(page, 'ui-admin@example.test');
  await expect(page).toHaveURL(/\/admin$/);
  await page.route('**/api/admin/convites', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Convites temporariamente indisponíveis.' }) });
    } else await route.continue();
  });
  await page.goto('/admin/funcionarios');
  await expect(page.getByText('Convites temporariamente indisponíveis.')).toBeVisible();
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.unroute('**/api/admin/convites');
  await page.getByRole('button', { name: 'Tentar carregar novamente' }).click();
  await expect(page.getByText('Convites temporariamente indisponíveis.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Novo convite' }).click();
  const email = uniqueEmail();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Criar convite' }).click();
  const link = await page.locator('.invite-link code').textContent();
  expect(link).toMatch(/\/ativar\?token=[a-f0-9]{48}$/);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: email });
  await row.getByRole('button', { name: 'Cancelar convite' }).click();
  await expect(row.getByText('Cancelado', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Renovar por 7 dias' }).click();
  await expect(page.locator('.invite-link code')).toHaveText(link);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(row.getByText('Pendente', { exact: true })).toBeVisible();
  for (const [url, title] of [['/admin/registros', 'Registros'], ['/admin/relatorios', 'Relatórios'], ['/admin/qrcode', 'QR Code'], ['/admin/configuracoes', 'Configurações']]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    await expect(page.locator('.alert.error')).toHaveCount(0);
  }
  await page.screenshot({ path: 'test-results/admin-mobile.png', fullPage: true });
});

test('QR photo plus geolocation records the full workday in the mobile UI', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -23.5, longitude: -46.6, accuracy: 5 });
  await register(page, await invite(), 'Ponto QA');
  // The workday must still use the official date when the device is misconfigured.
  await page.clock.setFixedTime(new Date('2040-01-01T12:00:00Z'));
  await page.reload();
  const buffer = await QRCode.toBuffer(`P:${qrCodeId.toUpperCase()}`, { width: 640, margin: 4 });
  for (const action of ['entrada', 'início do intervalo', 'fim do intervalo', 'saída']) {
    await page.getByRole('button', { name: 'Ler por foto' }).click();
    await expect(page.getByRole('button', { name: 'Abrir foto', exact: true })).toBeEnabled();
    await page.locator('input[type=file]').setInputFiles({ name: 'qrcode.png', mimeType: 'image/png', buffer });
    await expect(page.getByRole('dialog', { name: `Confirmar ${action}?` })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'Jornada concluída', exact: true })).toBeVisible();
  await expect(page.locator('.punch-mini-table .registered')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/workday-mobile.png', fullPage: true });
});
