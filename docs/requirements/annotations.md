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

## ReferenceLink 段階移行

- Phase B4 の初手では、`ReferenceLink` を独立テーブルとして追加する。
  - 主用途は `externalUrls` / `internalRefs` の正規化と、将来の検索・権限制御・監査拡張の土台作り
  - `notes` は引き続き `Annotation` に保持する
  - `external_url` の重複排除を DB 一意制約で扱うため、`ReferenceLink.refKind` は空文字既定値で保持する
- 現行の read path は `ReferenceLink` を正本とし、`externalUrls` / `internalRefs` は `ReferenceLink` だけから組み立てる。
  - 対象:
    - `GET /annotations/:kind/:id`
    - 承認証跡スナップショット生成
    - 休暇申請 submit 時の証跡有無判定
  - `notes` は引き続き `Annotation` から返す。
  - 旧 `Annotation(JSON)` にしか存在しない参照は返さないため、cutover 前に backfill + shadow 縮退を完了させる。
- `PATCH /annotations/:kind/:id` は、`notes` を `Annotation` に保持しつつ、
  `externalUrls` / `internalRefs` の更新時は `ReferenceLink` を正本として同期する。
  - `ReferenceLink` 更新後、`Annotation.externalUrls/internalRefs` は empty shadow に縮退する。
  - migration 未適用環境は非対応とし、`ReferenceLink` テーブルが前提となる。
  - response 形式は従来と変えない。
- バックフィルは `scripts/backfill-reference-links.mjs` で行う。
  - 既に `ReferenceLink` が存在する target は上書きせず skip する
  - `--limit-targets` は 1 回の実行で走査する `Annotation` 件数の上限として扱う
  - `Annotation` の `createdAt/createdBy/updatedAt/updatedBy` を `ReferenceLink` へ引き継ぐ
  - 既存 `project_chat` は `room_chat` に正規化して投入する
- shadow 縮退は `scripts/shrink-annotation-reference-shadow.mjs` で行う。
  - `ReferenceLink` のみで構成した状態が、現在の `Annotation(JSON)` と `ReferenceLink` を合成した状態と一致する target だけを対象にする
  - 参照が不足している target、または `Annotation(JSON)` 側にしか存在しない参照が残る target は skip する
  - `--limit-targets` は 1 回の実行で走査する `Annotation` 件数の上限として扱う
- `ReferenceLink` 側の `project_chat` 互換データは、read 時に `room_chat` として正規化する。
- cutover 後の運用順序は `backfill -> shrink -> read path cutover` とする。

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
  - 互換入力として `project_chat` を受け付けるが、保存・表示時は `room_chat` に正規化する
  - `id` 必須
  - 同一 `kind:id` は重複排除
  - legacy な `project_chat` は保存時に `room_chat` へ正規化する
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
