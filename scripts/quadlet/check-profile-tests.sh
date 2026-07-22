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
INSTALL_UNITS="$ROOT_DIR/scripts/quadlet/install-user-units.sh"
UNINSTALL_STACK="$ROOT_DIR/scripts/quadlet/uninstall-stack.sh"
BACKUP_CONFIG="$ROOT_DIR/scripts/quadlet/backup-config.sh"
CHECK_BACKUP="$ROOT_DIR/scripts/quadlet/check-backup.sh"
RESTORE_CONFIG="$ROOT_DIR/scripts/quadlet/restore-config.sh"
START_STACK="$ROOT_DIR/scripts/quadlet/start-stack.sh"
RESTART_STACK="$ROOT_DIR/scripts/quadlet/restart-stack.sh"
UPDATE_STACK="$ROOT_DIR/scripts/quadlet/update-stack.sh"
ROLLBACK_LATEST="$ROOT_DIR/scripts/quadlet/rollback-latest.sh"

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

installed_private_dir="$WORK_DIR/installed-private"
installed_private_systemd_dir="$WORK_DIR/installed-private-systemd"
installed_private_frontend="$WORK_DIR/installed-private-frontend.env"
run_success 'private-smoke installer selects profile units' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy QUADLET_TARGET_DIR="$installed_private_dir" \
  ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke --systemd-user-target-dir "$installed_private_systemd_dir"
for proxy_artifact in \
  erp4-caddy.container \
  erp4-caddy.env \
  erp4-caddy.Caddyfile \
  erp4-caddy-data.volume \
  erp4-caddy-config.volume; do
  [[ ! -e "$installed_private_dir/$proxy_artifact" ]] || fail "private-smoke installer created proxy artifact: $proxy_artifact"
done
if grep -Eq '^[[:space:]]*PublishPort[[:space:]]*=' "$installed_private_dir/erp4-postgres.container"; then
  fail 'private-smoke installer retained a PostgreSQL host publish port'
fi
grep -Fq 'localhost/erp4-backend:test-profile' "$installed_private_dir/erp4-backend.container" || \
  fail 'private-smoke installer did not render the requested image tag'
for native_unit in \
  erp4-migrate.service \
  erp4-config-backup.service \
  erp4-config-backup.timer \
  erp4-db-backup.service \
  erp4-db-backup.timer \
  erp4-config-prune.service \
  erp4-config-prune.timer \
  erp4-storage-readiness.service \
  erp4-storage-readiness.timer; do
  native_path="$installed_private_systemd_dir/$native_unit"
  [[ -L "$native_path" ]] || fail "installer did not register native systemd user unit: $native_unit"
  [[ "$(readlink "$native_path")" == "$installed_private_dir/$native_unit" ]] || \
    fail "native systemd user unit points outside the managed Quadlet target: $native_unit"
done
if find "$installed_private_systemd_dir" -maxdepth 1 \
  \( -name '*.container' -o -name '*.network' -o -name '*.volume' \) -print -quit | grep -q .; then
  fail 'installer registered a Quadlet source in the native systemd user unit path'
fi
run_success 'private-smoke installer is idempotent for native unit registration' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy QUADLET_TARGET_DIR="$installed_private_dir" \
  SYSTEMD_USER_TARGET_DIR="$installed_private_systemd_dir" ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke

native_collision_dir="$WORK_DIR/native-collision"
mkdir -p "$native_collision_dir"
: >"$native_collision_dir/erp4-migrate.service"
run_failure 'installer refuses unmanaged native systemd unit collision' 'will not be overwritten' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy QUADLET_TARGET_DIR="$WORK_DIR/native-collision-quadlet" \
  SYSTEMD_USER_TARGET_DIR="$native_collision_dir" ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke
