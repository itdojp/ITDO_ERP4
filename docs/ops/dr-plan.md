# DR計画（RTO/RPO）と復元演習

## 目的
バックアップが存在しても「復元できる」保証が無いと運用上の価値が低い。
本ドキュメントでは、暫定の RTO/RPO と、復元手順/演習を定義する。

## 対象（復旧対象）
### 最小（必須）
- PostgreSQL（業務データ）

### 追加（環境により）
- 添付ファイル（チャット添付等）
  - 現時点では、検証環境はローカル保存、将来は S3/Google Drive 等へ移行する可能性がある
- 設定/シークレット
  - `DATABASE_URL`、JWT/認証設定、Push通知鍵（VAPID）、メール設定、暗号鍵（GPG等）

## RTO/RPO（暫定推奨値）
最終値は業務要件（再入力コスト、法令/監査、月次締め等）に基づき確定する必要がある。
ここでは、初期運用を前提に暫定値を置く。

### 重要データ（例: 工数/経費/請求/承認）
- RPO: **1時間**
- RTO: **4時間**

### 通常データ（例: ログ/一部の補助データ）
- RPO: **24時間**
- RTO: **24時間**

## バックアップ方式（現状）
### 検証環境（Podman）
- `scripts/podman-poc.sh backup` / `restore` を使用する（`docs/ops/backup-restore.md`）

### 本番相当（ホスト上のPostgreSQLを想定）
- `scripts/backup-prod.sh` を使用する
  - ローカル保存（`BACKUP_DIR`）
  - 別ホスト退避（`REMOTE_HOST` 等）
  - 暗号化（`GPG_RECIPIENT` 等）
  - S3は未提供の前提でも運用可能（S3関連は後続）

設定例は `docs/requirements/backup-restore.env.example` を参照。

## 復元手順（最小）
### 検証環境（Podman）
1. バックアップ取得（source）
2. 別コンテナへリストア（verify）
3. 整合性チェック実行

復元検証スクリプト:
- `scripts/restore-verify.sh`

### 本番相当（注意）
本番DBへのリストアは破壊的操作になり得るため、原則として「専用の復旧環境」で実施する。
本番環境への直接復元は、影響範囲・切り戻し・個人情報の扱いを含めて判断する。

## 復元演習（定期）
### 方針（暫定）
- まずは **週1回**（検証環境）で実施し、所要時間/失敗要因を記録する
- 本番相当は、実行環境が用意できた時点で定期化（nightly/weekly）

### 記録（テンプレ）
- `docs/test-results/dr-restore-template.md` をコピーし、`docs/test-results/YYYY-MM-DD-dr-restore.md` として保存する

## 関連
- バックアップ/リストア（Runbook）: `docs/ops/backup-restore.md`
- 障害対応: `docs/ops/incident-response.md`

