/* eslint-disable no-console */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const designSystemRoot = path.join(
  frontendRoot,
  'node_modules',
  '@itdo',
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

const removeNestedReact = () => {
  const nestedRoot = path.join(designSystemRoot, 'node_modules');
  const reactPath = path.join(nestedRoot, 'react');
  const reactDomPath = path.join(nestedRoot, 'react-dom');
  try {
    fs.rmSync(reactPath, { recursive: true, force: true });
    fs.rmSync(reactDomPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
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

const allowSourceBuild =
  process.env.DESIGN_SYSTEM_ALLOW_SOURCE_BUILD === 'true';
if (!allowSourceBuild) {
  console.error(
    '[design-system] dist is missing. Install a prebuilt @itdo/design-system package or run this script with DESIGN_SYSTEM_ALLOW_SOURCE_BUILD=true and DESIGN_SYSTEM_SOURCE_REF=<commit-sha> in an isolated environment.',
  );
  process.exit(1);
}

const sourceRef = String(process.env.DESIGN_SYSTEM_SOURCE_REF || '').trim();
if (!/^[a-f0-9]{40}$/i.test(sourceRef)) {
  console.error(
    '[design-system] DESIGN_SYSTEM_SOURCE_REF must be an immutable 40-character commit SHA when source builds are enabled.',
  );
  process.exit(1);
}

const sourceRefDir = sourceRef.replace(/[^A-Za-z0-9._-]/g, '_');
const repoUrl = 'https://github.com/itdojp/itdo-design-system.git';
const cacheRoot = path.join(frontendRoot, '.cache', 'erp4-design-system-build');
const repoDir = path.join(cacheRoot, `itdo-design-system-${sourceRefDir}`);

console.log(`[design-system] building from source (${sourceRef})...`);

fs.mkdirSync(cacheRoot, { recursive: true });

fs.rmSync(repoDir, { recursive: true, force: true });
run('git', ['clone', '--quiet', repoUrl, repoDir], cacheRoot);
run('git', ['checkout', '--detach', sourceRef], repoDir);
run('npm', ['ci'], repoDir);
run('npm', ['run', 'build:lib'], repoDir);

fs.mkdirSync(distRoot, { recursive: true });
fs.cpSync(path.join(repoDir, 'dist'), distRoot, { recursive: true });
removeNestedReact();

if (!exists(distEntry) || !exists(distStyles)) {
  console.error('[design-system] build finished but dist is missing');
  process.exit(1);
}

console.log('[design-system] build complete');
