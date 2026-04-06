# さくらVPS 試験稼働記録テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象ホスト名:
- VPS IP:
- 対象ブランチ / commit SHA:
- 実行 Runbook: `docs/ops/sakura-vps-podman-trial.md`
- 受入確認コマンド: `./scripts/quadlet/check-trial-readiness.sh`

## 1. 前提確認
- `./scripts/quadlet/check-host-prereqs.sh`
  - 結果:
- `./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env`
  - 結果:
- `./scripts/quadlet/check-env.sh`
  - 結果:
- 必要時 `./scripts/quadlet/check-proxy.sh`
  - 結果:

## 2. build / 配置 / 起動
- `./scripts/quadlet/build-images.sh`
  - backend image:
  - frontend image:
- `./scripts/quadlet/install-user-units.sh`
  - 結果:
- `./scripts/quadlet/start-stack.sh`
  - 結果:
- 必要時 `./scripts/quadlet/start-stack.sh --include-proxy`
  - 結果:

## 3. 受入確認
- `./scripts/quadlet/check-trial-readiness.sh`
  - 結果:
- 必要時 `./scripts/quadlet/check-trial-readiness.sh --include-proxy --resolve-ip <VPS_IP>`
  - 結果:
- `./scripts/quadlet/status-stack.sh`
  - 結果:
- 必要時 `./scripts/quadlet/status-stack.sh --include-proxy`
  - 結果:

## 4. 採取した証跡
- `./scripts/quadlet/logs-stack.sh --lines 100`
  - 保存先:
- 必要時 `./scripts/quadlet/logs-stack.sh --include-proxy --lines 100`
  - 保存先:
- `systemctl --user list-timers 'erp4-*'`
  - 保存先:
- `/healthz`:
- `/readyz`:
- frontend HTTP probe:
- 必要時 `check-https.sh`:

## 5. 判定
- Go / No-Go:
- 判定理由:
- 未解消リスク:

## 6. 切り戻し実施時のみ
- 実施コマンド:
  - `./scripts/quadlet/stop-stack.sh`
  - 必要時 `./scripts/quadlet/stop-stack.sh --include-proxy`
  - 必要時 `./scripts/quadlet/rollback-latest.sh --skip-stack-check`
- 結果:
- 追加対応:
