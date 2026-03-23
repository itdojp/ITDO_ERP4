# 認証アーキテクチャ正式案

## 1. 目的

- 社内ユーザは Google Workspace を主認証基盤として利用する。
- Google Workspace を利用できない例外ユーザに限り、ERP4 内のローカル認証を許容する。
- 認証方式が複数あっても、ERP4 上の権限・監査・アカウントライフサイクルは一元管理する。
- Google 側のセキュリティ水準を下げず、ERP4 側の秘密情報保有を最小化する。

## 2. 決定事項

- 主認証経路は Google Workspace OIDC とする。
- 本番のブラウザ認証は Authorization Code Flow + PKCE を前提とし、ERP4 は BFF/Auth Gateway でセッションを管理する。
- Google Workspace のパスワード、Passkey、MFA は Google 側で管理し、ERP4 は保持しない。
- ローカル認証は例外運用とし、自己登録は禁止、管理者による発行・無効化のみを許可する。
- Google グループは初期状態では権限制御の一次ソースにしない。利用する場合も read-only・粗い権限マッピングに限定する。詳細条件は `docs/requirements/google-workspace-group-usage-policy.md` を参照する。
- email は連絡用属性であり、Google ユーザとローカルユーザの自動リンクキーには使わない。
- ERP4 の業務ユーザ本体は `UserAccount` とし、認証主体は別概念として管理する。

## 3. セキュリティ設計原則

- 認証の強度は IdP と同等以上を維持し、ERP4 側で弱い代替経路を既定値にしない。
- ERP4 側に Google 管理権限を広く持たせない。特に Domain-wide Delegation を要する常時接続は初期構成に入れない。
- 高権限ロール付与は Google グループ自動同期だけに依存させず、ERP4 側の承認可能なマッピング設定と監査ログを必須にする。
- ローカル認証ユーザは利用範囲を限定し、社内 Google ユーザと同等の権限付与を既定にしない。
- 本番での `AUTH_MODE=header` は禁止する。header 認証は PoC・開発・限定運用に閉じる。

## 4. 構成要素

- **Google Workspace / Google OIDC**
  - 社内ユーザ向けの一次認証基盤。
  - MFA / Passkey / 端末ポリシーは Google 側で適用する。
- **ERP4 Auth Gateway / BFF**
  - OIDC の code exchange、ID token 検証、ERP4 セッション発行、CSRF 対策、ログアウトを担当する。
- **ERP4 API**
  - BFF が発行したサーバセッションまたは内部短命トークンを受けて認可を行う。
- **Identity Registry**
  - ERP4 内部の業務ユーザ (`UserAccount`) と認証主体 (`UserIdentity`) の対応を保持する。
- **Local Auth Provider**
  - 例外ユーザ向けのローカル認証。
  - パスワードハッシュ、MFA 状態、ロック状態を管理する。

## 5. 認証方式

### 5.1 Google Workspace ユーザ

1. ブラウザは ERP4 BFF にアクセスする。
2. 未認証時、BFF は Google OIDC の認可エンドポイントへリダイレクトする。
3. Google 側で認証完了後、BFF が authorization code を受け取り、token endpoint で交換する。
4. BFF は ID token を検証し、`iss` / `aud` / `exp` / `nonce` / `sub` を確認する。
5. `providerType=google_oidc`, `providerSubject=sub` の `UserIdentity` を検索し、対応する `UserAccount` に解決する。
6. ERP4 は HTTP-only Cookie のサーバセッションを発行する。

### 5.2 ローカル認証ユーザ

- 対象は Google Workspace を利用できない例外ユーザのみとする。
- ERP4 が保持するのは以下に限定する。
  - Argon2id ハッシュ化パスワード
  - MFA シークレットまたは recovery code
  - ロック状態、失敗回数、最終認証日時
- 本番では以下を必須とする。
  - MFA 有効化
  - パスワード強度ポリシー
  - ログイン試行回数制限
  - 管理者による発行・失効
- ローカル認証ユーザには、既定で `admin` / `mgmt` / `exec` を割り当てない。

## 6. Google グループ利用方針

### 6.1 初期方針

- Google グループは **任意利用** とする。
- 初期本番では、ERP4 のロール・承認グループは ERP4 側 DB を一次ソースとする。
- Google グループは、利用しても「候補入力の補助」または「粗いロール付与」に限定する。

### 6.2 利用可能条件

Google グループを権限制御に使うのは、次の条件を満たす場合に限る。

