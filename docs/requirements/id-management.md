# ID管理/Google連携方針（方針・補足資料）

補足: 正式な認証方式と移行方針は `docs/requirements/auth-architecture.md` を一次ソースとする。

## 目的

- SSOでのログインとアカウントライフサイクル管理を実現する
- ERP側のユーザ情報とIDaaS（Google/MS等）を整合させる
- 監査・権限管理の基盤としてユーザ属性を安定化させる

## 用語

- IdP: 認証を提供する基盤（Google Workspace / Microsoft Entra ID など）
- IDaaS: IdPの集約やプロビジョニングを担うサービス（Okta/Cloud Identity など）

## 連携方式（想定）

- 認証: Google Workspace OIDC を主経路とする
- ブラウザ認証: Authorization Code Flow + PKCE + BFF/Auth Gateway を正式案とする
- ローカル認証: 例外ユーザに限定し、管理者発行・MFA必須で運用する
- プロビジョニング: まずはCSV/手動同期（SCIMは将来検討）
- 中間: IDaaS / Broker を利用する場合は経由可能にする

## 決定事項

- IdP/IDaaS: Google を採用
- Google Workspace ユーザを主認証経路とする（認証識別子は `UserIdentity(providerType=google_oidc, issuer, sub)` で管理する）
- email は連絡用として扱い、自動リンクはしない
- Google を利用できない例外ユーザに限り、ERP4 ローカル認証を許容する
- `g.itdo.jp` と `itdo.jp` は別メールとして扱い、自動正規化しない
- Google グループは初期状態では権限制御・組織配賦・案件配賦の一次ソースにしない
- Google グループを使う場合も read-only・粗いロールマッピングに限定する
- Admin SDK Directory API / Domain-wide Delegation を要する常時接続は初期構成に入れない

## ユーザ情報の持ち方

- ERP側の業務主体は `UserAccount` として保持する
- 認証識別子は `UserIdentity` に分離し、Google ユーザとローカルユーザを同一 `UserAccount` に紐付け可能にする
- 既存の `externalId` は移行期間中の互換項目とし、将来的には `UserIdentity` へ集約する
- email/name は同期可能な属性として保持するが、自動リンクキーには使わない
- 組織/部門/グループはERP側の権限制御に利用する
  - Google連携ユーザ: `UserIdentity(providerType=google_oidc, issuer, sub)` を一次識別子とし、email は連絡用
  - ローカルユーザ: `UserIdentity(providerType=local_password, issuer=erp4_local, providerSubject=<immutable local subject>)` を一次識別子とし、`loginId` は `LocalCredential` 側で管理する

### 例（論理モデル）

- user_accounts: id, email, name, orgUnitId, status, roleCodes, groupIds
- user_identities: id, userAccountId, providerType, providerSubject, issuer, emailSnapshot, status
- local_credentials: userIdentityId, loginId, passwordHash, mfaRequired, failedAttempts, lockedUntil
- user_profiles: employmentType, managerUserId, joinedAt（任意）

## ユーザ属性（決定）

| 項目              | 必須               | 取得元    | 備考                                   |
| ----------------- | ------------------ | --------- | -------------------------------------- |
| externalId        | 移行期間の互換項目 | 旧実装    | 将来的には `UserIdentity` に集約       |
| email             | 必須               | IdP/IDaaS | 連絡用属性。認証リンクキーには使わない |
| name              | 必須               | IdP/IDaaS | 表示名                                 |
| status            | 必須               | IdP/IDaaS | active/inactive                        |
| orgUnitId         | 任意               | IdP/IDaaS | 組織階層                               |
| departmentId      | 任意               | IdP/IDaaS | 部門                                   |
| roleCodes         | 必須               | ERP       | ロール（RBAC）                         |
| groupIds          | 任意               | ERP/IdP   | 承認/人事などのグループ                |
| projectIds        | 任意               | ERP       | 所属案件（複数を許容、ERP側で管理）    |
| employmentType    | 任意               | ERP/HR    | 正社員/契約等                          |
| managerUserId     | 任意               | IdP/ERP   | 上長                                   |
| joinedAt / leftAt | 任意               | ERP/HR    | 在籍期間                               |

## ロール/グループ付与方針

- 初期本番では ERP ロール/承認グループは ERP 側 DB を一次ソースとする
- IdP/IDaaS グループを使う場合も、候補入力補助または粗いロールマッピングに限定する
- 高権限ロール (`admin` / `exec` / `mgmt`) は Google グループだけで即時付与しない
- 例外はERP側で手動付与（監査ログに記録）
- プロジェクト所属はERP側で管理（IdP/IDaaSとは別管理）
  - `ProjectMember` テーブルでリーダ/メンバーを保持し、projectIds はそこから解決する

## リンク規約（暫定）

- Google 連携ユーザは `UserIdentity(providerType=google_oidc, issuer, sub)` を一次キーとし、email では自動リンクしない
- ローカル認証ユーザは `UserIdentity(providerType=local_password, issuer=erp4_local, providerSubject=<immutable local subject>)` を一次キーとし、`loginId` は credential 属性として扱う
- Google ID とローカル ID のリンク・解除は system_admin のみ許可する
- ユーザ本人による認証方式の追加・切替・解除は許可しない
- `g.itdo.jp` / `itdo.jp` の衝突は自動解決せず、連絡用emailの重複は許容する

