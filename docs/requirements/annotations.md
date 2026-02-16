# 注釈（メモ/外部URL/内部参照）仕様

## 目的

- 申請・承認の根拠を、対象ドキュメント単位で一元管理する。
- 根拠更新の監査可能性（変更履歴、理由、更新者）を担保する。
- 将来の上限値調整をコード変更なしで運用設定から行えるようにする。

## 対象

- 対象 API
  - `GET /annotations/:kind/:id`
  - `PATCH /annotations/:kind/:id`
  - `GET /annotations/:kind/:id/history`
  - `GET /annotation-settings`
  - `PATCH /annotation-settings`
- 実装
  - Backend: `packages/backend/src/routes/annotations.ts`
  - Backend: `packages/backend/src/routes/annotationSettings.ts`
  - Frontend: `packages/frontend/src/components/AnnotationsCard.tsx`

## データ構造

- `notes`: Markdown テキスト（null 可）
- `externalUrls`: `http/https` URL 配列
- `internalRefs`: `{ kind, id, label? }` 配列
  - `kind` は業務エンティティ種別（`invoice` / `project` / `chat_message` など）
- 履歴は Prisma の `AnnotationLog` モデル（`prisma.annotationLog`）に保存し、更新時の `reasonCode` / `reasonText` / `actorRole` を保持する。

## アクセス制御

- 利用ロール: `admin` / `mgmt` / `user`
- 一般ユーザーの制約
  - 管理対象（`purchase_order`, `vendor_quote`, `vendor_invoice`, `project`, `customer`, `vendor`）は更新不可
  - `projectId` を持つ対象は、対象プロジェクトに所属していない場合は更新不可
  - `expense` は本人以外の更新不可
- ステータスロック
  - `approved/sent/paid/acknowledged` は通常ユーザー更新不可
  - `admin/mgmt` は `reasonText` 必須で override 可（監査ログ記録）

## バリデーション

- `externalUrls`
  - 重複排除
  - `http/https` のみ許可
  - 件数・長さ・合計長は設定値で制限
- `internalRefs`
  - `kind` は許可リストのみ
  - `id` 必須
  - 同一 `kind:id` は重複排除
- `notes`
  - 文字数上限は設定値で制限

## 設定（annotation-settings）

- 既定値
  - `maxExternalUrlCount`: 20
  - `maxExternalUrlLength`: 2048
  - `maxExternalUrlTotalLength`: 16384
  - `maxNotesLength`: 20000
- 更新権限: `admin` / `mgmt`
- 制約
  - `maxExternalUrlCount > 0` の場合、`maxExternalUrlTotalLength` は `maxExternalUrlLength` 以上である必要がある（満たさない場合は 400 `INVALID_ANNOTATION_SETTING`）
- 設定更新は監査ログ `annotation_setting_updated` に記録する。

## 監査ログ

- 注釈更新: `annotations_updated`
- 設定更新: `annotation_setting_updated`
- ロック済み対象を管理権限で更新した場合は `reasonCode=admin_override` を記録する。

## 非スコープ

- 注釈の全文検索・全文インデックス最適化
- 添付ファイル保管（注釈自体のファイル添付）
- 内部参照 `kind` の動的拡張（現状は許可リスト運用）
