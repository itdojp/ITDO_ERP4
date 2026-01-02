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
- SCIM `active=false` を ERP `active=false` に反映。
- 削除は論理削除のみ。履歴を保持し監査整合性を維持。

## 差分適用と監査ログ
- SCIM で受け取った差分を監査ログに記録。
- 変更対象: ユーザ属性/グループ所属/有効無効。
- 受信ペイロードは `scimMeta` に保存（必要に応じてマスキング/削除方針を別途検討）。

## 運用フロー/責任分界
- IdP/IDaaS: ユーザ作成/更新/無効化、グループ変更の一次管理
- ERP: プロジェクト所属、承認グループ、ロール補助の管理
- 例外対応: ERP側での手動変更は監査ログに必ず記録

## テスト項目（代表ケース）
1. User作成（SCIM POST）→ ERP側でユーザ作成、active=true
2. User更新（メール/氏名変更）→ 反映と監査ログ記録
3. User無効化（active=false）→ ERP側で無効化、ログイン不可
4. Group作成/名称変更 → ERP側でグループ反映
5. Group membership 変更 → ERP側グループ所属更新
6. 不正トークン → 401/403 を返し、反映されない

## 監査ログ確認ポイント
- actor/source が `scim` として記録される
- before/after が残る（最低限: active/role/group の差分）
- batchId/correlationId を紐付け可能な場合は追記

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
