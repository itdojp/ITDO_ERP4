# 認証アーキテクチャ原案（ドラフト）

## 1. 目的と前提
- Google Workspace Standard を利用している社内ユーザーを対象に、Google アカウントのシングルサインオン (SSO) とパスワードレス認証（Passkey）を実現する。
- ERP4 側ではローカルパスワードを保持せず、OpenID Connect を用いたフェデレーション認証を標準とする。
- Project-Open から移行する既存ロール／プロジェクト権限を、新しい RBAC モデルへマッピングする。

## 2. 構成要素
- **Google Identity (Workspace IdP)**  
  OpenID Connect プロバイダ。Passkey/MFA 等は Google 側の管理ポリシーに従う。
- **ERP4 Auth Gateway**  
  OIDC フローのエントリポイント。トークン検証、セッション管理、認可判定、監査ログ記録を担当。
- **User Profile Service**  
  ユーザープロファイル・社内ロール・プロジェクト権限を保持する内部サービス／テーブル群。
- **Directory Sync Worker（任意）**  
  Google Admin SDK Directory API を用いて、Google グループや属性を read-only で同期するバッチ。サービスアカウント＋ドメイン全体委任で実行。

## 3. 認証フロー概要
1. 利用者が ERP4 にアクセスすると Auth Gateway が未認証セッションを検出し、Google OIDC の認可エンドポイントへリダイレクト。  
2. 利用者は Google 側で認証（Passkey/MFA 含む）し、Auth Gateway がコード＋ID トークンを受領。  
3. Auth Gateway がトークン署名と `aud`/`hd`/`exp` を検証し、`sub`・`email` をキーに User Profile Service を照会。  
4. 初回ログイン時はプロファイルを自動プロビジョニングし、初期ロール（例: general_user）を付与。  
5. RBAC 情報を含むセッション（HTTP-only Cookie または短命JWT）を発行。各 API 呼び出し時にトークン検証＋認可を実施。  
6. ログアウト時は ERP4 セッションを破棄。Google 側のログアウトとは分離して管理する。

## 4. Google グループ／属性の利用案
- **狙い**: Google グループを利用し、チーム／部門ベースの権限付与を簡略化する。  
- **同期方式**: Admin SDK Directory API (`groups.readonly`, `group.members.readonly`) を read-only スコープで利用。  
  - サービスアカウントにドメイン全体委任を設定し、Directory Sync Worker が 15〜60 分間隔で差分同期。  
  - 取得したグループ E メール ↔ ERP4 ロール／プロジェクト権限のマッピングテーブルを維持。  
  - 失敗時は通知（Slack/メール）、成功時は監査ログを更新。  
- **注意点**:  
  - 権限は読み取り専用に限定し、サービスアカウント鍵の保護・ローテーション手順を整備。  
  - グループ変更を即時反映したい場合は Pub/Sub Push 連携も検討だが、初期はバッチ同期で十分。  
  - 外部ユーザー（Google アカウントを持たない取引先等）の扱いは別途設計が必要。

## 5. Passkey と多要素
- Passkey は Google 側で提供されるため、ERP4 は追加開発不要。ID トークンの `amr`（Authentication Methods Reference）をログ出力し、どの認証手段でサインインしたかを可視化する。  
- Workspace 管理コンソールで MFA/Passkey ポリシーを設定し、ERP4 ではトークン検証と監査のみ行う。  
- 将来的に独自 WebAuthn を追加する場合は、二段階認証のプラグイン層を Auth Gateway に実装可能。

## 6. セッション／トークン方針
- **セッション長**: 1 セッション 12 時間、アイドルタイムアウト 2 時間を初期設定とし、業務要件で調整。  
- **保管方法**: HTTP-only Cookie でサーバセッション管理が基本。API 呼び出しには短命 JWT を発行し、必要に応じてリフレッシュトークンを利用。  
- **監査ログ**: ログイン成功／失敗、`amr`、Google `sub`、IP、User-Agent を記録。監査ログ保管期間は 2 年目安。  
- **CSRF／XSS 対策**: SameSiteStrict Cookie／CSRF トークン併用。SPA の場合は BFF パターンを採用。

## 7. データモデル初期案
- `users`: `id`, `google_sub`, `email`, `display_name`, `status`, `last_login_at`, `org_unit`, `picture_url` 等。  
- `user_roles`: `user_id`, `role_code`, `source`（manual/google-group）、`assigned_at`, `expires_at`。  
- `group_mappings`（任意）: `google_group_email`, `role_code`, `project_scope`, `last_synced_at`。  
- `org_units`: 法人・部署マスタ。Google から取得するか、社内マスタを優先するかは要検討。

## 8. 未決事項
- 外部ユーザー用の認証方式（Cloud Identity ゲスト／別 IdP の導入可否）。  
- Directory API クォータに合わせた同期頻度（総グループ数／メンバー数に応じて調整）。  
- オフボーディング時に Google アカウント停止を即時反映する仕組み（Webhook or Polling）。  
- RBAC とプロジェクト固有権限の詳細設計（Project-Open の `im_biz_objects` との対比）。  
- 認証・属性同期の失敗時に業務影響を最小化するフェイルセーフ（キャッシュ／手動割当）。

---
本ドキュメントは討議用の原案であり、要件ヒアリング・PoC 結果に基づきアップデートする。
