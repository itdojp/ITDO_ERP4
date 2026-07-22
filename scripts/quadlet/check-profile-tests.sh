#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -z "${TMPDIR:-}" || "$TMPDIR" == /tmp || "$TMPDIR" == /tmp/* ]]; then
  TMPDIR="$ROOT_DIR/.codex-local/tmp"
fi
mkdir -p "$TMPDIR"
WORK_DIR="$(mktemp -d "$TMPDIR/quadlet-profile-tests.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

CHECK_ENV="$ROOT_DIR/scripts/quadlet/check-env.sh"
CHECK_TRIAL="$ROOT_DIR/scripts/quadlet/check-trial-readiness.sh"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_success() {
  local label="$1"
  shift
  printf 'success: %s\n' "$label"
  local stdout_file="$WORK_DIR/${label//[^A-Za-z0-9_.-]/_}.out"
  local stderr_file="$WORK_DIR/${label//[^A-Za-z0-9_.-]/_}.err"
  "$@" >"$stdout_file" 2>"$stderr_file" || {
    cat "$stdout_file"
    cat "$stderr_file" >&2
    fail "expected success: $label"
  }
}

run_failure() {
  local label="$1"
  local pattern="$2"
  shift 2
  local out status
  printf 'failure: %s\n' "$label"
  set +e
  out="$({ "$@"; } 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf '%s\n' "$out"
    fail "expected failure: $label"
  fi
  if ! grep -Eq "$pattern" <<<"$out"; then
    printf '%s\n' "$out"
    fail "expected diagnostic not found for $label: $pattern"
  fi
  printf '%s\n' "$out"
}

write_postgres_env() {
  local dir="$1"
  cat >"$dir/erp4-postgres.env" <<'ENV'
POSTGRES_USER=erp4
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
POSTGRES_DB=postgres
ENV
}

write_private_backend_env() {
  local dir="$1"
  cat >"$dir/erp4-backend.env" <<'ENV'
SAKURA_VPS_PROFILE=private-smoke
DATABASE_URL=postgresql://erp4:REPLACE_WITH_STRONG_PASSWORD@erp4-postgres:5432/postgres?schema=public
PORT=3001
NODE_ENV=development
AUTH_MODE=header
AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=false
ALLOWED_ORIGINS=http://erp4-frontend:8080
MAIL_TRANSPORT=stub
PDF_PROVIDER=local
PDF_STORAGE_DIR=/var/lib/erp4/pdfs
PDF_BASE_URL=http://erp4-backend:3001/pdf-files
EVIDENCE_ARCHIVE_PROVIDER=local
EVIDENCE_ARCHIVE_LOCAL_DIR=/var/lib/erp4/evidence-archives
CHAT_ATTACHMENT_PROVIDER=local
CHAT_ATTACHMENT_LOCAL_DIR=/var/lib/erp4/chat-attachments
REPORT_PROVIDER=local
REPORT_STORAGE_DIR=/var/lib/erp4/reports
ENV
}

write_https_backend_env() {
  local dir="$1"
  cat >"$dir/erp4-backend.env" <<'ENV'
SAKURA_VPS_PROFILE=https-trial
DATABASE_URL=postgresql://erp4:REPLACE_WITH_STRONG_PASSWORD@erp4-postgres:5432/postgres?schema=public
PORT=3001
NODE_ENV=production
AUTH_MODE=jwt_bff
AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=false
ALLOWED_ORIGINS=https://trial-app.example.com
JWT_JWKS_URL=https://www.googleapis.com/oauth2/v3/certs
JWT_ISSUER=https://accounts.google.com
JWT_AUDIENCE=trial-client-id.example.apps.googleusercontent.com
GOOGLE_OIDC_CLIENT_SECRET=REPLACE_WITH_TRIAL_GOOGLE_CLIENT_SECRET
GOOGLE_OIDC_REDIRECT_URI=https://trial-api.example.com/auth/google/callback
AUTH_FRONTEND_ORIGIN=https://trial-app.example.com
AUTH_SESSION_COOKIE_SECURE=true
MAIL_TRANSPORT=stub
PDF_PROVIDER=local
PDF_STORAGE_DIR=/var/lib/erp4/pdfs
PDF_BASE_URL=https://trial-api.example.com/pdf-files
EVIDENCE_ARCHIVE_PROVIDER=local
EVIDENCE_ARCHIVE_LOCAL_DIR=/var/lib/erp4/evidence-archives
CHAT_ATTACHMENT_PROVIDER=local
CHAT_ATTACHMENT_LOCAL_DIR=/var/lib/erp4/chat-attachments
REPORT_PROVIDER=local
REPORT_STORAGE_DIR=/var/lib/erp4/reports
ENV
}

