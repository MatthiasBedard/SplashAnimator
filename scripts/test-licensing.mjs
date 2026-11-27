import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const now = Math.floor(Date.now() / 1000);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encode({ alg: 'ES256', typ: 'JWT', kid: 'fixture' });
const claims = encode({
  iss: 'splash-licensing', aud: 'splash-animator', software_key: 'splash-animator', jti: 'fixture',
  email: 'fixture@example.com', name: 'Fixture User', company_name: 'Fixture Co',
  edition: 'single', can_save: true, commercial_use: true, revenue_limit_usd: 100000,
  license_version: 1, iat: now, nbf: now, exp: now + 3600,
});
const input = `${header}.${claims}`;
const signature = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
const manager = process.env.npm_execpath;
if (!manager) throw Error('Start this test with pnpm test:licensing.');
const specs = process.argv.slice(2);
const result = spawnSync(process.execPath, [
  manager, 'test:iterate', ...(specs.length ? specs : ['tests/e2e/licensing.spec.ts']),
  '--timeout=60000',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SPLASH_LICENSE_PUBLIC_KEYS: JSON.stringify({ fixture: publicKey.export({ type: 'spki', format: 'pem' }) }),
    SPLASH_TEST_LICENSE: `${input}.${signature.toString('base64url')}`,
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
