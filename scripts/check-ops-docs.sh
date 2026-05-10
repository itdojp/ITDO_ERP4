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
  docs/ops/google-cloud-predeployment.md
  docs/ops/sakura-vps-deployment.md
  docs/ops/ops-automation.md
  docs/ops/codex-ops-workflows.md
  docs/ops/index.md
  docs/ops/release-checklist.md
  docs/ops/examples/codex-risk-report.schema.json
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
' docs/ops/examples/codex-risk-report.schema.json

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

printf 'Ops documentation checks completed.\n'
