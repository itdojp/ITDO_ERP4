# Workflow Evidence Pack（Issue #957）設計メモ

最終更新: 2026-02-14

## 目的

- 承認対象の根拠（チャット発言/外部URL/内部参照）を、申請時点または承認時点の状態で固定化し、後から監査再現できるようにする。

## スコープ（MVP）

- 承認インスタンス単位の Evidence Snapshot 保存
- Snapshot 取得API
- 承認画面で Snapshot の有無/更新日時を表示
- Snapshot 生成・閲覧操作の監査ログ記録

## 非スコープ（MVP外）

- PDF電子署名、タイムスタンプ証明
- 外部保管（S3等）への自動アーカイブ
- 添付ファイル本体の複製

## 用語

- `reference evidence`: 現行の注釈（notes/externalUrls/internalRefs）参照
- `snapshot evidence`: 時点固定した監査用データ

## データモデル案

### EvidenceSnapshot（テーブル: `evidence_snapshots`）

- `id` (UUID)
- `approvalInstanceId` (FK)
- `targetTable` / `targetId`
- `sourceAnnotationUpdatedAt` (snapshot元の注釈更新時刻)
- `capturedAt`
- `capturedBy`
- `version` (int, default 1)
- `items` (JSON)
  - `notes`: string | null
  - `externalUrls`: string[]
  - `internalRefs`: { kind, id, label? }[]
  - `chatMessages`: { id, roomId, createdAt, userId, excerpt, bodyHash? }[]
    - `bodyHash?`: 将来の改ざん検知/整合性検証用。現行 `ChatMessage` には未定義のため、MVPでは未実装可。
- `createdAt` / `updatedAt`

### AuditLog（既存モデル、テーブル: `audit_logs`）

- `action=evidence_snapshot_created`
- `action=evidence_snapshot_viewed`
- `action=evidence_snapshot_regenerated`

## API案

### POST /approval-instances/:id/evidence-snapshot

- 概要: 対象承認インスタンスの現行注釈から Snapshot を生成
- RBAC: `admin/mgmt`（MVP）
- 入力:
  - `forceRegenerate?: boolean`
  - `reasonText?: string`（再生成時必須）
- 出力:
  - `snapshotId`
  - `capturedAt`
  - `version`

### GET /approval-instances/:id/evidence-snapshot

- 概要: 最新 Snapshot を返却
- RBAC: 承認閲覧可能ユーザ
- 出力:
  - `exists`
  - `snapshot`（存在時）

### GET /approval-instances/:id/evidence-snapshot/history

- 概要: 再生成履歴（version一覧）
- RBAC: `admin/mgmt`（MVP）

## UI案（承認画面）

- `エビデンス（注釈）` セクションに Snapshot 情報を追加:
  - `Snapshot: 未生成 / 生成済み（capturedAt, capturedBy, version）`
  - `Snapshotを表示`
  - 管理者のみ `再生成`
- 注釈表示と Snapshot 表示を切替できるようにし、監査時は Snapshot 表示を既定にする。

## 生成タイミング

- MVP: `submit` 時に自動生成（対象テーブルのみ）
- 追加運用: `admin/mgmt` は承認画面から手動再生成可能（理由必須）

### ねらい

- 生成漏れを減らす（申請時点の固定化）
- 修正運用が必要な場合も監査ログ付きで再生成可能にする

## 権限/統制

- 生成/再生成: `admin/mgmt`
- 閲覧: 当該承認を閲覧できるユーザ
- 再生成時は `reasonText` 必須 + 監査ログ

## 受け入れ条件（MVP）

- 承認インスタンス単位で Snapshot が1件以上取得できる
- Snapshot にチャット抜粋/外部URL/内部参照が含まれる
- 生成/閲覧/再生成が監査ログで追跡できる
- 承認画面で Snapshot の存在確認と閲覧ができる

## 実装順

1. DBスキーマ追加（snapshotテーブル）
2. 生成/取得API
3. 承認画面UI反映
4. 監査ログ追加
5. E2E（生成→承認画面確認）追加
