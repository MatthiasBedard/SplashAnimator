import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || `git exited ${result.status}`);
  return result.stdout.split('\0').filter(Boolean);
}

const explicit = process.argv.slice(2);
for (const file of explicit) {
  if (!/\.(?:[cm]?[jt]sx?|svelte)$/.test(file) || !existsSync(resolve(root, file)))
    throw Error(`Requested lint source file does not exist or is unsupported: ${file}`);
}
const candidates = explicit.length
  ? explicit
  : [
      ...git(['diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD']),
      ...git(['ls-files', '--others', '--exclude-standard', '-z']),
    ];
const files = [...new Set(candidates)].filter(
  (file) => /\.(?:[cm]?[jt]sx?|svelte)$/.test(file) && existsSync(resolve(root, file)),
);
if (!files.length) {
  console.log('No changed JavaScript, TypeScript or Svelte files to lint.');
} else {
  console.log(`Linting ${files.length} source file(s) with a content cache.`);
  const result = spawnSync(
    process.execPath,
    [
      '--stack-size=4096',
      resolve(root, 'node_modules/eslint/bin/eslint.js'),
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      resolve(root, 'node_modules/.cache/splash-eslint/.eslintcache'),
      '--',
      ...files,
    ],
    { cwd: root, stdio: 'inherit', shell: false },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
