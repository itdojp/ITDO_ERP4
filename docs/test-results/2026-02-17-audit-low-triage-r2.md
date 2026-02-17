# Audit Low Triage (R2) - 2026-02-17

## 実行コマンド
- `npm audit --prefix packages/backend --audit-level=low --json`
- `npm audit --prefix packages/frontend --audit-level=low --json`
- `gh api repos/itdojp/ITDO_ERP4/dependabot/alerts/10`

## 結果サマリ
- backend: low=0 / moderate=7 / high=0 / critical=0
- frontend: low=0 / moderate=0 / high=0 / critical=0
- Dependabot alert: 1件 open（low）
  - Alert: `#10` / `GHSA-w7fw-mjwx-w883` / `CVE-2026-2391`
  - package: `qs`（transitive, runtime）
  - manifest: `packages/backend/package-lock.json`

## 影響評価
- 現在の lockfile 上の `node_modules/qs` は `6.15.0`（patched range `6.14.2+` を満たす）。
- Alert は `googleapis-common@8.0.1 -> qs:^6.7.0` の宣言レンジに起因して検出されている。
- 脆弱性の発現条件は `qs.parse(..., { comma: true })` で、既定値（`comma: false`）では発現しない。
- ERP4 backend で `qs` の `comma:true` を利用しているコードは確認できなかった。

## 方針
- **今回判断: 許容（暫定）**
  - 理由1: 実解決バージョンは patched（`6.15.0`）。
  - 理由2: 発現条件（`comma:true`）を現行実装で使っていない。
  - 理由3: upstream (`googleapis-common`) 側が `qs:^6.7.0` を維持しており、依存元更新のみで警告が解消しない。

## 再確認条件
- 週次（または依存更新PR時）に Dependabot alert #10 を再確認する。
- `googleapis` / `googleapis-common` 更新時に alert自動解消の有無を確認する。
- backend に `qs` 直接利用を追加する場合、`comma:true` を禁止し回帰テストを追加する。

## 参照
- https://github.com/itdojp/ITDO_ERP4/security/dependabot/10
- https://github.com/advisories/GHSA-w7fw-mjwx-w883
- 集約Issue: #1001
