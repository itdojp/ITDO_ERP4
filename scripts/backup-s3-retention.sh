#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S3_PROVIDER="${S3_PROVIDER:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-erp4/prod}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
S3_REGION="${S3_REGION:-}"
MODE="dry-run"
MODE_EXPLICIT=""
PLAN_JSON=""
PLAN_MARKDOWN=""
RESULT_JSON=""

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") --dry-run --plan-json NEW_FILE --plan-markdown NEW_FILE
  PRUNE_CONFIRM=1 RETENTION_PLAN_SHA256=... $(basename "$0") --apply \
    --plan-json REVIEWED_FILE --result-json NEW_FILE

Dry-run generates a reviewable retention plan. Apply is a separate invocation and
requires an unchanged remote inventory, the reviewed plan SHA-256, and explicit
confirmation. Apply never deletes old object versions; provider version retention is
an operator-evidence control.

Required env:
  S3_PROVIDER=aws|sakura, S3_BUCKET
  RETENTION_MIN_HOURLY, RETENTION_MIN_DAILY,
  RETENTION_MIN_WEEKLY, RETENTION_MIN_MONTHLY

Sakura additionally requires S3_ENDPOINT_URL=https://...
USAGE
}

die() {
  printf '[backup-retention][error] %s\n' "$*" >&2
  exit 1
}

validate_prefix() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ ]] || die 'S3_PREFIX is invalid'
  [[ "/$value/" != *'/../'* && "/$value/" != *'/./'* && "$value" != *'//'* ]] || die 'S3_PREFIX contains an unsafe path segment'
}

validate_private_file() {
  local file="$1"
  [[ -f "$file" && ! -L "$file" ]] || die 'reviewed plan must be a regular non-symlink file'
  local mode owner
  mode=$(stat -c '%a' "$file")
  owner=$(stat -c '%u' "$file")
  (( (8#$mode & 8#077) == 0 )) || die 'reviewed plan must use mode 600 or stricter'
  [[ "$owner" == "$(id -u)" ]] || die 'reviewed plan must be owned by the current user'
}

normalize_private_path() {
  local label="$1" value="$2" normalized
  normalized=$(realpath -m -- "$value")
  if [[ "$normalized" == "$ROOT_DIR/docs" || "$normalized" == "$ROOT_DIR/docs/"* ]]; then
    die "$label must stay outside docs/ because it contains target-specific inventory metadata"
  fi
  printf '%s\n' "$normalized"
}

write_result() {
  local status="$1" attempted="$2" deleted="$3" plan_sha="$4"
  RESULT_STATUS="$status" RESULT_ATTEMPTED="$attempted" RESULT_DELETED="$deleted" RESULT_PLAN_SHA="$plan_sha" \
    node - "$RESULT_JSON" <<'NODE'
const { writeFileSync } = require('node:fs');
writeFileSync(
  process.argv[2],
  `${JSON.stringify({
    schemaVersion: 'erp4.backup.retention-result.v1',
    status: process.env.RESULT_STATUS,
    attemptedObjects: Number(process.env.RESULT_ATTEMPTED),
    deletedObjects: Number(process.env.RESULT_DELETED),
    planSha256: process.env.RESULT_PLAN_SHA,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`,
  { flag: 'wx', mode: 0o600 },
);
NODE
}

aws_args=()
aws_cli() {
  aws "${aws_args[@]}" "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) [[ -z "$MODE_EXPLICIT" ]] || die 'choose exactly one of --dry-run or --apply'; MODE="dry-run"; MODE_EXPLICIT=1; shift ;;
    --apply) [[ -z "$MODE_EXPLICIT" ]] || die 'choose exactly one of --dry-run or --apply'; MODE="apply"; MODE_EXPLICIT=1; shift ;;
    --plan-json) [[ -n "${2:-}" ]] || die '--plan-json requires a value'; PLAN_JSON="$2"; shift 2 ;;
    --plan-markdown) [[ -n "${2:-}" ]] || die '--plan-markdown requires a value'; PLAN_MARKDOWN="$2"; shift 2 ;;
    --result-json) [[ -n "${2:-}" ]] || die '--result-json requires a value'; RESULT_JSON="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$S3_PROVIDER" in aws|sakura) ;; *) die 'S3_PROVIDER must be explicitly set to aws or sakura' ;; esac
