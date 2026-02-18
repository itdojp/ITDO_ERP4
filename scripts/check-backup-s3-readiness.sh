#!/usr/bin/env bash
set -euo pipefail

# Preflight checker for S3 backup destination settings used by scripts/backup-prod.sh.
# Output includes bucket/key/KMS identifiers for operational diagnosis.
#
# Required:
#   S3_BUCKET
#
# Optional:
#   S3_REGION
#   S3_ENDPOINT_URL
#   KMS_ENDPOINT_URL
#   EXPECT_SSE (default: aws:kms)          # aws:kms | AES256 | any
#   SSE_KMS_KEY_ID
#   CHECK_WRITE (default: 0)               # 1 to run put/delete probe
#   S3_PREFIX (default: erp4/prod)
#   STRICT (default: 1)                    # 1 fail on warnings, 0 warn only

STRICT="${STRICT:-1}"
S3_BUCKET="${S3_BUCKET:-}"
S3_REGION="${S3_REGION:-}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
KMS_ENDPOINT_URL="${KMS_ENDPOINT_URL:-}"
EXPECT_SSE="${EXPECT_SSE:-aws:kms}"
SSE_KMS_KEY_ID="${SSE_KMS_KEY_ID:-}"
CHECK_WRITE="${CHECK_WRITE:-0}"
S3_PREFIX="${S3_PREFIX:-erp4/prod}"

warn_count=0

log() {
  echo "[backup-s3-preflight] $*"
}

warn() {
  warn_count=$((warn_count + 1))
  echo "[backup-s3-preflight][WARN] $*" >&2
}

die() {
  echo "[backup-s3-preflight][ERROR] $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "missing command: $1"
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    die "missing env: ${name}"
  fi
}

aws_args=()
if [[ -n "$S3_REGION" ]]; then
  aws_args+=(--region "$S3_REGION")
fi
if [[ -n "$S3_ENDPOINT_URL" ]]; then
  aws_args+=(--endpoint-url "$S3_ENDPOINT_URL")
fi

aws_s3() {
  aws "${aws_args[@]}" "$@"
}

aws_kms_args=()
if [[ -n "$S3_REGION" ]]; then
  aws_kms_args+=(--region "$S3_REGION")
fi
if [[ -n "$KMS_ENDPOINT_URL" ]]; then
  aws_kms_args+=(--endpoint-url "$KMS_ENDPOINT_URL")
fi

aws_kms() {
  aws "${aws_kms_args[@]}" "$@"
}

normalize_bucket_region() {
  local region="$1"
  case "$region" in
    None|null|"" ) echo "us-east-1" ;;
    EU ) echo "eu-west-1" ;;
    * ) echo "$region" ;;
  esac
}

check_bucket_access() {
  log "checking bucket access: s3://${S3_BUCKET}"
  aws_s3 s3api head-bucket --bucket "$S3_BUCKET" >/dev/null
}

check_bucket_region() {
  local actual
  actual=$(aws_s3 s3api get-bucket-location --bucket "$S3_BUCKET" --query 'LocationConstraint' --output text)
  actual=$(normalize_bucket_region "$actual")
  log "bucket region: ${actual}"

  if [[ -n "$S3_REGION" && "$actual" != "$S3_REGION" ]]; then
    warn "S3_REGION mismatch (expected=${S3_REGION}, actual=${actual})"
  fi
}

check_bucket_versioning() {
  local status
  status=$(aws_s3 s3api get-bucket-versioning --bucket "$S3_BUCKET" --query 'Status' --output text 2>/dev/null || echo "")
  if [[ "$status" != "Enabled" ]]; then
    warn "bucket versioning is not Enabled (current=${status:-unset})"
  else
    log "bucket versioning: Enabled"
  fi
}

