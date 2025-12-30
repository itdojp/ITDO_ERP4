# SCIM 同期方針（案）

## 目的
- IdP/IDaaS を一次マスターとしたユーザ/グループ同期を確立する。
- 退職/無効化、グループ変更の運用を自動化する。

## 対象スコープ
- Users
- Groups
- Group Membership

## データ項目（案）
### User (SCIM)
- `id` / `externalId`
- `userName` (メール)
- `name.givenName` / `name.familyName` / `displayName`
- `active` (無効化)
- `emails` / `phoneNumbers`
- `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`
  - `department`, `organization`, `manager`

### Group (SCIM)
- `id` / `externalId`
- `displayName`
- `members`

## マスター/優先順位
- 認証/所属/有効無効: IdP/IDaaS を一次マスター。
- ERP固有属性: ERP側で管理（プロジェクト所属、承認グループ、役割補助）。

## 同期頻度
- 基本は Push (SCIM) を想定。
- 障害時のリカバリとして日次の整合ジョブを用意。

## 無効化・削除
- SCIM `active=false` を ERP `isActive=false` に反映。
- 削除は論理削除のみ。履歴を保持し監査整合性を維持。

## 差分適用と監査ログ
- SCIM で受け取った差分を監査ログに記録。
- 変更対象: ユーザ属性/グループ所属/有効無効。

## 実装計画（段階）
1. **設計フェーズ**
   - SCIM の対象属性・マッピングを確定。
   - IdP/IDaaS の一次マスター方針を確定。
2. **受信PoC**
   - SCIM エンドポイント（Users/Groups）を read-only で整備。
   - 監査ログの記録方針を試験。
3. **同期本番化**
   - 差分反映/無効化まで対応。
   - 例外運用（手動変更）を監査ログに記録。

## 実装メモ（SCIM v2）
- エンドポイント: `/scim/v2/Users`, `/scim/v2/Groups`
- 付随: `/scim/v2/ServiceProviderConfig`, `/scim/v2/ResourceTypes`
- 認証: `Authorization: Bearer <SCIM_BEARER_TOKEN>`
- ページング: `startIndex`, `count`（最大 `SCIM_PAGE_MAX`）
- フィルタ: `userName|externalId|id|active` / `displayName|externalId|id` の `eq` のみ
