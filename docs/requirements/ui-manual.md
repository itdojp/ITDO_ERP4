# ERP4 PoC UI 簡易マニュアル（管理者 / 利用者）

## 前提
- 本書は PoC 環境の UI 操作に関する簡易ガイドです。
- 画面キャプチャは 2026-01-15 実行の E2E で取得しています。
  - 証跡: `docs/test-results/2026-01-15-frontend-e2e/`
- 画面の表示内容は demo seed に基づきます（データ差分あり）。
- 対象ロールの目安: admin / mgmt / exec / hr / user

## 目次
- 共通: 現在のユーザー / ダッシュボード / ERP横断検索
- 利用者向け: 日報 / 工数 / タスク / 経費 / 休暇 / 見積 / 請求 / チャット / オフライン
- 管理者向け: 承認 / レポート / 案件 / マイルストーン / マスタ / ベンダー書類 / 管理設定 / 監査閲覧 / HR分析
- 補足: PWA キャッシュ更新

## 共通: 現在のユーザー
- 目的: 現在のログイン情報と通知/オフラインキューの状態確認
- 主な操作: 簡易ログイン/ログアウト、Push同意、オフライン再送
- 補足: Googleログインボタンは `VITE_GOOGLE_CLIENT_ID` 設定時のみ表示されます

![現在のユーザー](../test-results/2026-01-15-frontend-e2e/00-current-user.png)

---

## 共通: ダッシュボード
- 目的: アラート・承認・通知・インサイトの概要確認
- 主な操作: 件数確認、通知の既読化、アラート/インサイトの一覧確認
- 補足: インサイトは権限により表示されない場合があります

![ダッシュボード](../test-results/2026-01-15-frontend-e2e/01-core-dashboard.png)

---

## 共通: ERP横断検索
- 目的: 案件/見積/請求/工数/経費/仕入/チャットの横断検索
- 主な操作: 検索語入力 → 検索
- 補足: 2文字以上で検索を実行します

![ERP横断検索](../test-results/2026-01-15-frontend-e2e/06-core-global-search.png)

---

## 利用者向け（一般ユーザ）

### 日報 + ウェルビーイング
- 目的: 日報の記録とコンディション申告
- 主な操作: Good/Not Good 選択、メモ入力、送信
- 補足: Not Good 選択時のみタグと相談フラグが表示されます

![日報](../test-results/2026-01-15-frontend-e2e/02-core-daily-report.png)

### 工数入力
- 目的: 案件・タスク単位で工数を記録
- 主な操作: 案件/タスク/日付/工数/作業種別/場所の入力 → 追加
- 補足: 15分単位・最大 1440 分の制限があります

![工数入力](../test-results/2026-01-15-frontend-e2e/03-core-time-entries.png)

### タスク
- 目的: 案件タスクの登録・進捗・ベースライン確認
- 主な操作: 案件選択、タスクの追加/更新、ベースラインの閲覧
- 補足: 依存関係や進捗率はタスク編集で更新します

![タスク](../test-results/2026-01-15-frontend-e2e/21-project-tasks.png)

### 経費入力
- 目的: 経費の登録と領収書リンクの管理
- 主な操作: 案件/区分/金額/通貨/日付の入力 → 追加、領収書 URL の登録
- 補足: 共通経費は「共通経費」チェックで登録できます

![経費入力](../test-results/2026-01-15-frontend-e2e/04-core-expenses.png)

### 休暇
- 目的: 休暇の申請と一覧確認
- 主な操作: 休暇種別/期間/時間/備考の入力 → 作成 → 申請
- 補足: 工数重複がある場合は警告が表示されます

![休暇](../test-results/2026-01-15-frontend-e2e/22-leave-requests.png)

### 見積
- 目的: 見積ドラフトの作成と承認依頼
- 主な操作: 案件選択 → 金額/通貨/有効期限/備考 → 作成 → 承認依頼 → 送信（Stub）

![見積](../test-results/2026-01-15-frontend-e2e/05-core-estimates.png)

