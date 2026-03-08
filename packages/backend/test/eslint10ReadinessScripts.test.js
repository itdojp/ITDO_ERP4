import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

function runScript(scriptName, env = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return spawnSync('/bin/bash', [scriptPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'erp4-eslint10-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withMockBin(commands, fn) {
  return withTempDir((dir) => {
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    for (const [name, content] of Object.entries(commands)) {
      const cmdPath = path.join(binDir, name);
      writeFileSync(cmdPath, content);
      chmodSync(cmdPath, 0o755);
    }
    return fn(binDir);
  });
}

function makeNpmViewStub({
  pluginPeer = '^8.57.0 || ^9.0.0 || ^10.0.0',
  parserPeer = '^8.57.0 || ^9.0.0 || ^10.0.0',
  reactPeer = '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7',
  reactHooksPeer = '^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0',
} = {}) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "$1" != "view" || "$4" != "--json" ]]; then',
    '  echo "unexpected npm invocation: $*" >&2',
    '  exit 2',
    'fi',
    'target="$2"',
    'field="$3"',
    'case "${target}:${field}" in',
    '  "@typescript-eslint/eslint-plugin@latest:version") echo \'"8.56.0"\' ;;',
    `  "@typescript-eslint/eslint-plugin@latest:peerDependencies.eslint") echo '${JSON.stringify(pluginPeer)}' ;;`,
    '  "@typescript-eslint/parser@latest:version") echo \'"8.56.0"\' ;;',
    `  "@typescript-eslint/parser@latest:peerDependencies.eslint") echo '${JSON.stringify(parserPeer)}' ;;`,
    '  "eslint-plugin-react@latest:version") echo \'"7.37.5"\' ;;',
    `  "eslint-plugin-react@latest:peerDependencies.eslint") echo '${JSON.stringify(reactPeer)}' ;;`,
    '  "eslint-plugin-react-hooks@latest:version") echo \'"7.0.1"\' ;;',
    `  "eslint-plugin-react-hooks@latest:peerDependencies.eslint") echo '${JSON.stringify(reactHooksPeer)}' ;;`,
    '  *)',
    '    echo "unexpected npm view target: ${target}:${field}" >&2',
    '    exit 2',
    '    ;;',
    'esac',
  ].join('\n');
}

function makeSemverStub() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'range=""',
    'args=("$@")',
    'for ((i=0; i<${#args[@]}; i++)); do',
    '  if [[ "${args[$i]}" == "-r" ]]; then',
    '    range="${args[$((i+1))]}"',
    '    break',
    '  fi',
    'done',
    'case "$range" in',
    "  *'^10'*|*'|| ^10'* ) exit 0 ;;",
    '  * ) exit 1 ;;',
    'esac',
  ].join('\n');
}

test('check-eslint10-readiness: reports ready=false when React plugins do not include eslint@10', () => {
  withMockBin(
    {
      npm: makeNpmViewStub(),
      npx: makeSemverStub(),
    },
    (binDir) => {
      const res = runScript('check-eslint10-readiness.sh', {
        PATH: `${binDir}:${process.env.PATH || ''}`,
        STRICT: '0',
      });
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      assert.match(String(res.stdout), /pluginSupportsEslint10: true/);
      assert.match(String(res.stdout), /parserSupportsEslint10: true/);
      assert.match(String(res.stdout), /reactPluginSupportsEslint10: false/);
      assert.match(
        String(res.stdout),
        /reactHooksPluginSupportsEslint10: false/,
      );
      assert.match(String(res.stdout), /ready: false/);
    },
  );
});

test('check-eslint10-readiness: exits with status 2 when STRICT=1 and readiness is false', () => {
  withMockBin(
    {
      npm: makeNpmViewStub(),
      npx: makeSemverStub(),
    },
    (binDir) => {
      const res = runScript('check-eslint10-readiness.sh', {
        PATH: `${binDir}:${process.env.PATH || ''}`,
        STRICT: '1',
      });
      assert.equal(res.status, 2);
      assert.match(String(res.stdout), /ready: false/);
      assert.match(String(res.stderr), /eslint@10 is not supported/);
    },
  );
});

test('check-eslint10-readiness: reports ready=true when all peers include eslint@10', () => {
  withMockBin(
    {
      npm: makeNpmViewStub({
        reactPeer: '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7 || ^10.0.0',
        reactHooksPeer:
          '^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0 || ^10.0.0',
      }),
      npx: makeSemverStub(),
    },
    (binDir) => {
      const res = runScript('check-eslint10-readiness.sh', {
        PATH: `${binDir}:${process.env.PATH || ''}`,
        STRICT: '1',
      });
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      assert.match(String(res.stdout), /reactPluginSupportsEslint10: true/);
      assert.match(
        String(res.stdout),
        /reactHooksPluginSupportsEslint10: true/,
      );
      assert.match(String(res.stdout), /ready: true/);
    },
  );
});
