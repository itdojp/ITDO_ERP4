# ID管理/Google連携方針（たたき台）

## 目的
- SSOでのログインとアカウントライフサイクル管理を実現する
- ERP側のユーザ情報とIDaaS（Google/MS等）を整合させる
- 監査・権限管理の基盤としてユーザ属性を安定化させる

## 用語
- IdP: 認証を提供する基盤（Google Workspace / Microsoft Entra ID など）
- IDaaS: IdPの集約やプロビジョニングを担うサービス（Okta/Cloud Identity など）

## 連携方式（想定）
- 認証: OIDC（IdPに接続）
- プロビジョニング: まずはCSV/手動同期、将来SCIM (SCIM v2)
- 中間: IDaaS を利用する場合は経由可能にする

## ユーザ情報の持ち方
- ERP側の userId は内部IDとして保持し、IdP/IDaaSの subject は externalId として保持する
  - IdP連携ユーザは externalId 必須、非連携ユーザは externalId を null 許容
- email/name は同期可能な属性として保持
- 組織/部門/グループはERP側の権限制御に利用

### 例（論理モデル）
- users: id, externalId, email, name, orgUnitId, status, roleCodes, groupIds
- user_profiles: employmentType, managerUserId, joinedAt（任意）

## ユーザ属性（案）
| 項目 | 必須 | 取得元 | 備考 |
| --- | --- | --- | --- |
| externalId | 任意（IdP連携時は必須） | IdP/IDaaS | subject/immutable ID |
| email | 必須 | IdP/IDaaS | ログインIDとして利用 |
| name | 必須 | IdP/IDaaS | 表示名 |
| status | 必須 | IdP/IDaaS | active/inactive |
| orgUnitId | 任意 | IdP/IDaaS | 組織階層 |
| departmentId | 任意 | IdP/IDaaS | 部門 |
| roleCodes | 必須 | ERP | ロール（RBAC） |
| groupIds | 任意 | ERP/IdP | 承認/人事などのグループ |
| projectIds | 任意 | ERP | 所属案件 |
| employmentType | 任意 | ERP/HR | 正社員/契約等 |
| managerUserId | 任意 | IdP/ERP | 上長 |
| joinedAt / leftAt | 任意 | ERP/HR | 在籍期間 |

## ロール/グループ付与方針
- IdP/IDaaS グループ → ERPロール/承認グループへマッピング
- 例外はERP側で手動付与（監査ログに記録）
- プロジェクト所属はERP側で管理（IdP/IDaaSとは別管理）

## リンク規約（暫定）
- `externalId` がある場合はそれを優先してユーザを同定
- `externalId` が無い場合は `email` を主キー相当として扱う
- `externalId` と `email` が両方ある場合、`externalId` を一次キーとして維持し、`email` は変更許容

## プロビジョニング/退職
- 退職/無効化はIdP/IDaaSの状態を優先（ログイン不可）
- 過去データは保持し、監査ログの整合性を優先
- 代理/兼務などはERP側の属性で表現

## SCIM 同期方針（概要）
- 対象: Users / Groups / Group Membership
- 方式: 基本は IDaaS → ERP への Push。ERP側の手動変更は監査ログに記録。
- 競合: IdP/IDaaS を一次マスターとし、ERP側は補助属性のみ更新可。
- 無効化/削除: SCIM `active=false` で論理無効化し、履歴は保持する。
- 詳細は `docs/requirements/scim-sync.md` に整理。

## PoC段階
- ヘッダ認証のモック（x-user-id/x-roles/x-group-ids）
- 手動でユーザ/ロール/グループを設定
- 将来のOIDC導入時に置換できる構造を維持

## JWT/OIDC 対応（バックエンド実装）
- AUTH_MODE=jwt/hybrid で Bearer トークンを検証する
- JWT_JWKS_URL または JWT_PUBLIC_KEY を使用
- claim マッピングは環境変数で指定:
  - JWT_SUB_CLAIM (userId)
  - JWT_ROLE_CLAIM / JWT_GROUP_CLAIM / JWT_PROJECT_CLAIM / JWT_ORG_CLAIM
- roles が無い場合は AUTH_DEFAULT_ROLE を適用

### Google OIDC（例）
- JWT_JWKS_URL: `https://www.googleapis.com/oauth2/v3/certs`
- JWT_ISSUER: `https://accounts.google.com`
- JWT_AUDIENCE: Google の Client ID
- フロントは `VITE_GOOGLE_CLIENT_ID` を指定してIDトークンを取得し、Authorization: Bearer で送信
- Google IDを持たないユーザは header認証（AUTH_MODE=hybrid）やローカルユーザ運用で許容する
- userId を email に揃える場合は `JWT_SUB_CLAIM=email` を指定（email 変更時の運用ルールは別途定義）

## 監査ログ（案）
- 変更種別: role_grant / role_revoke / group_sync / user_deactivate / user_reactivate
- 記録項目: actor, targetUserId, source(IdP/manual), before/after, reason, timestamp, correlationId
- SCIM同期は batchId を残し、差分の追跡を可能にする

## 次のTODO
- 採用IdP/IDaaSの決定（Google/MS/Okta等）
- SCIM導入の可否、同期頻度・責任分界の定義
- ユーザ属性の正式スキーマ確定（たたき台は追記済み）
- 監査ログ/権限変更ログの要件整理（たたき台は追記済み）
- JWT_SUB_CLAIM=email 運用時の email 変更ルールを整理
