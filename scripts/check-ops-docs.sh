#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${TMPDIR:-}" || "${TMPDIR}" == "/tmp" || "${TMPDIR}" == /tmp/* ]]; then
  TMPDIR="$ROOT_DIR/.codex-local/tmp"
fi
NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${npm_config_cache:-$ROOT_DIR/.codex-local/npm-cache}}"
export TMPDIR NPM_CONFIG_CACHE npm_config_cache="$NPM_CONFIG_CACHE"
mkdir -p "$TMPDIR" "$NPM_CONFIG_CACHE"

OPS_DOC_TARGETS=(
  docs/ops/backup-restore.md
  docs/ops/backup-s3-decision-checklist.md
  docs/ops/dr-plan.md
  docs/ops/google-cloud-predeployment.md
  docs/ops/sakura-vps-deployment.md
  docs/ops/sakura-vps-env-checklist.md
  docs/ops/sakura-vps-podman-trial.md
  docs/ops/sakura-vps-trial-profiles.md
  docs/ops/storage-readiness.md
  docs/ops/ops-automation.md
  docs/ops/codex-ops-workflows.md
  docs/ops/continuity-handoff.md
  docs/ops/index.md
  docs/ops/release-checklist.md
  docs/requirements/backup-restore.md
  docs/test-results/backup-s3-readiness-template.md
  docs/test-results/backup-s3-restore-template.md
  docs/test-results/storage-readiness-template.md
  docs/ops/examples/codex-risk-report.schema.json
  docs/ops/examples/restore-evidence.json.example
)

printf '==> Checking ops documentation target files exist\n'
missing=0
for file in "${OPS_DOC_TARGETS[@]}"; do
  if [[ ! -f "$file" ]]; then
    printf 'missing ops documentation target: %s\n' "$file" >&2
    missing=1
  fi
done
[[ "$missing" -eq 0 ]] || exit 1

prettier=(npm exec --prefix packages/backend -- prettier)
if [[ -x packages/backend/node_modules/.bin/prettier ]]; then
  prettier=(packages/backend/node_modules/.bin/prettier)
fi

printf '==> Checking ops documentation formatting\n'
"${prettier[@]}" --check "${OPS_DOC_TARGETS[@]}"

printf '==> Validating ops JSON examples\n'
node -e '
const fs = require("fs");
for (const file of process.argv.slice(1)) {
  JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`valid JSON: ${file}`);
}
' docs/ops/examples/codex-risk-report.schema.json \
  docs/ops/examples/restore-evidence.json.example

printf '==> Checking relative Markdown links in ops documentation targets\n'
node - "${OPS_DOC_TARGETS[@]}" <<'NODE'
const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2).filter((file) => file.endsWith(".md"));
const repo = process.cwd();
const failures = [];

function stripTitle(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  const titleMatch = target.match(/^(\S+)\s+(?:["'(].*)$/);
  if (titleMatch) {
    target = titleMatch[1];
  }
  return target;
}

function isExternalOrAnchor(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function checkTarget(sourceFile, rawTarget, lineNumber) {
  let target = stripTitle(rawTarget);
  if (isExternalOrAnchor(target)) return;

  const withoutFragment = target.split("#", 1)[0];
  if (!withoutFragment) return;

  let decoded = withoutFragment;
  try {
    decoded = decodeURI(withoutFragment);
  } catch (_error) {
    // Keep the raw target if it is not a valid URI-encoded path.
  }

  const resolved = path.resolve(path.dirname(sourceFile), decoded);
  if (!resolved.startsWith(repo + path.sep) && resolved !== repo) {
    failures.push(`${sourceFile}:${lineNumber}: link escapes repository: ${target}`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    failures.push(`${sourceFile}:${lineNumber}: missing relative link target: ${target}`);
  }
}

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const inlinePattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of line.matchAll(inlinePattern)) {
      checkTarget(file, match[1], lineNumber);
    }

    const referencePattern = /^\s*\[[^\]]+\]:\s*(\S+)/;
    const referenceMatch = line.match(referencePattern);
    if (referenceMatch) {
      checkTarget(file, referenceMatch[1], lineNumber);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`relative Markdown links valid for ${files.length} file(s)`);
NODE

printf '==> Checking Sakura profile continuity in runbooks\n'
node - <<'NODE'
const fs = require('fs');

const files = [
  'docs/ops/sakura-vps-deployment.md',
  'docs/ops/sakura-vps-podman-trial.md',
];
const requiredCommandsByFile = new Map([
  [
    'docs/ops/sakura-vps-deployment.md',
    [
      'check-env.sh',
      'build-images.sh',
      'install-user-units.sh',
      'start-stack.sh',
      'check-trial-readiness.sh',
    ],
  ],
  [
    'docs/ops/sakura-vps-podman-trial.md',
    [
      'check-env.sh',
      'build-images.sh',
      'install-user-units.sh',
      'start-stack.sh',
      'restart-stack.sh',
      'check-trial-readiness.sh',
      'collect-trial-evidence.sh',
    ],
  ],
]);
const failures = [];

function profileInvocationFailures(file, source, commands) {
  const commandSet = new Set(commands);
  const found = new Set();
  const currentFailures = [];
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    const match = line.match(/^\.\/scripts\/quadlet\/([a-z0-9-]+\.sh)\b/u);
    if (!match || !commandSet.has(match[1])) continue;
    found.add(match[1]);
    if (!line.includes('--profile "$PROFILE"')) {
      currentFailures.push(
        `${file}:${index + 1}: ${match[1]} must receive --profile "$PROFILE"`,
      );
    }
  }
  for (const command of commandSet) {
    if (!found.has(command)) {
      currentFailures.push(`${file}: missing profile-aware invocation for ${command}`);
    }
  }
  return currentFailures;
}

const negativeFixture = [
  './scripts/quadlet/check-env.sh --profile "$PROFILE"',
  './scripts/quadlet/check-env.sh',
].join('\n');
if (
  profileInvocationFailures('negative-fixture', negativeFixture, [
    'check-env.sh',
  ]).length !== 1
) {
  throw new Error('profile continuity checker must reject every unbound invocation');
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const assignments = source.match(/^PROFILE=/gm) ?? [];
  if (assignments.length !== 1) {
    failures.push(`${file}: expected one PROFILE assignment, found ${assignments.length}`);
  }
  if (/--profile\s+(?:production|private-smoke|https-trial)\b/u.test(source)) {
    failures.push(`${file}: hard-coded --profile breaks build/install continuity`);
  }
  for (const example of [
    'erp4-frontend-build.env.example',
    'erp4-frontend-build.private-smoke.env.example',
    'erp4-frontend-build.https-trial.env.example',
  ]) {
    if (!source.includes(example)) {
      failures.push(`${file}: missing profile-specific example ${example}`);
    }
  }
  failures.push(
    ...profileInvocationFailures(
      file,
      source,
      requiredCommandsByFile.get(file) ?? [],
    ),
  );
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Sakura profile continuity valid for deployment and Podman runbooks');
NODE

printf 'Ops documentation checks completed.\n'