write_frontend_env() {
  local file="$1"
  local api_base="$2"
  cat >"$file" <<ENV
VITE_API_BASE=$api_base
VITE_ENABLE_SW=false
ENV
}

write_private_containers() {
  local dir="$1"
  for name in erp4-backend erp4-frontend erp4-postgres; do
    cat >"$dir/$name.container" <<EOF_CONTAINER
[Container]
Image=localhost/$name:test
Network=erp4.network
EOF_CONTAINER
  done
}

write_https_caddy() {
  local dir="$1"
  cat >"$dir/erp4-caddy.env" <<'ENV'
APP_DOMAIN=trial-app.example.com
API_DOMAIN=trial-api.example.com
ACME_EMAIL=ops@example.com
ENV
  cat >"$dir/erp4-caddy.container" <<'CONTAINER'
[Container]
Image=docker.io/library/caddy:2.9-alpine
PublishPort=0.0.0.0:80:80
PublishPort=0.0.0.0:443:443
CONTAINER
}

make_private_dir() {
  local dir="$1"
  mkdir -p "$dir"
  write_postgres_env "$dir"
  write_private_backend_env "$dir"
  write_private_containers "$dir"
}

make_https_dir() {
  local dir="$1"
  mkdir -p "$dir"
  write_postgres_env "$dir"
  write_https_backend_env "$dir"
  write_private_containers "$dir"
  write_https_caddy "$dir"
}

private_dir="$WORK_DIR/private"
private_frontend="$WORK_DIR/private-frontend.env"
make_private_dir "$private_dir"
write_frontend_env "$private_frontend" 'http://erp4-backend:3001'
run_success 'private-smoke minimal env without Google OIDC' \
  "$CHECK_ENV" --profile private-smoke --target-dir "$private_dir" --frontend-build-env "$private_frontend"

publish_dir="$WORK_DIR/private-publish"
cp -a "$private_dir" "$publish_dir"
printf 'PublishPort=127.0.0.1:55432:5432\n' >>"$publish_dir/erp4-postgres.container"
run_failure 'private-smoke rejects host publish' 'must not publish host ports' \
  "$CHECK_ENV" --profile private-smoke --target-dir "$publish_dir" --frontend-build-env "$private_frontend"

proxy_dir="$WORK_DIR/private-proxy"
cp -a "$private_dir" "$proxy_dir"
: >"$proxy_dir/erp4-caddy.env"
run_failure 'private-smoke rejects proxy files' 'must not install or start Caddy' \
  "$CHECK_ENV" --profile private-smoke --target-dir "$proxy_dir" --frontend-build-env "$private_frontend"

prod_header_dir="$WORK_DIR/private-prod-header"
cp -a "$private_dir" "$prod_header_dir"
python3 - "$prod_header_dir/erp4-backend.env" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
s = s.replace('NODE_ENV=development', 'NODE_ENV=production')
p.write_text(s)
PY
run_failure 'private-smoke rejects production header auth' 'production header auth' \
  "$CHECK_ENV" --profile private-smoke --target-dir "$prod_header_dir" --frontend-build-env "$private_frontend"

https_dir="$WORK_DIR/https"
https_frontend="$WORK_DIR/https-frontend.env"
make_https_dir "$https_dir"
write_frontend_env "$https_frontend" 'https://trial-api.example.com'
run_success 'https-trial minimal env' \
  "$CHECK_ENV" --profile https-trial --target-dir "$https_dir" --frontend-build-env "$https_frontend"

