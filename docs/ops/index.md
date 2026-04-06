# 運用ドキュメント（Runbook）

## 目的

運用・引き継ぎ・障害対応を成立させるための「入口（目次）」です。運用者はまず本ページから辿ることを想定します。

## 目次

### 起動/デプロイ

- ローカル/PoC 起動: [deploy-start](deploy-start.md)
- さくらVPS（Ubuntu）+ Podman + Quadlet: [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
  - env チェックリスト: [sakura-vps-env-checklist](sakura-vps-env-checklist.md)
  - 試験稼働 Go/No-Go チェックリスト: [sakura-vps-trial-checklist](sakura-vps-trial-checklist.md)
- さくらVPS HTTPS reverse proxy: [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
- Google Workspace OIDC + Auth Gateway 導入: [google-oidc-auth-gateway-rollout](google-oidc-auth-gateway-rollout.md)
- 設定（環境変数/シークレット）: [configuration](configuration.md)
- Secrets/アクセス権限: [secrets-and-access](secrets-and-access.md)
  - DBユーザ最小権限（ロール分離）: [db-roles](db-roles.md)

### バックアップ/リストア

- [backup-restore](backup-restore.md)
  - Quadlet DB backup/restore 補助: [quadlet-db-backup-restore](quadlet-db-backup-restore.md)
  - DR計画（RTO/RPO/復元演習）: [dr-plan](dr-plan.md)
  - 詳細: [docs/requirements/backup-restore.md](../requirements/backup-restore.md)
  - S3決定シート: [backup-s3-decision-checklist](backup-s3-decision-checklist.md)

### 移行（Project-Open → ERP4）

- [migration](migration.md)
  - 詳細: [docs/requirements/migration-runbook.md](../requirements/migration-runbook.md)

### 添付AVスキャン

- [antivirus](antivirus.md)
  - 最終決定記録: [antivirus-decision-record](antivirus-decision-record.md)
  - 運用判断メモ: [antivirus-decision-proposal](antivirus-decision-proposal.md)
  - 詳細: [docs/requirements/chat-attachments-antivirus.md](../requirements/chat-attachments-antivirus.md)

### 監視/障害対応

- health/readiness/ログ: [observability](observability.md)
- SLI/SLO（暫定）: [slo](slo.md)
- アラート設計: [alerting](alerting.md)
  - 発火条件、暫定 SEV、通知テンプレートの入口
- ダッシュボード定義: [dashboard](dashboard.md)
- 一次切り分け（Runbook）: [incident-response](incident-response.md)
  - SEV 判断、初動、症状別 triage、対応中の記録を確認するときの入口
- Postmortem テンプレ: [postmortem-template](postmortem-template.md)
  - 復旧後の振り返り記録を残すときのテンプレ
- ゲームデイ（演習計画）: [game-day](game-day.md)
  - 既存資料: [docs/requirements/ops-monitoring.md](../requirements/ops-monitoring.md)

### リリース

- 入口: [release](release.md)
- 戦略/詳細: [release-strategy](release-strategy.md)
- チェックリスト: [release-checklist](release-checklist.md)
- Feature Flag 運用: [feature-flags](feature-flags.md)

### セキュリティ運用

- [security](security.md)
  - 依存監視手順: [dependency-watch](dependency-watch.md)
  - 供給網セキュリティ: [docs/security/supply-chain.md](../security/supply-chain.md)
  - ベースライン: [docs/security/security-baseline.md](../security/security-baseline.md)
  - ActionPolicy `phase3_strict` trial / cutover / rollback: [action-policy-phase3-strict-rollout](action-policy-phase3-strict-rollout.md)

### 性能

- ベースライン（再計測手順）: [docs/performance/performance-baseline.md](../performance/performance-baseline.md)
- 退行検知ポリシー: [docs/performance/perf-regression-policy.md](../performance/perf-regression-policy.md)
- 計測結果: [docs/test-results/README.md](../test-results/README.md)