check_bucket_encryption() {
  local sse kms
  if ! sse=$(aws_s3 s3api get-bucket-encryption \
    --bucket "$S3_BUCKET" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
    --output text 2>/dev/null); then
    warn "bucket default encryption is not configured"
    return 0
  fi

  kms=$(aws_s3 s3api get-bucket-encryption \
    --bucket "$S3_BUCKET" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID' \
    --output text 2>/dev/null || echo "")

  log "bucket default encryption: ${sse}"
  if [[ -n "$kms" && "$kms" != "None" ]]; then
    log "bucket KMS key: ${kms}"
  fi

  if [[ "$EXPECT_SSE" != "any" && "$sse" != "$EXPECT_SSE" ]]; then
    warn "SSE algorithm mismatch (expected=${EXPECT_SSE}, actual=${sse})"
  fi

  if [[ -n "$SSE_KMS_KEY_ID" ]]; then
    if [[ -z "$kms" || "$kms" == "None" ]]; then
      warn "SSE_KMS_KEY_ID is set but bucket encryption has no KMS key"
    elif ! kms_id_matches "$SSE_KMS_KEY_ID" "$kms"; then
      warn "KMS key mismatch (expected=${SSE_KMS_KEY_ID}, actual=${kms})"
    fi
  fi
}

check_lifecycle() {
  local rules
  if ! rules=$(aws_s3 s3api get-bucket-lifecycle-configuration \
    --bucket "$S3_BUCKET" \
    --query 'Rules[].ID' \
    --output text 2>/dev/null); then
    warn "bucket lifecycle rule is not configured"
    return 0
  fi

  if [[ -z "$rules" || "$rules" == "None" ]]; then
    warn "bucket lifecycle rule is empty"
  else
    log "bucket lifecycle rules: ${rules}"
  fi
}

check_public_access_block() {
  local values
  if ! values=$(aws_s3 s3api get-public-access-block \
    --bucket "$S3_BUCKET" \
    --query '[PublicAccessBlockConfiguration.BlockPublicAcls,PublicAccessBlockConfiguration.IgnorePublicAcls,PublicAccessBlockConfiguration.BlockPublicPolicy,PublicAccessBlockConfiguration.RestrictPublicBuckets]' \
    --output text 2>/dev/null); then
    warn "public access block is not configured"
    return 0
  fi

  local names=(
    "BlockPublicAcls"
    "IgnorePublicAcls"
    "BlockPublicPolicy"
    "RestrictPublicBuckets"
  )
  local idx=0 value
  for value in $values; do
    if [[ "$value" != "True" ]]; then
      warn "public access block ${names[$idx]} is not True (current=$value)"
    fi
    idx=$((idx + 1))
  done
  if (( idx != 4 )); then
    warn "public access block check returned unexpected field count (${idx})"
  else
    log "public access block: configured"
  fi
}

check_kms_key() {
  if [[ -z "$SSE_KMS_KEY_ID" ]]; then
    return 0
  fi

  local key_state
  log "checking KMS key: ${SSE_KMS_KEY_ID}"
  key_state=$(aws_kms kms describe-key --key-id "$SSE_KMS_KEY_ID" --query 'KeyMetadata.KeyState' --output text)
  if [[ "$key_state" != "Enabled" ]]; then
    warn "KMS key state is not Enabled (current=${key_state})"
  else
    log "KMS key state: Enabled"
  fi
}

check_write_probe() {
  if [[ "$CHECK_WRITE" != "1" ]]; then
    return 0
  fi

  local stamp probe_prefix probe_key
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  probe_prefix="${S3_PREFIX%/}"
  if [[ -n "$probe_prefix" ]]; then
    probe_key="${probe_prefix}/_preflight/${stamp}.txt"
  else
    probe_key="_preflight/${stamp}.txt"
  fi
  log "write probe: s3://${S3_BUCKET}/${probe_key}"

  local put_args=(s3api put-object --bucket "$S3_BUCKET" --key "$probe_key" --body /dev/null)
  case "$EXPECT_SSE" in
    aws:kms)
      put_args+=(--server-side-encryption aws:kms)
      if [[ -n "$SSE_KMS_KEY_ID" ]]; then
        put_args+=(--ssekms-key-id "$SSE_KMS_KEY_ID")
      fi
      ;;
    AES256)
      put_args+=(--server-side-encryption AES256)
      ;;
  esac

  aws_s3 "${put_args[@]}" >/dev/null
  if ! aws_s3 s3api delete-object --bucket "$S3_BUCKET" --key "$probe_key" >/dev/null; then
    warn "write probe cleanup failed: s3://${S3_BUCKET}/${probe_key} remains"
  fi
}

main() {
  require_cmd aws
  require_env S3_BUCKET
  case "$EXPECT_SSE" in
    aws:kms|AES256|any) ;;
    *)
      die "EXPECT_SSE must be one of: aws:kms | AES256 | any (got: ${EXPECT_SSE})"
      ;;
  esac

  check_bucket_access
  check_bucket_region
  check_bucket_versioning
  check_bucket_encryption
  check_lifecycle
  check_public_access_block
  check_kms_key
  check_write_probe

  if (( warn_count > 0 )); then
    if [[ "$STRICT" == "1" ]]; then
      die "failed with ${warn_count} warning(s)"
    fi
    log "completed with ${warn_count} warning(s)"
    exit 0
  fi

  log "readiness check passed"
}
kms_id_matches() {
  local expected="$1"
  local actual="$2"
  if [[ -z "$expected" || -z "$actual" || "$actual" == "None" ]]; then
    return 1
  fi
  if [[ "$expected" == "$actual" ]]; then
    return 0
  fi
  if [[ "$expected" == arn:* ]]; then
    return 1
  fi
  if [[ "$expected" == alias/* ]]; then
    [[ "$actual" == *":$expected" ]] && return 0
    return 1
  fi
  [[ "$actual" == *"/$expected" ]] && return 0
  [[ "$actual" == *":key/$expected" ]] && return 0
  return 1
}

main "$@"
