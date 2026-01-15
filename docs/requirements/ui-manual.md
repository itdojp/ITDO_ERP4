# ERP4 PoC UI 簡易マニュアル（管理者 / 利用者）

## 前提
- 本書は PoC 環境の UI 操作に関する簡易ガイドです。
- 画面キャプチャは 2026-01-15 実行の E2E で取得しています。
  - 証跡: `docs/test-results/2026-01-15-frontend-e2e/`
- 画面の表示内容は demo seed に基づきます（データ差分あり）。

## 共通: ダッシュボード
- 目的: アラート・承認・通知・インサイトの概要確認
- 主な操作: 件数確認、通知の既読化、アラート/インサイトの一覧確認

![ダッシュボード](../test-results/2026-01-15-frontend-e2e/01-core-dashboard.png)

---

## 利用者向け（一般ユーザ）

### 日報 + ウェルビーイング
- 目的: 日報の記録とコンディション申告
- 主な操作: Good/Not Good 選択、メモ入力、送信

![日報](../test-results/2026-01-15-frontend-e2e/02-core-daily-report.png)

### 工数入力
- 目的: 案件・タスク単位で工数を記録
- 主な操作: 案件/タスク/日付/工数/作業種別/場所の入力 → 追加

![工数入力](../test-results/2026-01-15-frontend-e2e/03-core-time-entries.png)

### 請求（ドラフト）
- 目的: 工数や金額から請求ドラフトを作成
- 主な操作: 案件選択 → 金額設定 → 作成、工数期間から作成、詳細確認

![請求ドラフト](../test-results/2026-01-15-frontend-e2e/06-core-invoices.png)

### プロジェクトチャット
- 目的: プロジェクト単位のコミュニケーション
- 主な操作: 投稿、メンション、既読の確認

![プロジェクトチャット](../test-results/2026-01-15-frontend-e2e/12-project-chat.png)

### ルームチャット（DM/Private Group）
- 目的: ルーム単位のコミュニケーション
- 主な操作: ルーム選択、投稿、メンション

![ルームチャット](../test-results/2026-01-15-frontend-e2e/14-room-chat.png)

### オフライン動作（参考）
- 目的: オフライン時の送信待ちと復旧後の再送
- 主な操作: オフライン保存 → 再送

![オフライン送信待ち](../test-results/2026-01-15-frontend-e2e/14-offline-daily-queue.png)
![オフライン再送](../test-results/2026-01-15-frontend-e2e/15-offline-queue-retry.png)
![オフライン重複工数](../test-results/2026-01-15-frontend-e2e/16-offline-duplicate-time-entry.png)

---

## 管理者向け（admin/mgmt/exec）

### 承認
- 目的: 承認対象の一覧と状態確認
- 主な操作: 承認状況の参照

![承認](../test-results/2026-01-15-frontend-e2e/07-approvals.png)

### レポート
- 目的: 工数・予実・稼働の可視化
- 主な操作: 集計条件の設定、一覧確認

![レポート](../test-results/2026-01-15-frontend-e2e/08-reports.png)

### プロジェクト / メンバー管理
- 目的: 案件情報とメンバー構成の確認・管理
- 主な操作: プロジェクト一覧、メンバー確認

![プロジェクト](../test-results/2026-01-15-frontend-e2e/09-projects.png)
![プロジェクトメンバー](../test-results/2026-01-15-frontend-e2e/09-project-members.png)

### マスタ管理
- 目的: 取引先やタグ等のマスタデータ管理
- 主な操作: 一覧確認、追加/更新

![マスタ管理](../test-results/2026-01-15-frontend-e2e/10-master-data.png)

### 管理設定
- 目的: 全体設定・運用設定の確認
- 主な操作: 閾値や設定値の確認/変更

![管理設定](../test-results/2026-01-15-frontend-e2e/11-admin-settings.png)

### HR 分析（HR グループ向け）
- 目的: ウェルビーイング指標の確認
- 主な操作: 指標の閲覧、傾向の把握

![HR分析](../test-results/2026-01-15-frontend-e2e/13-hr-analytics.png)

---

## 補足
- `pwa push subscribe flow` は `VITE_PUSH_PUBLIC_KEY` 未設定のため E2E ではスキップしています。
- 画面デザインは `@itdojp/design-system` 適用済みです（compact density）。
