# 管理者による認証方式移行フロー

## 1. 目的

- Google OIDC とローカル認証の相互移行を、`system_admin` のみが実行できる管理フローとして定義する。
- 同一人物の業務主体を `UserAccount` に固定したまま、認証主体 (`UserIdentity`) の追加・無効化・切替を安全に行う。
- ユーザ本人による認証方式の切替や自己リンクを禁止し、監査可能な運用に限定する。

## 2. 前提

- Google 主認証、ローカル認証は例外運用とする。
- `UserAccount` は業務主体、`UserIdentity` は認証主体、`LocalCredential` はローカル認証情報とする。
- email による自動リンクは禁止する。
- すべての移行操作に `ticketId` と `reasonCode` を必須とする。

## 3. 対象フロー

### 3.1 ローカル -> Google 連携

- 対象
  - 既存の `local_password` identity を持つ `UserAccount`
- 管理者操作
  - `google_oidc` identity を追加する
  - 併用期間を設定する
  - 必要に応じて既存 `local_password` を `disabled` にする
- 禁止
  - email 一致だけで自動リンクすること
  - `UserAccount` を新規作成して差し替えること

### 3.2 Google -> ローカル移行

- 対象
  - 既存の `google_oidc` identity を持つ `UserAccount`
- 管理者操作
  - `local_password` identity を追加する
  - `LocalCredential` を作成する
  - 初期パスワードと MFA 初期化手順を発行する
  - 必要に応じて `google_oidc` を `disabled` にする
- 制約
  - MFA 完了前は高権限ロールを付与しない
  - ローカル化を理由に権限を拡張しない
  - Phase 1 では `mfaRequired` は caller が変更できない。`local_password` は既定で `mfaRequired=false` として発行する
    - MFA setup / challenge 経路が未実装のため、`true` 既定だと bootstrap password 回転後もログイン不能になる
    - Phase 2 で MFA 実行経路を実装した時点で、既定値を `true` へ切り替える
  - 管理者発行の初期パスワードは bootstrap secret とし、初回ログイン時に必ず再設定させる

### 3.3 併用期間管理

- 同一 `UserAccount` に複数 `UserIdentity` を持てる。
- ただし、併用は移行期間または break-glass 目的に限定する。
- 併用期間には以下を持つ。
  - `effectiveFrom`
  - `effectiveUntil`
  - `rollbackWindowUntil`
- `effectiveFrom` は identity 作成時刻を system が設定する読み取り専用値とする。
- `effectiveUntil` 超過後は、`status=active` であっても認証解決時に無効として扱う。
- その後の `status=disabled` 反映は、管理 API または運用ジョブで追従させる。

## 4. 管理 API 要件

### 4.1 一覧

- `GET /auth/user-identities`
- 条件
  - `system_admin` のみ
  - `userAccountId`, `providerType`, `status` で絞り込み可能

### 4.2 Google identity 追加

- `POST /auth/user-identities/google-link`
- 必須入力
  - `userAccountId`
  - `issuer`
  - `providerSubject`
  - `ticketId`
  - `reasonCode`
- 任意入力
  - `emailSnapshot`
  - `effectiveUntil`
  - `rollbackWindowUntil`
- バリデーション
  - `(providerType, issuer, providerSubject)` の一意制約
  - 同一 `UserAccount` への重複 `google_oidc` 追加禁止

### 4.3 ローカル identity 追加

- `POST /auth/user-identities/local-link`
- 必須入力
  - `userAccountId`
  - `loginId`
  - `password`
  - `ticketId`
  - `reasonCode`
- 追加処理
  - `local_password` identity 作成
  - `LocalCredential` 作成
  - パスワードは `argon2id`
  - Phase 1 では `mfaRequired=false` を system が既定設定
  - `mustRotatePassword=true` を system が設定する
  - 初回ログイン後の再設定強制は、ローカル認証実行経路の導入時に有効化する
  - `effectiveFrom` は作成時刻を system が設定する
  - `effectiveUntil` / `rollbackWindowUntil` は任意入力として受け付ける

### 4.4 identity 状態更新

- `PATCH /auth/user-identities/:identityId`
- 必須入力
  - `ticketId`
  - `reasonCode`
- 更新可能項目
  - `status` (`active` / `disabled`)
  - `effectiveUntil`
  - `rollbackWindowUntil`
  - `note`
- 制約
  - 最後の有効 identity を無効化する場合は break-glass 条件を満たすこと
  - `effectiveFrom` は更新不可
  - `ticketId` / `reasonCode` は監査必須項目であり、mutable field ではない

### 4.5 rollback

- `POST /auth/user-identities/:identityId/rollback`
- 必須入力
  - `ticketId`
  - `reasonCode`
- 任意入力
  - `reasonText`
- 処理
  - `rollbackOf` で参照される直前の移行操作を元に、対象 identity の `status` / `effectiveUntil` / `rollbackWindowUntil` を復元する
  - Google -> ローカル移行で発行した bootstrap password は rollback 後に無効化する
- 制約
  - `rollbackWindowUntil` を超過した操作は rollback 不可

## 4.x 実装フェーズ整理

- Phase 1 実装済み
  - `GET /auth/user-identities`
  - `POST /auth/user-identities/google-link`
  - `POST /auth/user-identities/local-link`
  - `PATCH /auth/user-identities/:identityId`
  - `effectiveUntil` 超過 identity の認証拒否
- Phase 2 実装予定
  - `POST /auth/user-identities/:identityId/rollback`
  - bootstrap password の初回ログイン再設定強制
  - 管理 UI

## 5. UI 要件

- `Settings > Auth` に管理画面を置く。
- 一覧表示項目
  - `UserAccount`
  - `providerType`
  - `issuer`
  - `providerSubject`（マスク可）
  - `status`
  - `lastAuthenticatedAt`
  - `effectiveFrom`
  - `effectiveUntil`
- 実行アクション
  - Google 連携追加
  - ローカル認証追加
  - identity 無効化
  - rollback
- UI では本人向けの切替導線を提供しない。

## 6. 監査ログ要件

すべての管理操作で以下を記録する。

- `actorAdminUserId`
- `targetUserAccountId`
- `targetIdentityId`
- `beforeProviders`
- `afterProviders`
- `ticketId`
- `reasonCode`
- `reasonText`
- `approvedBy`
- `executedAt`
- `rollbackOf`
- `changedFields`

## 7. フェイルセーフ

- Google 連携追加後に有効な Google ログインが確認できるまでは、旧 identity を維持する。
- ローカル認証追加後に MFA 設定が完了するまでは、高権限付与を停止する。
- 管理者発行の初期パスワードは初回ログイン時の再設定完了まで継続利用を禁止する。
- 移行途中に障害が発生した場合は、`beforeProviders` 構成へ戻せるよう rollback を記録する。
- `system_admin` は、自分自身の最後の有効 identity を単独で無効化できない。

## 8. 完了条件

- Google -> ローカル、ローカル -> Google の両方向が管理者 API で実行できる。
- 同一 `UserAccount` に対して複数 identity の追加・無効化・併用期間管理ができる。
- 本人向け切替 UI が存在しない。
- すべての移行操作に `ticketId` と `reasonCode` が記録される。

## 9. 関連仕様

- `docs/requirements/auth-architecture.md`
- `docs/requirements/auth-implementation-breakdown.md`
- `docs/requirements/id-management.md`
