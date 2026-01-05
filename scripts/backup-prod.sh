#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/tmp/erp4-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-erp4}"
BACKUP_TIMESTAMP="${BACKUP_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
S3_PREFIX="${S3_PREFIX:-erp4/${ENVIRONMENT}}"
DB_PORT="${DB_PORT:-5432}"

usage() {
  cat <<USAGE
Usage: $0 <backup|restore|upload|download>

Required env:
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME

Optional env:
  DB_PORT, BACKUP_DIR, BACKUP_PREFIX, BACKUP_TIMESTAMP
  ENVIRONMENT, S3_BUCKET, S3_PREFIX, S3_REGION, S3_ENDPOINT_URL
  SSE_KMS_KEY_ID, SSE_S3, GPG_RECIPIENT, GPG_HOME, GPG_REMOVE_PLAINTEXT
  ASSET_DIR, KEEP_DAYS, SCHEMA_VERSION, APP_VERSION
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

pg_env() {
  export PGPASSWORD="$DB_PASSWORD"
  export PGHOST="$DB_HOST"
  export PGPORT="$DB_PORT"
  export PGUSER="$DB_USER"
}

s3_args=()
if [[ -n "${S3_REGION:-}" ]]; then
  s3_args+=(--region "$S3_REGION")
fi
if [[ -n "${S3_ENDPOINT_URL:-}" ]]; then
  s3_args+=(--endpoint-url "$S3_ENDPOINT_URL")
fi

sse_args=()
if [[ -n "${SSE_KMS_KEY_ID:-}" ]]; then
  sse_args+=(--sse aws:kms --sse-kms-key-id "$SSE_KMS_KEY_ID")
elif [[ -n "${SSE_S3:-}" ]]; then
  sse_args+=(--sse "$SSE_S3")
fi

aws_cli() {
  aws "${s3_args[@]}" "$@"
}

s3_uri() {
  local prefix=$1
  local file=$2
  echo "s3://${S3_BUCKET}/${prefix}/$(basename "$file")"
}

s3_latest_key() {
  local prefix=$1
  local key
  key=$(aws_cli s3api list-objects-v2 \
    --bucket "$S3_BUCKET" \
    --prefix "${prefix}/" \
    --query 'sort_by(Contents,&LastModified)[-1].Key' \
    --output text)
  if [[ "$key" == "None" ]]; then
    key=""
  fi
  echo "$key"
}

maybe_encrypt() {
  local file=$1
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
  gpg "${gpg_args[@]}" --batch --yes --recipient "$GPG_RECIPIENT" --output "$out" --encrypt "$file"
  if [[ "${GPG_REMOVE_PLAINTEXT:-}" == "1" ]]; then
    rm -f "$file"
  fi
  echo "$out"
}

write_meta() {
  local meta_file=$1
  local generated_at
  generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  cat <<EOF > "$meta_file"
{
  "env": "$ENVIRONMENT",
  "generatedAt": "$generated_at",
  "dbName": "$DB_NAME",
  "dbHost": "$DB_HOST",
  "schemaVersion": "${SCHEMA_VERSION:-}",
  "appVersion": "${APP_VERSION:-}"
}
EOF
}

backup() {
  require_env DB_HOST DB_USER DB_PASSWORD DB_NAME
  require_cmd pg_dump
  require_cmd pg_dumpall
  pg_env

  mkdir -p "$BACKUP_DIR"

  local base="${BACKUP_PREFIX}-${BACKUP_TIMESTAMP}"
  local db_file="$BACKUP_DIR/${base}-db.dump"
  local globals_file="$BACKUP_DIR/${base}-globals.sql"
  local assets_file="$BACKUP_DIR/${base}-assets.tar.gz"
  local meta_file="$BACKUP_DIR/${base}-meta.json"

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
    local s3_base="${S3_PREFIX%/}"
    local s3_db_prefix="${s3_base}/db"
    local s3_globals_prefix="${s3_base}/globals"
    local s3_assets_prefix="${s3_base}/assets"
    local s3_meta_prefix="${s3_base}/meta"
    log "uploading db dump to S3"
    aws_cli s3 cp "$db_upload" "$(s3_uri "$s3_db_prefix" "$db_upload")" "${sse_args[@]}"
    log "uploading globals dump to S3"
    aws_cli s3 cp "$globals_upload" "$(s3_uri "$s3_globals_prefix" "$globals_upload")" "${sse_args[@]}"
    if [[ -n "$assets_upload" ]]; then
      log "uploading assets archive to S3"
      aws_cli s3 cp "$assets_upload" "$(s3_uri "$s3_assets_prefix" "$assets_upload")" "${sse_args[@]}"
    fi
    log "uploading metadata to S3"
    aws_cli s3 cp "$meta_upload" "$(s3_uri "$s3_meta_prefix" "$meta_upload")" "${sse_args[@]}"
  fi

  if [[ -n "${KEEP_DAYS:-}" ]]; then
    log "pruning backups older than ${KEEP_DAYS} days in $BACKUP_DIR"
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "${BACKUP_PREFIX}-*" -mtime +"$KEEP_DAYS" -print -delete
  fi

  log "backup completed"
}

download_latest() {
  require_cmd aws
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
    echo "latest backups not found in s3://${S3_BUCKET}/${S3_PREFIX}" >&2
    exit 1
  fi

  local db_file="$BACKUP_DIR/$(basename "$db_key")"
  local globals_file="$BACKUP_DIR/$(basename "$globals_key")"
  log "downloading db dump: $db_key"
  aws_cli s3 cp "s3://${S3_BUCKET}/${db_key}" "$db_file"
  log "downloading globals dump: $globals_key"
  aws_cli s3 cp "s3://${S3_BUCKET}/${globals_key}" "$globals_file"
  if [[ -n "$assets_key" ]]; then
    local assets_file="$BACKUP_DIR/$(basename "$assets_key")"
    log "downloading assets archive: $assets_key"
    aws_cli s3 cp "s3://${S3_BUCKET}/${assets_key}" "$assets_file"
  fi
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
  if [[ -z "$backup_file" || -z "$globals_file" ]]; then
    backup_file=$(ls -1t "$BACKUP_DIR"/${BACKUP_PREFIX}-*-db.dump 2>/dev/null | head -1)
    globals_file=$(ls -1t "$BACKUP_DIR"/${BACKUP_PREFIX}-*-globals.sql 2>/dev/null | head -1)
  fi

  if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
    echo "backup file not found. Set BACKUP_FILE or run download." >&2
    exit 1
  fi
  if [[ -z "$globals_file" || ! -f "$globals_file" ]]; then
    echo "globals file not found. Set BACKUP_GLOBALS_FILE or run download." >&2
    exit 1
  fi

  if [[ "$globals_file" == *.gpg ]]; then
    require_cmd gpg
    local decrypted_globals="${globals_file%.gpg}"
    gpg --batch --yes --output "$decrypted_globals" --decrypt "$globals_file"
    globals_file="$decrypted_globals"
  fi
  if [[ "$backup_file" == *.gpg ]]; then
    require_cmd gpg
    local decrypted_backup="${backup_file%.gpg}"
    gpg --batch --yes --output "$decrypted_backup" --decrypt "$backup_file"
    backup_file="$decrypted_backup"
  fi

  log "restoring globals"
  psql -v ON_ERROR_STOP=1 -f "$globals_file" postgres
  log "restoring database"
  pg_restore --clean --if-exists -d "$DB_NAME" "$backup_file"
  log "restore completed"
}

cmd="${1:-}"
case "$cmd" in
  backup)
    backup
    ;;
  upload)
    if [[ -z "${S3_BUCKET:-}" ]]; then
      echo "S3_BUCKET is required for upload" >&2
      exit 1
    fi
    backup
    ;;
  download)
    if [[ -z "${S3_BUCKET:-}" ]]; then
      echo "S3_BUCKET is required for download" >&2
      exit 1
    fi
    download_latest
    ;;
  restore)
    restore
    ;;
  *)
    usage
    exit 1
    ;;
esac
