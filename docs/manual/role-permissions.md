# ロール/権限と可視範囲（PoC）

## 目的
- 「見える/操作できる範囲」を明確化し、運用事故と問い合わせを減らす
- 403（権限不足）発生時の一次切り分けを可能にする

## 参照（仕様/実装）
- 方針: [access-control](../requirements/access-control.md)
- マトリクス（PoC）: [rbac-matrix](../requirements/rbac-matrix.md)

## ロールの種類（PoC）
| ロール | 概要 | 主な想定 |
|---|---|---|
| `admin` | システム管理者 | 全設定/全データ |
| `mgmt` | 管理部 | 承認/マスタ/アラート/運用 |
| `exec` | 経営 | 承認（高額/リスク）/閲覧 |
| `hr` | 人事 | ウェルビーイング/HR分析 |
| `user` | 一般利用者 | 日報/工数/経費/休暇 |
| `external_chat` | 外部ユーザ | チャットのみ |

補足:
- `project_lead` / `employee` / `probationary` は現状 `user` 相当（追加制限/追加権限は後続）
- 「案件リーダー」は **ロール** ではなく、案件メンバー（ProjectMember）の役割（leader/member）として扱う

## 可視範囲の基本ルール（要点）
### 本人データ（個人系）
- 工数/経費/休暇/日報: 原則 **本人のみ**（`admin/mgmt` は全体）
- ウェルビーイング: 入力は本人、閲覧は `hr`（+運用で定義した人事グループ）

### 案件データ（案件系）
- 案件/タスク/見積/請求: 原則 **案件メンバー**（または `admin/mgmt/exec`）
- 仕入/発注: 原則 `admin/mgmt`（運用方針により拡張）

### 承認データ
- 承認インスタンスの閲覧: `admin/mgmt/exec` + 申請者本人 + 所属案件メンバー
- 編集（ルール/設定）: 原則 `admin/mgmt` のみ

### チャット
- ルームメンバーのみ閲覧/投稿（`external_chat` は許可された公式ルームのみ）
- 監査閲覧（break-glass）は `mgmt/exec` を想定（詳細: [project-chat](../requirements/project-chat.md)）

## 403（権限不足）の一次切り分け
1. **ロール不足**（機能自体が許可されていない）
   - 例: `alert-settings` / `approval-rules` は `admin/mgmt` 前提
2. **案件スコープ不足**（projectId が一致しない）
   - 例: `time_entries` / `expenses` / `estimates` / `invoices` 等の projectId フィルタ
3. **グループ不足**（人事/承認グループ）
   - 例: ウェルビーイング閲覧、承認ステップ担当
4. **環境設定不足**（PoCの擬似ログイン/本番のOIDC設定）
   - 例: `AUTH_MODE`、JWT設定、フロントの `VITE_*`

## PoCでの権限確認（擬似ログイン）
PoC UI では「現在のユーザー」セクションで `roles` / `projectIds` / `groupIds` を入力し、
擬似的に権限を切り替えられます（本番運用では使用しません）。

詳細操作:
- [ui-manual-user](ui-manual-user.md)
- [ui-manual-admin](ui-manual-admin.md)