production_gdrive_dir="$WORK_DIR/production-gdrive"
cp -a "$https_dir" "$production_gdrive_dir"
cat >>"$production_gdrive_dir/erp4-backend.env" <<'ENV'
ERP4_GDRIVE_CLIENT_ID=placeholder-common-client
ERP4_GDRIVE_CLIENT_SECRET=placeholder-common-secret
ERP4_GDRIVE_REFRESH_TOKEN=placeholder-common-refresh
ERP4_GDRIVE_SHARED_DRIVE_ID=placeholder-shared-drive
ERP4_GDRIVE_TIMEOUT_MS=30000
ERP4_GDRIVE_MAX_RETRIES=3
ERP4_GDRIVE_RETRY_BASE_DELAY_MS=250
ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES=5242880
CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=placeholder-folder
ENV
sed -i \
  -e 's/^SAKURA_VPS_PROFILE=.*/SAKURA_VPS_PROFILE=production/' \
  -e 's/^CHAT_ATTACHMENT_PROVIDER=.*/CHAT_ATTACHMENT_PROVIDER=gdrive/' \
  "$production_gdrive_dir/erp4-backend.env"
run_success 'production accepts common Google Drive credentials' \
  "$CHECK_ENV" --profile production --target-dir "$production_gdrive_dir" --frontend-build-env "$https_frontend"

production_gdrive_missing_dir="$WORK_DIR/production-gdrive-missing"
cp -a "$production_gdrive_dir" "$production_gdrive_missing_dir"
sed -i '/^ERP4_GDRIVE_CLIENT_SECRET=/d' "$production_gdrive_missing_dir/erp4-backend.env"
run_failure 'production rejects missing Google Drive credential pair' 'complete ERP4_GDRIVE_.*ERP4_GDRIVE_CLIENT_SECRET' \
  "$CHECK_ENV" --profile production --target-dir "$production_gdrive_missing_dir" --frontend-build-env "$https_frontend"

production_gdrive_legacy_dir="$WORK_DIR/production-gdrive-legacy"
cp -a "$production_gdrive_dir" "$production_gdrive_legacy_dir"
sed -i \
  -e 's/^ERP4_GDRIVE_CLIENT_ID=/CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=/' \
  -e 's/^ERP4_GDRIVE_CLIENT_SECRET=/CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET=/' \
  -e 's/^ERP4_GDRIVE_REFRESH_TOKEN=/CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN=/' \
  "$production_gdrive_legacy_dir/erp4-backend.env"
run_success 'production keeps legacy Google Drive credentials compatible' \
  "$CHECK_ENV" --profile production --target-dir "$production_gdrive_legacy_dir" --frontend-build-env "$https_frontend"

production_gdrive_mixed_dir="$WORK_DIR/production-gdrive-mixed"
cp -a "$production_gdrive_legacy_dir" "$production_gdrive_mixed_dir"
sed -i 's/^CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=/ERP4_GDRIVE_CLIENT_ID=/' "$production_gdrive_mixed_dir/erp4-backend.env"
run_failure 'production rejects mixed partial Google Drive credential sets' 'complete ERP4_GDRIVE_.*ERP4_GDRIVE_CLIENT_SECRET' \
  "$CHECK_ENV" --profile production --target-dir "$production_gdrive_mixed_dir" --frontend-build-env "$https_frontend"

production_gdrive_tuning_dir="$WORK_DIR/production-gdrive-tuning"
cp -a "$production_gdrive_dir" "$production_gdrive_tuning_dir"
sed -i 's/^ERP4_GDRIVE_TIMEOUT_MS=.*/ERP4_GDRIVE_TIMEOUT_MS=0/' "$production_gdrive_tuning_dir/erp4-backend.env"
run_failure 'production rejects invalid Google Drive tuning' 'ERP4_GDRIVE_TIMEOUT_MS >= 1' \
  "$CHECK_ENV" --profile production --target-dir "$production_gdrive_tuning_dir" --frontend-build-env "$https_frontend"

