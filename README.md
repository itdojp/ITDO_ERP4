# ITDO ERP4 - 社内統合システム実装リポジトリ

## プロジェクト概要

ITDO ERP4 は、Project-Open で十数年運用してきた社内統合システムを、現行業務に合わせて段階的に再構築するための実装リポジトリです。前段として整理した仕様・要求は [ITDO_ERP3](https://github.com/itdojp/ITDO_ERP3) に保存されており、本リポジトリでは **実装に必要な仕様抜粋・移行設計・コード・運用手順** を集約します。

- 既存システム: Project-Open 3.5 + PostgreSQL 8.1（独自カスタマイズ多数）
- 現行実装: TypeScript のモジュラーモノリス PoC
  - Backend: Node.js + Fastify + Prisma + PostgreSQL
  - Frontend: React + Vite + TypeScript
  - E2E: Playwright + Podman PostgreSQL
- アーキテクチャ方針: [docs/architecture/greenfield-ideal-design.md](docs/architecture/greenfield-ideal-design.md) の「Modular Monolith First」を基準に、境界強化と段階的な移行容易性を優先
- 運用方針: 段階的移行（並行稼働期間あり）、MVP 完成後にロールアウト

## リポジトリ構成

```text
ITDO_ERP4/
├── AGENTS.md              # Codex/開発者向け運用ガイド
├── Makefile               # lint/test/build/e2e 等の標準入口
├── README.md              # 本ファイル
├── SECURITY.md            # セキュリティ連絡・運用方針
├── deploy/
│   ├── containers/        # コンテナ実行・初期化関連
│   └── quadlet/           # Podman/systemd Quadlet 定義
├── docs/
│   ├── api/               # API 契約・スキーマ関連
│   ├── architecture/      # アーキテクチャ方針・設計判断
│   ├── data/              # データ品質・移行・インポート関連
│   ├── legacy/            # Project-Open カスタマイズの棚卸し
│   ├── manual/            # 利用者/管理者向けマニュアル
│   ├── ops/               # 運用Runbook・導入手順
│   ├── plan/              # 実装計画・マイルストーン
│   ├── quality/           # DoD・品質ゲート・テスト戦略
│   ├── requirements/      # 実装用に抽出した仕様書
│   ├── security/          # セキュリティ設計・手順
│   ├── test-results/      # テスト・スクリーンショット証跡
│   └── ui/                # UI/UX 方針・証跡・品質基準
├── packages/
│   ├── backend/           # Fastify API、Prisma schema、backend tests
│   └── frontend/          # React/Vite UI、Vitest、Playwright specs
└── scripts/
    ├── checks/            # 品質チェック補助
    ├── ops/               # 運用・導入補助
    ├── perf/              # 性能検証補助
    └── quadlet/           # Quadlet/Podman 補助
```

## 主要コマンド

Makefile が利用できる場合は、以下を標準入口とします。

```bash
make lint
make format-check
make typecheck
make build
make test
make audit
make e2e
```

個別パッケージの直接実行例は [AGENTS.md](AGENTS.md) を参照してください。

## 手動確認（PoC）

フロント（ダッシュボード→日報→工数→請求）

- ダッシュボード: アラートカードが最新5件表示され、`すべて表示` で切替できる
- 日報/ウェルビーイング: Good/Not Good 送信ができ、Not Good時にタグ/コメント/ヘルプ導線が表示される
- 工数入力: 入力→一覧再取得で反映される
- 請求ドラフト: 一覧/詳細が表示され、送信ボタンでステータスが更新される

バックエンドの詳細手順は [docs/manual/manual-test-checklist.md](docs/manual/manual-test-checklist.md) と [packages/backend/src/tests/happy-path.md](packages/backend/src/tests/happy-path.md) を参照してください。

## 品質（Quality）

- 品質目標: [docs/quality/quality-goals.md](docs/quality/quality-goals.md)
- DoD: [docs/quality/definition-of-done.md](docs/quality/definition-of-done.md)
- 品質ゲート（CI）: [docs/quality/quality-gates.md](docs/quality/quality-gates.md)
- テスト戦略: [docs/quality/test-strategy.md](docs/quality/test-strategy.md)
- テストギャップ: [docs/quality/test-gaps.md](docs/quality/test-gaps.md)

詳細は `docs/` 以下のドキュメントおよび GitHub Issues を参照してください。

## 運用（Ops）

- 運用Runbook（入口）: [docs/ops/index.md](docs/ops/index.md)
- 操作/運用マニュアル（入口）: [docs/manual/README.md](docs/manual/README.md)
- さくらVPS/Podman試行手順: [docs/ops/sakura-vps-podman-trial.md](docs/ops/sakura-vps-podman-trial.md)
