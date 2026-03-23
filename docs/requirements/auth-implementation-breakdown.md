# 認証アーキテクチャ実装分解

## 目的

- `docs/requirements/auth-architecture.md` を実装可能な単位へ分解する。
- Google 主認証、例外ローカル認証、管理者による認証方式移行を段階導入する。

## 実装単位

### 1. 認証識別子の分離

- 目的
  - `UserAccount` と認証主体を分離する。
- 主な変更
  - `UserIdentity` テーブル追加
  - `LocalCredential` テーブル追加
  - 既存 `externalId` 互換運用の移行方針整理
- 完了条件
  - Google / local の複数 identity を 1 `UserAccount` に紐付け可能
  - 既存認可ロジックが `UserAccount` ベースで継続動作

### 2. Google OIDC 本番経路の確立

- 目的
  - `AUTH_MODE=header` を本番から排除する。
- 主な変更
  - Authorization Code + PKCE
  - BFF/Auth Gateway 導入
  - サーバセッション化
- Phase 1 実装
  - `AUTH_MODE=jwt_bff`
  - `AuthSession` / `AuthOidcFlow`
  - `GET /auth/google/start`
  - `GET /auth/google/callback`
  - `GET /auth/session`
  - `GET /auth/sessions`
  - `POST /auth/sessions/:sessionId/revoke`
  - `POST /auth/logout`
  - `AuthSession -> UserIdentity -> UserAccount` による API 認証解決
- Phase 2 実装
  - frontend の Bearer 直送経路廃止
  - BFF 向け CSRF token 配布
  - セッション一覧/失効 UI
  - 監査/運用ガイドの本番切替手順
- 完了条件
  - ブラウザ本番経路が BFF 経由のみで成立
  - API 直 Bearer 前提の PoC 経路を本番無効化

### 3. ローカル認証の導入

- 目的
  - Google を利用できない例外ユーザに限定したローカル認証を提供する。
- 主な変更
  - `system_admin` に限定したローカル credential lifecycle API
  - `POST /auth/local/login`
  - `POST /auth/local/password/rotate`
  - 管理者によるローカルアカウント発行
  - Argon2id パスワード
  - MFA 必須化
  - lockout / password reset
- Phase 1 実装
  - local credential lifecycle API
  - `POST /auth/local/login`
  - `POST /auth/local/password/rotate`
  - failed attempt count / temporary lockout
  - bootstrap password の初回再設定
  - `mfaRequired=false` の credential に限る BFF session 発行
- Phase 2 実装
  - MFA challenge / setup 実行経路
  - recovery code
  - local login UI
- 完了条件
  - 本人自己登録なし
  - system_admin のみ発行・失効可能
  - MFA 未完了の credential が session を作成しない

### 4. 認証方式移行フロー

- 目的
  - Google⇔ローカルの相互移行を管理者操作に限定して提供する。
- 主な変更
  - admin API / UI
  - 監査ログ拡張
  - 併用期間の制御
  - `effectiveUntil` 超過 identity の認証拒否
  - bootstrap password の初回ログイン再設定強制
- Phase 1 実装
  - `GET /auth/user-identities`
  - `POST /auth/user-identities/google-link`
  - `POST /auth/user-identities/local-link`
  - `PATCH /auth/user-identities/:identityId`
  - `effectiveUntil` 超過 identity の認証拒否
- Phase 2 実装
  - rollback API
  - 管理 UI
  - bootstrap password の初回ログイン再設定強制
- 完了条件
  - 同一 `UserAccount` に対して identity 追加・無効化が可能
  - ユーザ本人による切替 UI が存在しない
- 参照
  - `docs/requirements/auth-admin-identity-migration.md`

### 5. 権限/グループの安全な取り込み

- 目的
  - Google グループ利用を optional に保ちつつ、安全に扱う。
- 主な変更
  - 既定では ERP DB を一次ソースとする
  - optional な group mapping 実装は read-only / coarse role 限定
  - 高権限ロールの自動昇格禁止
- 完了条件
  - Google グループを使わない構成でも本番運用可能
  - 使う場合も失敗時に権限不足側へ倒れる
- 参照
  - `docs/requirements/google-workspace-group-usage-policy.md`

## 推奨実装順

1. 認証識別子の分離
2. Google OIDC 本番経路の確立
3. ローカル認証の導入
4. 認証方式移行フロー
5. Google グループ利用の再評価

## 依存関係

- 3 は 1 に依存する
- 4 は 1 と 3 に依存する
- 2 は 1 と並行設計可能だが、切替時の整合のため同一リリース計画で扱う
- 5 は 2 の後に判断する
