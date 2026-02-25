# ERP4 管理者チュートリアル（画面キャプチャ付き）

更新日: 2026-02-25

## 目的

管理者（`admin` / `mgmt`）が、日次運用で使用頻度の高い管理機能を短時間で確認するためのチュートリアルです。

## 前提

- 対象: `admin` / `mgmt`（一部 `exec` / `hr` 向けの閲覧含む）
- 所要時間: 20〜30分
- 画面キャプチャ: `docs/test-results/2026-02-05-frontend-e2e-r1/`
- 詳細仕様は `docs/manual/ui-manual-admin.md` を参照

## チュートリアル（Step by Step）

### Step 1: ログイン情報と通知設定を確認する

1. 画面上部の「現在のユーザー」を開く  
2. `Roles / OwnerProjects / Groups` を確認する  
3. 通知設定（`realtime` / `digest` / ミュート期限）を確認する

完了条件:
- 管理操作に必要なロールと通知設定を確認できる

![Step1 現在のユーザー](../test-results/2026-02-05-frontend-e2e-r1/00-current-user.png)

### Step 2: ダッシュボードで承認・通知・アラートを把握する

1. 「ダッシュボード」を開く  
2. 「承認状況」「通知」「Alerts」「Insights」を確認する  
3. 必要な通知を既読化する

完了条件:
- 当日の優先対応（承認待ち/アラート）を把握できる

![Step2 ダッシュボード](../test-results/2026-02-05-frontend-e2e-r1/01-core-dashboard.png)

### Step 3: 承認一覧でエビデンスを確認して処理する

1. 「承認」を開く  
2. `flowType / status / projectId` で対象を絞り込む  
3. `エビデンス（注釈）` と `確認依頼リンク` を確認して `承認` / `却下` を実行する

完了条件:
- 承認時に根拠情報を確認し、処理を完了できる

![Step3 承認](../test-results/2026-02-05-frontend-e2e-r1/07-approvals.png)

### Step 4: レポートで案件の稼働状況を確認する

1. 「Reports」を開く  
2. `from/to` と案件を指定する  
3. `PJ別工数` / `グループ別工数` / `EVM` を確認する

完了条件:
- 期間と案件単位の稼働状況を取得できる

![Step4 レポート](../test-results/2026-02-05-frontend-e2e-r1/08-reports.png)

### Step 5: 案件とメンバーを更新する

1. 「プロジェクト」を開く  
2. 案件基本情報を編集して `更新` する  
3. `メンバー管理` でユーザー追加/権限更新を行う

完了条件:
- 案件情報とメンバー権限を更新できる

![Step5 プロジェクト](../test-results/2026-02-05-frontend-e2e-r1/09-projects.png)
![Step5 メンバー管理](../test-results/2026-02-05-frontend-e2e-r1/09-project-members.png)

### Step 6: ベンダー書類（発注/仕入）を確認する

1. 「仕入/発注」を開く  
2. 一覧で対象書類を検索する  
3. `作成` を開き、案件・業者・金額・期日などを入力して登録導線を確認する

完了条件:
- 発注書/仕入見積/仕入請求の作成・参照導線を把握できる

![Step6 ベンダー書類一覧](../test-results/2026-02-05-frontend-e2e-r1/06-vendor-docs.png)
![Step6 ベンダー書類作成](../test-results/2026-02-05-frontend-e2e-r1/06-vendor-docs-create.png)

### Step 7: 管理設定・監査ログ・期間締めを確認する

1. 「Settings」を開き、主要設定カードを確認する  
2. 「監査ログ」を開き、絞り込み・エクスポート導線を確認する  
3. 「期間締め」を開き、締め対象の確認手順を確認する

完了条件:
- 設定変更時の監査確認導線と締め運用導線を把握できる

![Step7 設定](../test-results/2026-02-05-frontend-e2e-r1/11-admin-settings.png)
![Step7 監査ログ](../test-results/2026-02-05-frontend-e2e-r1/29-audit-logs.png)
![Step7 期間締め](../test-results/2026-02-05-frontend-e2e-r1/30-period-locks.png)

### Step 8: 運用ジョブと送信ログを確認する

1. 「運用ジョブ」を開き、定期処理の実行結果を確認する  
2. 「ドキュメント送信ログ」を開き、配信結果を確認する  
3. 「PDFファイル一覧」で送信対象PDFを確認する

完了条件:
- 運用ジョブと配信監視の基本確認ができる

![Step8 運用ジョブ](../test-results/2026-02-05-frontend-e2e-r1/25-admin-jobs.png)
![Step8 ドキュメント送信ログ](../test-results/2026-02-05-frontend-e2e-r1/26-document-send-logs.png)
![Step8 PDFファイル一覧](../test-results/2026-02-05-frontend-e2e-r1/27-pdf-files.png)

## 次の参照先

- 管理者向け詳細操作: `docs/manual/ui-manual-admin.md`
- 承認運用: `docs/manual/approval-operations.md`
- 経理運用: `docs/manual/accounting-guide.md`
