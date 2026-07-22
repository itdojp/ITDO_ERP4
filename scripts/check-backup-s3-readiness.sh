#!/usr/bin/env bash
set -euo pipefail

# Preflight checker for S3 backup destination settings used by scripts/backup-prod.sh.
# Output intentionally redacts bucket, object-key, endpoint, and KMS identifiers.
#
# Required:
#   S3_BUCKET
#   S3_PROVIDER                            # aws | sakura
#   S3_EXECUTION_MODE                      # real | fake
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
#   S3_OPERATOR_EVIDENCE_FILE              # Sakura console evidence, caller-owned mode 600

STRICT="${STRICT:-1}"
S3_PROVIDER="${S3_PROVIDER:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_REGION="${S3_REGION:-}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
KMS_ENDPOINT_URL="${KMS_ENDPOINT_URL:-}"
EXPECT_SSE="${EXPECT_SSE:-}"
SSE_KMS_KEY_ID="${SSE_KMS_KEY_ID:-}"
CHECK_WRITE="${CHECK_WRITE:-0}"
S3_PREFIX="${S3_PREFIX:-erp4/prod}"
S3_OPERATOR_EVIDENCE_FILE="${S3_OPERATOR_EVIDENCE_FILE:-}"
S3_EXECUTION_MODE="${S3_EXECUTION_MODE:-}"
S3_REAL_RUN_CONFIRM="${S3_REAL_RUN_CONFIRM:-0}"
ROOT_DIR="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"

warn_count=0
not_applicable_count=0
bucket_versioning_status=""

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

validate_binary_flag() {
  local name="$1"
  local value="${!name}"
  case "$value" in
    0|1) ;;
    *)
      die "${name} must be 0|1 (got: ${value})"
      ;;
  esac
}

validate_prefix() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ ]] || die 'S3_PREFIX contains unsupported characters'
  [[ "/$value/" != *'/../'* && "/$value/" != *'/./'* && "$value" != *'//'* ]] || die 'S3_PREFIX contains an unsafe path segment'
}

