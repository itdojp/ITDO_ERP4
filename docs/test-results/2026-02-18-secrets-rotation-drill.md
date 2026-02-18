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
- スモーク実行: **NG**
  - 失敗内容: `ERR_MODULE_NOT_FOUND`（`packages/backend/src/services/notifier.js` 解決不可）
  - 判定: Runbook には記載したが、PoC 環境での実行前提（ts 実行環境/参照パス）が不足

## フォローアップ

- `scripts/smoke-email.ts` を CI/ローカル双方で実行可能な形に修正する（ts 実行方法の固定 or dist 参照へ変更）
- 次回演習で再実行し、成功ログを本ファイルへ追記する