## プロビジョニング/退職

- 退職/無効化はIdP/IDaaSの状態を優先（ログイン不可）
- 過去データは保持し、監査ログの整合性を優先
- 代理/兼務などはERP側の属性で表現

## SCIM 同期方針（概要）

- 現時点では導入しない（要件を詰めた後に再検討）
- 将来の想定:
  - 対象: Users / Groups / Group Membership
  - 方式: 基本は IDaaS → ERP への Push。ERP側の手動変更は監査ログに記録。
  - 競合: IdP/IDaaS を一次マスターとし、ERP側は補助属性のみ更新可。
  - 無効化/削除: SCIM `active=false` で論理無効化し、履歴は保持する。
  - 詳細は `docs/requirements/scim-sync.md` に整理。

## PoC段階

- ヘッダ認証のモック（x-user-id/x-roles/x-group-ids）は本番では使用しない
- 手動でユーザ/ロール/グループを設定
- 将来の BFF/Auth Gateway と `UserIdentity` 導入時に置換できる構造を維持

## JWT/OIDC 対応（バックエンド実装）

- AUTH_MODE=jwt/hybrid で Bearer トークンを検証する
- JWT_JWKS_URL または JWT_PUBLIC_KEY を使用
- claim マッピングは環境変数で指定:
  - JWT_SUB_CLAIM (userId)
  - JWT_ROLE_CLAIM / JWT_GROUP_CLAIM / JWT_PROJECT_CLAIM / JWT_ORG_CLAIM
- roles が無い場合は AUTH_DEFAULT_ROLE を適用
- JWT認証時、`UserAccount.userName == userId` のユーザが存在すればDB側のグループ所属を `groupIds` にマージし、ロールも補完する
- `UserIdentity(providerType=google_oidc, issuer, providerSubject=sub)` が存在する場合は、そちらを優先して対応する `UserAccount` を解決する
- `UserIdentity` 未導入の既存データに対しては、移行期間の互換層として `userName` / `externalId` lookup を継続する
  - `admin` → role `admin`
  - `mgmt` → role `mgmt`
  - `exec` → role `exec`
  - `hr` / `hr-group` → role `hr`
  - role `user` は常に付与される（`project_lead`/`employee`/`probationary` は `user` に包含）
  - `UserAccount.active=false` または `deletedAt!=null` の場合はログイン不可（401）
  - DB照会に失敗した場合はログイン不可（401）
  - 補足: 現状は PoC のため、ユーザ/グループ投入は SCIM エンドポイントまたはSQLで行う（同期の本番化は後続）
  - グループ→ロールのマッピングは環境変数で上書き可能: `AUTH_GROUP_TO_ROLE_MAP="groupA=role1,groupB=role2"`（未指定時は既定マップを使用）
  - DB照会の負荷が問題になる場合はキャッシュを有効化できる: `AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS`（秒、0で無効。無効がデフォルト）

### Google OIDC（例）

- JWT_JWKS_URL: `https://www.googleapis.com/oauth2/v3/certs`
- JWT_ISSUER: `https://accounts.google.com`
- JWT_AUDIENCE: Google の Client ID
- フロントは `VITE_GOOGLE_CLIENT_ID` を指定してIDトークンを取得し、Authorization: Bearer で送信
- Google IDを持たないユーザは、将来のローカル認証実装で許容する。header認証は本番代替にしない
- userId は `sub` を使用（`JWT_SUB_CLAIM=sub`）
- 連絡用emailは `email` claim を優先し、取得できない場合は手入力で登録
- 追加の連絡用emailは Admin SDK を使わず、手入力で運用する

## 監査ログ（決定）

- 変更種別: role_grant / role_revoke / group_sync / user_deactivate / user_reactivate
- 記録項目: actor, targetUserId, source(IdP/manual), before/after, reason, timestamp, correlationId
- SCIM同期は batchId を残し、差分の追跡を可能にする

## 認証方式の移行（追加要件）

- ローカル認証ユーザ → Google 連携、および Google 認証ユーザ → ローカル認証の相互移行を許容する
- いずれも system_admin による管理者操作のみ許可する
- ユーザ本人による移行は不可
- 移行時も業務主体は同一 `UserAccount` を維持し、認証主体だけを追加・無効化する
- すべての移行操作は監査ログに残し、申請番号またはチケット番号を必須とする

## 次のTODO

- 採用IdP/IDaaSの決定（Google/MS/Okta等）【決定: Google】
- SCIM導入の可否、同期頻度・責任分界の定義【決定: 現時点では導入しない。要件を詰めて再検討】
- ユーザ属性の正式スキーマ確定【決定済み】
- 監査ログ/権限変更ログの要件整理【決定済み】
- 連絡用emailの取得方法を確定【決定: OIDC email claim 優先、不可なら手入力。Admin SDK は使わない】
- `g.itdo.jp` / `itdo.jp` の衝突回避方針を決定【決定: 自動リンクなし、メールは連絡用のみ】
