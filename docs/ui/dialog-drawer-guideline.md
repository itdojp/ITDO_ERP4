# Dialog / Drawer 使い分けガイド

最終更新: 2026-02-12

## 目的

画面遷移を伴わない詳細表示・編集UIで、`Dialog` と `Drawer` の適用基準を統一し、UXの一貫性と実装保守性を高める。

## 判断基準

- `Drawer` を使うケース
  - 一覧から詳細を確認しつつ、元の一覧コンテキストを維持したい
  - 情報量が多く、縦スクロールを伴う可能性が高い
  - 詳細内で関連アクション（注釈・更新など）を継続的に実行する
- `Dialog` を使うケース
  - 単発の確認（承認/削除確認など）で、短時間で閉じる前提
  - 入力項目が少なく、モーダル中央表示で十分
  - 重大操作の明示的確認（`ConfirmActionDialog` 含む）

## 既定方針

- 一覧→詳細/編集導線の既定は `Drawer`
- 確認系・短時間操作は `Dialog` / `ConfirmActionDialog`
- 新規画面実装時は本ガイドに従い、例外がある場合は PR に理由を明記する

## 適用済み例

- `packages/frontend/src/sections/Invoices.tsx`
  - 請求一覧→請求詳細を `Drawer` で表示
- `packages/frontend/src/sections/Expenses.tsx`
  - 経費一覧→注釈編集を `Drawer` で表示

## 関連

- Issue: `#941 feat(ui): @itdo/design-system v1.1.0（Issue #75-80追加パターン）をERP4へ段階導入`
