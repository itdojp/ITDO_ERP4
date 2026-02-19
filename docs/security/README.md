# セキュリティ概要

## 目的
- セキュリティの前提（資産/境界/分類）を明確化し、レビュー・運用の基準を揃える

## 参照
- セキュリティベースライン: `docs/security/security-baseline.md`
- 監査ログ必須イベント: `docs/security/audit-required-events.md`
- サプライチェーン対策: `docs/security/supply-chain.md`
- 依存脆弱性トリアージ運用: `docs/security/dependency-vulnerability-policy.md`
- 依存脆弱性台帳: `docs/security/dependency-vulnerability-register.md`
- 品質目標: `docs/quality/quality-goals.md`

## 資産（守る対象）
### データ
- 個人情報（ユーザID、氏名、メール、連絡先）
- 業務データ（案件、見積、請求、発注、工数、経費）
- HR/ウェルビーイング情報（要配慮情報）
- 監査ログ/操作ログ

### システム
- Backend API（Fastify/Prisma）
- Frontend UI（React/Vite）
- PostgreSQL（データベース）
- 添付/ファイル（PDF、チャット添付、証跡）
- 外部連携（Webhook/Slack、Google Drive/SCIM/IdP など）

## 信頼境界（Trust Boundaries）
1. **ブラウザ**（利用者）
2. **フロントエンド**（UI/Service Worker）
3. **バックエンド API**
4. **データベース**
5. **外部連携先**（Webhook/Drive/SCIM/Push/Email）

境界を跨ぐ通信は **認証・認可・入力検証** を必須とする。

## データ分類（運用上の目安）
- **機密（高）**: HR/ウェルビーイング、認証情報、監査ログ
- **機密（中）**: 取引情報（見積/請求/発注/仕入）、工数/経費
- **社内**: ダッシュボード、レポート、設定値
- **公開**: 公開可能な手順書（必要な範囲のみ）

## 脅威サマリ（要約）
- 認証/認可の抜け（権限昇格、越権参照）
- 入力検証不足（XSS/不正パラメータ）
- 外部連携の悪用（SSRF、Webhook 先誤設定）
- 依存関係の脆弱性（サプライチェーン）
- 添付/ファイルのリスク（マルウェア、意図しない公開）
- 監査ログの不備（追跡不能）

## 運用方針（最小）
- セキュリティ関連の設定/運用変更は Issue/PR で履歴化する
- 重大な脆弱性は公開Issueに詳細を残さない
- 監査ログは「誰が/いつ/何を」を最優先で残す
