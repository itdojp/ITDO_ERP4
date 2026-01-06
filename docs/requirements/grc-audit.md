# GRC/監査機能強化 要件整理（初版）

## 目的
- 監査対応に必要な証跡を整備し、改ざん防止と可観測性を高める。
- 権限棚卸しとアクセスレビューを運用で回せる状態にする。

## 対象範囲（案）
- 監査ログの拡充（閲覧/編集/承認/エクスポート）
- 監査レポートの出力（期間/対象/担当）
- 権限棚卸し（ロール/グループ/プロジェクト権限）
- データ保持/削除ポリシー

## PoCスコープ（Phase 3）
- 監査ログの検索/CSV出力（期間/ユーザ/アクション/対象）
- 監査ログ出力の操作自体を監査ログに記録
- アクセス棚卸しスナップショットの出力（ユーザ/グループ/状態）
- 監査ログの改ざん検知（ハッシュチェーン）は次フェーズに持ち越し
- 権限は admin/mgmt/exec を対象（PoC）

## 監査ログ（案）
- 記録項目: who/when/action/target/from/to/reason/actorGroup
- 保存: DB保存、改ざん検知のためのハッシュチェーン検討
- 出力: 期間指定のCSV/PDF

## PoC API（案）
- `GET /audit-logs`
  - query: `from`, `to`, `userId`, `action`, `targetTable`, `targetId`, `format=csv|json`, `limit`
  - json: `{ items: AuditLog[] }`
  - csv: `id,action,userId,targetTable,targetId,createdAt,metadata`
- `GET /access-reviews/snapshot`
  - query: `format=csv|json`
  - json: `{ users: UserAccount[], groups: GroupAccount[], memberships: UserGroup[] }`
  - csv: `userId,userName,active,groupId,groupName`

## PoCでの監査ログ記録
- `audit_log_exported` / `access_review_exported` を記録
- metadata に `filters` / `format` / `rowCount` を保持

## アクセスレビュー（案）
- 定期レビュー（四半期）
- 変更履歴の可視化
- レビュー結果の記録

## 非機能/運用（案）
- 保持期間の法的要件の整理
- マスキング/秘匿の範囲
- 監査対応フロー（依頼→抽出→提出）

## 未決定事項
- 法令準拠の詳細（各国/地域）
- 監査証跡の外部保全の要否
- 監査レポートのフォーマット

## 次アクション
- 監査対象イベントの棚卸し
- 保持期間/出力要件の整理
- アクセスレビューの運用案作成
- PoC実装（監査ログ出力/アクセス棚卸し）
