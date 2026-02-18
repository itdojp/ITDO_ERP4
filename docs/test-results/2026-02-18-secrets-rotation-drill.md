# Secrets Rotation Drill (2026-02-18)

## 実施概要

| 項目             | 内容                             |
| ---------------- | -------------------------------- |
| 実施日           | 2026-02-18                       |
| 種別             | Tabletop + 手順検証（PoC環境）   |
| 対象Runbook      | `docs/ops/secrets-and-access.md` |
| 対象シークレット | `SENDGRID_API_KEY`（外部API）    |
| 実施者           | Codex CLI                        |

## シナリオ

- 想定インシデント: `SENDGRID_API_KEY` 漏洩疑い
- 目標:
  1. 失効/再発行の手順が Runbook 上で追えること
  2. ローテーション後スモーク手順が実行可能であること

## 実施内容

1. Runbook に沿って「再発行 → 実行環境反映 → スモーク → 旧鍵失効」の手順を確認
2. スモーク手順として次コマンドを実行
   - `npx ts-node --esm scripts/smoke-email.ts`

## 結果

- 手順定義: **OK**
- スモーク実行（初回 2026-02-18）: **NG**
  - 失敗内容: `ERR_MODULE_NOT_FOUND`（`packages/backend/src/services/notifier.js` 解決不可）
  - 判定: Runbook には記載したが、PoC 環境での実行前提（ts 実行環境/参照パス）が不足
- スモーク再実行（再実施 2026-02-19）: **OK**
  - 実行コマンド: `npx ts-node --project packages/backend/tsconfig.json scripts/smoke-email.ts`
  - 結果: `stub: invalid recipients fail / stub: valid recipients pass / smtp: missing config fails` が全て PASS

## フォローアップ

- Issue: #1148（`scripts/smoke-email.ts` の実行互換性修正）
- 対応: dist 参照へ修正し、Runbook と演習記録を更新済み
