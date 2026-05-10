#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="check"
PROJECT="${GCP_PROJECT_ID:-}"
CONFIRM_PROJECT=""
BILLING_REQUIRED=0
ALLOW_MISSING_GCLOUD=0
MARKDOWN_SUMMARY=""
WIF_POOL=""
WIF_PROVIDER=""
WIF_LOCATION="global"
WIF_SERVICE_ACCOUNT=""
REQUIRED_APIS=(drive.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com serviceusage.googleapis.com)
SECRET_NAMES=()
SUMMARY_LINES=()
WARNINGS=0
FAILURES=0
MISSING_APIS=()

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--check | --apply] --project PROJECT [options]

Google Cloud preflight for ERP4 Sakura VPS deployments. --check is read-only.
--apply only enables missing APIs and requires --confirm-project PROJECT.
Secret values are never read or printed.

Options:
  --check                         Read-only preflight (default)
  --apply                         Enable missing required APIs only
  --project PROJECT               Google Cloud project id
  --confirm-project PROJECT       Required with --apply; must match --project
  --api SERVICE                   Add required API service name; can be repeated
  --secret NAME                   Check Secret Manager secret metadata; can be repeated
  --billing-required              Fail when billing is not enabled or cannot be confirmed
  --wif-pool POOL                 Workload Identity Pool id to check
  --wif-provider PROVIDER         Workload Identity Provider id to check with --wif-pool
  --wif-location LOCATION         WIF location (default: global)
  --wif-service-account EMAIL     Service account used by WIF/GitHub Actions
  --allow-missing-gcloud          Return success with skip summary when gcloud is missing
  --markdown-summary FILE         Write secret-free Markdown summary
  -h, --help                      Show this help message
USAGE
}

add_summary() {
  SUMMARY_LINES+=("$1")
}

ok() {
  printf 'OK: %s\n' "$*"
  add_summary "- ✅ $*"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARN: %s\n' "$*" >&2
  add_summary "- ⚠️ $*"
}

fail_item() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL: %s\n' "$*" >&2
  add_summary "- ❌ $*"
}

write_summary() {
  [[ -n "$MARKDOWN_SUMMARY" ]] || return 0
  {
    printf '# ERP4 Google Cloud preflight\n\n'
    printf -- '- Date: `%s`\n' "$(ops_timestamp)"
    printf -- '- Project: `%s`\n' "${PROJECT:-unknown}"
    printf -- '- Mode: `%s`\n\n' "$MODE"
    printf '## Results\n\n'
    printf '%s\n' "${SUMMARY_LINES[@]}"
  } > "$MARKDOWN_SUMMARY"
}

require_gcloud() {
  if ops_command_exists gcloud; then
    return 0
  fi
  if [[ "$ALLOW_MISSING_GCLOUD" -eq 1 ]]; then
    warn 'gcloud is not installed; skipped Google Cloud checks by explicit --allow-missing-gcloud'
    write_summary
    exit 0
  fi
  ops_fail 'gcloud is required; install Google Cloud CLI or use --allow-missing-gcloud only for local syntax/CI smoke checks'
}

resolve_project() {
  local active_project
  active_project="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
    PROJECT="$active_project"
  fi
  [[ -n "$PROJECT" && "$PROJECT" != "(unset)" ]] || ops_fail '--project is required when no active gcloud project is set'
  if [[ -n "$active_project" && "$active_project" != "(unset)" && "$active_project" != "$PROJECT" ]]; then
    warn "active gcloud project ($active_project) differs from requested project ($PROJECT)"
  else
    ok "gcloud project confirmed: $PROJECT"
  fi
}

check_account() {
  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1 || true)"
  if [[ -z "$account" ]]; then
    fail_item 'no active gcloud account; run gcloud auth login or configure workload identity'
  else
    ok "active gcloud account: $account"
  fi
}

check_billing() {
  local billing
  billing="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)"
  if [[ "$billing" == "True" || "$billing" == "true" ]]; then
    ok 'billing enabled'
  elif [[ "$BILLING_REQUIRED" -eq 1 ]]; then
    fail_item 'billing is not enabled or cannot be confirmed'
  else
    warn 'billing is not enabled or cannot be confirmed; confirm manually if paid APIs are required'
  fi
}

load_enabled_apis() {
  gcloud services list --enabled --project "$PROJECT" --format='value(config.name)' 2>/dev/null || true
}

