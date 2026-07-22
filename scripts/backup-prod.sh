#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/tmp/erp4-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-erp4}"
BACKUP_TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%d-%H%M%S)}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
S3_PREFIX="${S3_PREFIX:-erp4/${ENVIRONMENT}}"
S3_PROVIDER="${S3_PROVIDER:-}"
BACKUP_RETENTION_CLASS="${BACKUP_RETENTION_CLASS:-daily}"
BACKUP_SECONDARY_PROVIDER="${BACKUP_SECONDARY_PROVIDER:-none}"
BACKUP_GDRIVE_CLI="${BACKUP_GDRIVE_CLI:-$ROOT_DIR/scripts/backup-gdrive-secondary.sh}"
COMMIT_SHA="${COMMIT_SHA:-$(git -C "$ROOT_DIR" rev-parse --verify HEAD 2>/dev/null || printf unknown)}"
S3_VERIFY_DOWNLOAD="${S3_VERIFY_DOWNLOAD:-0}"
DB_PORT="${DB_PORT:-5432}"

usage() {
  cat <<USAGE
Usage: $0 <backup|restore|upload|download|check>

Required env:
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME

Optional env:
  DB_PORT, BACKUP_DIR, BACKUP_PREFIX, BACKUP_TIMESTAMP
  ENVIRONMENT, S3_PROVIDER=aws|sakura, S3_BUCKET, S3_PREFIX, S3_REGION, S3_ENDPOINT_URL
  SSE_KMS_KEY_ID, SSE_S3, GPG_RECIPIENT, GPG_HOME, GPG_REMOVE_PLAINTEXT
  ASSET_DIR, KEEP_DAYS, SCHEMA_VERSION, APP_VERSION, COMMIT_SHA
  BACKUP_RETENTION_CLASS=hourly|daily|weekly|monthly, S3_VERIFY_DOWNLOAD=0|1
  BACKUP_SECONDARY_PROVIDER=none|gdrive, BACKUP_GDRIVE_* (secondary用)
  BACKUP_FILE, BACKUP_GLOBALS_FILE, BACKUP_ASSETS_FILE (upload/restore 用)
  BACKUP_MANIFEST_FILE (check 用)
  REMOTE_HOST, REMOTE_USER, REMOTE_PORT, REMOTE_DIR
  REMOTE_SSH_KEY, REMOTE_SSH_OPTS, REMOTE_KEEP_DAYS
  SKIP_GLOBALS=1 (restore時に globals の適用をスキップ)
  RESTORE_CONFIRM=1 (required for restore)
USAGE
}

log() {
  echo "[backup-prod] $*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

require_env() {
  local missing=()
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    echo "missing env: ${missing[*]}" >&2
    exit 1
  fi
}

PGPASSFILE_CREATED=""
BACKUP_GDRIVE_REQUEST_FILE_CREATED=""

cleanup_pgpass() {
  if [[ -n "$PGPASSFILE_CREATED" ]]; then
    rm -f "$PGPASSFILE_CREATED"
  fi
}

cleanup_backup_gdrive_request() {
  if [[ -n "$BACKUP_GDRIVE_REQUEST_FILE_CREATED" ]]; then
    rm -f -- "$BACKUP_GDRIVE_REQUEST_FILE_CREATED"
  fi
}

trap 'cleanup_pgpass; cleanup_backup_gdrive_request' EXIT

pg_env() {
  export PGHOST="$DB_HOST"
  export PGPORT="$DB_PORT"
  export PGUSER="$DB_USER"
  if [[ -n "${PGPASSFILE:-}" ]]; then
    return 0
  fi
  if [[ -n "${DB_PASSWORD:-}" ]]; then
    local scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
    mkdir -p "$scratch_root"
    chmod 700 "$scratch_root"
    PGPASSFILE_CREATED="$(mktemp "$scratch_root/pgpass.XXXXXX")"
    chmod 600 "$PGPASSFILE_CREATED"
    printf '%s:%s:%s:%s:%s\n' \
      "${DB_HOST:-*}" \
      "${DB_PORT:-*}" \
      "*" \
      "${DB_USER:-*}" \
      "$DB_PASSWORD" > "$PGPASSFILE_CREATED"
    export PGPASSFILE="$PGPASSFILE_CREATED"
  fi
}

ssh_extra_opts=()
if [[ -n "${REMOTE_SSH_OPTS:-}" ]]; then
  read -r -a ssh_extra_opts <<< "${REMOTE_SSH_OPTS}"
fi

s3_args=()
if [[ -n "${S3_REGION:-}" ]]; then
  s3_args+=(--region "$S3_REGION")
fi
if [[ -n "${S3_ENDPOINT_URL:-}" ]]; then
  s3_args+=(--endpoint-url "$S3_ENDPOINT_URL")
fi

sse_args=()
if [[ "$S3_PROVIDER" == "aws" && -n "${SSE_KMS_KEY_ID:-}" ]]; then
  sse_args+=(--sse aws:kms --sse-kms-key-id "$SSE_KMS_KEY_ID")
elif [[ "$S3_PROVIDER" == "aws" && -n "${SSE_S3:-}" ]]; then
  sse_args+=(--sse "$SSE_S3")
fi

aws_cli() {
  aws "${s3_args[@]}" "$@"
}

s3_copy_quiet() {
  local failure_message="$1"
  shift
  if ! aws_cli s3 cp "$@" --only-show-errors >/dev/null 2>&1; then
    echo "$failure_message" >&2
    return 1
  fi
}

validate_safe_token() {
  local name="$1" value="$2"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ && "$value" != *'..'* ]] || {
    echo "$name contains unsupported characters" >&2
    exit 1
  }
}

validate_safe_filename() {
  local name="$1" value="$2"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$ ]] || {
    echo "$name contains unsupported characters" >&2
    exit 1
  }
}

