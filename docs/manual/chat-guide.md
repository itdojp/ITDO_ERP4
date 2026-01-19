# チャット運用ガイド（MVP）

## 目的
- 会社が認知できる範囲でコミュニケーションを成立させ、監査・説明責任に耐える形にする

## 対象読者
- 利用者（`user`）
- 管理者（`admin/mgmt/exec`）
- 外部ユーザ（`external_chat`）

## 参照
- チャット仕様: [project-chat](../requirements/project-chat.md)
- ルーム仕様: [chat-rooms](../requirements/chat-rooms.md)
- 添付（Google Drive）: [chat-attachments-google-drive](../requirements/chat-attachments-google-drive.md)
- 添付（ウイルス対策）: [chat-attachments-antivirus](../requirements/chat-attachments-antivirus.md)
- UI 操作: [ui-manual-user](ui-manual-user.md) / [ui-manual-admin](ui-manual-admin.md)

## ルーム種別（概要）
運用上の扱いは [project-chat](../requirements/project-chat.md) を優先します。
- `project`: 案件ルーム（案件に紐づく）
- `department`: 部門/グループ
- `company`: 全社（必要なら）
- `private_group`: 私的グループ（管理者設定で許可/禁止）
- `dm`: DM（管理者設定で許可/禁止）

## DM / private_group の統制（MVP）
管理設定（チャット設定）で on/off できます。
- `user/hr の private_group 作成を許可`
- `DM 作成を許可`

## 外部ユーザ（external_chat）
- 参加できるのは「許可された公式ルーム」のみ（MVP）
- DM は禁止（管理者設定で許可していても、外部ユーザは対象外とする運用を推奨）

## 既読/未読・メンション
運用方針（要点）:
- 未読は本人のみ把握できる（他者の未読/既読は表示しない方針）
- メンションは補完選択で対象を指定する
- `ALL` 相当は誤爆防止（投稿前確認 + 回数制限）を併用する

実装状況は PoC のUIに依存するため、差分がある場合は Issue 化して整合させます。

## 添付
### 保存先
- `CHAT_ATTACHMENT_PROVIDER=local`: ローカル保存（検証用）
- `CHAT_ATTACHMENT_PROVIDER=gdrive`: Google Drive（専用アカウント/専用フォルダ）

### セキュリティ運用
- OAuth refresh token は長期鍵として扱い、Secrets 管理/ローテ/失効手順を必須とする
- 監査ログ（upload/download）を確認できること

## 監査閲覧（break-glass）
- 原則: break-glass は監査目的のみ、理由入力 + 監査ログを必須
- 事前に「使用されたことが分かる」仕組みを運用で担保する（ログ/通知/定期棚卸し）

## 関連画面（証跡）
![プロジェクトチャット](../test-results/2026-01-19-frontend-e2e-r1/12-project-chat.png)

![ルームチャット](../test-results/2026-01-19-frontend-e2e-r1/14-room-chat.png)

![監査閲覧](../test-results/2026-01-19-frontend-e2e-r1/24-chat-break-glass.png)

![管理設定](../test-results/2026-01-19-frontend-e2e-r1/11-admin-settings.png)
