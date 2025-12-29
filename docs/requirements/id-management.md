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
- プロビジョニング: まずはCSV/手動同期、将来SCIM
- 中間: IDaaS を利用する場合は経由可能にする

## ユーザ情報の持ち方
- ERP側の userId は外部IDと紐づける（IdP/IDaaSのsubject/immutable ID）
- email/name は同期可能な属性として保持
- 組織/部門/グループはERP側の権限制御に利用

### 例（論理モデル）
- users: id, externalId, email, name, orgUnitId, status, roleCodes, groupIds
- user_profiles: employmentType, managerUserId, joinedAt（任意）

## ロール/グループ付与方針
- IdP/IDaaS グループ → ERPロール/承認グループへマッピング
- 例外はERP側で手動付与（監査ログに記録）
- プロジェクト所属はERP側で管理（IdP/IDaaSとは別管理）

## プロビジョニング/退職
- 退職/無効化はIdP/IDaaSの状態を優先（ログイン不可）
- 過去データは保持し、監査ログの整合性を優先
- 代理/兼務などはERP側の属性で表現

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

## 次のTODO
- 採用IdP/IDaaSの決定（Google/MS/Okta等）
- SCIM導入の可否、同期頻度・責任分界の定義
- ユーザ属性の正式スキーマ確定
- 監査ログ/権限変更ログの要件整理