check_apis() {
  local enabled api found
  enabled="$(load_enabled_apis)"
  for api in "${REQUIRED_APIS[@]}"; do
    found=0
    if grep -Fxq "$api" <<<"$enabled"; then
      found=1
    fi
    if [[ "$found" -eq 1 ]]; then
      ok "API enabled: $api"
    else
      MISSING_APIS+=("$api")
      if [[ "$MODE" == "apply" ]]; then
        warn "API will be enabled by --apply: $api"
      else
        fail_item "API not enabled: $api"
      fi
    fi
  done
}

apply_missing_apis() {
  if [[ "${#MISSING_APIS[@]}" -eq 0 ]]; then
    return 0
  fi
  [[ "$MODE" == "apply" ]] || return 0
  [[ -n "$CONFIRM_PROJECT" && "$CONFIRM_PROJECT" == "$PROJECT" ]] || ops_fail '--apply requires --confirm-project matching --project'
  ops_run apply gcloud services enable --project "$PROJECT" "${MISSING_APIS[@]}"
  MISSING_APIS=()
  SUMMARY_LINES+=("- ✅ enabled missing APIs with explicit --apply for project $PROJECT")
  check_apis
}

check_secret() {
  local name="$1" states
  if gcloud secrets describe "$name" --project "$PROJECT" --format='value(name)' >/dev/null 2>&1; then
    ok "secret exists: $name"
    states="$(gcloud secrets versions list "$name" --project "$PROJECT" --format='value(name,state)' 2>/dev/null | tr '\n' ';' || true)"
    if [[ -n "$states" ]]; then
      ok "secret versions metadata available: $name"
    else
      warn "secret has no visible versions or versions cannot be listed: $name"
    fi
  else
    fail_item "secret not found or not accessible: $name"
  fi
}

check_wif() {
  if [[ -n "$WIF_SERVICE_ACCOUNT" ]]; then
    if gcloud iam service-accounts describe "$WIF_SERVICE_ACCOUNT" --project "$PROJECT" --format='value(email)' >/dev/null 2>&1; then
      ok "WIF service account exists: $WIF_SERVICE_ACCOUNT"
    else
      fail_item "WIF service account not found or not accessible: $WIF_SERVICE_ACCOUNT"
    fi
  fi
  if [[ -n "$WIF_POOL" || -n "$WIF_PROVIDER" ]]; then
    [[ -n "$WIF_POOL" && -n "$WIF_PROVIDER" ]] || ops_fail '--wif-pool and --wif-provider must be provided together'
    if gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" --project "$PROJECT" --location "$WIF_LOCATION" --workload-identity-pool "$WIF_POOL" --format='value(name)' >/dev/null 2>&1; then
      ok "WIF provider exists: pool=$WIF_POOL provider=$WIF_PROVIDER location=$WIF_LOCATION"
    else
      fail_item "WIF provider not found or not accessible: pool=$WIF_POOL provider=$WIF_PROVIDER location=$WIF_LOCATION"
    fi
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --project)
      ops_require_arg "$1" "${2:-}"
      PROJECT="$2"
      shift 2
      ;;
    --confirm-project)
      ops_require_arg "$1" "${2:-}"
      CONFIRM_PROJECT="$2"
      shift 2
      ;;
    --api)
      ops_require_arg "$1" "${2:-}"
      REQUIRED_APIS+=("$2")
      shift 2
      ;;
    --secret)
      ops_require_arg "$1" "${2:-}"
      SECRET_NAMES+=("$2")
      shift 2
      ;;
    --billing-required)
      BILLING_REQUIRED=1
      shift
      ;;
    --wif-pool)
      ops_require_arg "$1" "${2:-}"
      WIF_POOL="$2"
      shift 2
      ;;
    --wif-provider)
      ops_require_arg "$1" "${2:-}"
      WIF_PROVIDER="$2"
      shift 2
      ;;
    --wif-location)
      ops_require_arg "$1" "${2:-}"
      WIF_LOCATION="$2"
      shift 2
      ;;
    --wif-service-account)
      ops_require_arg "$1" "${2:-}"
      WIF_SERVICE_ACCOUNT="$2"
      shift 2
      ;;
    --allow-missing-gcloud)
      ALLOW_MISSING_GCLOUD=1
      shift
      ;;
    --markdown-summary)
      ops_require_arg "$1" "${2:-}"
      MARKDOWN_SUMMARY="$2"
      shift 2
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

require_gcloud
resolve_project
check_account
check_billing
check_apis
apply_missing_apis
for secret in "${SECRET_NAMES[@]}"; do
  check_secret "$secret"
done
check_wif
write_summary
printf 'Summary: failures=%s warnings=%s missingApis=%s\n' "$FAILURES" "$WARNINGS" "${#MISSING_APIS[@]}"
if (( FAILURES > 0 )); then
  exit 1
fi
