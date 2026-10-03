import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run with Firebase emulators:exec; production tests are forbidden.');
}
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const env = {
  ...process.env, FIREBASE_ADMIN_PROJECT_ID: 'demo-ponto-uau',
  FIREBASE_ADMIN_CLIENT_EMAIL: 'test@demo-ponto-uau.iam.gserviceaccount.com',
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
};
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '-p', '3107'], {
  env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
server.stdout.on('data', chunk => { output = (output + chunk).slice(-10000); });
server.stderr.on('data', chunk => { output = (output + chunk).slice(-10000); });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = (await fetch('http://127.0.0.1:3107/api/convites/invalid')).status === 400; } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error('Next.js exited before becoming ready.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Next.js did not become ready.');
  await import('./flows.emulator.mjs');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else server.kill();
}
