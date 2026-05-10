#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="check"
DEPLOY_USER="${ERP4_DEPLOY_USER:-deploy}"
REPO_PARENT="${ERP4_REPO_PARENT:-/opt/itdo}"
REPO_DIR="${ERP4_REPO_DIR:-/opt/itdo/ITDO_ERP4}"
SKIP_APT=0
SKIP_LINGER=0
SET_LOW_PORTS=0
PACKAGES=(git curl jq make ca-certificates unzip ufw fail2ban unattended-upgrades podman uidmap slirp4netns passt fuse-overlayfs)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--check | --dry-run | --apply] [options]

Bootstrap helper for a Sakura VPS host. --check and --dry-run do not modify the host.
--apply can install packages, create directories, and enable linger; low-port sysctl changes
require the additional --set-unprivileged-port-start flag.

Options:
  --check                         Validate current host state only (default)
  --dry-run                       Print commands that would be executed
  --apply                         Execute non-destructive bootstrap steps
  --deploy-user USER              Deploy user for ownership/linger (default: $DEPLOY_USER)
  --repo-parent DIR               Parent directory for repository (default: $REPO_PARENT)
  --repo-dir DIR                  Repository path for evidence output (default: $REPO_DIR)
  --skip-apt                      Skip apt update/install
  --skip-linger                   Skip loginctl enable-linger
  --set-unprivileged-port-start   With --apply, set net.ipv4.ip_unprivileged_port_start=80
  -h, --help                      Show this help message
USAGE
}

require_sudo_for_apply() {
  if [[ "$MODE" == "apply" ]] && ! sudo -n true 2>/dev/null; then
    ops_warn 'sudo may prompt for a password during --apply'
  fi
}

check_state() {
  printf '# ERP4 Sakura VPS bootstrap check (%s)\n' "$(ops_timestamp)"
  printf 'deploy_user=%s\nrepo_parent=%s\nrepo_dir=%s\n' "$DEPLOY_USER" "$REPO_PARENT" "$REPO_DIR"
  if id "$DEPLOY_USER" >/dev/null 2>&1; then
    ops_info "deploy user exists: $DEPLOY_USER"
  else
    ops_warn "deploy user does not exist yet: $DEPLOY_USER"
  fi
  if [[ -d "$REPO_PARENT" ]]; then
    ops_info "repo parent exists: $REPO_PARENT"
  else
    ops_warn "repo parent does not exist yet: $REPO_PARENT"
  fi
  for cmd in sudo apt-get install loginctl podman git curl; do
    if ops_command_exists "$cmd"; then
      ops_info "command available: $cmd"
    else
      ops_warn "command not found: $cmd"
    fi
  done
  "$SCRIPT_DIR/sakura-vps-preflight.sh" --check --repo-dir "$(dirname "$REPO_PARENT")" || true
}

run_apply_or_dry_run() {
  require_sudo_for_apply

  if [[ "$SKIP_APT" -eq 0 ]]; then
    ops_run "$MODE" sudo apt-get update
    ops_run "$MODE" sudo apt-get install -y "${PACKAGES[@]}"
  else
    ops_info 'skipping apt package installation'
  fi

  ops_run "$MODE" sudo install -d -m 0775 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$REPO_PARENT"
  ops_run "$MODE" install -d -m 0700 "$HOME/.local/share/erp4" "$HOME/.local/share/erp4/quadlet-backups" "$HOME/.local/share/erp4/db-backups"

  if [[ "$SKIP_LINGER" -eq 0 ]]; then
    ops_run "$MODE" sudo loginctl enable-linger "$DEPLOY_USER"
  else
    ops_info 'skipping loginctl enable-linger'
  fi

  if [[ "$SET_LOW_PORTS" -eq 1 ]]; then
    if [[ "$MODE" == "dry-run" ]]; then
      printf '[ops][dry-run] echo %q | sudo tee /etc/sysctl.d/90-itdo-rootless-ports.conf\n' 'net.ipv4.ip_unprivileged_port_start=80'
    else
      printf 'net.ipv4.ip_unprivileged_port_start=80\n' | sudo tee /etc/sysctl.d/90-itdo-rootless-ports.conf >/dev/null
    fi
    ops_run "$MODE" sudo sysctl --system
  else
    ops_warn 'not changing net.ipv4.ip_unprivileged_port_start; pass --set-unprivileged-port-start with --apply only after confirming rootless 80/443 requirements'
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
    --deploy-user)
      ops_require_arg "$1" "${2:-}"
      DEPLOY_USER="$2"
      shift 2
      ;;
    --repo-parent)
      ops_require_arg "$1" "${2:-}"
      REPO_PARENT="$2"
      shift 2
      ;;
    --repo-dir)
      ops_require_arg "$1" "${2:-}"
      REPO_DIR="$2"
      REPO_PARENT="$(dirname "$2")"
      shift 2
      ;;
    --skip-apt)
      SKIP_APT=1
      shift
      ;;
    --skip-linger)
      SKIP_LINGER=1
      shift
      ;;
    --set-unprivileged-port-start)
      SET_LOW_PORTS=1
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

case "$MODE" in
  check)
    check_state
    ;;
  dry-run|apply)
    run_apply_or_dry_run
    ;;
  *)
    ops_fail "unknown mode: $MODE"
    ;;
esac