- Google から直接 group 情報を runtime lookup しない。
- 取得経路が read-only である。
- ERP4 側にマッピングテーブルと監査ログがある。
- グループ変更時の失敗・遅延時に、権限過剰付与より権限不足側へ倒れる。

### 6.3 推奨順位

1. **利用しない**
   - 最も安全で運用が単純。
   - ロール・グループは ERP4 で管理する。
2. **JWT claim 経由で利用**
   - 別の信頼済み IdP/Broker が `group_ids` claim を付与する場合のみ。
   - Google の標準 ID token をそのまま前提にはしない。
3. **read-only 同期で利用**
   - 定期バッチまたは SCIM 等で ERP4 の `GroupAccount` に同期する。
   - 同期失敗時は権限不足側に倒し、高権限は自動昇格させない。

### 6.4 制限

- Google グループだけで `admin` / `exec` を即時付与しない。
- 案件所属 (`ProjectMember`) は ERP4 側管理を維持する。
- 承認権限や会計・人事などの高リスク権限は、ERP4 側で明示ロールまたは承認済みマッピングに限定する。

## 7. データモデル

### 7.1 業務ユーザ

- `UserAccount`
  - ERP4 の業務主体。
  - 表示名、所属、雇用属性、承認系属性、プロジェクト所属の起点。

### 7.2 認証主体

- `UserIdentity`
  - `id`
  - `userAccountId`
  - `providerType` (`google_oidc` / `local_password`)
  - `providerSubject`
    - `google_oidc`: OIDC の `sub`
    - `local_password`: ERP4 が採番する不変の認証主体 ID
  - `issuer`
    - `NOT NULL`
    - `google_oidc`: 対象テナントの OIDC issuer
    - `local_password`: 固定値 `erp4_local`
  - `emailSnapshot`
  - `status`
  - `lastAuthenticatedAt`
  - `linkedAt`
- 制約
  - `(providerType, issuer, providerSubject)` は一意
  - `issuer` は常に非 NULL とし、`local_password` では固定値 `erp4_local` を使う
  - email は一意キーにしない

### 7.3 ローカル認証情報

- `LocalCredential`
  - `userIdentityId`
  - `loginId`
  - `passwordHash`
  - `passwordAlgo=argon2id`
  - `mfaRequired`
  - `mfaSecretRef`
  - `failedAttempts`
  - `lockedUntil`
  - `passwordChangedAt`
  - `recoveryCodesHash`

### 7.4 グループ/ロール

- `GroupAccount`
  - ERP4 側のグループ識別子。
- `GroupMapping`
  - 外部グループと ERP4 ロール/グループの対応。
  - source, scope, reviewedBy, reviewedAt を保持する。

## 8. 識別子とリンク規約

- Google ユーザの識別は `UserIdentity(providerType=google_oidc, issuer, providerSubject=sub)` で行う。
- ローカルユーザの識別は `UserIdentity(providerType=local_password, issuer=erp4_local, providerSubject=<immutable local subject>)` で行う。
- ローカル認証で利用者が入力する `loginId` は `LocalCredential` 側で管理し、業務運用上の変更が必要な場合でも `providerSubject` は不変とする。
- `UserAccount.externalId` に Google `issuer + sub` を直接詰める運用はやめ、認証識別子は `UserIdentity` に分離する。
- email による自動リンクは禁止する。
- 同一人物の Google ID とローカル ID のリンク・解除は、管理者操作のみ許可する。
- ユーザ本人による認証方式の追加・切替・解除は許可しない。

## 9. 認証方式の移行ポリシー

### 9.1 管理者による移行のみ許可

- Google → ローカル、ローカル → Google のいずれも、`system_admin` 権限を持つ管理者のみ実行できる。
- ユーザ本人が UI から認証方式を切り替える機能は提供しない。
- すべての移行操作は監査ログに記録し、申請番号またはチケット番号を必須入力とする。

### 9.2 ローカル認証ユーザから Google 連携への移行

- 前提
  - 対象 `UserAccount` が存在すること
  - 移行先 Google アカウントの `sub` と `issuer` を管理者が確認済みであること
- 操作
  - 対象 `UserAccount` に `google_oidc` の `UserIdentity` を追加する
  - 必要に応じて `local_password` は一定の猶予期間後に無効化する
- 推奨
  - まず `Google + ローカル併用` の短期移行期間を設け、その後 `local_password` を disable する
