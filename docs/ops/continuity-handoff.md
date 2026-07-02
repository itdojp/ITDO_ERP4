# 継続性・引き継ぎ入口

## 目的

コミッターや運用担当が交代しても、ITDO ERP4 の現状把握、開発継続、運用判断、障害対応を開始できるようにするための入口です。詳細手順を重複管理せず、既存 Runbook と品質ドキュメントへの導線を集約します。

## まず確認する順序

1. 全体像と現行スタック
   - [README](../../README.md)
   - [グリーンフィールド理想設計](../architecture/greenfield-ideal-design.md)
2. 開発・レビュー運用
   - [AGENTS.md](../../AGENTS.md)
   - [Definition of Done](../quality/definition-of-done.md)
   - [品質ゲート](../quality/quality-gates.md)
3. 運用 Runbook
   - [運用ドキュメント入口](index.md)
   - [設定（環境変数/シークレット）](configuration.md)
   - [Secrets/アクセス権限](secrets-and-access.md)
4. デプロイ・試験稼働
   - [さくらVPS 導入 Runbook](sakura-vps-deployment.md)
   - [Google Cloud 事前設定](google-cloud-predeployment.md)
   - [導入自動化](ops-automation.md)
5. 障害対応・リリース
   - [一次切り分け Runbook](incident-response.md)
   - [バックアップ/リストア](backup-restore.md)
   - [リリース入口](release.md)
   - [リリースチェックリスト](release-checklist.md)

## 引き継ぎ時の最小確認

- GitHub Issues / Pull Requests の open 状態、Draft PR、CI failure を確認する
- `AGENTS.md` の重要パス定義に該当する変更が pending でないか確認する
- `docs/ops/index.md` から本番/試験稼働に必要な Runbook が辿れることを確認する
- secrets、OAuth client、service account key、VPS credential の実値はリポジトリ外で管理されていることを確認する
- 直近の `docs/test-results/` 証跡と GitHub Actions の最新成功 run を確認する

## 重要パスの引き継ぎ注意点

重要パスは [AGENTS.md](../../AGENTS.md) の「重要パスの独立レビュー」に従います。特に認証/認可、請求/会計、データ移行、Workflow/証跡、本番運用に関わる変更は、作成者と独立したレビュー、CI pass、未解決 review thread 0、rollback 手順の明記を merge 前に確認してください。

## 迷った場合の停止条件

以下のいずれかに該当する場合は、merge や本番適用を停止し、Issue または PR コメントで判断材料を残します。

- 実行対象環境、rollback、データ影響範囲が不明
- 認証緩和、secret 露出、権限拡大の影響が説明できない
- migration/import/export の再実行可否が不明
- CI failure、未解決 review thread、未確認の Copilot suggestion が残っている
- Runbook と実作業の手順が一致しない
