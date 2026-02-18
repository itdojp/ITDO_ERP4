# Secrets/アクセス権限（運用方針）

## 目的

- シークレット漏洩、設定ミス、過剰権限による運用事故を抑える
- 「どこに何があるか」「誰が扱うか」を追跡可能にする

## シークレットの定義

以下をシークレットとして扱います（例）。

- APIキー（OpenAI/SendGrid 等）
- OAuth クライアントシークレット/リフレッシュトークン（Google Drive 等）
- JWT 検証キー/公開鍵（JWKS URL を含む）
- Webhook 署名シークレット
- VAPID 鍵（Push 通知）

## 保管場所（推奨）

- CI/CD: GitHub Actions Secrets（環境単位で分離できる場合は Environment Secrets を優先）
- 実行環境: `.env` / Secret Manager 等（リポジトリにコミットしない）

## 配布/参照の原則

- 最小権限: 「必要な実行主体」のみが参照できる
- 最小公開: ログ/例外/レスポンスにシークレットを出さない
- 変更履歴: 誰が/いつ/何を（少なくとも GitHub 側の履歴で）追跡できる

## ローテーション

推奨トリガ:

- 担当者変更、端末紛失、漏洩疑い、委託先変更
- 重大脆弱性対応（依存更新とは別）
- 期限付きトークンの更新

最低限の運用:

- 重要シークレットは「失効/再発行手順」を docs 化しておく
- ローテーション後は疎通確認（最小のスモーク）を実施し、Issue に記録する

## 定期運用（Issue化ルール）

- 四半期ごとに「Secrets棚卸し/ローテーション」Issue を 1 本起票する。
  - 例: `security(ops): secrets inventory + rotation rehearsal 2026Q1`
- 起票時テンプレート（最低項目）:
  - 対象環境（prod/stg/dev）
  - 対象シークレット（下表参照）
  - 実施担当 / レビュア
  - 実施日 / 完了日
  - 実施結果（成功/失敗/保留）と次アクション
- 既定ラベル: `security`, `ops`, `quarterly`

## 棚卸し（Inventory）

四半期に1回を目安に、以下を更新します。

| 種別    | 名前                                     | 利用箇所         | 保管場所                  | 所有者       | ローテーション          | 最終棚卸し日 | 最終ローテーション/演習日 | 失効手順                                                                  |
| ------- | ---------------------------------------- | ---------------- | ------------------------- | ------------ | ----------------------- | ------------ | ------------------------- | ------------------------------------------------------------------------- |
| OAuth   | `CHAT_ATTACHMENT_GDRIVE_*`               | chat attachments | GitHub Secrets / 実行環境 | Platform/Ops | 半年ごと + 事象発生時   | 2026-02-19   | 未記録                    | Google Cloud Console で旧 credential を revoke し、refresh token を再発行 |
| API key | `SENDGRID_API_KEY`                       | notifier         | GitHub Secrets / 実行環境 | Platform/Ops | 四半期ごと + 事象発生時 | 2026-02-19   | 2026-02-18（演習）        | SendGrid Dashboard で旧 key revoke → 新 key 作成                          |
| API key | `CHAT_EXTERNAL_LLM_OPENAI_API_KEY`       | chat summary     | GitHub Secrets / 実行環境 | Platform/Ops | 四半期ごと + 事象発生時 | 2026-02-19   | 未記録                    | OpenAI console で旧 key revoke → 新 key 作成                              |
| JWT     | `JWT_PUBLIC_KEY` / `JWT_JWKS_URL`        | 認証             | GitHub Secrets / 実行環境 | Platform/Ops | 半年ごと + 事象発生時   | 2026-02-19   | 未記録                    | 新鍵を配備し、旧鍵を無効化（重複期間を短期で設定）                        |
| Push    | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push         | GitHub Secrets / 実行環境 | Platform/Ops | 半年ごと + 事象発生時   | 2026-02-19   | 未記録                    | 新鍵ペア配備後に旧鍵での送信を停止                                        |

- `未記録` の項目は次回の実ローテーション実施時に日付を追記する。

## 失効/再発行手順（主要シークレット）

### 1) JWT（`JWT_PUBLIC_KEY` / `JWT_JWKS_URL`）

1. 新しい公開鍵/JWKS を生成・公開する
2. 実行環境の環境変数を更新する
3. backend 再起動後、認証付き API で疎通確認する
4. 旧鍵を無効化し、Issue に実施時刻を記録する

### 2) Push（`VAPID_*`）

1. 新しい VAPID 鍵ペアを作成する
2. 実行環境へ `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` を反映する
3. Push 通知の送信を検証する（少なくとも 1 件）
4. 旧鍵を失効し、影響範囲を記録する

### 3) OAuth（`CHAT_ATTACHMENT_GDRIVE_*`）

1. OAuth client secret / refresh token を再発行する
2. 実行環境へ反映し backend を再起動する
3. 添付の upload/download をスモーク実施する
4. 旧 token を revoke する

### 4) 外部API（`SENDGRID_API_KEY` / `CHAT_EXTERNAL_LLM_OPENAI_API_KEY`）

1. provider 側で新しい API key を作成する
2. 実行環境へ反映し backend を再起動する
3. notifier / external LLM の疎通を確認する
4. 旧 key を revoke し、Issue に記録する

## ローテーション後のスモーク確認（最小）

- backend 基本疎通:
  - `BASE_URL=http://localhost:3001 ./scripts/smoke-backend.sh`
- メール通知（stub/smtp 設定確認を含む最小チェック）:
  - `npx ts-node --project packages/backend/tsconfig.json scripts/smoke-email.ts`
- 実施結果は `docs/test-results/` の記録と運用Issueに残す（成功/失敗と原因）。

## 演習記録

- 直近演習: `docs/test-results/2026-02-18-secrets-rotation-drill.md`

## 監視（漏洩検知）

- CI で secret scanning を実行（blocking）: `.github/workflows/ci.yml` の `secret-scan` job
- 誤検知は `scripts/secret-scan.allowlist` で最小範囲で除外する
- 検知した場合は該当コミット/PRを特定し、即時失効/再発行を実施

## 最小権限（例）

- DB: アプリ用ユーザはスキーマ単位で必要権限のみ（DDL/スーパーユーザ不可）
- ストレージ（Google Drive 等）: 専用フォルダ/専用アカウント、必要スコープ最小化
- GitHub: Fine-grained PAT / Actions Secrets のアクセス範囲を最小化

### DBユーザ（アプリ用ロール分離）

- 推奨: migrate 実行ユーザ（DDL）とアプリ実行ユーザ（DML）を分離する
- 手順/SQL: `docs/ops/db-roles.md`

## インシデント時

- 影響範囲の特定（漏洩した可能性のあるキー、期間、アクセスログ）
- シークレットの即時失効/再発行
- 必要な場合はユーザ通知/法務対応
- Postmortem（再発防止策を Issue 化）