- 禁止
  - email 一致だけで Google アカウントへ自動リンクしない

### 9.3 Google 認証ユーザからローカル認証への移行

- 前提
  - 対象 `UserAccount` が存在すること
  - 例外運用理由が承認済みであること
- 操作
  - 対象 `UserAccount` に `local_password` の `UserIdentity` と `LocalCredential` を追加する
  - 必要に応じて `google_oidc` の `UserIdentity` を無効化または削除する
- 必須制約
  - 管理者が初期パスワードを発行し、初回ログイン時に再設定させる
  - MFA 設定完了までは高権限ロールを付与しない
  - Google からローカルへ移行しただけで権限を拡張しない

### 9.4 併用期間の扱い

- 1 つの `UserAccount` に対して複数の `UserIdentity` を保持できる設計とする。
- ただし常用を避けるため、併用は移行期間または break-glass 目的に限定する。
- 併用時も業務主体は 1 つの `UserAccount` のままとし、監査ログ・承認履歴・所属情報は分岐させない。

### 9.5 必要な監査項目

- actorAdminUserId
- targetUserAccountId
- beforeProviders / afterProviders
- reasonCode
- ticketId
- approvedBy
- executedAt
- rollbackOf

## 10. セッション/トークン方針

- ブラウザ向けはサーバセッションを標準とする。
- Cookie は `Secure`, `HttpOnly`, `SameSite=Lax` 以上を必須にする。
- API 直接呼び出し用の内部トークンを使う場合は短命 JWT に限定し、refresh token をブラウザに保持しない。
- セッションの初期値
  - absolute timeout: 12 時間
  - idle timeout: 2 時間
- ログアウトは ERP4 セッション破棄を必須とし、Google 側ログアウトとは分離する。

## 11. 監査・統制

- 記録対象
  - ログイン成功/失敗
  - MFA 成功/失敗
  - アカウント lock/unlock
  - Google/ローカルのリンク操作
  - グループ同期とマッピング変更
  - 権限昇格/剥奪
- 最低限の記録項目
  - actor
  - principalUserId
  - providerType
  - issuer
  - subject
  - sourceIp
  - userAgent
  - result
  - correlationId
- 高権限ロール変更は 4-eyes または監査レビュー対象とする。

## 12. フェイルセーフ

- Google 認証系障害時
  - 既存セッションの短時間継続は可
  - 新規ログインは停止
  - header fallback へ自動降格しない
- グループ同期障害時
  - 最終成功状態を読み取り専用で利用してもよいが、自動昇格はしない
  - 不整合時は権限不足側に倒す
- ローカル認証障害時
  - break-glass 用の最小管理者アカウントを別保護で管理する
  - 常用運用には使わない

## 13. 現行実装との差分

- 現行 `packages/backend/src/plugins/auth.ts` は `AUTH_MODE=jwt|hybrid|header` の PoC 構成で、header 認証が残っている。
- 現行は Bearer token を API で直接検証しており、BFF セッション標準にはなっていない。
- 現行は `UserIdentity` を優先しつつ、移行期間の互換層として `UserAccount.externalId` / `userName` lookup も残す構成である。
- 現行には本番向けローカルパスワード認証がない。
- 本正式案では、これらを段階的に置き換える。

## 14. 導入フェーズ

### Phase 1

- `UserIdentity` / `LocalCredential` を導入し、既存 `UserAccount.externalId` との互換運用を設ける。
- 既存認可ロジックを `UserAccount` ベースのまま維持しつつ、認証識別子を分離する。

### Phase 2

- Google OIDC を本番主経路として確立する。
- header 認証を本番から排除する。
- グループ利用は停止し、ERP4 側ロール管理のみで運用する。

### Phase 3

- 例外ユーザ向けローカル認証を実装する。
- 管理者による Google⇔ローカル移行フローを実装する。
- 高権限ロールへのローカル認証割当制約を入れる。

### Phase 4

- Google グループの read-only 利用可否を再評価する。
- 採用する場合は、同期方式・マッピング監査・失敗時挙動を定義する。

## 15. 未決事項

- ローカル認証ユーザに必須とする MFA 方式（TOTP / FIDO2 / email OTP）
- break-glass アカウントの保管責任分界
- Google グループを一切使わないか、限定導入するかの最終判断
- 現行 `UserAccount.externalId` から `UserIdentity` への移行方式
- 認証方式移行時の承認ワークフロー要否
- BFF 導入時の frontend 認証フロー変更範囲