cleanup_staged_download() {
  local directory="$1" staged_file
  for staged_file in "$directory"/*; do
    [[ -e "$staged_file" || -L "$staged_file" ]] || continue
    if [[ -f "$staged_file" || -L "$staged_file" ]]; then
      rm -f -- "$staged_file"
    fi
  done
  rmdir -- "$directory" 2>/dev/null || true
}

validate_sakura_backup_id() {
  local value="$1"
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    if [[ ! "$value" =~ ^[A-Za-z0-9._-]+-([0-9]{8}-[0-9]{6})-[A-Fa-f0-9]{7,64}$ ]]; then
      echo 'Sakura BACKUP_ID must include UTC YYYYMMDD-HHMMSS and commit SHA' >&2
      exit 1
    fi
    validate_utc_backup_timestamp "${BASH_REMATCH[1]}" || {
      echo 'Sakura BACKUP_ID contains an invalid UTC calendar timestamp' >&2
      exit 1
    }
  fi
}

validate_utc_backup_timestamp() {
  node - "$1" <<'NODE'
const value = process.argv[2];
const match = value.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
if (!match) process.exit(1);
const [, year, month, day, hour, minute, second] = match.map(Number);
const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
if (
  date.getUTCFullYear() !== year ||
  date.getUTCMonth() !== month - 1 ||
  date.getUTCDate() !== day ||
  date.getUTCHours() !== hour ||
  date.getUTCMinutes() !== minute ||
  date.getUTCSeconds() !== second
) process.exit(1);
NODE
}

validate_s3_prefix() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ ]] || {
    echo 'S3_PREFIX contains unsupported characters' >&2
    exit 1
  }
  [[ "/$value/" != *'/../'* && "/$value/" != *'/./'* && "$value" != *'//'* ]] || {
    echo 'S3_PREFIX contains an unsafe path segment' >&2
    exit 1
  }
}

validate_s3_profile() {
  case "$S3_PROVIDER" in
    aws|sakura) ;;
    *) echo "S3_PROVIDER must be explicitly set to aws or sakura" >&2; exit 1 ;;
  esac
  case "$BACKUP_RETENTION_CLASS" in
    hourly|daily|weekly|monthly) ;;
    *) echo 'BACKUP_RETENTION_CLASS is invalid' >&2; exit 1 ;;
  esac
  case "$S3_VERIFY_DOWNLOAD" in 0|1) ;; *) echo 'S3_VERIFY_DOWNLOAD must be 0 or 1' >&2; exit 1 ;; esac
  validate_safe_token ENVIRONMENT "$ENVIRONMENT"
  validate_safe_token BACKUP_PREFIX "$BACKUP_PREFIX"
  validate_safe_token COMMIT_SHA "$COMMIT_SHA"
  validate_s3_prefix "$S3_PREFIX"
  if [[ -n "${S3_ENDPOINT_URL:-}" && ! "${S3_ENDPOINT_URL}" =~ ^https://([A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(:[0-9]{1,5})?/?$ ]]; then
    echo 'S3_ENDPOINT_URL must be a credential-free HTTPS origin' >&2
    exit 1
  fi
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    [[ -n "${S3_BUCKET:-}" ]] || { echo 'S3_BUCKET is required for Sakura' >&2; exit 1; }
    [[ -n "${S3_ENDPOINT_URL:-}" ]] || { echo 'S3_ENDPOINT_URL is required for Sakura' >&2; exit 1; }
    [[ -z "${SSE_KMS_KEY_ID:-}" ]] || {
      echo 'SSE_KMS_KEY_ID is not supported by the Sakura profile' >&2
      exit 1
    }
  fi
}

validate_secondary_profile() {
  case "$BACKUP_SECONDARY_PROVIDER" in
    none) return 0 ;;
    gdrive) ;;
    *) echo 'BACKUP_SECONDARY_PROVIDER must be none or gdrive' >&2; return 1 ;;
  esac
  if [[ "$S3_PROVIDER" != "sakura" || -z "${S3_BUCKET:-}" ]]; then
    echo 'Google Drive secondary requires a successful Sakura primary profile' >&2
    return 1
  fi
  if [[ "$BACKUP_RETENTION_CLASS" == "hourly" ]]; then
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo 'Missing required command: node' >&2
    return 1
  fi
  if [[ ! -x "$BACKUP_GDRIVE_CLI" || -L "$BACKUP_GDRIVE_CLI" ]]; then
    echo 'backup Google Drive CLI is unavailable' >&2
    return 1
  fi
  "$BACKUP_GDRIVE_CLI" check-config >/dev/null
}

copy_bundle_to_secondary() {
  if ! validate_secondary_profile; then
    echo '{"status":"partial_failure","primary":"success","secondary":"failed"}' >&2
    return 1
  fi
  if [[ "$BACKUP_SECONDARY_PROVIDER" == "none" ]]; then
    return 0
  fi
  if [[ "$BACKUP_RETENTION_CLASS" == "hourly" ]]; then
    log 'Google Drive secondary skipped for hourly retention class'
    return 0
  fi
  local scratch_root request_file
  local -a artifacts=("$@")
  scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
  mkdir -p "$scratch_root"
  chmod 700 "$scratch_root"
  request_file=$(mktemp "$scratch_root/backup-gdrive-request.XXXXXX")
  BACKUP_GDRIVE_REQUEST_FILE_CREATED="$request_file"
  chmod 600 "$request_file"
  node - "$request_file" "${artifacts[@]}" <<'NODE'
const { writeFileSync } = require('node:fs');
const [output, ...artifacts] = process.argv.slice(2);
writeFileSync(output, `${JSON.stringify({ artifacts }, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
NODE
  log 'copying verified Sakura bundle to Google Drive secondary'
  if ! "$BACKUP_GDRIVE_CLI" upload --request-file "$request_file"; then
    rm -f -- "$request_file"
    BACKUP_GDRIVE_REQUEST_FILE_CREATED=""
    echo '{"status":"partial_failure","primary":"success","secondary":"failed"}' >&2
    return 1
  fi
  rm -f -- "$request_file"
  BACKUP_GDRIVE_REQUEST_FILE_CREATED=""
}

remote_enabled() {
  [[ -n "${REMOTE_HOST:-}" ]]
}

validate_remote_values() {
  if ! remote_enabled; then
    return 0
  fi
  if [[ -z "${REMOTE_DIR:-}" ]]; then
    echo "REMOTE_DIR is required when REMOTE_HOST is set" >&2
    exit 1
  fi
  if [[ ! "${REMOTE_DIR}" =~ ^[A-Za-z0-9._/=-]+$ ]]; then
    echo "REMOTE_DIR contains unsupported characters: '${REMOTE_DIR}'" >&2
    exit 1
  fi
  if [[ ! "${BACKUP_PREFIX}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "BACKUP_PREFIX contains unsupported characters: '${BACKUP_PREFIX}'" >&2
    exit 1
  fi
  if [[ -n "${REMOTE_KEEP_DAYS:-}" && ! "${REMOTE_KEEP_DAYS}" =~ ^[0-9]+$ ]]; then
    echo "REMOTE_KEEP_DAYS must be a non-negative integer, got: '${REMOTE_KEEP_DAYS}'" >&2
    exit 1
  fi
}

remote_target() {
  if [[ -n "${REMOTE_USER:-}" ]]; then
    echo "${REMOTE_USER}@${REMOTE_HOST}"
  else
    echo "${REMOTE_HOST}"
  fi
}

ssh_remote() {
  local target
  target=$(remote_target)
  local args=()
  if [[ -n "${REMOTE_PORT:-}" ]]; then
    args+=(-p "$REMOTE_PORT")
  fi
  if [[ -n "${REMOTE_SSH_KEY:-}" ]]; then
    args+=(-i "$REMOTE_SSH_KEY")
  fi
  if (( ${#ssh_extra_opts[@]} > 0 )); then
    args+=("${ssh_extra_opts[@]}")
  fi
  ssh "${args[@]}" "$target" "$@"
}

build_rsync_rsh() {
  local cmd=(ssh)
  if [[ -n "${REMOTE_PORT:-}" ]]; then
    cmd+=(-p "$REMOTE_PORT")
  fi
  if [[ -n "${REMOTE_SSH_KEY:-}" ]]; then
    cmd+=(-i "$REMOTE_SSH_KEY")
  fi
  if (( ${#ssh_extra_opts[@]} > 0 )); then
    cmd+=("${ssh_extra_opts[@]}")
  fi
  local rsh_cmd
  printf -v rsh_cmd '%q ' "${cmd[@]}"
  echo "${rsh_cmd% }"
}

ensure_remote_dir() {
  if ! remote_enabled; then
    return 0
  fi
  validate_remote_values
  require_cmd ssh
  ssh_remote "mkdir -p -- '$REMOTE_DIR'"
}

remote_copy_files() {
  if ! remote_enabled; then
    return 0
  fi
  ensure_remote_dir

  local target
  target=$(remote_target)

  if command -v rsync >/dev/null 2>&1; then
    local rsync_rsh
    rsync_rsh=$(build_rsync_rsh)
    rsync -a --quiet --protect-args -e "$rsync_rsh" "$@" "${target}:${REMOTE_DIR}/"
  else
    require_cmd scp
    local scp_args=()
    if [[ -n "${REMOTE_PORT:-}" ]]; then
      scp_args+=(-P "$REMOTE_PORT")
    fi
    if [[ -n "${REMOTE_SSH_KEY:-}" ]]; then
      scp_args+=(-i "$REMOTE_SSH_KEY")
    fi
    if (( ${#ssh_extra_opts[@]} > 0 )); then
      scp_args+=("${ssh_extra_opts[@]}")
    fi
    local local_path
    for local_path in "$@"; do
      scp "${scp_args[@]}" "$local_path" "${target}:${REMOTE_DIR}/"
    done
  fi

  if [[ -n "${REMOTE_KEEP_DAYS:-}" ]]; then
    ssh_remote "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${BACKUP_PREFIX}-*' -mtime +${REMOTE_KEEP_DAYS} -print -delete"
  fi
}

select_latest_s3_key() {
  local prefix="$1" required_type="${2:-any}"
  aws_cli s3api list-objects-v2 \
    --bucket "$S3_BUCKET" \
    --prefix "${prefix%/}/" \
    --output json 2>/dev/null | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const input = JSON.parse(raw);
  const contents = input.Contents ?? [];
  if (!Array.isArray(contents)) process.exit(2);
  const requiredType = process.argv[1];
  const expectedPrefix = process.argv[2];
  const candidates = contents
    .filter((entry) =>
      typeof entry?.Key === "string" &&
      typeof entry?.LastModified === "string" &&
      entry.Key.startsWith(expectedPrefix) &&
      !entry.Key.endsWith(".manifest.json") &&
      (requiredType === "any" || entry.Key.includes(`/${requiredType}/`)),
    )
    .map((entry) => ({ ...entry, timestamp: Date.parse(entry.LastModified) }));
  if (candidates.some((entry) => Number.isNaN(entry.timestamp))) process.exit(3);
  candidates.sort((left, right) => right.timestamp - left.timestamp || right.Key.localeCompare(left.Key));
  process.stdout.write(candidates[0]?.Key ?? "");
});
' "$required_type" "${prefix%/}/"
}

s3_latest_key() {
  select_latest_s3_key "$1" any
}

backup_date_path() {
  local backup_id="$1"
  [[ "$backup_id" =~ -([0-9]{4})([0-9]{2})([0-9]{2})-[0-9]{6}-[A-Fa-f0-9]{7,64}$ ]] || {
    echo 'Sakura BACKUP_ID does not contain a valid UTC date' >&2
    exit 1
  }
  local year="${BASH_REMATCH[1]}" month="${BASH_REMATCH[2]}" day="${BASH_REMATCH[3]}"
  case "$BACKUP_RETENTION_CLASS" in
    hourly) printf '%s/%s/%s\n' "$year" "$month" "$day" ;;
    daily) printf '%s/%s\n' "$year" "$month" ;;
    weekly|monthly) printf '%s\n' "$year" ;;
  esac
}

artifact_type_name() {
  case "$1" in
    db) printf 'database\n' ;;
    globals|assets|metadata) printf '%s\n' "$1" ;;
    *) echo 'unsupported backup artifact type' >&2; exit 1 ;;
  esac
}

artifact_remote_prefix() {
  local kind="$1" backup_id="$2"
  if [[ "$S3_PROVIDER" == "aws" ]]; then
    # Preserve the pre-Sakura AWS key layout used by existing inventory and
    # restore tooling.
    [[ "$kind" != "metadata" ]] || kind="meta"
    printf '%s/%s\n' "${S3_PREFIX%/}" "$kind"
    return
  fi
  printf '%s/%s/%s/%s/%s\n' \
    "${S3_PREFIX%/}" \
    "$BACKUP_RETENTION_CLASS" \
    "$(backup_date_path "$backup_id")" \
    "$backup_id" \
    "$(artifact_type_name "$kind")"
}

ensure_sakura_encrypted() {
  local artifact="$1"
  if [[ "$S3_PROVIDER" == "sakura" && "$artifact" != *.gpg ]]; then
    echo 'Sakura profile refuses to upload an artifact without OpenPGP client-side encryption' >&2
    exit 1
  fi
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    assert_openpgp_encrypted "$artifact"
  fi
}

assert_openpgp_encrypted() {
  local artifact="$1" packets gpg_home
  require_cmd gpg
  local gpg_args=(--batch --no-options)
  gpg_home="${GPG_HOME:-}"
  [[ -z "$gpg_home" ]] || gpg_args+=(--homedir "$gpg_home")
  if ! packets=$(LC_ALL=C gpg "${gpg_args[@]}" --list-packets "$artifact" 2>/dev/null); then
    echo 'artifact is not a valid OpenPGP message' >&2
    exit 1
  fi
  grep -Eq '^:pubkey enc packet:' <<<"$packets" || {
    echo 'artifact is not encrypted to an OpenPGP public key' >&2
    exit 1
  }
  grep -Eq '^:(aead encrypted packet|encrypted data packet):' <<<"$packets" || {
    echo 'artifact does not contain an OpenPGP encrypted data packet' >&2
    exit 1
  }
}

create_or_verify_manifest() {
  local source_file="$1" artifact_file="$2" kind="$3" backup_id="$4"
  local manifest_file="${artifact_file}.manifest.json"
  local generated_at commit_sha encryption_algorithm
  require_cmd node
  generated_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  commit_sha="$COMMIT_SHA"
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    [[ "$backup_id" =~ -([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})-([A-Fa-f0-9]{7,64})$ ]] || {
      echo 'Sakura BACKUP_ID metadata is invalid' >&2
      exit 1
    }
    generated_at="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}T${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}Z"
    commit_sha="${BASH_REMATCH[7]}"
  fi
  encryption_algorithm=none
  if [[ "$artifact_file" == *.gpg ]]; then
    assert_openpgp_encrypted "$artifact_file"
    encryption_algorithm=openpgp
  fi
  if [[ -f "$manifest_file" ]]; then
    local -a verify_args=(
      --artifact "$artifact_file" --manifest "$manifest_file" \
      --type "$(artifact_type_name "$kind")" \
      --backup-id "$backup_id" \
      --environment "$ENVIRONMENT" \
      --retention-class "$BACKUP_RETENTION_CLASS" \
      --commit-sha "$commit_sha" \
      --database-version "${DB_VERSION:-unknown}" \
      --schema-version "${SCHEMA_VERSION:-unknown}" \
      --app-version "${APP_VERSION:-unknown}" \
      --encryption "$encryption_algorithm"
    )
    if [[ "$S3_PROVIDER" == "sakura" ]]; then
      verify_args+=(--generated-at "$generated_at")
    fi
    node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" verify \
      "${verify_args[@]}" >/dev/null || return 1
  else
    if [[ "$S3_PROVIDER" == "sakura" && "$source_file" == "$artifact_file" ]]; then
      echo 'pre-encrypted Sakura artifacts require their existing manifest sidecar' >&2
      exit 1
    fi
    node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" create \
      --source "$source_file" \
      --artifact "$artifact_file" \
      --output "$manifest_file" \
      --type "$(artifact_type_name "$kind")" \
      --backup-id "$backup_id" \
      --generated-at "$generated_at" \
      --environment "$ENVIRONMENT" \
      --retention-class "$BACKUP_RETENTION_CLASS" \
      --database-name "${DB_NAME:-unknown}" \
      --database-version "${DB_VERSION:-unknown}" \
      --schema-version "${SCHEMA_VERSION:-unknown}" \
      --app-version "${APP_VERSION:-unknown}" \
      --encryption "$encryption_algorithm" \
      --commit-sha "$commit_sha" >/dev/null || return 1
  fi
  printf '%s\n' "$manifest_file"
}

assert_remote_key_absent() {
  local key="$1" existing
  existing=$(aws_cli s3api list-objects-v2 \
    --bucket "$S3_BUCKET" --prefix "$key" --max-keys 1 \
    --query "Contents[?Key=='${key}'].Key | [0]" --output text 2>/dev/null) || return 1
  if [[ -n "$existing" && "$existing" != "None" ]]; then
    echo 'S3 object already exists; refusing to overwrite immutable backup' >&2
    exit 1
  fi
}

upload_artifact() {
  local source_file="$1" artifact_file="$2" kind="$3" backup_id="$4"
  ensure_sakura_encrypted "$artifact_file"
  validate_sakura_backup_id "$backup_id"
  local manifest_file remote_prefix artifact_key manifest_key local_size local_sha remote_values remote_size remote_sha
  manifest_file=$(create_or_verify_manifest "$source_file" "$artifact_file" "$kind" "$backup_id")
  remote_prefix=$(artifact_remote_prefix "$kind" "$backup_id")
  artifact_key="${remote_prefix}/$(basename "$artifact_file")"
  manifest_key="${artifact_key}.manifest.json"
  local_size=$(stat -c '%s' "$artifact_file")
  local_sha=$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.artifact.sha256)' "$manifest_file")

  assert_remote_key_absent "$artifact_key"
  assert_remote_key_absent "$manifest_key"
  s3_copy_quiet 'S3 artifact upload failed' \
    "$artifact_file" "s3://${S3_BUCKET}/${artifact_key}" \
    "${sse_args[@]}" --metadata "sha256=$local_sha"
  s3_copy_quiet 'S3 manifest upload failed; an orphan artifact may require operator review' \
    "$manifest_file" "s3://${S3_BUCKET}/${manifest_key}" "${sse_args[@]}"
  if ! remote_values=$(aws_cli s3api head-object \
    --bucket "$S3_BUCKET" --key "$artifact_key" \
    --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null); then
    echo 'S3 upload verification failed: remote metadata could not be read' >&2
    exit 1
  fi
  read -r remote_size remote_sha <<<"$remote_values"
  if [[ "$remote_size" != "$local_size" || "$remote_sha" != "$local_sha" ]]; then
    echo 'S3 upload verification failed: remote size/checksum mismatch' >&2
    exit 1
  fi

  local verify_full_download=0 verify_remote_manifest=0
  [[ "$S3_VERIFY_DOWNLOAD" == "1" ]] && verify_full_download=1
  if [[ "$BACKUP_SECONDARY_PROVIDER" == "gdrive" && "$BACKUP_RETENTION_CLASS" != "hourly" ]]; then
    verify_remote_manifest=1
  fi
  if [[ "$verify_full_download" == "1" || "$verify_remote_manifest" == "1" ]]; then
    local scratch_root verify_dir verify_file verify_manifest
    scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
    mkdir -p "$scratch_root"
    chmod 700 "$scratch_root"
    verify_dir=$(mktemp -d "$scratch_root/backup-download-verify.XXXXXX")
    verify_file="$verify_dir/$(basename "$artifact_file")"
    verify_manifest="${verify_file}.manifest.json"
    if [[ "$verify_full_download" == "1" ]] &&
       ! s3_copy_quiet 'S3 verification artifact download failed' \
         "s3://${S3_BUCKET}/${artifact_key}" "$verify_file"; then
      rm -f -- "$verify_file" "$verify_manifest"
      rmdir -- "$verify_dir"
      echo 'S3 upload verification failed: remote artifact download failed' >&2
      exit 1
    fi
    if ! s3_copy_quiet 'S3 verification manifest download failed' \
         "s3://${S3_BUCKET}/${manifest_key}" "$verify_manifest"; then
      rm -f -- "$verify_file" "$verify_manifest"
      rmdir -- "$verify_dir"
      echo 'S3 upload verification failed: remote manifest download failed' >&2
      exit 1
    fi
    cmp -s "$manifest_file" "$verify_manifest" || {
      rm -f -- "$verify_file" "$verify_manifest"
      rmdir -- "$verify_dir"
      echo 'S3 upload verification failed: remote manifest mismatch' >&2
      exit 1
    }
    if [[ "$verify_full_download" == "1" ]]; then
      node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" verify \
        --artifact "$verify_file" --manifest "$verify_manifest" >/dev/null || {
          rm -f -- "$verify_file" "$verify_manifest"
          rmdir -- "$verify_dir"
          exit 1
        }
      if [[ "$S3_PROVIDER" == "sakura" ]] && ! assert_openpgp_encrypted "$verify_file"; then
        rm -f -- "$verify_file" "$verify_manifest"
        rmdir -- "$verify_dir"
        exit 1
      fi
    fi
    rm -f -- "$verify_file" "$verify_manifest"
    rmdir -- "$verify_dir"
  fi
}

sakura_download_context() {
  local key="$1" relative artifact_name artifact_type backup_id kind expected_prefix commit_sha
  local prefix="${S3_PREFIX%/}/"
  [[ "$key" == "$prefix"* ]] || {
    echo 'Sakura object key is outside the configured prefix' >&2
    return 1
  }
  relative="${key#"$prefix"}"
  local -a segments
  IFS='/' read -r -a segments <<<"$relative"
  (( ${#segments[@]} >= 4 )) || {
    echo 'Sakura object key layout is invalid' >&2
    return 1
  }
  artifact_name="${segments[${#segments[@]} - 1]}"
  artifact_type="${segments[${#segments[@]} - 2]}"
  backup_id="${segments[${#segments[@]} - 3]}"
  validate_safe_filename S3_OBJECT_NAME "$artifact_name"
  validate_safe_token BACKUP_ID "$backup_id"
  validate_sakura_backup_id "$backup_id"
  case "$artifact_type" in
    database) kind=db ;;
    globals|assets|metadata) kind="$artifact_type" ;;
    *) echo 'Sakura object key contains an unsupported artifact type' >&2; return 1 ;;
  esac
  expected_prefix="$(artifact_remote_prefix "$kind" "$backup_id")"
  [[ "$key" == "${expected_prefix}/${artifact_name}" ]] || {
    echo 'Sakura object key does not match its retention class/date/bundle context' >&2
    return 1
  }
  commit_sha="${backup_id##*-}"
  printf '%s\t%s\t%s\n' "$artifact_type" "$backup_id" "$commit_sha"
}

download_verified_artifact() {
  local key="$1"
  local artifact_name destination manifest_destination scratch_root download_dir temporary_artifact temporary_manifest
  local sakura_context artifact_type backup_id commit_sha
  artifact_name="$(basename "$key")"
  validate_safe_filename S3_OBJECT_NAME "$artifact_name"
  [[ "$artifact_name" != *.manifest.json ]] || { echo 'manifest key cannot be downloaded as an artifact' >&2; exit 1; }
  destination="$BACKUP_DIR/$artifact_name"
  manifest_destination="${destination}.manifest.json"
  [[ ! -e "$destination" && ! -e "$manifest_destination" ]] || {
    echo 'download destination already exists; refusing to overwrite' >&2
    exit 1
  }
  scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
  mkdir -p "$scratch_root"
  chmod 700 "$scratch_root"
  download_dir=$(mktemp -d "$scratch_root/backup-s3-download.XXXXXX")
  temporary_artifact="$download_dir/$artifact_name"
  temporary_manifest="${temporary_artifact}.manifest.json"
  if ! s3_copy_quiet 'S3 artifact download failed' \
       "s3://${S3_BUCKET}/${key}" "$temporary_artifact" ||
     ! s3_copy_quiet 'S3 manifest download failed' \
       "s3://${S3_BUCKET}/${key}.manifest.json" "$temporary_manifest"; then
    rm -f -- "$temporary_artifact" "$temporary_manifest"
    rmdir -- "$download_dir"
    echo 'S3 download integrity verification failed' >&2
    exit 1
  fi
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    sakura_context="$(sakura_download_context "$key")" || {
      rm -f -- "$temporary_artifact" "$temporary_manifest"
      rmdir -- "$download_dir"
      exit 1
    }
    IFS=$'\t' read -r artifact_type backup_id commit_sha <<<"$sakura_context"
    if ! node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" verify \
         --artifact "$temporary_artifact" --manifest "$temporary_manifest" \
         --type "$artifact_type" --backup-id "$backup_id" \
         --environment "$ENVIRONMENT" --retention-class "$BACKUP_RETENTION_CLASS" \
         --commit-sha "$commit_sha" --encryption openpgp >/dev/null ||
       ! assert_openpgp_encrypted "$temporary_artifact"; then
      rm -f -- "$temporary_artifact" "$temporary_manifest"
      rmdir -- "$download_dir"
      echo 'S3 download integrity/context verification failed' >&2
      exit 1
    fi
  elif ! node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" verify \
       --artifact "$temporary_artifact" --manifest "$temporary_manifest" >/dev/null; then
    rm -f -- "$temporary_artifact" "$temporary_manifest"
    rmdir -- "$download_dir"
    echo 'S3 download integrity verification failed' >&2
    exit 1
  fi
  if ! mv --no-clobber -- "$temporary_artifact" "$destination" || [[ -e "$temporary_artifact" ]]; then
    rm -f -- "$temporary_artifact" "$temporary_manifest"
    rmdir -- "$download_dir"
    echo 'download destination appeared while publishing the verified artifact; refusing to overwrite' >&2
    exit 1
  fi
  if ! mv --no-clobber -- "$temporary_manifest" "$manifest_destination" || [[ -e "$temporary_manifest" ]]; then
    if ! mv --no-clobber -- "$destination" "$temporary_artifact" || [[ -e "$destination" ]]; then
      echo 'verified artifact was published without its manifest; manual recovery is required' >&2
      exit 1
    fi
    rm -f -- "$temporary_artifact" "$temporary_manifest"
    rmdir -- "$download_dir"
    echo 'download destination appeared while publishing the verified manifest; no files were published' >&2
    exit 1
  fi
  rmdir -- "$download_dir"
  printf '%s\n' "$destination"
}

s3_latest_sakura_database_key() {
  local prefix="${S3_PREFIX%/}/${BACKUP_RETENTION_CLASS}/"
  select_latest_s3_key "$prefix" database
}

remove_plaintext_after_copy() {
  local source_file="$1" artifact_file="$2"
  if [[ "${GPG_REMOVE_PLAINTEXT:-}" == "1" && "$source_file" != "$artifact_file" ]]; then
    rm -f "$source_file"
  fi
}

maybe_encrypt() {
  local file=$1
  if [[ "$file" == *.gpg ]]; then
    echo "$file"
    return 0
  fi
  if [[ -z "${GPG_RECIPIENT:-}" ]]; then
    echo "$file"
    return 0
  fi
  require_cmd gpg
  local gpg_home="${GPG_HOME:-}"
  local gpg_args=()
  if [[ -n "$gpg_home" ]]; then
    gpg_args+=(--homedir "$gpg_home")
  fi
  local out="${file}.gpg"
  [[ ! -e "$out" ]] || { echo 'encrypted artifact already exists; refusing to overwrite' >&2; exit 1; }
  if ! gpg "${gpg_args[@]}" --batch --yes --recipient "$GPG_RECIPIENT" \
    --output "$out" --encrypt "$file" >/dev/null 2>&1; then
    echo 'OpenPGP encryption failed; inspect the private operator log' >&2
    return 1
  fi
  echo "$out"
}

write_meta() {
  local meta_file=$1
  local generated_at
  generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  ENVIRONMENT_VALUE="$ENVIRONMENT" \
  GENERATED_AT_VALUE="$generated_at" \
  DB_NAME_VALUE="$DB_NAME" \
  SCHEMA_VERSION_VALUE="${SCHEMA_VERSION:-}" \
  APP_VERSION_VALUE="${APP_VERSION:-}" \
  COMMIT_SHA_VALUE="$COMMIT_SHA" \
  RETENTION_CLASS_VALUE="$BACKUP_RETENTION_CLASS" \
    node - "$meta_file" <<'NODE'
const { writeFileSync } = require('node:fs');
const output = process.argv[2];
const data = {
  env: process.env.ENVIRONMENT_VALUE,
  generatedAt: process.env.GENERATED_AT_VALUE,
  dbName: process.env.DB_NAME_VALUE,
  schemaVersion: process.env.SCHEMA_VERSION_VALUE,
  appVersion: process.env.APP_VERSION_VALUE,
  commitSha: process.env.COMMIT_SHA_VALUE,
  retentionClass: process.env.RETENTION_CLASS_VALUE,
};
writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
NODE
}

backup() {
  require_env DB_HOST DB_USER DB_PASSWORD DB_NAME
  require_cmd pg_dump
  require_cmd pg_dumpall
  require_cmd node
  if [[ -n "${S3_BUCKET:-}" || -n "$S3_PROVIDER" ]]; then
    validate_s3_profile
    if [[ "$S3_PROVIDER" == "sakura" ]]; then
      require_env GPG_RECIPIENT
      [[ "$COMMIT_SHA" =~ ^[A-Fa-f0-9]{7,64}$ ]] || {
        echo 'COMMIT_SHA must be an explicit hexadecimal Git commit for Sakura' >&2
        exit 1
      }
      [[ "$BACKUP_TIMESTAMP" =~ ^[0-9]{8}-[0-9]{6}$ ]] || {
        echo 'BACKUP_TIMESTAMP must use UTC YYYYMMDD-HHMMSS for Sakura' >&2
        exit 1
      }
      validate_utc_backup_timestamp "$BACKUP_TIMESTAMP" || {
        echo 'BACKUP_TIMESTAMP is not a valid UTC calendar timestamp' >&2
        exit 1
      }
    fi
  fi
  pg_env
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    require_cmd psql
    require_cmd node
    DB_VERSION="${DB_VERSION:-$(psql -Atqc 'SHOW server_version' "$DB_NAME")}"
    SCHEMA_VERSION="${SCHEMA_VERSION:-$(find "$ROOT_DIR/packages/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort | tail -1)}"
    APP_VERSION="${APP_VERSION:-$(node -p "require('$ROOT_DIR/packages/backend/package.json').version")}"
    require_env DB_VERSION SCHEMA_VERSION APP_VERSION
  fi

  mkdir -p "$BACKUP_DIR"

  local base="${BACKUP_PREFIX}-${BACKUP_TIMESTAMP}"
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    base="${base}-${COMMIT_SHA:0:12}"
  fi
  local db_file="$BACKUP_DIR/${base}-db.dump"
  local globals_file="$BACKUP_DIR/${base}-globals.sql"
  local assets_file="$BACKUP_DIR/${base}-assets.tar.gz"
  local meta_file="$BACKUP_DIR/${base}-meta.json"

  local candidate
  for candidate in "$db_file" "$globals_file" "$meta_file"; do
    [[ ! -e "$candidate" && ! -e "${candidate}.gpg" ]] || {
      echo 'backup artifact already exists; refusing to overwrite' >&2
      exit 1
    }
  done
  if [[ -n "${ASSET_DIR:-}" && ( -e "$assets_file" || -e "${assets_file}.gpg" ) ]]; then
    echo 'backup assets artifact already exists; refusing to overwrite' >&2
    exit 1
  fi

  log "creating db dump: $db_file"
  pg_dump -Fc -d "$DB_NAME" -f "$db_file"
  if [[ ! -s "$db_file" ]]; then
    echo "backup failed: $db_file is empty" >&2
    exit 1
  fi

  log "creating globals dump: $globals_file"
  pg_dumpall --globals-only -f "$globals_file"
  if [[ ! -s "$globals_file" ]]; then
    echo "backup failed: $globals_file is empty" >&2
    exit 1
  fi

  if [[ -n "${ASSET_DIR:-}" ]]; then
    if [[ ! -d "$ASSET_DIR" ]]; then
      echo "asset dir not found: $ASSET_DIR" >&2
      exit 1
    fi
    log "archiving assets: $assets_file"
    tar -czf "$assets_file" -C "$ASSET_DIR" .
  fi

  write_meta "$meta_file"

  local db_upload
  local globals_upload
  local assets_upload=""
  local meta_upload
  db_upload=$(maybe_encrypt "$db_file")
  globals_upload=$(maybe_encrypt "$globals_file")
  meta_upload=$(maybe_encrypt "$meta_file")
  if [[ -f "$assets_file" ]]; then
    assets_upload=$(maybe_encrypt "$assets_file")
  fi

  if [[ -n "${S3_BUCKET:-}" ]]; then
    require_cmd aws
    log "uploading db dump to S3"
    upload_artifact "$db_file" "$db_upload" db "$base"
    log "uploading globals dump to S3"
    upload_artifact "$globals_file" "$globals_upload" globals "$base"
    if [[ -n "$assets_upload" ]]; then
      log "uploading assets archive to S3"
      upload_artifact "$assets_file" "$assets_upload" assets "$base"
    fi
    log "uploading metadata to S3"
    upload_artifact "$meta_file" "$meta_upload" metadata "$base"
    local -a secondary_artifacts=("$db_upload" "$globals_upload" "$meta_upload")
    if [[ -n "$assets_upload" ]]; then
      secondary_artifacts+=("$assets_upload")
    fi
    copy_bundle_to_secondary "${secondary_artifacts[@]}"
  fi

  if remote_enabled; then
    local db_manifest globals_manifest assets_manifest="" meta_manifest
    db_manifest=$(create_or_verify_manifest "$db_file" "$db_upload" db "$base")
    globals_manifest=$(create_or_verify_manifest "$globals_file" "$globals_upload" globals "$base")
    meta_manifest=$(create_or_verify_manifest "$meta_file" "$meta_upload" metadata "$base")
    if [[ -n "$assets_upload" ]]; then
      assets_manifest=$(create_or_verify_manifest "$assets_file" "$assets_upload" assets "$base")
    fi
    local remote_files=(
      "$db_upload" "$db_manifest"
      "$globals_upload" "$globals_manifest"
      "$meta_upload" "$meta_manifest"
    )
    if [[ -n "$assets_upload" ]]; then
      remote_files+=("$assets_upload" "$assets_manifest")
    fi
    remote_copy_files "${remote_files[@]}"
  fi
  remove_plaintext_after_copy "$db_file" "$db_upload"
  remove_plaintext_after_copy "$globals_file" "$globals_upload"
  remove_plaintext_after_copy "$meta_file" "$meta_upload"
  if [[ -n "$assets_upload" ]]; then
    remove_plaintext_after_copy "$assets_file" "$assets_upload"
  fi

  if [[ -n "${KEEP_DAYS:-}" ]]; then
    log "pruning backups older than ${KEEP_DAYS} days in $BACKUP_DIR"
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "${BACKUP_PREFIX}-*" -mtime +"$KEEP_DAYS" -print -delete
    if [[ -n "${S3_BUCKET:-}" ]]; then
      log "note: remote S3 objects are not pruned by KEEP_DAYS; use the provider retention workflow"
    fi
  fi

  log "backup completed"
}

latest_local_artifact() {
  local suffix="$1" candidate latest="" latest_time=-1 candidate_time
  shopt -s nullglob
  for candidate in "$BACKUP_DIR"/${BACKUP_PREFIX}-*${suffix}; do
    [[ -f "$candidate" && ! -L "$candidate" && "$candidate" != *.manifest.json ]] || continue
    candidate_time=$(stat -c '%Y' "$candidate")
    if (( candidate_time > latest_time )); then
      latest="$candidate"
      latest_time="$candidate_time"
    fi
  done
  shopt -u nullglob
  printf '%s\n' "$latest"
}

matching_bundle_artifact() {
  local base="$1"
  if [[ -f "${base}.gpg" && ! -L "${base}.gpg" ]]; then
    printf '%s\n' "${base}.gpg"
  elif [[ -f "$base" && ! -L "$base" ]]; then
    printf '%s\n' "$base"
  fi
}

upload_existing() {
  if [[ -z "${S3_BUCKET:-}" ]]; then
    echo "S3_BUCKET is required for upload" >&2
    exit 1
  fi
  require_cmd aws
  require_cmd node
  mkdir -p "$BACKUP_DIR"

  local db_file="${BACKUP_FILE:-}"
  local globals_file="${BACKUP_GLOBALS_FILE:-}"
  local assets_file="${BACKUP_ASSETS_FILE:-}"
  local meta_file=""

  if [[ -z "$db_file" ]]; then
    db_file=$(latest_local_artifact '-db.dump*')
  fi
  if [[ -z "$db_file" || ! -f "$db_file" || -L "$db_file" ]]; then
    echo "backup file not found. Set BACKUP_FILE or run backup first." >&2
    exit 1
  fi

  local backup_id bundle_base
  case "$db_file" in
    *-db.dump|*-db.dump.gpg) ;;
    *) echo 'BACKUP_FILE must end with -db.dump or -db.dump.gpg' >&2; exit 1 ;;
  esac
  bundle_base="${db_file%-db.dump*}"
  backup_id="${BACKUP_ID:-$(basename "$bundle_base")}"
  validate_safe_token BACKUP_ID "$backup_id"
  validate_sakura_backup_id "$backup_id"
  validate_s3_profile

  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    [[ "$backup_id" == "$(basename "$bundle_base")" ]] || {
      echo 'Sakura BACKUP_ID must match the artifact filename bundle ID' >&2
      exit 1
    }
    if [[ -z "$globals_file" ]]; then globals_file=$(matching_bundle_artifact "${bundle_base}-globals.sql"); fi
    if [[ -z "$assets_file" ]]; then assets_file=$(matching_bundle_artifact "${bundle_base}-assets.tar.gz"); fi
    meta_file=$(matching_bundle_artifact "${bundle_base}-meta.json")
    case "$globals_file" in "${bundle_base}-globals.sql"|"${bundle_base}-globals.sql.gpg") ;; *) echo 'Sakura globals artifact must belong to the same backup bundle' >&2; exit 1 ;; esac
    if [[ -n "$assets_file" ]]; then
      case "$assets_file" in "${bundle_base}-assets.tar.gz"|"${bundle_base}-assets.tar.gz.gpg") ;; *) echo 'Sakura assets artifact must belong to the same backup bundle' >&2; exit 1 ;; esac
    fi
    [[ -n "$meta_file" ]] || { echo 'matching Sakura metadata artifact was not found' >&2; exit 1; }
    require_env DB_VERSION SCHEMA_VERSION APP_VERSION
  else
    if [[ -z "$globals_file" ]]; then globals_file=$(latest_local_artifact '-globals.sql*'); fi
    if [[ -z "$assets_file" ]]; then assets_file=$(latest_local_artifact '-assets.tar.gz*'); fi
    meta_file=$(latest_local_artifact '-meta.json*')
  fi
  if [[ -z "$globals_file" || ! -f "$globals_file" || -L "$globals_file" ]]; then
    echo "globals file not found. Set BACKUP_GLOBALS_FILE or run backup first." >&2
    exit 1
  fi
  [[ -z "$assets_file" || ( -f "$assets_file" && ! -L "$assets_file" ) ]] || { echo 'assets artifact must be a regular non-symlink file' >&2; exit 1; }
  [[ -z "$meta_file" || ( -f "$meta_file" && ! -L "$meta_file" ) ]] || { echo 'metadata artifact must be a regular non-symlink file' >&2; exit 1; }

  local db_upload
  local globals_upload
  local assets_upload=""
  local meta_upload=""
  db_upload=$(maybe_encrypt "$db_file")
  globals_upload=$(maybe_encrypt "$globals_file")
  if [[ -n "$assets_file" && -f "$assets_file" ]]; then
    assets_upload=$(maybe_encrypt "$assets_file")
  fi
  if [[ -n "$meta_file" && -f "$meta_file" ]]; then
    meta_upload=$(maybe_encrypt "$meta_file")
  fi

  log "uploading db dump to S3"
  upload_artifact "$db_file" "$db_upload" db "$backup_id"
  log "uploading globals dump to S3"
  upload_artifact "$globals_file" "$globals_upload" globals "$backup_id"
  if [[ -n "$assets_upload" ]]; then
    log "uploading assets archive to S3"
    upload_artifact "$assets_file" "$assets_upload" assets "$backup_id"
  fi
  if [[ -n "$meta_upload" ]]; then
    log "uploading metadata to S3"
    upload_artifact "$meta_file" "$meta_upload" metadata "$backup_id"
  fi
  local -a secondary_artifacts=("$db_upload" "$globals_upload" "$meta_upload")
  if [[ -n "$assets_upload" ]]; then
    secondary_artifacts+=("$assets_upload")
  fi
  copy_bundle_to_secondary "${secondary_artifacts[@]}"
  remove_plaintext_after_copy "$db_file" "$db_upload"
  remove_plaintext_after_copy "$globals_file" "$globals_upload"
  [[ -n "$assets_upload" ]] && remove_plaintext_after_copy "$assets_file" "$assets_upload"
  [[ -n "$meta_upload" ]] && remove_plaintext_after_copy "$meta_file" "$meta_upload"
  log "upload completed"
}

download_latest() {
  require_cmd aws
  require_cmd node
  validate_s3_profile
  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    mkdir -p "$BACKUP_DIR"
    local db_key bundle_prefix globals_key assets_key metadata_key
    db_key=$(s3_latest_sakura_database_key)
    [[ -n "$db_key" ]] || { echo 'latest Sakura database backup was not found' >&2; exit 1; }
    bundle_prefix="${db_key%/database/*}"
    globals_key=$(s3_latest_key "${bundle_prefix}/globals")
    assets_key=$(s3_latest_key "${bundle_prefix}/assets")
    metadata_key=$(s3_latest_key "${bundle_prefix}/metadata")
    [[ -n "$globals_key" ]] || { echo 'matching Sakura globals backup was not found' >&2; exit 1; }
    [[ -n "$metadata_key" ]] || { echo 'matching Sakura metadata backup was not found' >&2; exit 1; }
    log 'downloading and verifying database backup'
    download_verified_artifact "$db_key" >/dev/null
    log 'downloading and verifying globals backup'
    download_verified_artifact "$globals_key" >/dev/null
    if [[ -n "$assets_key" ]]; then
      log 'downloading and verifying assets backup'
      download_verified_artifact "$assets_key" >/dev/null
    fi
    log 'downloading and verifying metadata backup'
    download_verified_artifact "$metadata_key" >/dev/null
    log 'download completed with manifest verification'
    return
  fi
  local s3_base="${S3_PREFIX%/}"
  local s3_db_prefix="${s3_base}/db"
  local s3_globals_prefix="${s3_base}/globals"
  local s3_assets_prefix="${s3_base}/assets"

  mkdir -p "$BACKUP_DIR"

  local db_key
  local globals_key
  local assets_key
  db_key=$(s3_latest_key "$s3_db_prefix")
  globals_key=$(s3_latest_key "$s3_globals_prefix")
  assets_key=$(s3_latest_key "$s3_assets_prefix")

  if [[ -z "$db_key" || -z "$globals_key" ]]; then
    echo "latest backups were not found under the configured S3 prefix" >&2
    exit 1
  fi

  local db_file globals_file
  validate_safe_filename S3_OBJECT_NAME "$(basename "$db_key")"
  validate_safe_filename S3_OBJECT_NAME "$(basename "$globals_key")"
  db_file="$BACKUP_DIR/$(basename "$db_key")"
  globals_file="$BACKUP_DIR/$(basename "$globals_key")"
  log "downloading latest db dump"
  s3_copy_quiet 'latest database backup download failed' \
    "s3://${S3_BUCKET}/${db_key}" "$db_file"
  log "downloading latest globals dump"
  s3_copy_quiet 'latest globals backup download failed' \
    "s3://${S3_BUCKET}/${globals_key}" "$globals_file"
  if [[ -n "$assets_key" ]]; then
    local assets_file
    validate_safe_filename S3_OBJECT_NAME "$(basename "$assets_key")"
    assets_file="$BACKUP_DIR/$(basename "$assets_key")"
    log "downloading latest assets archive"
    s3_copy_quiet 'latest assets backup download failed' \
      "s3://${S3_BUCKET}/${assets_key}" "$assets_file"
  fi
}

download_latest_remote() {
  if ! remote_enabled; then
    echo "REMOTE_HOST is required for remote download" >&2
    exit 1
  fi
  ensure_remote_dir
  require_cmd ssh

  mkdir -p "$BACKUP_DIR"

  local db_key
  local globals_key
  local assets_key
  local meta_key
  db_key=$(ssh_remote "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${BACKUP_PREFIX}-*-db.dump*' ! -name '*.manifest.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-" || true)
  globals_key=$(ssh_remote "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${BACKUP_PREFIX}-*-globals.sql*' ! -name '*.manifest.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-" || true)
  assets_key=$(ssh_remote "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${BACKUP_PREFIX}-*-assets.tar.gz*' ! -name '*.manifest.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-" || true)
  meta_key=$(ssh_remote "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${BACKUP_PREFIX}-*-meta.json*' ! -name '*.manifest.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-" || true)

  if [[ -z "$db_key" || -z "$globals_key" || -z "$meta_key" ]]; then
    echo "backups were not found on the configured remote target" >&2
    exit 1
  fi

  local remote_root="${REMOTE_DIR%/}/"
  local artifact_key artifact_name
  for artifact_key in "$db_key" "$globals_key" "$meta_key"; do
    [[ "$artifact_key" == "$remote_root"* ]] || {
      echo 'remote backup path is outside the configured directory' >&2
      exit 1
    }
    artifact_name="${artifact_key#"$remote_root"}"
    [[ "$artifact_name" != */* ]] || {
      echo 'remote backup path contains an unexpected directory' >&2
      exit 1
    }
    validate_safe_filename REMOTE_ARTIFACT_NAME "$artifact_name"
  done
  if [[ -n "$assets_key" ]]; then
    [[ "$assets_key" == "$remote_root"* ]] || {
      echo 'remote backup path is outside the configured directory' >&2
      exit 1
    }
    artifact_name="${assets_key#"$remote_root"}"
    [[ "$artifact_name" != */* ]] || {
      echo 'remote backup path contains an unexpected directory' >&2
      exit 1
    }
    validate_safe_filename REMOTE_ARTIFACT_NAME "$artifact_name"
  fi

  local db_name globals_name meta_name assets_name="" backup_id
  db_name=$(basename "$db_key")
  globals_name=$(basename "$globals_key")
  meta_name=$(basename "$meta_key")
  case "$db_name" in
    *-db.dump) backup_id="${db_name%-db.dump}" ;;
    *-db.dump.gpg) backup_id="${db_name%-db.dump.gpg}" ;;
    *) echo 'remote database artifact name is invalid' >&2; exit 1 ;;
  esac
  validate_safe_token BACKUP_ID "$backup_id"
  case "$globals_name" in
    "${backup_id}-globals.sql"|"${backup_id}-globals.sql.gpg") ;;
    *) echo 'remote globals artifact belongs to a different backup bundle' >&2; exit 1 ;;
  esac
  case "$meta_name" in
    "${backup_id}-meta.json"|"${backup_id}-meta.json.gpg") ;;
    *) echo 'remote metadata artifact belongs to a different backup bundle' >&2; exit 1 ;;
  esac
  if [[ -n "$assets_key" ]]; then
    assets_name=$(basename "$assets_key")
    case "$assets_name" in
      "${backup_id}-assets.tar.gz"|"${backup_id}-assets.tar.gz.gpg") ;;
      *) echo 'remote assets artifact belongs to a different backup bundle' >&2; exit 1 ;;
    esac
  fi

  local target
  target=$(remote_target)

  local artifact_keys=("$db_key" "$globals_key" "$meta_key")
  local artifact_types=(database globals metadata)
  if [[ -n "$assets_key" ]]; then
    artifact_keys+=("$assets_key")
    artifact_types+=(assets)
  fi

  local download_files=()
  for artifact_key in "${artifact_keys[@]}"; do
    if ! ssh_remote "test -f '${artifact_key}.manifest.json'"; then
      echo 'remote backup manifest sidecar is missing' >&2
      exit 1
    fi
    download_files+=("$artifact_key" "${artifact_key}.manifest.json")
  done

  local scratch_root download_dir
  scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
  mkdir -p "$scratch_root"
  chmod 700 "$scratch_root"
  download_dir=$(mktemp -d "$scratch_root/backup-remote-download.XXXXXX")

  local destination
  for artifact_key in "${artifact_keys[@]}"; do
    artifact_name=$(basename "$artifact_key")
    destination="$BACKUP_DIR/$artifact_name"
    [[ ! -e "$destination" && ! -e "${destination}.manifest.json" ]] || {
      rmdir -- "$download_dir"
      echo 'download destination already exists; refusing to overwrite' >&2
      exit 1
    }
  done

  if command -v rsync >/dev/null 2>&1; then
    local rsync_rsh
    rsync_rsh=$(build_rsync_rsh)
    if ! rsync -a --quiet --protect-args -e "$rsync_rsh" \
         "${download_files[@]/#/${target}:}" "$download_dir/"; then
      cleanup_staged_download "$download_dir"
      echo 'remote backup download failed' >&2
      exit 1
    fi
  else
    require_cmd scp
    local scp_args=()
    if [[ -n "${REMOTE_PORT:-}" ]]; then
      scp_args+=(-P "$REMOTE_PORT")
    fi
    if [[ -n "${REMOTE_SSH_KEY:-}" ]]; then
      scp_args+=(-i "$REMOTE_SSH_KEY")
    fi
    if (( ${#ssh_extra_opts[@]} > 0 )); then
      scp_args+=("${ssh_extra_opts[@]}")
    fi
    local remote_path
    for remote_path in "${download_files[@]}"; do
      local remote_spec
      remote_spec="${target}:$(printf '%q' "$remote_path")"
      if ! scp "${scp_args[@]}" "$remote_spec" "$download_dir/"; then
        cleanup_staged_download "$download_dir"
        echo 'remote backup download failed' >&2
        exit 1
      fi
    done
  fi

  local index local_artifact local_manifest verification_failed=0
  for index in "${!artifact_keys[@]}"; do
    artifact_name=$(basename "${artifact_keys[$index]}")
    local_artifact="$download_dir/$artifact_name"
    local_manifest="${local_artifact}.manifest.json"
    if ! node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" verify \
         --artifact "$local_artifact" --manifest "$local_manifest" \
         --type "${artifact_types[$index]}" --backup-id "$backup_id" \
         --environment "$ENVIRONMENT" \
         --retention-class "$BACKUP_RETENTION_CLASS" >/dev/null; then
      verification_failed=1
      break
    fi
    if [[ "$local_artifact" == *.gpg ]] && ! (assert_openpgp_encrypted "$local_artifact"); then
      verification_failed=1
      break
    fi
  done
  if [[ "$verification_failed" == "1" ]]; then
    cleanup_staged_download "$download_dir"
    echo 'remote backup integrity/context verification failed' >&2
    exit 1
  fi

  for artifact_key in "${artifact_keys[@]}"; do
    artifact_name=$(basename "$artifact_key")
    local_artifact="$download_dir/$artifact_name"
    local_manifest="${local_artifact}.manifest.json"
    destination="$BACKUP_DIR/$artifact_name"
    if ! mv --no-clobber -- "$local_artifact" "$destination" || [[ -e "$local_artifact" ]] ||
       ! mv --no-clobber -- "$local_manifest" "${destination}.manifest.json" || [[ -e "$local_manifest" ]]; then
      echo 'verified remote bundle could not be published without overwrite; manual recovery is required' >&2
      exit 1
    fi
  done
  rmdir -- "$download_dir"
  log 'remote download completed with manifest verification'
}

restore() {
  if [[ "${RESTORE_CONFIRM:-}" != "1" ]]; then
    echo "RESTORE_CONFIRM=1 is required to run restore" >&2
    exit 1
  fi
  require_env DB_HOST DB_USER DB_PASSWORD DB_NAME
  require_cmd pg_restore
  require_cmd psql
  pg_env

  local backup_file="${BACKUP_FILE:-}"
  local globals_file="${BACKUP_GLOBALS_FILE:-}"
  if [[ -z "$backup_file" ]]; then
    backup_file=$(latest_local_artifact '-db.dump*')
  fi
  if [[ -z "$globals_file" ]]; then
    globals_file=$(latest_local_artifact '-globals.sql*')
  fi

  if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
    echo "backup file not found. Set BACKUP_FILE or run download." >&2
    exit 1
  fi

  local gpg_args=()
  if [[ -n "${GPG_HOME:-}" ]]; then
    gpg_args+=(--homedir "$GPG_HOME")
  fi

  if [[ "$backup_file" == *.gpg ]]; then
    require_cmd gpg
    local decrypted_backup="${backup_file%.gpg}"
    if [[ -e "$decrypted_backup" || -L "$decrypted_backup" ]]; then
      echo 'refusing to overwrite existing decrypted database artifact' >&2
      exit 1
    fi
    if ! gpg "${gpg_args[@]}" --batch --output "$decrypted_backup" \
      --decrypt "$backup_file" >/dev/null 2>&1; then
      echo 'OpenPGP database decrypt failed; inspect the private operator log' >&2
      exit 1
    fi
    backup_file="$decrypted_backup"
  fi

  if [[ "${SKIP_GLOBALS:-}" != "1" ]]; then
    if [[ -z "$globals_file" || ! -f "$globals_file" ]]; then
      echo "globals file not found. Set BACKUP_GLOBALS_FILE or run download." >&2
      exit 1
    fi
    if [[ "$globals_file" == *.gpg ]]; then
      require_cmd gpg
      local decrypted_globals="${globals_file%.gpg}"
      if [[ -e "$decrypted_globals" || -L "$decrypted_globals" ]]; then
        echo 'refusing to overwrite existing decrypted globals artifact' >&2
        exit 1
      fi
      if ! gpg "${gpg_args[@]}" --batch --output "$decrypted_globals" \
        --decrypt "$globals_file" >/dev/null 2>&1; then
        echo 'OpenPGP globals decrypt failed; inspect the private operator log' >&2
        exit 1
      fi
      globals_file="$decrypted_globals"
    fi
    log "restoring globals"
    psql -v ON_ERROR_STOP=1 -f "$globals_file" postgres
  else
    log "skipping globals restore (SKIP_GLOBALS=1)"
  fi
  log "restoring database"
  pg_restore --clean --if-exists -d "$DB_NAME" "$backup_file"

  if [[ -n "${ASSET_DIR:-}" ]]; then
    local assets_file="${BACKUP_ASSETS_FILE:-}"
    if [[ -z "$assets_file" ]]; then
      assets_file=$(ls -1t "$BACKUP_DIR"/${BACKUP_PREFIX}-*-assets.tar.gz* 2>/dev/null | head -1 || true)
    fi
    if [[ -n "$assets_file" && -f "$assets_file" ]]; then
      if [[ "$assets_file" == *.gpg ]]; then
        require_cmd gpg
        local decrypted_assets="${assets_file%.gpg}"
        if [[ -e "$decrypted_assets" || -L "$decrypted_assets" ]]; then
          echo 'refusing to overwrite existing decrypted assets artifact' >&2
          exit 1
        fi
        if ! gpg "${gpg_args[@]}" --batch --output "$decrypted_assets" \
          --decrypt "$assets_file" >/dev/null 2>&1; then
          echo 'OpenPGP assets decrypt failed; inspect the private operator log' >&2
          exit 1
        fi
        assets_file="$decrypted_assets"
      fi
      mkdir -p "$ASSET_DIR"
      if [[ -n "$(ls -A "$ASSET_DIR" 2>/dev/null)" ]]; then
        log "warning: asset dir is not empty; files may be overwritten"
      fi
      log "restoring assets to $ASSET_DIR"
      tar -xzf "$assets_file" -C "$ASSET_DIR"
    else
      log "assets archive not found; skipping asset restore"
    fi
  fi
  log "restore completed"
}

check_backup() {
  require_env BACKUP_FILE BACKUP_MANIFEST_FILE
  require_cmd node
  node "$ROOT_DIR/scripts/backup-s3-manifest.mjs" verify \
    --artifact "$BACKUP_FILE" --manifest "$BACKUP_MANIFEST_FILE"
}

subcommand="${1:-}"
case "$subcommand" in
  backup)
    backup
    ;;
  upload)
    upload_existing
    ;;
  download)
    if [[ -n "${S3_BUCKET:-}" ]]; then
      download_latest
    elif remote_enabled; then
      download_latest_remote
    else
      echo "S3_BUCKET or REMOTE_HOST is required for download" >&2
      exit 1
    fi
    ;;
  restore)
    restore
    ;;
  check)
    check_backup
    ;;
  *)
    usage
    exit 1
    ;;
esac