[[ ! -e "$WORK_DIR/native-collision-quadlet" ]] || fail 'native unit collision left a partial Quadlet install'
[[ "$(find "$native_collision_dir" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ]] || \
  fail 'native unit collision left partial systemd user registrations'

relative_install_cwd="$WORK_DIR/relative-install-cwd"
mkdir -p "$relative_install_cwd"
run_success 'installer canonicalizes relative native unit link targets' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy ERP4_IMAGE_TAG=test-profile \
  bash -c 'cd "$1" && "$2" --profile private-smoke --target-dir quadlet --systemd-user-target-dir systemd-user' \
  bash "$relative_install_cwd" "$INSTALL_UNITS"
[[ "$(readlink "$relative_install_cwd/systemd-user/erp4-migrate.service")" == \
  "$relative_install_cwd/quadlet/erp4-migrate.service" ]] || \
  fail 'installer wrote a non-canonical relative native unit link target'
run_success 'uninstaller canonicalizes relative managed native unit paths' \
  env SYSTEMCTL=true DISABLE_STACK=/usr/bin/true bash -c \
  'cd "$1" && "$2" --target-dir quadlet --systemd-user-target-dir systemd-user' \
  bash "$relative_install_cwd" "$UNINSTALL_STACK"
[[ ! -e "$relative_install_cwd/systemd-user/erp4-migrate.service" && \
  ! -L "$relative_install_cwd/systemd-user/erp4-migrate.service" ]] || \
  fail 'uninstaller left a managed native unit installed through a relative target path'

write_postgres_env "$installed_private_dir"
write_private_backend_env "$installed_private_dir"
write_frontend_env "$installed_private_frontend" 'http://erp4-backend:3001'
run_success 'installed private-smoke target passes env validation' \
  "$CHECK_ENV" --profile private-smoke --target-dir "$installed_private_dir" --frontend-build-env "$installed_private_frontend"

link_backup_quadlet_dir="$WORK_DIR/link-backup-quadlet"
link_backup_systemd_dir="$WORK_DIR/link-backup-systemd"
link_backup_output_dir="$WORK_DIR/link-backup-output"
link_restore_dir="$WORK_DIR/link-backup-restore"
link_restore_systemd_dir="$WORK_DIR/link-backup-restore-systemd"
link_restore_systemctl_log="$WORK_DIR/link-backup-restore-systemctl.log"
fake_link_restore_systemctl="$WORK_DIR/fake-link-restore-systemctl.sh"
run_success 'default link-mode installer prepares backup fixture' \
  env SYSTEMCTL=true QUADLET_TARGET_DIR="$link_backup_quadlet_dir" \
  SYSTEMD_USER_TARGET_DIR="$link_backup_systemd_dir" ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke
[[ -L "$link_backup_quadlet_dir/erp4-config-backup.service" ]] || \
  fail 'default installer mode did not create the expected managed unit link fixture'
link_backup_archive="$(
  "$BACKUP_CONFIG" \
    --target-dir "$link_backup_quadlet_dir" \
    --output-dir "$link_backup_output_dir" \
    --include-units \
    --print-archive
)"
run_success 'default link-mode unit backup validates as regular files' \
  "$CHECK_BACKUP" --archive "$link_backup_archive"
if tar -tvzf "$link_backup_archive" | grep -Eq '^l'; then
  fail 'default link-mode unit backup retained a symbolic-link archive entry'
fi
for backed_up_name in \
  erp4-storage-readiness.env \
  erp4-storage-readiness.service \
  erp4-storage-readiness.timer; do
  tar -tzf "$link_backup_archive" | grep -Fxq "$backed_up_name" || \
    fail "default link-mode backup omitted storage readiness artifact: $backed_up_name"
done
cat >"$fake_link_restore_systemctl" <<EOF_FAKE_LINK_RESTORE_SYSTEMCTL
#!/usr/bin/env bash
for name in \
  erp4-migrate.service \
  erp4-config-backup.service \
  erp4-config-backup.timer \
  erp4-db-backup.service \
  erp4-db-backup.timer \
  erp4-config-prune.service \
  erp4-config-prune.timer \
  erp4-storage-readiness.service \
  erp4-storage-readiness.timer; do
  [[ -L "$link_restore_systemd_dir/\$name" ]] || exit 1
done
printf '%s\n' "\$*" >"$link_restore_systemctl_log"
EOF_FAKE_LINK_RESTORE_SYSTEMCTL
chmod +x "$fake_link_restore_systemctl"
run_success 'default link-mode unit backup restores independently of source links' \
  env SYSTEMCTL="$fake_link_restore_systemctl" "$RESTORE_CONFIG" \
  --archive "$link_backup_archive" --target-dir "$link_restore_dir" \
  --systemd-user-target-dir "$link_restore_systemd_dir"
grep -Fxq -- '--user daemon-reload' "$link_restore_systemctl_log" || \
  fail 'restore did not reload systemd after registering native units'
for restored_name in \
  erp4-migrate.service \
  erp4-config-backup.service \
  erp4-config-backup.timer \
  erp4-db-backup.service \
  erp4-db-backup.timer \
  erp4-config-prune.service \
  erp4-config-prune.timer \
  erp4-storage-readiness.service \
  erp4-storage-readiness.timer; do
  [[ -f "$link_restore_dir/$restored_name" && ! -L "$link_restore_dir/$restored_name" ]] || \
    fail "restored native unit is not a regular file: $restored_name"
  [[ -L "$link_restore_systemd_dir/$restored_name" ]] || \
    fail "restore did not register native systemd unit: $restored_name"
  [[ "$(readlink "$link_restore_systemd_dir/$restored_name")" == "$link_restore_dir/$restored_name" ]] || \
    fail "restored native systemd unit points outside the restore target: $restored_name"
done

link_restore_skip_dir="$WORK_DIR/link-backup-restore-skip-reload"
link_restore_skip_systemd_dir="$WORK_DIR/link-backup-restore-skip-reload-systemd"
run_success 'restore skip-daemon-reload still registers native systemd units' \
  env SYSTEMCTL=/usr/bin/false "$RESTORE_CONFIG" --archive "$link_backup_archive" \
  --target-dir "$link_restore_skip_dir" --systemd-user-target-dir "$link_restore_skip_systemd_dir" \
  --skip-daemon-reload
[[ -L "$link_restore_skip_systemd_dir/erp4-migrate.service" ]] || \
  fail 'restore --skip-daemon-reload skipped native systemd unit registration'

relative_restore_cwd="$WORK_DIR/relative-restore-cwd"
mkdir -p "$relative_restore_cwd"
run_success 'restore canonicalizes relative native unit link targets' \
  env SYSTEMCTL=/usr/bin/false bash -c \
  'cd "$1" && "$2" --archive "$3" --target-dir quadlet --systemd-user-target-dir systemd-user --skip-daemon-reload' \
  bash "$relative_restore_cwd" "$RESTORE_CONFIG" "$link_backup_archive"
[[ "$(readlink "$relative_restore_cwd/systemd-user/erp4-migrate.service")" == \
  "$relative_restore_cwd/quadlet/erp4-migrate.service" ]] || \
  fail 'restore wrote a non-canonical relative native unit link target'

restore_collision_dir="$WORK_DIR/link-backup-restore-collision"
restore_collision_systemd_dir="$WORK_DIR/link-backup-restore-collision-systemd"
mkdir -p "$restore_collision_systemd_dir"
: >"$restore_collision_systemd_dir/erp4-migrate.service"
run_failure 'restore rejects unmanaged native systemd unit collision before extraction' 'will not be overwritten' \
  "$RESTORE_CONFIG" --archive "$link_backup_archive" --target-dir "$restore_collision_dir" \
  --systemd-user-target-dir "$restore_collision_systemd_dir" --skip-daemon-reload
[[ ! -e "$restore_collision_dir" ]] || fail 'native unit collision left a partial restore target'

restore_latest_args_file="$WORK_DIR/restore-latest-args.txt"
fake_list_backups="$WORK_DIR/fake-list-backups.sh"
fake_restore_config="$WORK_DIR/fake-restore-config.sh"
cat >"$fake_list_backups" <<EOF_FAKE_LIST_BACKUPS
#!/usr/bin/env bash
printf '%s\n' "$link_backup_archive"
EOF_FAKE_LIST_BACKUPS
cat >"$fake_restore_config" <<EOF_FAKE_RESTORE_CONFIG
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$restore_latest_args_file"
EOF_FAKE_RESTORE_CONFIG
chmod +x "$fake_list_backups" "$fake_restore_config"
run_success 'restore-latest propagates native systemd target dir' \
  env LIST_BACKUPS_SCRIPT="$fake_list_backups" RESTORE_CONFIG_SCRIPT="$fake_restore_config" \
  "$ROOT_DIR/scripts/quadlet/restore-latest.sh" --target-dir "$link_restore_dir" \
  --systemd-user-target-dir "$link_restore_systemd_dir" --overwrite --skip-daemon-reload
grep -Fq -- "--systemd-user-target-dir $link_restore_systemd_dir" "$restore_latest_args_file" || \
  fail 'restore-latest did not propagate systemd-user-target-dir to restore-config'

unsafe_backup_dir="$WORK_DIR/unsafe-backup-source"
mkdir -p "$unsafe_backup_dir"
printf 'not-a-runtime-env\n' >"$WORK_DIR/outside.env"
ln -s "$WORK_DIR/outside.env" "$unsafe_backup_dir/erp4-postgres.env"
run_failure 'config backup rejects env symlink dereference' 'env/config backup source must not be a symlink' \
  "$BACKUP_CONFIG" --target-dir "$unsafe_backup_dir" --output-dir "$WORK_DIR/unsafe-backup-output"

uninstall_quadlet_dir="$WORK_DIR/uninstall-quadlet"
uninstall_systemd_dir="$WORK_DIR/uninstall-systemd"
uninstall_systemctl_log="$WORK_DIR/uninstall-systemctl.log"
fake_uninstall_systemctl="$WORK_DIR/fake-uninstall-systemctl.sh"
cat >"$fake_uninstall_systemctl" <<EOF_FAKE_SYSTEMCTL
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$uninstall_systemctl_log"
EOF_FAKE_SYSTEMCTL
chmod +x "$fake_uninstall_systemctl"
run_success 'installer prepares managed native link uninstall fixture' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy QUADLET_TARGET_DIR="$uninstall_quadlet_dir" \
  SYSTEMD_USER_TARGET_DIR="$uninstall_systemd_dir" ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke
run_success 'uninstaller removes all managed native links' \
  env SYSTEMCTL="$fake_uninstall_systemctl" DISABLE_STACK=/usr/bin/true QUADLET_TARGET_DIR="$uninstall_quadlet_dir" \
  SYSTEMD_USER_TARGET_DIR="$uninstall_systemd_dir" \
  "$UNINSTALL_STACK" --target-dir "$uninstall_quadlet_dir" --systemd-user-target-dir "$uninstall_systemd_dir"
for native_unit in \
  erp4-migrate.service \
  erp4-config-backup.service \
  erp4-config-backup.timer \
  erp4-db-backup.service \
  erp4-db-backup.timer \
  erp4-config-prune.service \
  erp4-config-prune.timer \
  erp4-storage-readiness.service \
  erp4-storage-readiness.timer; do
  [[ ! -e "$uninstall_systemd_dir/$native_unit" && ! -L "$uninstall_systemd_dir/$native_unit" ]] || \
    fail "uninstaller left a managed native link behind: $native_unit"
  [[ ! -e "$uninstall_quadlet_dir/$native_unit" && ! -L "$uninstall_quadlet_dir/$native_unit" ]] || \
    fail "uninstaller left a managed native source behind: $native_unit"
  grep -Fq -- "$native_unit" "$uninstall_systemctl_log" || \
    fail "uninstaller did not disable managed native unit: $native_unit"
done
grep -Fq -- '--user disable --now' "$uninstall_systemctl_log" || \
  fail 'uninstaller did not stop and disable managed native units before removal'

same_target_dir="$WORK_DIR/uninstall-same-target"
same_target_systemctl_log="$WORK_DIR/uninstall-same-target-systemctl.log"
fake_same_target_systemctl="$WORK_DIR/fake-uninstall-same-target-systemctl.sh"
cat >"$fake_same_target_systemctl" <<EOF_FAKE_SYSTEMCTL
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$same_target_systemctl_log"
EOF_FAKE_SYSTEMCTL
chmod +x "$fake_same_target_systemctl"
run_success 'installer prepares shared Quadlet and systemd target fixture' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy QUADLET_TARGET_DIR="$same_target_dir" \
  SYSTEMD_USER_TARGET_DIR="$same_target_dir" ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke
printf '%064d\n' 0 >"$same_target_dir/erp4-postgres-unit.sha256"
run_success 'uninstaller disables native units when target directories are identical' \
  env SYSTEMCTL="$fake_same_target_systemctl" DISABLE_STACK=/usr/bin/true QUADLET_TARGET_DIR="$same_target_dir" \
  SYSTEMD_USER_TARGET_DIR="$same_target_dir" \
  "$UNINSTALL_STACK" --target-dir "$same_target_dir" --systemd-user-target-dir "$same_target_dir" --purge-config
for native_unit in \
  erp4-migrate.service \
  erp4-config-backup.service \
  erp4-config-backup.timer \
  erp4-db-backup.service \
  erp4-db-backup.timer \
  erp4-config-prune.service \
  erp4-config-prune.timer \
  erp4-storage-readiness.service \
  erp4-storage-readiness.timer; do
  grep -Fq -- "$native_unit" "$same_target_systemctl_log" || \
    fail "same-target uninstaller did not disable managed native unit: $native_unit"
done
[[ ! -e "$same_target_dir/erp4-postgres-unit.sha256" && ! -L "$same_target_dir/erp4-postgres-unit.sha256" ]] || \
  fail 'uninstaller left managed PostgreSQL unit state behind'
for purged_config in \
  erp4-postgres.env \
  erp4-backend.env \
  erp4-frontend-build.env \
  erp4-maintenance.env \
  erp4-storage-readiness.env; do
  [[ ! -e "$same_target_dir/$purged_config" && ! -L "$same_target_dir/$purged_config" ]] || \
    fail "uninstaller --purge-config left managed config behind: $purged_config"
done

stale_proxy_dir="$WORK_DIR/private-stale-proxy"
mkdir -p "$stale_proxy_dir"
: >"$stale_proxy_dir/erp4-caddy.env"
run_failure 'private-smoke installer rejects stale proxy artifacts' 'back up and remove proxy artifacts explicitly' \
  env SYSTEMCTL=true QUADLET_INSTALL_MODE=copy QUADLET_TARGET_DIR="$stale_proxy_dir" \
  SYSTEMD_USER_TARGET_DIR="$WORK_DIR/stale-proxy-systemd" ERP4_IMAGE_TAG=test-profile \
  "$INSTALL_UNITS" --profile private-smoke

profile_args_file="$WORK_DIR/profile-args.txt"
fake_check_env="$WORK_DIR/fake-check-env.sh"
cat >"$fake_check_env" <<EOF_FAKE_CHECK
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$profile_args_file"
EOF_FAKE_CHECK
chmod +x "$fake_check_env"
run_success 'start stack propagates private-smoke profile' \
  env CHECK_ENV="$fake_check_env" CHECK_STACK=true SYSTEMCTL=true QUADLET_TARGET_DIR="$installed_private_dir" \
  "$START_STACK" --profile private-smoke --skip-stack-check
grep -Fq -- '--profile private-smoke' "$profile_args_file" || fail 'start-stack did not propagate private-smoke to check-env'
[[ -f "$installed_private_dir/erp4-postgres-unit.sha256" && ! -L "$installed_private_dir/erp4-postgres-unit.sha256" ]] || \
  fail 'start-stack did not record PostgreSQL unit state'
[[ "$(stat -c %a "$installed_private_dir/erp4-postgres-unit.sha256")" == 600 ]] || \
  fail 'PostgreSQL unit state is not owner-only'
run_failure 'start stack rejects private-smoke proxy' 'private-smoke must not include proxy' \
  env SYSTEMCTL=true "$START_STACK" --profile private-smoke --include-proxy --skip-env-check --skip-stack-check

fake_stop="$WORK_DIR/fake-stop.sh"
fake_start="$WORK_DIR/fake-start.sh"
printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_stop"
cat >"$fake_start" <<EOF_FAKE_START
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$profile_args_file"
EOF_FAKE_START
chmod +x "$fake_stop" "$fake_start"
run_success 'restart stack propagates private-smoke profile' \
  env STOP_STACK="$fake_stop" START_STACK="$fake_start" SYSTEMCTL=true \
  "$RESTART_STACK" --profile private-smoke --skip-stack-check
grep -Fq -- '--profile private-smoke' "$profile_args_file" || fail 'restart-stack did not propagate private-smoke to start-stack'
run_success 'restart stack propagates https-trial proxy profile' \
  env STOP_STACK="$fake_stop" START_STACK="$fake_start" SYSTEMCTL=true \
  "$RESTART_STACK" --profile https-trial --include-proxy --skip-stack-check
grep -Fq -- '--profile https-trial' "$profile_args_file" || fail 'restart-stack did not propagate https-trial to start-stack'
grep -Fq -- '--include-proxy' "$profile_args_file" || fail 'restart-stack did not propagate include-proxy to start-stack'

fake_install="$WORK_DIR/fake-install.sh"
cat >"$fake_install" <<EOF_FAKE_INSTALL
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$profile_args_file"
EOF_FAKE_INSTALL
chmod +x "$fake_install"
run_success 'update stack propagates private-smoke profile' \
  env QUADLET_TARGET_DIR="$installed_private_dir" INSTALL_UNITS="$fake_install" SYSTEMCTL=true \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check
grep -Fq -- '--profile private-smoke' "$profile_args_file" || fail 'update-stack did not propagate private-smoke to install-user-units'

update_target_dir="$WORK_DIR/update-profile-target"
update_systemctl_log="$WORK_DIR/update-profile-systemctl.log"
update_podman_log="$WORK_DIR/update-profile-podman.log"
fake_update_install="$WORK_DIR/fake-update-install.sh"
fake_update_systemctl="$WORK_DIR/fake-update-systemctl.sh"
fake_update_podman="$WORK_DIR/fake-update-podman.sh"
mkdir -p "$update_target_dir"
cp "$ROOT_DIR/deploy/quadlet/erp4-postgres.container" "$update_target_dir/erp4-postgres.container"
cat >"$fake_update_install" <<EOF_FAKE_UPDATE_INSTALL
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$profile_args_file"
cp "$ROOT_DIR/deploy/quadlet/profiles/private-smoke/erp4-postgres.container" \
  "$update_target_dir/erp4-postgres.container"
EOF_FAKE_UPDATE_INSTALL
cat >"$fake_update_systemctl" <<EOF_FAKE_UPDATE_SYSTEMCTL
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$update_systemctl_log"
EOF_FAKE_UPDATE_SYSTEMCTL
cat >"$fake_update_podman" <<EOF_FAKE_UPDATE_PODMAN
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$update_podman_log"
EOF_FAKE_UPDATE_PODMAN
chmod +x "$fake_update_install" "$fake_update_systemctl" "$fake_update_podman"
run_success 'update stack restarts PostgreSQL when private-smoke changes its unit' \
  env QUADLET_TARGET_DIR="$update_target_dir" INSTALL_UNITS="$fake_update_install" \
  SYSTEMCTL="$fake_update_systemctl" PODMAN="$fake_update_podman" POSTGRES_READY_TIMEOUT_SECONDS=2 \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check
[[ "$(sed -n '1p' "$update_systemctl_log")" == '--user restart erp4-postgres.service' ]] || \
  fail 'update-stack did not restart changed PostgreSQL unit before migrations'
grep -Fxq -- 'exec erp4-postgres pg_isready -U erp4 -t 1' "$update_podman_log" || \
  fail 'update-stack did not wait for PostgreSQL readiness after profile change'
grep -Fq -- '--profile private-smoke' "$profile_args_file" || \
  fail 'profile-changing update did not propagate private-smoke to installer'

: >"$update_systemctl_log"
: >"$update_podman_log"
run_success 'update stack avoids PostgreSQL restart when its profile unit is unchanged' \
  env QUADLET_TARGET_DIR="$update_target_dir" INSTALL_UNITS="$fake_update_install" \
  SYSTEMCTL="$fake_update_systemctl" PODMAN="$fake_update_podman" POSTGRES_READY_TIMEOUT_SECONDS=2 \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check
if grep -Fq -- 'erp4-postgres.service' "$update_systemctl_log"; then
  fail 'update-stack restarted unchanged PostgreSQL unit'
fi
[[ ! -s "$update_podman_log" ]] || fail 'update-stack probed PostgreSQL even though its unit was unchanged'

link_update_source="$WORK_DIR/update-link-source.container"
link_update_target="$WORK_DIR/update-link-target"
fake_link_update_install="$WORK_DIR/fake-link-update-install.sh"
mkdir -p "$link_update_target"
cp "$ROOT_DIR/deploy/quadlet/profiles/private-smoke/erp4-postgres.container" "$link_update_source"
ln -s "$link_update_source" "$link_update_target/erp4-postgres.container"
sha256sum "$link_update_source" | awk '{print $1}' >"$link_update_target/erp4-postgres-unit.sha256"
chmod 0600 "$link_update_target/erp4-postgres-unit.sha256"
cat >"$fake_link_update_install" <<EOF_FAKE_LINK_UPDATE_INSTALL
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$profile_args_file"
EOF_FAKE_LINK_UPDATE_INSTALL
chmod +x "$fake_link_update_install"
printf '\n# same-profile content update\n' >>"$link_update_source"
: >"$update_systemctl_log"
: >"$update_podman_log"
run_success 'update stack detects same-profile content changes through a stable unit symlink' \
  env QUADLET_TARGET_DIR="$link_update_target" INSTALL_UNITS="$fake_link_update_install" \
  SYSTEMCTL="$fake_update_systemctl" PODMAN="$fake_update_podman" POSTGRES_READY_TIMEOUT_SECONDS=2 \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check
[[ "$(sed -n '1p' "$update_systemctl_log")" == '--user restart erp4-postgres.service' ]] || \
  fail 'update-stack did not restart PostgreSQL after same-path unit content change'
[[ "$(cat "$link_update_target/erp4-postgres-unit.sha256")" == "$(sha256sum "$link_update_source" | awk '{print $1}')" ]] || \
  fail 'update-stack did not record the applied same-profile unit content hash'

chmod 0644 "$link_update_target/erp4-postgres-unit.sha256"
: >"$update_systemctl_log"
run_success 'update stack replaces a non-owner-only unit state after a safe PostgreSQL restart' \
  env QUADLET_TARGET_DIR="$link_update_target" INSTALL_UNITS="$fake_link_update_install" \
  SYSTEMCTL="$fake_update_systemctl" PODMAN="$fake_update_podman" POSTGRES_READY_TIMEOUT_SECONDS=2 \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check
[[ "$(sed -n '1p' "$update_systemctl_log")" == '--user restart erp4-postgres.service' ]] || \
  fail 'update-stack trusted a non-owner-only PostgreSQL unit state'
[[ "$(stat -c %a "$link_update_target/erp4-postgres-unit.sha256")" == 600 ]] || \
  fail 'update-stack did not replace PostgreSQL unit state with owner-only permissions'

unsafe_state_target="$WORK_DIR/update-unsafe-state-target"
mkdir -p "$unsafe_state_target"
cp "$ROOT_DIR/deploy/quadlet/profiles/private-smoke/erp4-postgres.container" \
  "$unsafe_state_target/erp4-postgres.container"
printf '%064d\n' 0 >"$WORK_DIR/outside-unit-state"
ln -s "$WORK_DIR/outside-unit-state" "$unsafe_state_target/erp4-postgres-unit.sha256"
run_failure 'update stack rejects a symbolic-link unit state file' 'unit state must not be a symlink' \
  env QUADLET_TARGET_DIR="$unsafe_state_target" INSTALL_UNITS="$fake_link_update_install" SYSTEMCTL=true \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check

fake_unready_podman="$WORK_DIR/fake-update-unready-podman.sh"
cat >"$fake_unready_podman" <<EOF_FAKE_UNREADY_PODMAN
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$update_podman_log"
exit 1
EOF_FAKE_UNREADY_PODMAN
chmod +x "$fake_unready_podman"
cp "$ROOT_DIR/deploy/quadlet/erp4-postgres.container" "$update_target_dir/erp4-postgres.container"
sha256sum "$update_target_dir/erp4-postgres.container" | awk '{print $1}' >"$update_target_dir/erp4-postgres-unit.sha256"
: >"$update_systemctl_log"
: >"$update_podman_log"
run_failure 'update stack fails before migration when changed PostgreSQL is not ready' 'did not become ready' \
  env QUADLET_TARGET_DIR="$update_target_dir" INSTALL_UNITS="$fake_update_install" \
  SYSTEMCTL="$fake_update_systemctl" PODMAN="$fake_unready_podman" POSTGRES_READY_TIMEOUT_SECONDS=1 \
  "$UPDATE_STACK" --profile private-smoke --skip-build --skip-stack-check
if grep -Fq -- 'erp4-migrate.service' "$update_systemctl_log"; then
  fail 'update-stack continued to migration after PostgreSQL readiness failure'
fi

fake_restore="$WORK_DIR/fake-restore.sh"
fake_restart="$WORK_DIR/fake-restart.sh"
rollback_restore_args_file="$WORK_DIR/rollback-restore-args.txt"
rollback_systemd_dir="$WORK_DIR/rollback-systemd"
printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_restore"
cat >"$fake_restore" <<EOF_FAKE_RESTORE
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$rollback_restore_args_file"
EOF_FAKE_RESTORE
cat >"$fake_restart" <<EOF_FAKE_RESTART
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$profile_args_file"
EOF_FAKE_RESTART
chmod +x "$fake_restore" "$fake_restart"
run_success 'rollback latest propagates private-smoke profile' \
  env RESTORE_LATEST="$fake_restore" RESTART_STACK="$fake_restart" \
  "$ROLLBACK_LATEST" --profile private-smoke --backup-dir "$WORK_DIR" --target-dir "$installed_private_dir" \
  --systemd-user-target-dir "$rollback_systemd_dir" --skip-stack-check
grep -Fq -- '--profile private-smoke' "$profile_args_file" || fail 'rollback-latest did not propagate private-smoke to restart-stack'
grep -Fq -- "--systemd-user-target-dir $rollback_systemd_dir" "$rollback_restore_args_file" || \
  fail 'rollback-latest did not propagate systemd-user-target-dir to restore-latest'
run_failure 'rollback latest rejects private-smoke proxy' 'private-smoke must not include proxy' \
  "$ROLLBACK_LATEST" --profile private-smoke --include-proxy --skip-restart

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
