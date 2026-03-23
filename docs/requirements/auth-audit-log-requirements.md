# 認証監査ログ要件

目的: Google Workspace OIDC とローカル認証の監査証跡を統一し、`#1493` の本番経路要件を満たす。

## 1. 対象範囲

- Google OIDC Auth Gateway
  - `GET /auth/google/callback`
  - `POST /auth/logout`
  - `POST /auth/sessions/:sessionId/revoke`
- ローカル認証
  - `POST /auth/local/login`
  - `POST /auth/local/password/rotate`
- 管理者による認証主体操作
  - `POST /auth/user-identities/google-link`
  - `POST /auth/user-identities/local-link`
  - `PATCH /auth/user-identities/:identityId`
  - `POST /auth/local-credentials`
  - `PATCH /auth/local-credentials/:identityId`

## 2. 必須イベント

### Google OIDC

| action                        | 契機                                                 | targetTable                          | 必須 metadata                                                                    |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `google_oidc_login_succeeded` | Google callback 成功後に `AuthSession` を発行        | `AuthSession`                        | `userAccountId`, `identityId`, `issuer`, `providerSubject`                       |
| `google_oidc_login_failed`    | flow 不正、ID token 検証失敗、identity 未リンク/無効 | `AuthOidcFlow` または `UserIdentity` | `reasonCode`, `state` または `issuer`/`providerSubject`, `error`                 |
| `auth_session_logout`         | current session の logout                            | `AuthSession`                        | `userAccountId`, `identityId`, `issuer`, `providerSubject`                       |
| `auth_session_revoked`        | session 一覧から任意 session を revoke               | `AuthSession`                        | `userAccountId`, `identityId`, `issuer`, `providerSubject`, `revokedBySessionId` |

### ローカル認証

| action                           | 契機                                               | targetTable                             | 必須 metadata                            |
| -------------------------------- | -------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `local_login_succeeded`          | local login 成功                                   | `AuthSession`                           | `userAccountId`, `identityId`, `loginId` |
| `local_login_failed`             | password 不一致、payload 不正、credential 検証失敗 | `LocalCredential` または `UserIdentity` | `reasonCode`, `loginId`                  |
| `local_login_blocked`            | lockout、MFA 未設定、MFA challenge 必須            | `LocalCredential` または `UserIdentity` | `reasonCode`, `loginId`                  |
| `local_password_rotated`         | bootstrap password 再設定成功                      | `LocalCredential`                       | `userAccountId`, `identityId`, `loginId` |
| `local_password_rotation_failed` | rotate 失敗                                        | `LocalCredential` または `UserIdentity` | `reasonCode`, `loginId`                  |

### 管理者操作

| action                        | 契機                       | targetTable       | 必須 metadata                                                            |
| ----------------------------- | -------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `user_identity_google_linked` | Google identity 追加       | `UserIdentity`    | `userAccountId`, `issuer`, `providerSubject`, `ticketId`, `reasonCode`   |
| `user_identity_local_linked`  | local identity 追加        | `UserIdentity`    | `userAccountId`, `issuer`, `providerSubject`, `ticketId`, `reasonCode`   |
| `user_identity_updated`       | identity 状態/猶予期間更新 | `UserIdentity`    | `userAccountId`, `changedFields`, `ticketId`, `reasonCode`               |
| `local_credential_created`    | local credential 発行      | `LocalCredential` | `userAccountId`, `identityId`, `loginId`, `ticketId`, `reasonCode`       |
| `local_credential_updated`    | local credential 更新      | `LocalCredential` | `userAccountId`, `identityId`, `changedFields`, `ticketId`, `reasonCode` |

## 3. 共通要件

- 監査ログは `auditLog.create` を経由し、`auditContextFromRequest(req)` を必ず付与する。
- `source`, `actorType`, `actorUserId`, `ip`, `userAgent`, `requestId` は既存監査文脈に従う。
- 認証失敗系イベントは、認証成立前でも可能な範囲で `state`, `issuer`, `providerSubject`, `loginId` を残す。
- email を主体識別子として監査ログの一次キーに使わない。
- 高権限操作の追跡に必要な `ticketId` / `reasonCode` は、管理者 API で必須とする。

## 4. 保持・削除

- `AuthSession` / `AuthOidcFlow` は調査目的で即時物理削除しない。
- Cookie 破棄や session revoke 後も、監査ログと DB レコードで事後追跡できることを優先する。

## 5. テスト要件

- backend route test で最低限以下を回帰対象に含める。
  - `google_oidc_login_succeeded`
  - `google_oidc_login_failed`
  - `auth_session_logout`
  - `auth_session_revoked`
  - `local_login_succeeded`
  - `local_login_failed`
  - `local_password_rotated`
- 監査 action 名だけでなく、主要 metadata の有無も確認する。
