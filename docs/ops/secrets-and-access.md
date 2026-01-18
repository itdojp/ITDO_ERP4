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

## 棚卸し（Inventory）
四半期に1回を目安に、以下を更新します。

| 種別 | 名前 | 利用箇所 | 保管場所 | 所有者 | ローテーション | 失効手順 |
|---|---|---|---|---|---|---|
| OAuth | `CHAT_ATTACHMENT_GDRIVE_*` | chat attachments | GitHub Secrets / 実行環境 | - | - | - |
| API key | `SENDGRID_API_KEY` | notifier | GitHub Secrets / 実行環境 | - | - | - |
| API key | `CHAT_EXTERNAL_LLM_OPENAI_API_KEY` | chat summary | GitHub Secrets / 実行環境 | - | - | - |

## 監視（漏洩検知）
- CI で secret scanning を実行（非ブロッキング）: `.github/workflows/ci.yml` の `secret-scan` job
- 検知した場合は該当コミット/PRを特定し、即時失効/再発行を実施

## 最小権限（例）
- DB: アプリ用ユーザはスキーマ単位で必要権限のみ（DDL/スーパーユーザ不可）
- ストレージ（Google Drive 等）: 専用フォルダ/専用アカウント、必要スコープ最小化
- GitHub: Fine-grained PAT / Actions Secrets のアクセス範囲を最小化

## インシデント時
- 影響範囲の特定（漏洩した可能性のあるキー、期間、アクセスログ）
- シークレットの即時失効/再発行
- 必要な場合はユーザ通知/法務対応
- Postmortem（再発防止策を Issue 化）
