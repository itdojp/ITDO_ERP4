/* eslint-disable no-console */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const designSystemRoot = path.join(
  frontendRoot,
  'node_modules',
  '@itdojp',
  'design-system',
);
const distRoot = path.join(designSystemRoot, 'dist');
const distEntry = path.join(distRoot, 'index.js');
const distStyles = path.join(distRoot, 'styles.css');

const exists = (targetPath) => {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const run = (command, args, cwd) => {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
};

const sleep = (ms) => {
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitArray, 0, 0, ms);
};

const resolveGitTag = () => {
  try {
    const pkgPath = path.join(frontendRoot, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const spec = parsed?.dependencies?.['@itdojp/design-system'];
    if (typeof spec !== 'string') return 'v1.0.0';
    const match = spec.match(/#(.+)$/);
    return match?.[1] ? String(match[1]) : 'v1.0.0';
  } catch {
    return 'v1.0.0';
  }
};

if (!exists(designSystemRoot)) {
  console.log('[design-system] not installed yet; skip build');
  process.exit(0);
}

if (exists(distEntry) && exists(distStyles)) {
  console.log('[design-system] dist already exists; skip build');
  process.exit(0);
}

const tag = resolveGitTag();
const repoUrl = 'https://github.com/itdojp/itdo-design-system.git';
const cacheRoot = path.join(os.tmpdir(), 'erp4-design-system-build');
const repoDir = path.join(cacheRoot, `itdo-design-system-${tag}`);
const cloneRetriesRaw = process.env.DESIGN_SYSTEM_CLONE_RETRIES || '3';
const cloneRetries = Math.max(1, Number(cloneRetriesRaw) || 1);

const buildLocal = () => {
  try {
    console.log('[design-system] dist not found; building in-place...');
    run('npm', ['install'], designSystemRoot);
    run('npm', ['run', 'build:lib'], designSystemRoot);
    if (exists(distEntry) && exists(distStyles)) {
      console.log('[design-system] local build complete');
      return true;
    }
  } catch (err) {
    console.warn('[design-system] local build failed; fallback to clone');
  }
  return false;
};

if (buildLocal()) {
  process.exit(0);
}

console.log(`[design-system] building from source (${tag})...`);

fs.mkdirSync(cacheRoot, { recursive: true });

let cloned = false;
for (let attempt = 1; attempt <= cloneRetries; attempt += 1) {
  try {
    fs.rmSync(repoDir, { recursive: true, force: true });
    run(
      'git',
      [
        '-c',
        'advice.detachedHead=false',
        'clone',
        '--quiet',
        '--depth',
        '1',
        '--branch',
        tag,
        repoUrl,
        repoDir,
      ],
      cacheRoot,
    );
    cloned = true;
    break;
  } catch (err) {
    if (attempt >= cloneRetries) {
      throw err;
    }
    console.warn(
      `[design-system] clone failed (attempt ${attempt}/${cloneRetries}). retrying...`,
    );
    sleep(1000 * attempt);
  }
}
if (!cloned) {
  console.error('[design-system] failed to clone design-system repository');
  process.exit(1);
}
run('npm', ['ci'], repoDir);
run('npm', ['run', 'build:lib'], repoDir);

fs.mkdirSync(distRoot, { recursive: true });
fs.cpSync(path.join(repoDir, 'dist'), distRoot, { recursive: true });

if (!exists(distEntry) || !exists(distStyles)) {
  console.error('[design-system] build finished but dist is missing');
  process.exit(1);
}

console.log('[design-system] build complete');