### 請求（ドラフト）
- 目的: 工数や金額から請求ドラフトを作成
- 主な操作: 案件選択 → 金額設定 → 作成、工数期間から作成、詳細確認
- 補足: 工数から作成した場合、対象工数は請求に紐づきます

![請求ドラフト](../test-results/2026-01-15-frontend-e2e/06-core-invoices.png)

### プロジェクトチャット
- 目的: プロジェクト単位のコミュニケーション
- 主な操作: 投稿、メンション、既読の確認

![プロジェクトチャット](../test-results/2026-01-15-frontend-e2e/12-project-chat.png)

### ルームチャット（DM/Private Group）
- 目的: ルーム単位のコミュニケーション
- 主な操作: ルーム選択、投稿、メンション
- 補足: DM/Private Group の利用可否は管理設定に依存します

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
- 主な操作: フィルタ条件の指定、承認/却下、理由の入力
- 補足: flowType / status / projectId / approver などで絞り込み可能

![承認](../test-results/2026-01-15-frontend-e2e/07-approvals.png)

### レポート
- 目的: 工数・予実・稼働の可視化
- 主な操作: 期間/案件/ユーザの設定、工数・残業・バーンダウン・EVM の取得
- 補足: ベースラインが未設定の場合はバーンダウン取得ができません

![レポート](../test-results/2026-01-15-frontend-e2e/08-reports.png)

### プロジェクト / メンバー管理
- 目的: 案件情報とメンバー構成の確認・管理
- 主な操作: 案件の追加/更新、親案件の設定、期間/予算/計画工数の登録、メンバー割当

![プロジェクト](../test-results/2026-01-15-frontend-e2e/09-projects.png)
![プロジェクトメンバー](../test-results/2026-01-15-frontend-e2e/09-project-members.png)

### マイルストーン
- 目的: 請求連動のマイルストーン登録と納期確認
- 主な操作: 案件選択、マイルストーン登録/更新、納期リスト取得
- 補足: 納期レポートは期間指定で取得できます

![マイルストーン](../test-results/2026-01-15-frontend-e2e/23-project-milestones.png)

### マスタ管理
- 目的: 取引先やタグ等のマスタデータ管理
- 主な操作: 顧客/業者/連絡先の追加・更新・確認

![マスタ管理](../test-results/2026-01-15-frontend-e2e/10-master-data.png)

### ベンダー書類（発注 / 仕入見積 / 仕入請求）
- 目的: 発注書・仕入見積・仕入請求の管理
- 主な操作: 案件/業者の選択、番号・金額・期日の登録、一覧確認

![ベンダー書類一覧](../test-results/2026-01-15-frontend-e2e/06-vendor-docs.png)
![ベンダー書類作成](../test-results/2026-01-15-frontend-e2e/06-vendor-docs-create.png)

### 管理設定
- 目的: 全体設定・運用設定の確認
- 主な操作: アラート設定 / 承認ルール / 帳票テンプレート / 連携設定 / レポート配信 / チャット設定 / 単価設定
- 補足: JSON 入力欄は構造が正しい場合のみ保存されます

![管理設定](../test-results/2026-01-15-frontend-e2e/11-admin-settings.png)

### 監査閲覧（Break-glass）
- 目的: 監査目的のチャット閲覧（Break-glass）
- 主な操作: 対象ルーム/期間/ユーザの指定、閲覧理由の入力
- 補足: 利用ログが監査用に記録されます

![監査閲覧](../test-results/2026-01-15-frontend-e2e/24-chat-break-glass.png)

### HR 分析（HR グループ向け）
- 目的: ウェルビーイング指標の確認
- 主な操作: 指標の閲覧、傾向の把握

![HR分析](../test-results/2026-01-15-frontend-e2e/13-hr-analytics.png)

---

## 補足
- PWA のキャッシュ更新確認: サービスワーカー更新後の表示確認に利用します。

![PWA キャッシュ更新](../test-results/2026-01-15-frontend-e2e/20-sw-cache-refresh.png)

- `pwa push subscribe flow` は `VITE_PUSH_PUBLIC_KEY` 未設定のため E2E ではスキップしています。
- 画面デザインは `@itdojp/design-system` 適用済みです（compact density）。
