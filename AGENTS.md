# リポジトリ運用ガイド（Codex/開発者向け）

## 目的

- repo 固有の前提条件と最小品質チェックだけを定義する

## 前提

- Node.js / npm が利用可能であること
- DB / E2E の既定環境は Podman であること

## 基本コマンド

```bash
make lint
make format-check
make typecheck
make build
make test
make audit
make e2e
```

## 補助コマンド

- UI 証跡更新: `make ui-evidence`
- UI visual regression: `make ui-visual-regression`
- UI visual regression baseline 更新: `make ui-visual-regression-update`
- フロントを API 接続で起動: `make frontend-dev-api`
- Podman スモーク検証: `make podman-smoke`
- PR レビューコメント一覧: `make pr-comments PR=123`

補足:

- E2E を直接実行する場合は `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`
- `E2E_PODMAN_HOST_PORT` 未指定時は、既定ポート競合時に空きポートへ自動フォールバックする

## PR レビュー運用

- GitHub PR のレビュー確認は、グローバル skill `pr-review-completeness` を使う
- 特定 review URL / review ID が与えられた場合は、その review 単位で確認する
- review 本文、review comments、review threads、未解決 thread 数の整合が取れるまで「対応不要」と判断しない

## Review guidelines（PRレビュー重点観点）

- docs / scripts / examples / PR本文に、production secret、private key、OAuth client secret、service account key、GitHub token、Slack webhook、Google API key の実値を含めない
- `rm -rf`、`git reset --hard`、`git clean -fd`、`podman volume rm`、DB migration / restore、firewall変更などの破壊的操作は、対象範囲・dry-run・rollback・人間承認条件が明記されているか確認する
- さくらVPS本番導入では、Codexに直接変更させるのではなく、Runbook/スクリプト案・dry-run・証跡整理までを標準範囲とする
- `AUTH_MODE=header` などの認証緩和は local/dev または認証ゲートウェイ内側の限定用途として扱い、本番既定値として記載しない
- Google OAuth / Drive / service account の設定は、最小scope、最小共有権限、redirect URI制限、key保管/rotation/revocation、監査証跡を確認する
- Rootless Podman、Quadlet、Caddy/TLS、backup timer の手順は、権限、永続化、起動確認、rollback、ログ確認が揃っているか確認する
- worktree / clone の新規作成先は `/home/devuser/work/CodeX/ITDO_ERP4/worktrees` または `repos` 配下に限定し、`/tmp` を標準手順にしない
- ops docs/scripts 変更では `docs/ops/codex-ops-workflows.md` の人間承認境界と検証コマンドに反していないか確認する

## 変更前後の最小確認

- 変更内容に応じて `make lint`, `make format-check`, `make typecheck`, `make test` を通す
- 依存更新がある場合は `make audit` を通す
- UI 変更がある場合は `docs/manual/` と `docs/test-results/` の更新要否を確認する
- 仕様変更がある場合は `docs/requirements/` を更新する

## 記録ルール

- 新規依存追加時は、理由・影響・ロールバックを PR 本文に記載する
