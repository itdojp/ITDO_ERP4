#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="check"
REPO_DIR="${ERP4_REPO_DIR:-$ROOT_DIR}"
REMOTE="${ERP4_GIT_REMOTE:-origin}"
BRANCH="${ERP4_GIT_BRANCH:-main}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
FRONTEND_BUILD_ENV="${FRONTEND_BUILD_ENV_FILE:-$REPO_DIR/deploy/quadlet/env/erp4-frontend-build.env}"
INCLUDE_PROXY=0
SKIP_NPM_CI=0
SKIP_BUILD_IMAGES=0
SKIP_START=0
SKIP_GIT_UPDATE=0
UPDATE_EXISTING=0
PROFILE="${SAKURA_VPS_PROFILE:-production}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--check | --dry-run | --apply] [options]

Deploy/update helper for ERP4 on Sakura VPS. --check validates prerequisites only.
--dry-run prints commands. --apply performs git update, dependency install, image build,
Quadlet install, and stack start/update unless skipped.

Options:
  --check                         Validate repo/env without changing state (default)
  --dry-run                       Print commands that would be executed
  --apply                         Execute deployment steps
  --repo-dir DIR                  Repository directory (default: $REPO_DIR)
  --remote NAME                   Git remote (default: $REMOTE)
  --branch NAME                   Git branch (default: $BRANCH)
  --target-dir DIR                Quadlet target directory (default: $TARGET_DIR)
  --frontend-build-env FILE       Frontend build env file
  --profile NAME                  Use production, private-smoke, or https-trial
  --include-proxy                 Include Caddy/proxy validation and start/update
  --update-existing               Use scripts/quadlet/update-stack.sh instead of start-stack.sh
  --skip-git-update               Do not run git fetch/checkout/pull
  --skip-npm-ci                   Do not run npm ci for backend/frontend
  --skip-build-images             Do not build Podman images
  --skip-start                    Do not install/start/update Quadlet units
  -h, --help                      Show this help message
USAGE
}

check_no_placeholders() {
  local file="$1"
  [[ -f "$file" ]] || ops_fail "required file not found: $file"
  if grep -Eq 'REPLACE_ME|REPLACE_WITH|YOUR_|example\.com' "$file"; then
    ops_fail "$file still contains placeholder values"
  fi
  ops_check_private_file_mode "$file" || true
}

run_check() {
  printf '# ERP4 Sakura VPS deploy check (%s)\n' "$(ops_timestamp)"
  git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || ops_fail "repo-dir is not a git checkout: $REPO_DIR"
  ops_info "repo HEAD: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
  git -C "$REPO_DIR" status --short --branch

  check_no_placeholders "$FRONTEND_BUILD_ENV"
  check_no_placeholders "$TARGET_DIR/erp4-postgres.env"
  check_no_placeholders "$TARGET_DIR/erp4-backend.env"
  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    check_no_placeholders "$TARGET_DIR/erp4-caddy.env"
    [[ -f "$TARGET_DIR/erp4-caddy.Caddyfile" ]] || ops_fail "required file not found: $TARGET_DIR/erp4-caddy.Caddyfile"
  fi
  if [[ -f "$TARGET_DIR/erp4-maintenance.env" ]]; then
    check_no_placeholders "$TARGET_DIR/erp4-maintenance.env"
  else
    ops_warn "maintenance env not found yet: $TARGET_DIR/erp4-maintenance.env"
  fi

  "$REPO_DIR/scripts/quadlet/check-env.sh" --profile "$PROFILE" --target-dir "$TARGET_DIR" --frontend-build-env "$FRONTEND_BUILD_ENV"
  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    "$REPO_DIR/scripts/quadlet/check-proxy.sh" --target-dir "$TARGET_DIR"
    "$REPO_DIR/scripts/quadlet/check-host-prereqs.sh"
  fi
}