production_report_gdrive_dir="$WORK_DIR/production-report-gdrive"
cp -a "$production_gdrive_dir" "$production_report_gdrive_dir"
sed -i \
  -e 's/^CHAT_ATTACHMENT_PROVIDER=.*/CHAT_ATTACHMENT_PROVIDER=local/' \
  -e 's/^REPORT_PROVIDER=.*/REPORT_PROVIDER=gdrive/' \
  "$production_report_gdrive_dir/erp4-backend.env"
printf '%s\n' 'REPORT_GDRIVE_FOLDER_ID=placeholder-report-folder' >>"$production_report_gdrive_dir/erp4-backend.env"
run_success 'production accepts non-Chat Google Drive with common credentials' \
  "$CHECK_ENV" --profile production --target-dir "$production_report_gdrive_dir" --frontend-build-env "$https_frontend"

production_report_legacy_dir="$WORK_DIR/production-report-gdrive-legacy"
cp -a "$production_report_gdrive_dir" "$production_report_legacy_dir"
sed -i \
  -e 's/^ERP4_GDRIVE_CLIENT_ID=/CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=/' \
  -e 's/^ERP4_GDRIVE_CLIENT_SECRET=/CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET=/' \
  -e 's/^ERP4_GDRIVE_REFRESH_TOKEN=/CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN=/' \
  "$production_report_legacy_dir/erp4-backend.env"
run_failure 'production rejects legacy-only credentials for non-Chat Google Drive' 'missing required key: ERP4_GDRIVE_CLIENT_ID' \
  "$CHECK_ENV" --profile production --target-dir "$production_report_legacy_dir" --frontend-build-env "$https_frontend"

production_report_missing_folder_dir="$WORK_DIR/production-report-gdrive-missing-folder"
cp -a "$production_report_gdrive_dir" "$production_report_missing_folder_dir"
sed -i '/^REPORT_GDRIVE_FOLDER_ID=/d' "$production_report_missing_folder_dir/erp4-backend.env"
run_failure 'production rejects missing report Google Drive folder' 'missing required key: REPORT_GDRIVE_FOLDER_ID' \
  "$CHECK_ENV" --profile production --target-dir "$production_report_missing_folder_dir" --frontend-build-env "$https_frontend"

http_redirect_dir="$WORK_DIR/https-http-redirect"
cp -a "$https_dir" "$http_redirect_dir"
python3 - "$http_redirect_dir/erp4-backend.env" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
s = s.replace('https://trial-api.example.com/auth/google/callback', 'http://trial-api.example.com/auth/google/callback')
secret_like = 'GOC' + 'SPX-' + 'do-not-print-test-secret'
s = s.replace('REPLACE_WITH_TRIAL_GOOGLE_CLIENT_SECRET', secret_like)
p.write_text(s)
PY
set +e
secret_output="$({ "$CHECK_ENV" --profile https-trial --target-dir "$http_redirect_dir" --frontend-build-env "$https_frontend"; } 2>&1)"
secret_status=$?
set -e
[[ "$secret_status" -ne 0 ]] || fail 'expected https-trial HTTP redirect failure'
grep -Eq 'requires HTTPS GOOGLE_OIDC_REDIRECT_URI|requires HTTPS' <<<"$secret_output" || {
  printf '%s\n' "$secret_output"
  fail 'expected HTTPS diagnostic for http redirect'
}
secret_like_for_check="GOC""SPX-do-not-print-test-secret"
if grep -q "$secret_like_for_check" <<<"$secret_output"; then
  fail 'check-env output leaked a secret-like value'
fi
printf '%s\n' "$secret_output"