validate_endpoint_tls() {
  [[ "$S3_ENDPOINT_URL" =~ ^https://([A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(:[0-9]{1,5})?/?$ ]] || die 'S3_ENDPOINT_URL must be a credential-free HTTPS origin'
}

emit_summary() {
  local status="$1"
  local warning_count="$2"
  local error_count="$3"
  log "SUMMARY status=${status} warning_count=${warning_count} error_count=${error_count} strict=${STRICT} check_write=${CHECK_WRITE} provider=${S3_PROVIDER} execution_mode=${S3_EXECUTION_MODE} real_run_confirm=${S3_REAL_RUN_CONFIRM} not_applicable_count=${not_applicable_count} operator_evidence=$([[ -n "$S3_OPERATOR_EVIDENCE_FILE" ]] && echo present || echo missing)"
}

not_applicable() {
  not_applicable_count=$((not_applicable_count + 1))
  log "CHECK name=$1 status=not_applicable reason=$2"
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
  log "checking configured bucket access"
  aws_s3 s3api head-bucket --bucket "$S3_BUCKET" >/dev/null 2>&1 || die 'configured bucket is not accessible'
}

check_list_access() {
  log "checking object list access"
  aws_s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "${S3_PREFIX%/}/" --max-keys 1 >/dev/null 2>&1 || die 'configured prefix cannot be listed'
}

check_bucket_region() {
  local actual
  actual=$(aws_s3 s3api get-bucket-location --bucket "$S3_BUCKET" --query 'LocationConstraint' --output text 2>/dev/null) || die 'bucket region could not be queried'
  actual=$(normalize_bucket_region "$actual")
  log "bucket region: ${actual}"

  if [[ -n "$S3_REGION" && "$actual" != "$S3_REGION" ]]; then
    warn "S3_REGION mismatch (expected=${S3_REGION}, actual=${actual})"
  fi
}

check_bucket_versioning() {
  local status
  status=$(aws_s3 s3api get-bucket-versioning --bucket "$S3_BUCKET" --query 'Status' --output text 2>/dev/null || echo "")
  bucket_versioning_status="$status"
  if [[ "$status" != "Enabled" ]]; then
    warn "bucket versioning is not Enabled (current=${status:-unset})"
  else
    log "bucket versioning: Enabled"
  fi
}

check_bucket_acl() {
  local acl
  if ! acl=$(aws_s3 s3api get-bucket-acl --bucket "$S3_BUCKET" --output json 2>/dev/null); then
    warn 'bucket ACL could not be queried'
    return
  fi
  if grep -Eq 'AllUsers|AuthenticatedUsers' <<<"$acl"; then
    warn 'bucket ACL contains a public or authenticated-users group grant'
  else
    log 'bucket ACL: no public group grant detected'
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
  if [[ "$EXPECT_SSE" != "any" && "$sse" != "$EXPECT_SSE" ]]; then
    warn "SSE algorithm mismatch (expected=${EXPECT_SSE}, actual=${sse})"
  fi

  if [[ -n "$SSE_KMS_KEY_ID" ]]; then
    if [[ -z "$kms" || "$kms" == "None" ]]; then
      warn "SSE_KMS_KEY_ID is set but bucket encryption has no KMS key"
    elif ! kms_id_matches "$SSE_KMS_KEY_ID" "$kms"; then
      warn "configured KMS key does not match the bucket default"
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
    log "bucket lifecycle rules: configured"
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
  log "checking configured KMS key"
  key_state=$(aws_kms kms describe-key --key-id "$SSE_KMS_KEY_ID" --query 'KeyMetadata.KeyState' --output text 2>/dev/null) || die 'configured KMS key could not be queried'
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

  local stamp probe_prefix probe_key scratch_root probe_file download_file probe_sha remote_values remote_size remote_sha probe_version
  local -a delete_args
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
  probe_prefix="${S3_PREFIX%/}"
  if [[ -n "$probe_prefix" ]]; then
    probe_key="${probe_prefix}/_preflight/${stamp}.txt"
  else
    probe_key="_preflight/${stamp}.txt"
  fi
  log 'write probe: started'

  scratch_root="${ERP4_TMP_DIR:-$ROOT_DIR/.codex-local/tmp}"
  mkdir -p "$scratch_root"
  chmod 700 "$scratch_root"
  probe_file=$(mktemp "$scratch_root/backup-s3-probe.XXXXXX")
  download_file=$(mktemp "$scratch_root/backup-s3-probe-download.XXXXXX")
  printf 'erp4-backup-s3-readiness\n' >"$probe_file"
  probe_sha=$(sha256sum "$probe_file" | awk '{print $1}')

  local put_args=(s3api put-object --bucket "$S3_BUCKET" --key "$probe_key" --body "$probe_file" --metadata "sha256=$probe_sha")
  if [[ "$S3_PROVIDER" == "aws" ]]; then
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
  fi

  put_args+=(--query VersionId --output text)
  if ! probe_version=$(aws_s3 "${put_args[@]}" 2>/dev/null); then
    rm -f "$probe_file" "$download_file"
    die 'write probe upload failed; inspect the private provider inventory before retry'
  fi
  case "$probe_version" in None|null|'{}'|'') probe_version="" ;; esac
  if [[ "$bucket_versioning_status" == "Enabled" && -z "$probe_version" ]]; then
    rm -f "$probe_file" "$download_file"
    die 'write probe did not return a version ID; operator cleanup is required before retry'
  fi
  delete_args=(s3api delete-object --bucket "$S3_BUCKET" --key "$probe_key")
  [[ -z "$probe_version" ]] || delete_args+=(--version-id "$probe_version")
  if ! remote_values=$(aws_s3 s3api head-object --bucket "$S3_BUCKET" --key "$probe_key" --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null); then
    if ! aws_s3 "${delete_args[@]}" >/dev/null 2>&1; then
      rm -f "$probe_file" "$download_file"
      die 'write probe metadata check and synthetic object cleanup failed; operator cleanup is required'
    fi
    rm -f "$probe_file" "$download_file"
    die 'write probe remote metadata check failed'
  fi
  read -r remote_size remote_sha <<<"$remote_values"
  if [[ "$remote_size" != "$(stat -c '%s' "$probe_file")" || "$remote_sha" != "$probe_sha" ]]; then
    if ! aws_s3 "${delete_args[@]}" >/dev/null 2>&1; then
      rm -f "$probe_file" "$download_file"
      die 'write probe checksum check and synthetic object cleanup failed; operator cleanup is required'
    fi
    rm -f "$probe_file" "$download_file"
    die 'write probe remote size/checksum mismatch'
  fi
  if ! aws_s3 s3api get-object --bucket "$S3_BUCKET" --key "$probe_key" "$download_file" >/dev/null 2>&1 || ! cmp -s "$probe_file" "$download_file"; then
    if ! aws_s3 "${delete_args[@]}" >/dev/null 2>&1; then
      rm -f "$probe_file" "$download_file"
      die 'write probe download check and synthetic object cleanup failed; operator cleanup is required'
    fi
    rm -f "$probe_file" "$download_file"
    die 'write probe download checksum mismatch'
  fi
  if ! aws_s3 "${delete_args[@]}" >/dev/null 2>&1; then
    rm -f "$probe_file" "$download_file"
    die 'write probe cleanup failed; operator cleanup is required before retry'
  fi
  rm -f "$probe_file" "$download_file"
  log 'write probe: round-trip verified and deleted'
}

check_sakura_operator_evidence() {
  not_applicable bucket_encryption 'client_side_gpg_is_authoritative'
  not_applicable lifecycle 'repository_retention_plan_is_authoritative'
  not_applicable public_access_block 'aws_specific_api_bucket_acl_checked_separately'
  not_applicable kms 'aws_specific_api'
  if [[ -z "$S3_OPERATOR_EVIDENCE_FILE" ]]; then
    warn 'Sakura operator evidence is missing for versioning, public access, access control, and provider retention settings'
    return
  fi
  if [[ -L "$S3_OPERATOR_EVIDENCE_FILE" || ! -f "$S3_OPERATOR_EVIDENCE_FILE" || ! -s "$S3_OPERATOR_EVIDENCE_FILE" ]]; then
    die 'S3_OPERATOR_EVIDENCE_FILE must be a regular non-symlink file'
  fi
  local mode owner
  mode=$(stat -c '%a' "$S3_OPERATOR_EVIDENCE_FILE")
  owner=$(stat -c '%u' "$S3_OPERATOR_EVIDENCE_FILE")
  (( (8#$mode & 8#077) == 0 )) || die 'S3_OPERATOR_EVIDENCE_FILE must use mode 600 or stricter'
  [[ "$owner" == "$(id -u)" ]] || die 'S3_OPERATOR_EVIDENCE_FILE must be owned by the current user'
  local field
  for field in versioningStatus publicAccessStatus accessControlStatus retentionStatus; do
    grep -Eq "^${field}=[A-Za-z0-9][A-Za-z0-9._-]*$" "$S3_OPERATOR_EVIDENCE_FILE" || \
      die "S3_OPERATOR_EVIDENCE_FILE is missing required field: ${field}"
  done
  log 'operator evidence: present'
}

main() {
  validate_binary_flag STRICT
  validate_binary_flag CHECK_WRITE
  case "$S3_PROVIDER" in
    aws|sakura) ;;
    *) die "S3_PROVIDER must be one of: aws | sakura (got: ${S3_PROVIDER})" ;;
  esac
  case "$S3_EXECUTION_MODE" in
    real|fake) ;;
    *) die 'S3_EXECUTION_MODE must be explicitly set to real or fake' ;;
  esac
  validate_binary_flag S3_REAL_RUN_CONFIRM
  if [[ "$S3_EXECUTION_MODE" == "real" && "$S3_REAL_RUN_CONFIRM" != "1" ]]; then
    die 'S3_REAL_RUN_CONFIRM=1 is required to attest that real provider credentials and endpoint are in use'
  fi
  if [[ -z "$EXPECT_SSE" ]]; then
    if [[ "$S3_PROVIDER" == "aws" ]]; then EXPECT_SSE='aws:kms'; else EXPECT_SSE='any'; fi
  fi
  case "$EXPECT_SSE" in
    aws:kms|AES256|any) ;;
    *)
      die "EXPECT_SSE must be one of: aws:kms | AES256 | any (got: ${EXPECT_SSE})"
      ;;
  esac
  require_cmd aws
  require_cmd sha256sum
  require_env S3_BUCKET
  validate_prefix "$S3_PREFIX"
  if [[ -n "$S3_ENDPOINT_URL" ]]; then
    validate_endpoint_tls
  fi

  if [[ "$S3_PROVIDER" == "sakura" ]]; then
    require_env S3_ENDPOINT_URL
    [[ -z "$SSE_KMS_KEY_ID" ]] || die 'SSE_KMS_KEY_ID is not supported by the Sakura profile; use GPG client-side encryption'
    if [[ "$S3_EXECUTION_MODE" == "real" && "$CHECK_WRITE" != "1" ]]; then
      die 'CHECK_WRITE=1 is required for real Sakura readiness evidence'
    fi
  fi

  check_bucket_access
  check_list_access
  if [[ "$S3_PROVIDER" == "aws" ]]; then
    check_bucket_region
    check_bucket_versioning
    check_bucket_encryption
    check_lifecycle
    check_public_access_block
    check_kms_key
  else
    check_bucket_region
    check_bucket_versioning
    check_bucket_acl
    check_sakura_operator_evidence
  fi
  check_write_probe

  if (( warn_count > 0 )); then
    if [[ "$STRICT" == "1" ]]; then
      emit_summary fail "$warn_count" 1
      die "failed with ${warn_count} warning(s)"
    fi
    emit_summary warn "$warn_count" 0
    log "completed with ${warn_count} warning(s)"
    exit 0
  fi

  emit_summary pass 0 0
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
