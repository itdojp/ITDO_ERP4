#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${TMPDIR:-}" || "${TMPDIR}" == "/tmp" || "${TMPDIR}" == /tmp/* ]]; then
  TMPDIR="$ROOT_DIR/.codex-local/tmp"
fi
export TMPDIR
mkdir -p "$TMPDIR"
SMOKE_DIR="$(mktemp -d "$TMPDIR/ops-quality.XXXXXX")"
cleanup() {
  rm -rf "$SMOKE_DIR"
}
trap cleanup EXIT

mapfile -t OPS_SHELL_FILES < <(find scripts/ops -type f -name '*.sh' | sort)
mapfile -t OPS_ENTRYPOINTS < <(find scripts/ops -maxdepth 1 -type f -name '*.sh' | sort)

printf '==> Checking ops shell script syntax\n'
for file in "${OPS_SHELL_FILES[@]}"; do
  bash -n "$file"
  printf 'syntax ok: %s\n' "$file"
done

printf '==> Running shellcheck when available\n'
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -S warning "${OPS_SHELL_FILES[@]}"
else
  printf 'shellcheck not found; skipped optional shellcheck gate. bash -n remains blocking.\n'
fi

printf '==> Checking ops script help output\n'
for script in "${OPS_ENTRYPOINTS[@]}"; do
  "$script" --help >/dev/null
  printf 'help ok: %s\n' "$script"
done

printf '==> Checking destructive or secret-exposing command guard\n'
if grep -RInE '(rm[[:space:]].*(-r|-f|-rf|-fr)|git[[:space:]]+reset[[:space:]].*--hard|git[[:space:]]+clean[[:space:]].*(-f|-d)|podman[[:space:]]+volume[[:space:]]+rm|gcloud[[:space:]]+secrets[[:space:]]+versions[[:space:]]+access|gcloud[[:space:]]+secrets[[:space:]]+delete|gcloud[[:space:]]+projects[[:space:]]+delete|sudo[[:space:]]+(rm|shutdown|reboot))' scripts/ops; then
  printf 'Potentially destructive or secret-exposing command found in scripts/ops. Add an explicit reviewed guard before allowing it.\n' >&2
  exit 1
fi
printf 'destructive or secret-exposing command guard ok\n'

require_env_key() {
  local file="$1"
  local key="$2"
  if ! grep -Eq "^${key}=" "$file"; then
    printf 'missing required sample env key: %s in %s\n' "$key" "$file" >&2
    return 1
  fi
  local value
  value="$(awk -F= -v key="$key" '$1 == key {print substr($0, index($0, "=") + 1); exit}' "$file")"
  if [[ -z "${value// }" ]]; then
    printf 'empty required sample env key: %s in %s\n' "$key" "$file" >&2
    return 1
  fi
}

printf '==> Checking sample env keys and secret-like values\n'
gcp_env="docs/ops/examples/gcp-preflight.env.example"
vps_env="docs/ops/examples/vps-ops.env.example"
for key in \
  GCP_PROJECT_ID \
  GCP_WIF_POOL \
  GCP_WIF_PROVIDER \
  GCP_WIF_LOCATION \
  GCP_WIF_SERVICE_ACCOUNT \
  GCP_SECRET_GOOGLE_OIDC_CLIENT_SECRET \
  GCP_SECRET_CHAT_GDRIVE_CLIENT_SECRET \
  GCP_SECRET_CHAT_GDRIVE_REFRESH_TOKEN; do
  require_env_key "$gcp_env" "$key"
done
for key in \
  ERP4_DEPLOY_USER \
  ERP4_REPO_PARENT \
  ERP4_REPO_DIR \
  ERP4_GIT_REMOTE \
  ERP4_GIT_BRANCH \
  QUADLET_TARGET_DIR \
  FRONTEND_BUILD_ENV_FILE \
  BACKEND_HEALTH_URL \
  BACKEND_READY_URL \
  FRONTEND_URL; do
  require_env_key "$vps_env" "$key"
done

