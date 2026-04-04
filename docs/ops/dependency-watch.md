# 依存監視 Runbook

## 目的

- `#914`（eslint@10 readiness）
- `#1153`（Dependabot low alert / upstream 追従）

の定期確認手順を 1 箇所にまとめる。

## 前提

- `gh` が利用可能であること
- 依存監視に必要な token / 認証が設定されていること
- `packages/backend` の依存が取得済みであること

## 実行順序

1. Dependabot token の前提を確認する。

   ```bash
   make dependabot-token-readiness-check
   ```

   記録方針:
   - `ready: true/false` と `resultReason` を Issue #1176 または運用Issueに転記する
   - release 証跡へ流用する場合は、同日の Dependabot alerts 記録へ結果を併記する

2. Dependabot alerts の現況を確認する。

   ```bash
   make dependabot-alerts-check
   RUN_CHECK=1 make dependabot-alerts-record
   ```

3. ESLint v10 readiness の現況を確認する。

   ```bash
   make eslint10-readiness-check
   RUN_CHECK=1 make eslint10-readiness-record
   ```

4. 2 と 3 を同じ run label でまとめて記録したい場合は、以下を使う。

   ```bash
   make dependency-watch-record
   ```

   補足:
   - `docs/test-results/YYYY-MM-DD-dependabot-alerts-rN.md`
   - `docs/test-results/YYYY-MM-DD-eslint10-readiness-rN.md`
     を同じ `rN` で生成する。
   - token 前提まで fail-fast したい場合は `RUN_TOKEN_CHECK=1 make dependency-watch-record` を使う。

## 判定基準

### Dependabot alerts

- `actionRequired=false`
  - 現状維持。`#1153` に確認日時と結果を追記する。
- `actionRequired=true`
  - `upstreamUpdated=true` または alert 状態変化を確認し、`#1153` の方針を見直す。
  - 新規対応が必要なら PR または issue を起票する。

### ESLint v10 readiness

- `ready=true`
  - `#914` の再開条件を満たす可能性がある。peer 制約と CI を再確認し、Dependabot PR 再開を判断する。
- `ready=false`
  - 現状維持。`#914` に確認日時と blocker を追記する。

## 記録先

- Dependabot token readiness: `docs/test-results/YYYY-MM-DD-dependabot-alerts-rN.md` に併記、または Issue #1176 / 運用Issueへ転記
- Dependabot alerts: `docs/test-results/YYYY-MM-DD-dependabot-alerts-rN.md`
- ESLint10 readiness: `docs/test-results/YYYY-MM-DD-eslint10-readiness-rN.md`

テンプレート:

- `docs/test-results/dependabot-alerts-template.md`
- `docs/test-results/eslint10-readiness-template.md`

## 関連ドキュメント

- `docs/requirements/ci-plan.md`
- `docs/security/supply-chain.md`
- `docs/ops/security.md`