if [[ "$S3_PROVIDER" == "sakura" ]]; then
  [[ "$S3_ENDPOINT_URL" =~ ^https://([A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(:[0-9]{1,5})?/?$ ]] || die 'S3_ENDPOINT_URL must be a credential-free HTTPS origin for Sakura'
fi
[[ -n "$S3_BUCKET" ]] || die 'S3_BUCKET is required'
[[ -n "$PLAN_JSON" ]] || die '--plan-json is required'
command -v realpath >/dev/null 2>&1 || die 'missing command: realpath'
PLAN_JSON="$(normalize_private_path PLAN_JSON "$PLAN_JSON")"
validate_prefix "$S3_PREFIX"
for name in RETENTION_MIN_HOURLY RETENTION_MIN_DAILY RETENTION_MIN_WEEKLY RETENTION_MIN_MONTHLY; do
  [[ "${!name:-}" =~ ^[1-9][0-9]*$ ]] || die "$name must be explicitly set to a positive integer"
done
command -v aws >/dev/null 2>&1 || die 'missing command: aws'
command -v node >/dev/null 2>&1 || die 'missing command: node'
command -v sha256sum >/dev/null 2>&1 || die 'missing command: sha256sum'

[[ -n "$S3_ENDPOINT_URL" ]] && aws_args+=(--endpoint-url "$S3_ENDPOINT_URL")
[[ -n "$S3_REGION" ]] && aws_args+=(--region "$S3_REGION")

scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
mkdir -p "$scratch_root"
chmod 700 "$scratch_root"
inventory="$(mktemp "$scratch_root/backup-retention-inventory.XXXXXX.json")"
delete_list=""
plan_snapshot=""
cleanup() {
  rm -f -- "$inventory"
  [[ -z "$delete_list" ]] || rm -f -- "$delete_list"
  [[ -z "$plan_snapshot" ]] || rm -f -- "$plan_snapshot"
}
trap cleanup EXIT
if ! aws_cli s3api list-objects-v2 \
  --bucket "$S3_BUCKET" --prefix "${S3_PREFIX%/}/" --output json >"$inventory" 2>/dev/null; then
  die 'remote retention inventory could not be read; inspect the private provider log'
fi
chmod 600 "$inventory"
target_fingerprint=$(printf '%s\0%s\0%s\0%s' "$S3_PROVIDER" "$S3_ENDPOINT_URL" "$S3_REGION" "$S3_BUCKET" | sha256sum | awk '{print $1}')

if [[ "$MODE" == "dry-run" ]]; then
  [[ -n "$PLAN_MARKDOWN" ]] || die '--plan-markdown is required for dry-run'
  PLAN_MARKDOWN="$(normalize_private_path PLAN_MARKDOWN "$PLAN_MARKDOWN")"
  [[ ! -e "$PLAN_JSON" && ! -e "$PLAN_MARKDOWN" ]] || die 'plan output files must not already exist'
  node_args=(
    "$ROOT_DIR/scripts/backup-s3-retention.mjs"
    --inventory "$inventory"
    --prefix "$S3_PREFIX"
    --provider "$S3_PROVIDER"
    --target-fingerprint "$target_fingerprint"
    --json-out "$PLAN_JSON"
    --markdown-out "$PLAN_MARKDOWN"
    --min-hourly "$RETENTION_MIN_HOURLY"
    --min-daily "$RETENTION_MIN_DAILY"
    --min-weekly "$RETENTION_MIN_WEEKLY"
    --min-monthly "$RETENTION_MIN_MONTHLY"
  )
  [[ -n "${RETENTION_NOW:-}" ]] && node_args+=(--now "$RETENTION_NOW")
  node "${node_args[@]}"
  printf '[backup-retention] mode: dry-run\n'
  printf '[backup-retention] review plan sha256: %s\n' "$(sha256sum "$PLAN_JSON" | awk '{print $1}')"
  exit 0
fi

[[ -n "$RESULT_JSON" ]] || die '--result-json must name a new file with --apply'
RESULT_JSON="$(normalize_private_path RESULT_JSON "$RESULT_JSON")"
[[ ! -e "$RESULT_JSON" ]] || die '--result-json must name a new file with --apply'
[[ "${PRUNE_CONFIRM:-}" == "1" ]] || die 'PRUNE_CONFIRM=1 is required with --apply'
[[ "${RETENTION_EXCLUSIVE_LOCK_CONFIRM:-}" == "1" ]] || die 'RETENTION_EXCLUSIVE_LOCK_CONFIRM=1 is required with --apply'
[[ "${RETENTION_PLAN_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || die 'RETENTION_PLAN_SHA256 is required with --apply'
validate_private_file "$PLAN_JSON"
plan_snapshot=$(mktemp "$scratch_root/backup-retention-plan-snapshot.XXXXXX.json")
cat -- "$PLAN_JSON" >"$plan_snapshot"
chmod 400 "$plan_snapshot"
actual_plan_sha=$(sha256sum "$plan_snapshot" | awk '{print $1}')
[[ "$actual_plan_sha" == "$RETENTION_PLAN_SHA256" ]] || die 'reviewed plan SHA-256 does not match'

current_inventory_sha=$(sha256sum "$inventory" | awk '{print $1}')
delete_list=$(mktemp "$scratch_root/backup-retention-delete-list.XXXXXX")
chmod 600 "$delete_list"
if ! PLAN_PREFIX="$S3_PREFIX" \
  PLAN_PROVIDER="$S3_PROVIDER" \
  PLAN_TARGET_FINGERPRINT="$target_fingerprint" \
  PLAN_INVENTORY_SHA="$current_inventory_sha" \
  PLAN_MIN_HOURLY="$RETENTION_MIN_HOURLY" \
  PLAN_MIN_DAILY="$RETENTION_MIN_DAILY" \
  PLAN_MIN_WEEKLY="$RETENTION_MIN_WEEKLY" \
  PLAN_MIN_MONTHLY="$RETENTION_MIN_MONTHLY" \
  node - "$plan_snapshot" "$inventory" >"$delete_list" <<'NODE'
const { readFileSync } = require('node:fs');
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const inventory = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const types = new Set(['assets', 'database', 'globals', 'metadata']);
const classes = ['hourly', 'daily', 'weekly', 'monthly'];
const fail = (message) => { throw new Error(message); };
if (plan.schemaVersion !== 'erp4.backup.retention-plan.v1') fail('plan_schema_invalid');
if (plan.applyAllowed !== true) fail('plan_apply_not_allowed');
if (plan.prefix !== process.env.PLAN_PREFIX) fail('plan_prefix_mismatch');
if (plan.provider !== process.env.PLAN_PROVIDER) fail('plan_provider_mismatch');
if (plan.targetFingerprint !== process.env.PLAN_TARGET_FINGERPRINT) fail('plan_target_mismatch');
if (plan.inventorySha256 !== process.env.PLAN_INVENTORY_SHA) fail('inventory_changed');
for (const name of classes) {
  if (plan.minimums?.[name] !== Number(process.env[`PLAN_MIN_${name.toUpperCase()}`])) {
    fail('plan_minimum_mismatch');
  }
}
if (!Array.isArray(plan.deleteBundles) || !Array.isArray(plan.deleteKeys)) fail('plan_delete_set_invalid');
if (new Set(plan.deleteBundles).size !== plan.deleteBundles.length || new Set(plan.deleteKeys).size !== plan.deleteKeys.length) fail('plan_duplicate_delete_entry');
const bundles = new Set(plan.deleteBundles);
for (const bundle of bundles) {
  const segments = bundle.split('/');
  if (segments.length < 3 || !classes.includes(segments[0]) || segments.some((part) => !safeSegment.test(part))) fail('plan_bundle_invalid');
}
const inventoryKeys = new Set();
const bundleByKey = new Map();
for (const item of inventory.Contents ?? []) {
  if (typeof item?.Key !== 'string' || inventoryKeys.has(item.Key)) fail('inventory_key_invalid');
  inventoryKeys.add(item.Key);
  if (!item.Key.startsWith(`${plan.prefix}/`)) continue;
  const relative = item.Key.slice(plan.prefix.length + 1);
  const segments = relative.split('/');
  const typeIndex = segments.length - 2;
  if (typeIndex < 2 || !types.has(segments[typeIndex]) || segments.some((part) => !safeSegment.test(part))) continue;
  bundleByKey.set(item.Key, segments.slice(0, typeIndex).join('/'));
}
const expectedKeys = [...bundleByKey]
  .filter(([, bundle]) => bundles.has(bundle))
  .map(([key]) => key)
  .sort();
const actualKeys = [...plan.deleteKeys].sort();
if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) fail('plan_delete_set_mismatch');
for (const key of actualKeys) {
  if (!inventoryKeys.has(key) || !bundles.has(bundleByKey.get(key))) fail('plan_delete_key_invalid');
}
for (const key of actualKeys.sort((a, b) => Number(!a.endsWith('.manifest.json')) - Number(!b.endsWith('.manifest.json')) || a.localeCompare(b))) {
  console.log(key);
}
NODE
then
  die 'reviewed plan validation failed or remote inventory changed; generate a new dry-run plan'
fi
mapfile -t delete_keys <"$delete_list"
deleted=0
for key in "${delete_keys[@]}"; do
  if ! aws_cli s3api delete-object --bucket "$S3_BUCKET" --key "$key" >/dev/null 2>&1; then
    write_result partial "${#delete_keys[@]}" "$deleted" "$actual_plan_sha"
    die 'retention apply stopped after a partial delete; inspect the protected result file'
  fi
  deleted=$((deleted + 1))
done
write_result complete "${#delete_keys[@]}" "$deleted" "$actual_plan_sha"
printf '[backup-retention] deleted objects: %s\n' "$deleted"