private_key_pattern='-----''BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|-----''BEGIN PRIVATE KEY-----|-----''BEGIN PGP PRIVATE KEY BLOCK-----'
secret_pattern="(${private_key_pattern}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{80,}|xox[baprs]-[A-Za-z0-9-]{10,}|https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}|ya29\.[0-9A-Za-z._-]{20,})"
secret_matches="$SMOKE_DIR/secret-like-matches.txt"
if grep -RInE "$secret_pattern" docs/ops/examples/*.env.example > "$secret_matches"; then
  printf 'Sample env file contains a value that looks like a real secret. Locations only are shown to avoid reprinting the value.\n' >&2
  awk -F: 'NF >= 2 { print $1 ":" $2 }' "$secret_matches" >&2
  printf 'Replace the value with a placeholder or secret resource name.\n' >&2
  exit 1
fi
printf 'sample env checks ok\n'

run_smoke() {
  local label="$1"
  shift
  printf 'smoke: %s\n' "$label"
  "$@"
}

run_controlled_check() {
  local label="$1"
  local expected_pattern="$2"
  shift 2
  local required_pattern=""
  if [[ "${1:-}" == "--require" ]]; then
    required_pattern="$2"
    shift 2
  fi
  local output status
  printf 'controlled check: %s\n' "$label"
  set +e
  output="$({ "$@"; } 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    return 0
  fi
  if [[ -n "$required_pattern" ]] && ! grep -Eq "$required_pattern" <<<"$output"; then
    printf 'unexpected failure in %s: required diagnostic was not found: %s\n' "$label" "$required_pattern" >&2
    return "$status"
  fi
  if grep -Eq "$expected_pattern" <<<"$output"; then
    printf 'controlled non-zero exit accepted for environment-dependent check: %s\n' "$label"
    return 0
  fi
  printf 'unexpected failure in %s (exit %s)\n' "$label" "$status" >&2
  return "$status"
}

gdrive_env="$SMOKE_DIR/gdrive-ci.env"
cat > "$gdrive_env" <<'ENV'
CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=placeholder-client-id
CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET=placeholder-client-secret
CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN=placeholder-refresh-token
CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=placeholder-folder-id
ENV
chmod 600 "$gdrive_env"

mkdir -p "$SMOKE_DIR/quadlet"
cp deploy/quadlet/env/erp4-postgres.env.example "$SMOKE_DIR/quadlet/erp4-postgres.env"
cp deploy/quadlet/env/erp4-backend.env.example "$SMOKE_DIR/quadlet/erp4-backend.env"
cp deploy/quadlet/env/erp4-frontend-build.env.example "$SMOKE_DIR/frontend-build.env"
chmod 600 "$SMOKE_DIR/quadlet/erp4-postgres.env" "$SMOKE_DIR/quadlet/erp4-backend.env" "$SMOKE_DIR/frontend-build.env"

run_controlled_check 'gcp-preflight missing-gcloud or unauthenticated safe check' '(gcloud is not installed|Summary: failures=[1-9][0-9]*)' \
  scripts/ops/gcp-preflight.sh --check --project erp4-ci-smoke --allow-missing-gcloud --markdown-summary "$SMOKE_DIR/gcp-preflight.md"
run_smoke 'gcp-drive dry-run with placeholder env' \
  scripts/ops/gcp-drive-check.sh --dry-run --env-file "$gdrive_env" --mode read --markdown-summary "$SMOKE_DIR/gdrive.md"
run_smoke 'sakura bootstrap dry-run' \
  scripts/ops/sakura-vps-bootstrap.sh --dry-run --deploy-user deploy --repo-parent "$SMOKE_DIR/repo-parent" --repo-dir "$SMOKE_DIR/repo-parent/ITDO_ERP4" --skip-apt --skip-linger
run_smoke 'sakura deploy dry-run with all mutating phases skipped' \
  scripts/ops/sakura-vps-deploy.sh --dry-run --repo-dir "$ROOT_DIR" --target-dir "$SMOKE_DIR/quadlet" --frontend-build-env "$SMOKE_DIR/frontend-build.env" --skip-git-update --skip-npm-ci --skip-build-images --skip-start
run_controlled_check 'sakura preflight check' 'Summary: failures=[1-9][0-9]*' \
  scripts/ops/sakura-vps-preflight.sh --check --repo-dir "$ROOT_DIR" --min-memory-mb 1 --min-disk-mb 1 --port 1
run_controlled_check 'sakura verify check without live stack' '(failed to connect to systemd user bus|http[[:space:]]+backend health[[:space:]]+failed|db[[:space:]]+postgres ready[[:space:]]+failed|verification failed: [1-9][0-9]* step\(s\))' --require 'OK: Quadlet env validation passed' \
  env TIMEOUT_SECONDS=1 INTERVAL_SECONDS=1 BACKEND_HEALTH_URL=http://127.0.0.1:1/healthz BACKEND_READY_URL=http://127.0.0.1:1/readyz FRONTEND_URL=http://127.0.0.1:1/ \
  scripts/ops/sakura-vps-verify.sh --check --target-dir "$SMOKE_DIR/quadlet" --frontend-build-env "$SMOKE_DIR/frontend-build.env" --markdown-summary "$SMOKE_DIR/verify.md"

printf 'Ops script checks completed.\n'