run_deploy() {
  if [[ "$SKIP_GIT_UPDATE" -eq 0 ]]; then
    ops_run "$MODE" git -C "$REPO_DIR" fetch "$REMOTE" "$BRANCH"
    ops_run "$MODE" git -C "$REPO_DIR" checkout "$BRANCH"
    ops_run "$MODE" git -C "$REPO_DIR" pull --ff-only "$REMOTE" "$BRANCH"
  fi

  if [[ "$SKIP_NPM_CI" -eq 0 ]]; then
    ops_run "$MODE" npm ci --prefix "$REPO_DIR/packages/backend"
    ops_run "$MODE" npm ci --prefix "$REPO_DIR/packages/frontend"
  fi

  ops_run "$MODE" env QUADLET_TARGET_DIR="$TARGET_DIR" "$REPO_DIR/scripts/quadlet/check-env.sh" --profile "$PROFILE" --target-dir "$TARGET_DIR" --skip-runtime --frontend-build-env "$FRONTEND_BUILD_ENV"
  if [[ "$SKIP_BUILD_IMAGES" -eq 0 ]]; then
    ops_run "$MODE" env FRONTEND_BUILD_ENV_FILE="$FRONTEND_BUILD_ENV" "$REPO_DIR/scripts/quadlet/build-images.sh"
  fi

  if [[ "$SKIP_START" -eq 0 ]]; then
    local stack_cmd
    if [[ "$UPDATE_EXISTING" -eq 1 ]]; then
      stack_cmd="$REPO_DIR/scripts/quadlet/update-stack.sh"
      if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
        ops_run "$MODE" env QUADLET_TARGET_DIR="$TARGET_DIR" "$stack_cmd" --profile "$PROFILE" --include-proxy --skip-build
      else
        ops_run "$MODE" env QUADLET_TARGET_DIR="$TARGET_DIR" "$stack_cmd" --profile "$PROFILE" --skip-build
      fi
    else
      stack_cmd="$REPO_DIR/scripts/quadlet/start-stack.sh"
      ops_run "$MODE" env QUADLET_TARGET_DIR="$TARGET_DIR" "$REPO_DIR/scripts/quadlet/install-user-units.sh" --profile "$PROFILE"
      if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
        ops_run "$MODE" env QUADLET_TARGET_DIR="$TARGET_DIR" "$stack_cmd" --profile "$PROFILE" --include-proxy
      else
        ops_run "$MODE" env QUADLET_TARGET_DIR="$TARGET_DIR" "$stack_cmd" --profile "$PROFILE"
      fi
    fi
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --repo-dir)
      ops_require_arg "$1" "${2:-}"
      REPO_DIR="$2"
      FRONTEND_BUILD_ENV="${FRONTEND_BUILD_ENV_FILE:-$REPO_DIR/deploy/quadlet/env/erp4-frontend-build.env}"
      shift 2
      ;;
    --remote)
      ops_require_arg "$1" "${2:-}"
      REMOTE="$2"
      shift 2
      ;;
    --branch)
      ops_require_arg "$1" "${2:-}"
      BRANCH="$2"
      shift 2
      ;;
    --target-dir)
      ops_require_arg "$1" "${2:-}"
      TARGET_DIR="$2"
      shift 2
      ;;
    --frontend-build-env)
      ops_require_arg "$1" "${2:-}"
      FRONTEND_BUILD_ENV="$2"
      shift 2
      ;;
    --profile)
      ops_require_arg "$1" "${2:-}"
      PROFILE="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --update-existing)
      UPDATE_EXISTING=1
      shift
      ;;
    --skip-git-update)
      SKIP_GIT_UPDATE=1
      shift
      ;;
    --skip-npm-ci)
      SKIP_NPM_CI=1
      shift
      ;;
    --skip-build-images)
      SKIP_BUILD_IMAGES=1
      shift
      ;;
    --skip-start)
      SKIP_START=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ops_fail "unknown argument: $1"
      ;;
  esac
done

case "$PROFILE" in
  production|private-smoke|https-trial) ;;
  *) ops_fail "unknown profile: $PROFILE" ;;
esac
if [[ "$PROFILE" == "private-smoke" && "$INCLUDE_PROXY" -eq 1 ]]; then
  ops_fail 'private-smoke must not include proxy'
fi
if [[ "$PROFILE" == "https-trial" && "$INCLUDE_PROXY" -eq 0 ]]; then
  ops_fail 'https-trial requires --include-proxy'
fi

case "$MODE" in
  check)
    run_check
    ;;
  dry-run|apply)
    run_deploy
    ;;
  *)
    ops_fail "unknown mode: $MODE"
    ;;
esac