insecure_cookie_dir="$WORK_DIR/https-insecure-cookie"
cp -a "$https_dir" "$insecure_cookie_dir"
python3 - "$insecure_cookie_dir/erp4-backend.env" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text().replace('AUTH_SESSION_COOKIE_SECURE=true', 'AUTH_SESSION_COOKIE_SECURE=false')
p.write_text(s)
PY
run_failure 'https-trial rejects insecure cookie' 'AUTH_SESSION_COOKIE_SECURE=true' \
  "$CHECK_ENV" --profile https-trial --target-dir "$insecure_cookie_dir" --frontend-build-env "$https_frontend"

missing_oidc_dir="$WORK_DIR/https-missing-oidc"
cp -a "$https_dir" "$missing_oidc_dir"
python3 - "$missing_oidc_dir/erp4-backend.env" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
lines = [line for line in p.read_text().splitlines() if not line.startswith('GOOGLE_OIDC_CLIENT_SECRET=')]
p.write_text('\n'.join(lines) + '\n')
PY
run_failure 'https-trial detects missing OIDC secret' 'GOOGLE_OIDC_CLIENT_SECRET' \
  "$CHECK_ENV" --profile https-trial --target-dir "$missing_oidc_dir" --frontend-build-env "$https_frontend"

mixed_origins_dir="$WORK_DIR/https-mixed-origins"
cp -a "$https_dir" "$mixed_origins_dir"
python3 - "$mixed_origins_dir/erp4-backend.env" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text().replace('ALLOWED_ORIGINS=https://trial-app.example.com', 'ALLOWED_ORIGINS=https://trial-app.example.com,http://bad.example.com')
p.write_text(s)
PY
run_failure 'https-trial rejects mixed ALLOWED_ORIGINS with HTTP entry' 'must not use HTTP in ALLOWED_ORIGINS' \
  "$CHECK_ENV" --profile https-trial --target-dir "$mixed_origins_dir" --frontend-build-env "$https_frontend"

wrong_caddy_ports_dir="$WORK_DIR/https-wrong-caddy-ports"
cp -a "$https_dir" "$wrong_caddy_ports_dir"
python3 - "$wrong_caddy_ports_dir/erp4-caddy.container" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
s = s.replace('PublishPort=0.0.0.0:80:80', 'PublishPort=0.0.0.0:8080:80')
s = s.replace('PublishPort=0.0.0.0:443:443', 'PublishPort=0.0.0.0:8443:443')
p.write_text(s)
PY
run_failure 'https-trial requires Caddy host ports 80/443' 'host port 80' \
  "$CHECK_ENV" --profile https-trial --target-dir "$wrong_caddy_ports_dir" --frontend-build-env "$https_frontend"

run_success 'trial readiness private-smoke can skip live stack probes' \
  "$CHECK_TRIAL" --profile private-smoke --target-dir "$private_dir" --frontend-build-env "$private_frontend" --skip-host-check --skip-stack-check
run_failure 'trial readiness rejects private-smoke proxy checks' 'private-smoke must not include proxy' \
  "$CHECK_TRIAL" --profile private-smoke --include-proxy --skip-host-check --skip-env-check --skip-stack-check
run_failure 'trial readiness requires https-trial proxy checks' 'https-trial requires --include-proxy' \
  "$CHECK_TRIAL" --profile https-trial --skip-host-check --skip-env-check --skip-stack-check

storage_service="$ROOT_DIR/deploy/quadlet/erp4-storage-readiness.service"
storage_timer="$ROOT_DIR/deploy/quadlet/erp4-storage-readiness.timer"
grep -Fq 'Type=oneshot' "$storage_service" || fail 'storage readiness must remain oneshot'
grep -Fq './scripts/storage-readiness.sh --format json' "$storage_service" || fail 'storage readiness service entrypoint missing'
grep -Fq 'SyslogIdentifier=erp4-storage-readiness' "$storage_service" || fail 'storage readiness journal identifier missing'
grep -Fq 'Persistent=true' "$storage_timer" || fail 'storage readiness timer must be persistent'
if grep -Eqi '(restore|prune|delete-object|trash)' "$storage_service"; then
  fail 'storage readiness service must not restore, prune, or delete objects'
fi

printf 'OK: Quadlet profile tests passed\n'
