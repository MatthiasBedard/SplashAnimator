import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const prepareLinux = process.argv[2] === '--prepare-linux';
if (!prepareLinux && process.platform !== 'win32')
  throw Error('This acceptance workflow requires a Windows desktop.');
const manager = process.env.npm_execpath;
if (!manager) throw Error('Run with pnpm test:native-project.');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited with ${result.status ?? result.signal}`);
}

const tauri = path.resolve('apps/editor/src-tauri');
const target = prepareLinux
  ? path.resolve('target/native-linux-acceptance')
  : path.join(tauri, 'target', 'native-project-acceptance');
mkdirSync(target, { recursive: true });
const fixture = mkdtempSync(path.join(target, 'fixture-'));
try {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = [
    encode({ alg: 'ES256', typ: 'JWT', kid: 'fixture' }),
    encode({
      iss: 'splash-licensing',
      aud: 'splash-animator',
      software_key: 'splash-animator',
      jti: 'native-project-fixture',
      email: 'fixture@example.com',
      name: 'Native QA',
      company_name: 'Fixture',
      edition: 'single',
      can_save: true,
      commercial_use: true,
      revenue_limit_usd: 100000,
      license_version: 1,
      iat: now,
      nbf: now,
      exp: now + 3600,
    }),
  ].join('.');
  const signature = sign('sha256', Buffer.from(input), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const license = path.join(fixture, 'test.license');
  writeFileSync(license, input + '.' + signature.toString('base64url'), { flag: 'wx' });
  const frontend = path.join(target, 'frontend');
  run(process.execPath, [manager, 'build', '--outDir', frontend], {
    ...process.env,
    VITE_SPLASH_LICENSE_PUBLIC_KEYS: JSON.stringify({
      fixture: publicKey.export({ type: 'spki', format: 'pem' }),
    }),
  });
  if (prepareLinux) {
    writeFileSync(path.join(target, 'test.license'), input + '.' + signature.toString('base64url'));
  } else {
    run(
      'cargo',
      [
        'build',
        '--release',
        '--locked',
        '--features',
        'tauri/custom-protocol,native-project-test',
        '--manifest-path',
        path.join(tauri, 'Cargo.toml'),
      ],
      {
        ...process.env,
        CARGO_TARGET_DIR: target,
        TAURI_CONFIG: JSON.stringify({
          identifier: 'studio.splash.animator.nativeacceptance',
          build: { frontendDist: 'target/native-project-acceptance/frontend' },
        }),
      },
    );
    run(
      process.execPath,
      [
        manager,
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.native.config.ts',
        ...process.argv.slice(2),
      ],
      {
        ...process.env,
        SPLASH_NATIVE_PROJECT_TEST_EXE: path.join(target, 'release', 'splash-animator.exe'),
        SPLASH_NATIVE_PROJECT_TEST_LICENSE_FILE: license,
      },
    );
  }
} finally {
  rmSync(fixture, { force: true, recursive: true });
}
