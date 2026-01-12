# ITDO ERP4 - 社内統合システム実装リポジトリ

## プロジェクト概要
ITDO ERP4 は、Project-Open で十数年運用してきた社内統合システムを、モダンなアーキテクチャと運用で再構築するための実装リポジトリです。前段として整理した仕様・要求は [ITDO_ERP3](https://github.com/itdojp/ITDO_ERP3) に保存されており、本リポジトリでは **実装に必要な仕様抜粋・移行設計・コード** を集約します。

- 既存システム：Project-Open 3.5 + PostgreSQL 8.1（独自カスタマイズ多数）
- 目標スタック：TypeScript / Rust / Python を中心とした疎結合サービス群、PostgreSQL 15+
- 運用方針：段階的移行（並行稼働期間あり）、MVP 完成後にロールアウト

## リポジトリ構成（初期）

```
ITDO_ERP4/
├── README.md
└── docs/
    ├── plan/               # 実装計画・マイルストーン
    ├── requirements/       # 実装用に抽出した仕様書
    └── legacy/             # Project-Open カスタマイズの棚卸し
```

## 進行中の主なタスク
- [ ] ITDO_ERP3 から MVP に必要な仕様を抽出し、本リポジトリへ要約版として取り込み
- [ ] Project-Open のカスタマイズ把握（タイムシート、請求、権限、通知）を `docs/legacy/` に整理
- [ ] 新アーキテクチャ仮案の決定と初期サービス（例：Timesheet API）の PoC 着手

## 手動確認（PoC）
フロント（ダッシュボード→日報→工数→請求）
- ダッシュボード: アラートカードが最新5件表示され、`すべて表示`で切替できる
- 日報/ウェルビーイング: Good/Not Good 送信ができ、Not Good時にタグ/コメント/ヘルプ導線が表示される
- 工数入力: 入力→一覧再取得で反映される
- 請求ドラフト: 一覧/詳細が表示され、送信ボタンでステータスが更新される

バックエンドの詳細手順は `docs/requirements/manual-test-checklist.md` と `packages/backend/src/tests/happy-path.md` を参照。

詳細は `docs/` 以下のドキュメントおよび GitHub Issues を参照してください。開発フローは今後整備予定です。
