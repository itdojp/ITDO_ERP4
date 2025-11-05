# 開発ロードマップ（ドラフト）

## 1. 全体方針
- **段階的移行**: 既存 Project-Open と並行稼働しながらモジュール単位で置き換え。
- **MVP 優先**: プロジェクト管理・タイムシート・請求（インボイス対応）・通知基盤を対象範囲とする。
- **データ整合性重視**: PostgreSQL 15 へのスキーマ再設計と移行ツール整備を先行実施。
- **ドキュメント→実装サイクル**: 仕様整理（ITDO_ERP3）→抽出要約（ITDO_ERP4）→実装・検証の流れで進める。

## 2. フェーズ構成
| フェーズ | 期間目安 | 主要成果物 | 備考 |
|----------|----------|------------|------|
| **Phase 0** 準備 | 2025Q4 | - ITDO_ERP3 から抜粋した MVP 仕様要約<br>- Project-Open カスタマイズ棚卸し一覧<br>- 移行ガイドライン（データ/権限/通知） | 本リポジトリで実施 |
| **Phase 1** MVP 実装 | 2026H1 | - Timesheet/Billing/Project サービスのPoC→本実装<br>- React/Next.js フロントPoC<br>- PostgreSQL 15 環境での移行試験 | 並行稼働開始 |
| **Phase 2** 拡張 | 2026H2 | - HR・Sales・CRM 連携<br>- 自動化ワークフロー/レポート | 既存PO機能との差分解消 |
| **Phase 3** 高度化 | 2027~ | - AI支援/分析モジュール<br>- GRC・監査機能強化 | 追加要件次第 |

## 3. 直近（Phase 0）の重点タスク
1. **仕様抽出**  
   - ITDO_ERP3 `integrated-specs` のうち MVP 関連ファイルを要約し、`docs/requirements/` に反映。  
   - 用語集・API規約など、実装で参照する標準をセットアップ。
2. **Legacy棚卸し**  
   - Project-Open `intranet-timesheet2*`、`intranet-invoices*`、`acs_sc_*` カスタマイズの機能/SQLを整理。  
   - eメール送信 (`cf_timesheet_notification`, Message-ID fix) やシーケンス調整など再利用する知見をドキュメント化。
3. **移行設計**  
   - PostgreSQL 15 スキーマ設計案（Prisma等のモデリング）と旧DBマッピング案のドラフト作成。  
   - 認証/権限移行（Site-Wide Administrators 他）の仮設計。
4. **リポジトリ運用整備**  
   - Issue / Project / Label 方針の決定。  
   - CI 準備（Lint/Format/Docs ビルド）を設定予定。

## 4. マイルストーン案
- **M0.1**: MVP仕様要約の初版完成（`docs/requirements/`）  
- **M0.2**: Legacyカスタム棚卸しリスト公開（`docs/legacy/`）  
- **M0.3**: データ移行ドラフト & PoC DB スキーマ確定  
- **M1.0**: Timesheet サービス + UI PoC をステージングへ展開  

## 5. 次アクション
- [ ] Issue: MVP 仕様抜粋作業をチケット化  
- [ ] Issue: Legacy カスタマイズ棚卸し（タイムシート / 請求 / 認証 / 通知）  
- [ ] Issue: 新DBスキーマ設計 PoC  
- [ ] Issue: リポジトリ運用ルール整備

※ 上記はドラフトです。ITDO_ERP3 側の課題 (#325/#326 等) と整合を取りつつ更新していきます。
