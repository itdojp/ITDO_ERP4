# TODO リスト（短期ドライブ用）

## 残作業（運用確定）
- [ ] #544 S3 バケット/リージョン/KMS の確定値を `docs/requirements/backup-restore.md` に反映
- [ ] #544 S3/OSS 移行の時期を決定（`docs/requirements/backup-restore.md`）
- [ ] #547 GitHub Packages 配布復旧後に `@itdojp/design-system@1.0.0` へ依存を戻す（暫定: git tag 参照）
- [x] #648 E2E/統合テストの拡充（手動チェックの自動化開始）
- [x] #650 依存関係更新の運用ルール整備（`docs/quality/dependency-update-policy.md`）
- [x] #649 監査ログ/操作ログ 基盤の整理（PIIマスキング・相関ID）

## 次アクション（未実装対応: FE/BE）
- [x] #551 #552 未実装項目の解消（優先度A: 管理/監査UI）
  - [x] FE: アクセス棚卸しスナップショット（/access-reviews/snapshot）UI
  - [x] FE: 監査ログ検索/CSV出力（/audit-logs）UI
  - [x] FE: 期間締め（/period-locks）管理UI
- [x] 未実装項目の解消（優先度B: ジョブ/運用UI）
  - [x] FE: ジョブ実行UI（/jobs/alerts/run, /jobs/approval-escalations/run, /jobs/data-quality/run）
  - [x] FE: 通知配信ジョブUI（/jobs/notification-deliveries/run）
  - [x] FE: レポート配信ジョブUI（/jobs/report-subscriptions/run, /jobs/report-deliveries/retry）
  - [x] FE: 定期案件ジョブUI（/jobs/recurring-projects/run）
  - [x] FE: 連携ジョブUI（/jobs/integrations/run）
- [x] 未実装項目の解消（優先度C: 文書送信/ファイル/通知UI）
  - [x] FE: 発注書の送信履歴（/purchase-orders/:id/send-logs）UI
  - [x] FE: ドキュメント送信ログ詳細/イベント（/document-send-logs/:id, /document-send-logs/:id/events）UI
  - [x] FE: ドキュメント送信ログの再送（/document-send-logs/:id/retry）UI
  - [x] FE: PDFファイル閲覧導線（/pdf-files/:filename）
  - [x] FE: Pushテスト送信UI（/push-notifications/test）
- [ ] 未実装項目の解消（優先度D: 実配信/外部連携）
  - [x] #558 BE: Push通知の実配信（/push-notifications/test の stub 解消）
  - [x] #559 BE: Slack/Webhook通知の実装（notifier の stub 解消、優先度低）
  - [ ] #560 BE: 添付AVスキャンの実運用（要否判断/方式決定）
    - [x] ClamAV/clamd オプション（`CHAT_ATTACHMENT_AV_PROVIDER=clamav`）の実装（PR #565）
    - [x] 運用設計（叩き台）を docs に追加（PR #566）
    - [x] Podman で clamd を起動/停止/疎通できる補助スクリプトを追加（PR #567）
    - [x] readiness 改善（PING/PONG）+ 統合スモーク + テスト結果記録（PR #568）
    - [ ] 本番での有効化方針（`disabled` 継続 or `clamav`）の決定
    - [ ] 定義更新/監視/障害時の運用方針の最終決定（`docs/requirements/chat-attachments-antivirus.md`）
  - [x] FE: SCIM 設定/状態のUI（/scim/status）

## 次アクション（プロジェクト運用/レポート）
- [x] #522 EVM（PV/EV/AC/SPI/CPI）日次算出（PR #532）
  - [x] API: `GET /reports/project-evm/:projectId?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - [x] UI: Reports に EVM（表/指標）を追加
  - [x] E2E（@extended）または手動QA手順の追記
- [x] #533 PO→ERP4 データ移行 実行ツール
  - [x] 入力仕様（JSON）と実行手順を docs に整理（PR #534）
  - [x] 最小import（customers/vendors/projects/tasks/milestones/time/expense）（PR #534）
  - [x] 見積/請求/発注/業者書類の最小import（estimate/invoice/PO/VQ/VI）（PR #535）
  - [x] 取込後の整合チェック（件数一致）を追加（PR #534）
  - [x] 取込後の整合チェック（参照切れ/明細合計）を追加（PR #535）
  - [x] 取込後の整合チェック（プロジェクト別合計など）を追加（#536）
  - [x] CSV 取込対応（#537）
  - [x] 移行後チェックSQLを追加（PR #540）
  - [x] 運用手順（リハーサル/ロールバック/チェック）を docs に追加（PR #541）
- [ ] #543 PO→ERP4 実データ移行 リハーサル（1回目）

## 次アクション（チャット）
- [x] #453 ルーム化（project chat→room chat）移行方針の確定と段階移行の計画化
  - [x] 仕様/方針ドキュメント（案）の追加（`docs/requirements/chat-rooms.md`）
  - [x] #464 ChatRoom/ChatRoomMember のDB追加（projectルーム先行）
  - [x] #465 ルーム一覧API（projectルーム先行）
  - [x] #469 ProjectChat の案件選択を /chat-rooms へ切替（projectルーム先行）
  - [x] #471 projectルームIDをprojectIdに固定（roomId=projectId）
- [x] #472 room-based messageテーブル導入とproject chat API移行（Step 3）
  - [x] #475 旧ProjectChat*テーブルの凍結/廃止（Step 5）
  - [x] 互換維持の移行ステップ（Step 1〜5）の確定
- [x] #434 ガバナンス（公式/私的/DM）と監査break-glassの設計を確定
  - [x] #477 break-glass を room target に対応
  - [x] 公式ルーム（company/department）のMVP
  - [x] private_group/DM のMVP（設定ON/OFF含む）
- [x] #454 break-glass（申請/二重承認/閲覧許可/監査ログ）を実装
- [x] #455 break-glass UI（申請/承認/履歴）+ システムメッセージ
- [x] #445 AI支援（要約/アクション抽出/FAQ/検索支援）のMVP方針決定

## 次アクション（リリース準備/QA整理）
- [x] #398 テスト結果インデックス整備
  - [x] docs/test-results/README.md を追加
  - [x] 既存のテスト結果ファイルを日付順に整理
- [x] #399 QA手順: Push通知の前提条件を明文化
  - [x] docs/requirements/qa-plan.md に VITE_ENABLE_SW / VITE_PUSH_PUBLIC_KEY の追記
- [x] #400 リリース前チェックリストの叩き台
  - [x] docs/plan/release-checklist.md を追加

## 次アクション（未決定事項の確定）
- [x] #408 損益/工数予実 未決定事項の確定
- [x] #409 見積/請求/発注 UI 未決定事項の確定
- [x] #410 定期案件テンプレ 未決定事項の確定
- [x] #411 案件/タスク/マイルストーン編集 未決定事項の確定
- [x] #412 GRC/監査 未決定事項の確定
- [x] #413 AI/分析 未決定事項の確定

## 次アクション（実装計画）
- [x] #416 Project予算フィールド追加と損益/アラート調整
- [x] #417 Task付け替え時の工数一括移動
- [x] #418 マイルストーン更新と請求ドラフト連動
- [x] #419 Project親変更の理由必須/監査ログ
- [x] #420 定期案件テンプレのデフォルト調整
## 次アクション（Phase 3 着手）
- [x] #338 Phase 3 計画整理（ロードマップ/TODO更新）
  - [x] ロードマップをPhase 3着手に更新（Phase 2完了の反映）
  - [x] TODOにPoCタスクを分解して追加
  - [x] AI/GRC PoCのスコープを要件ドキュメントに反映
- [x] #339 GRC/監査 PoC（監査ログ/アクセス棚卸し）
  - [x] 監査ログの検索/CSV出力API（期間/ユーザ/アクション/対象）
  - [x] 監査ログ出力時の監査ログ記録
  - [x] アクセス棚卸しスナップショット出力（ユーザ/グループ/状態）
  - [x] docs/requirements/grc-audit.md に手順/仕様を追記
- [x] #340 AI/分析 PoC（インサイト生成/表示）
  - [x] ルールベースのインサイト生成（予算超過/残業増/承認遅延）
  - [x] インサイトAPI（期間/プロジェクト指定）
  - [x] 管理ダッシュボードの簡易表示（一覧/カード）
  - [x] 閲覧操作の監査ログ記録
  - [x] docs/requirements/ai-analytics.md に手順/仕様を追記

## 次アクション（Phase 3 次フェーズ）
- [x] #347 PoC評価（監査ログ/アクセス棚卸し/インサイト）
  - [x] 監査ログエクスポートの動作確認（検索条件/CSV/JSON/監査ログ記録）
  - [x] アクセス棚卸しスナップショットの確認（出力項目/権限/内容）
  - [x] インサイト生成の確認（Alert集計/件数/サンプル対象/権限）
  - [x] 確認結果を記録し、課題をIssue化
- [x] #348 本実装計画（GRC/AI 強化）
  - [x] 監査対象イベントの拡張方針を整理
  - [x] 監査ログの外部保全方針（WORM/S3 Object Lock 等）を整理
  - [x] インサイトの追加指標/根拠表示の仕様を整理
  - [x] スケール/性能/保持方針を整理
- [x] #349 運用設計（監査/アクセスレビュー/インサイト）
  - [x] 監査ログ出力の運用フロー（申請/承認/実行/記録）
  - [x] アクセスレビューの周期/責任者/記録方法
  - [x] インサイトの説明責任/運用ルール（誤検知/根拠提示）

## 次アクション（Phase 3 本実装）
- [x] #354 監査ログ拡張（項目/イベント/出力統一）
  - [x] AuditLogスキーマの拡張（actorRole/actorGroupId/requestId/ipAddress/userAgent/source/reasonCode/reasonText）
  - [x] 監査イベント対象の追加（認証/権限/承認/データ操作/設定変更）
  - [x] /audit-logs の検索/CSV出力に拡張項目を反映
- [x] #355 監査ログ外部保全/改ざん検知の実装
  - [x] 日次ローテーションのCSV/JSON出力の整理
  - [x] ハッシュチェーン生成（sha256）と検証手順
  - [x] 外部保全（WORM/S3 Object Lock）運用手順の整理
- [x] #356 インサイト拡張 + 根拠表示
  - [x] 予実ギャップ/承認ボトルネック/納期・請求遅延/連携失敗の指標追加
  - [x] 根拠データ（件数/対象/期間/計算式）をAPIに含める
  - [x] 管理UIで根拠情報を表示
- [x] #357 監査ログの性能/保持方針（パーティション/インデックス）
  - [x] パーティション/保持方針のドキュメント化
  - [x] 必要なインデックス/マイグレーションの洗い出し
## 次アクション（保守/改善）
- [x] #345 CSVユーティリティ共通化（reports/reportSubscriptions）
  - [x] reports/reportSubscriptions のCSV処理を utils/csv.ts に統合
  - [x] 振る舞い差分があればドキュメント化

## 次アクション（意思決定反映の実装計画）
- [x] #275 Googleログイン対応 + 非Googleユーザ許容（ハイブリッド認証）
  - [x] AUTH_MODE=hybrid の導入方針を定義し、環境変数（JWKS/ISSUER/AUDIENCE 等）を追加
  - [x] ユーザ外部ID（externalId）のnullable運用に対応し、リンク規約（email/externalId）を整理
  - [x] Google OIDC のJWT検証とクレームマッピングを実装
  - [x] ヘッダ認証/ローカルユーザの併用ルートを維持（優先順位・フォールバック）
  - [x] 認証/ID管理ドキュメント更新（auth-architecture/id-management/README）
- [x] #276 アクセス制御たたき台の実装反映
  - [x] RBAC（admin/mgmt/exec/hr/user）をAPIに適用（requireRole + 主要エンドポイント）
  - [x] projectIdスコープの閲覧フィルタを実装（userは所属案件に限定）
  - [x] 見積/請求の閲覧を user に許可し、projectId スコープで絞り込み
  - [x] 承認中データの閲覧条件を実装（mgmt/exec + 申請者 + プロジェクトメンバー）
  - [x] ウェルビーイング閲覧はhr専用＋匿名集計は5人未満非表示
  - [x] 例外操作（付け替え/承認取消）は理由必須 + 監査ログ必須
  - [x] ドキュメント更新（access-control/rbac-matrix）
- [x] #277 付け替え運用（締め期間/理由コード/承認取消）
  - [x] PeriodLock テーブル追加（period/scope/projectId/closedAt/closedBy/reason）
  - [x] 付け替え理由コードを定義（input_error など）+ reasonText 必須
  - [x] Task 付け替えに reasonCode/reasonText を適用し監査ログを記録
  - [x] 付け替えAPIの実装（TimeEntry/Expense/Task 等、締め期間/承認状態のチェック）
  - [x] TimeEntry 付け替え（締め期間/承認中チェック + 監査ログ）
  - [x] Expense 付け替え（締め期間/承認中チェック + 監査ログ）
  - [x] 承認取消フローの実装（status=cancelled、権限と理由の検証）
  - [x] 監査ログ・付け替え履歴の記録
  - [x] 仕様ドキュメント更新（reassignment-policy）
- [x] #278 バックアップ/リストア運用の確定と実装準備
  - [x] 保持期間/RPO/RTO の暫定値を設定（デフォルト: 日次14日/週次8週/月次12か月）
  - [x] 暗号化/保管先の運用手順の暫定確定（SSE-KMS + 別ホスト退避時のみGPG）
  - [x] PDF/添付のバックアップ方式を暫定決定（ローカル + 別ホスト退避）
  - [x] バックアップ/リストア手順のスクリプト化（Podman）
  - [x] 本番向けバックアップ/リストアスクリプト追加（S3対応）
  - [x] 検証環境: ローカル + 別ホスト退避 + 暗号化のスクリプト対応
  - [x] 本番運用手順の叩き台整理（S3/KMS/暗号化）
  - [x] リストア検証の運用（定期テスト）を定義
  - [x] S3準備チェックリストの整理（候補項目の明文化）
  - [x] S3バケット/リージョン/KMSの暫定値反映
  - [x] PDF/添付の保存先をS3/OSSへ移行する場合の手順確定
    - [x] 移行手順の叩き台を docs に追加
    - [x] 利用開始条件/責任分界の叩き台を追加
    - [x] S3/OSS 利用開始のタイミングと責任範囲を暫定確定
- [x] #279 アラート再送ポリシーの実装
  - [x] AlertSetting に remindMaxCount を追加（デフォルト3）
  - [x] Alert に reminderCount などの管理項目を追加し、上限で停止
  - [x] remindAfterHours をリマインド間隔として扱う実装に整理
  - [x] 管理画面（AlertSetting）に remindMaxCount の入力/表示を追加
  - [x] マイグレーション作成 + ドキュメント更新（ops-monitoring）

## 次アクション（Roadmap反映: Phase 2 実装計画）
- [x] HR/CRM 連携の実装を本番化（ジョブ/差分同期/エラー処理） (#317)
  - [x] 連携対象のテーブル/フィールドのマッピング確定（docs更新）
  - [x] 差分同期のキー（updatedAt/externalId）と衝突解決ルールを定義
  - [x] integration_runs に retry/backoff を追加し失敗時アラートを実装
  - [x] 手動実行/スケジュール実行の管理画面を整備（最小UI）
- [x] モバイル/PWA の実運用化 (#318)
  - [x] オフラインキュー（TimeEntry/Expense/日報）の送信順序とリトライ設計
  - [x] 競合時の挙動（上書き/差分提示）の最小UXを決定
  - [x] Push 通知の配信条件/同意UXを整備
- [x] 自動化ワークフロー/レポート拡張の本実装 (#319)
  - [x] 定期レポートの生成（CSV/PDF）を本実装に置換
  - [x] 送信履歴と配信失敗のリトライ/停止条件を確定
  - [x] 配信先（メール/ダッシュボード）の優先度/無効条件を決定
- [x] ロードマップの更新（Phase 1完了の反映とPhase 2の期日整理） (#320)

## 次アクション（Phase 2 運用検証）
- [x] HR/CRM 連携の運用検証とデータ品質チェック (#324)
- [x] PWA/Push 運用検証と安定化 (#325)
  - [x] 運用検証手順を docs に追記
  - [x] オフライン送信キューのE2E検証とエビデンス取得
  - [x] 競合/重複の実検証と結果記録
  - [x] Push 同意/解除/再登録の実検証（VAPID鍵）
  - [x] Service Worker 更新/キャッシュ破棄の実検証
- [x] レポート配信の運用検証（定期実行/再送/失敗通知） (#326)
  - [x] ジョブ運用の叩き台（batch-jobs/ops-monitoring）を追記
  - [x] QA/手動チェックリストにレポート配信を追加
  - [x] cron 用の実行スクリプト（scripts/run-report-deliveries.sh）を追加
  - [x] 定期実行設定（cron/運用）と結果記録
  - [x] 失敗通知・CSV/PDF性能の検証結果を記録
## 次アクション（基盤整備）
- [x] DBマイグレーション基盤整備（ベースライン作成＋Podman手順）（#273）

## 次アクション（運用/UI改善）
- [x] レポート購読 管理画面の操作性改善（一括実行/有効切替/配信IDフィルタ）（#268）
- [x] フロント Hooks 警告の解消（AdminSettings/Dashboard）（#269）
- [x] レポート購読の reportKey 一覧と用途を docs に追記（#271）

## 次アクション（アクセス制御/所属管理）
- [x] #378 ERP側での案件メンバー管理（projectIdsのDB化）

## 次アクション（意思決定・運用確定）
- [x] #365 ID管理の未決定事項整理（IdP/SCIM/メール変更）
- [x] #366 アクセス制御の未決定事項整理（ロール/ABAC/PBAC/RLS）
- [x] #367 DBマイグレーション運用の未決定事項（本番権限/移行統合）
- [x] #368 付け替え運用の最終化（締め期間/理由コード/取消手順）
- [x] #369 バックアップ/リストア本番値の確定（保持/暗号化/S3/PDF）
## 次アクション（Phase 2 実装開始）
- [x] 工数: Task ID 無効入力で500になる問題の修正 (#259)
  - [x] backend: taskId存在チェック or 無効値の明示エラー
  - [x] frontend: Task選択UI or 無効値を送信しない
- [x] HR/CRM 連携の実装スケルトン
  - [x] integration_settings / integration_runs のスキーマ追加
  - [x] 管理画面の設定CRUD（接続種別/スケジュール/有効無効）
  - [x] CRM向けエクスポートAPI（顧客/業者/連絡先）と検証
- [x] モバイル/Push MVP（PWA）
  - [x] push_subscriptions の登録APIとDB
  - [x] Web Pushの送信スタブとService Workerのpush通知
  - [x] テスト手順の追記
- [x] 自動化ワークフロー/レポート拡張
  - [x] report_subscriptions のスキーマとCRUD
  - [x] スケジュール実行ジョブの雛形（CSV/PDF生成のstub）
  - [x] 通知先（メール/ダッシュボード）の配信記録

## 次アクション（M1.0 検証 + Phase2 着手準備）
- [x] 現環境（Podman）でMVP主要フローの総合確認
  - [x] 見積→請求→送信（メール/PDF）のハッピーパス
    - [x] /invoices/:id/send-logs の pdfUrl で確認
  - [x] 工数/経費/修正承認の入力と履歴確認
    - [x] time修正で approval instance 生成を確認
  - [x] アラート発火→ダッシュボード通知の確認
    - [x] approval_delay 設定 + /jobs/alerts/run で open alert 作成
  - [x] ウェルビーイング閲覧権限（人事のみ）と監査ログ確認
    - [x] user 403 / hr 200 と AuditLog の wellbeing_view を確認
- [x] PWAオフライン下書きの動作確認と不具合チケット化
  - [x] 日報/工数の下書き保存→復元
  - [x] オフライン→オンライン復帰時の送信/保存
  - [x] Task ID が存在しない場合の500を不具合化（#259）
- [x] 承認ルール/アラート設定画面のAPI連携（保存/読み込み）
- [x] レポートUIの実装（プロジェクト別/グループ別/個人別残業）
- [x] データ移行リハーサル（サンプルETL→件数/金額検証）
  - [x] `docs/requirements/migration-poc.md` に結果記録
- [x] 運用ドキュメント更新（Podman手順/バックアップ/復旧）
- [x] Phase2実装スコープの初期チケット起票（HR/CRM連携・自動化レポート・Push通知MVP）
  - [x] HR/CRM 連携（#156）
  - [x] 自動化ワークフロー/レポート拡張（#158）
  - [x] モバイル/Push PoC（#157）

## 次アクション（Phase 1 本番化）
- [x] PDF/メール本番運用の設定/QA/手順整備 (#244)
  - [x] 環境変数/必要ファイルと送信ログ/再送の確認手順を整理
- [x] IDaaS/SCIM 連携の運用フロー/テスト整備 (#245)
  - [x] 同期フロー/代表ケース/監査ログ確認の項目化
- [x] 性能チューニング: ベンチマーク/目標SLA/計測手順 (#246)
  - [x] 代表クエリのSLAと計測手順の叩き台
- [x] モバイルPoC: PWAスケルトンとオフライン下書き最小実装 (#247)
  - [x] manifest/service worker と下書き保存の最小実装

## 11/21 週（～12/10ステージングまでに着手）
- [x] Prisma/SQL 詳細化（enum/型/FK/削除ポリシー）とスキーマPR作成（#5）
  - [x] DocStatus/TimeStatus/LeaveStatus/FlowType のenum見直しと日本語注釈追加
  - [x] FK/ON DELETE/ON UPDATE方針をテーブルごとに列挙（Project/Estimate/Invoice/Expense/TimeEntry）
  - [x] 請求・発注・仕入系のnullable列を精査（estimateId/milestoneId/taskIdなど）
  - [x] 監査メタ createdBy/updatedBy の扱いを統一し TODO記載
  - [x] PRにschema.prisma + docs/requirements/schema-prisma-sketch.md 対応をまとめる
- [x] 発番/定期案件/アラート計算のバッチ擬似コード・シーケンスを追加（#6, batch-jobs.md）
  - [x] 採番サービスに月跨ぎリセット/オーバーフロー処理コメント追加
  - [x] 定期案件テンプレから案件生成、請求ドラフト自動作成のシーケンス図
  - [x] アラート（予算/残業/承認遅延/納期未請求）の擬似コードと発火→通知→サプレッションフロー
- [x] バックエンドPoCスケルトン（APIサーバ: プロジェクト/見積/請求/タイムシート/経費登録と発番・承認フック）
  - [x] prisma clientをDI化またはモジュール共有に寄せる
  - [x] `/projects/:id/estimates`起案→`/estimates/:id/submit`→`/invoices/:id/submit/send`のhappyパス通し
  - [x] タイムエントリ・経費のPOST/GETと簡易フィルタ（projectId/userId/date範囲）
  - [x] タイム修正時に承認インスタンスを起動するhookのスタブ
- [x] フロントPoCスケルトン（Web: 日報入力、工数入力、請求ドラフト閲覧）
  - [x] APIクライアントラッパ（fetch + JSON/エラー処理）
  - [x] 日報+WBフォームのモック（入力→POST→トースト表示）
  - [x] 工数入力フォーム（project/task選択、日付、時間、場所、残業区分）と一覧リロード
  - [x] 請求ドラフト一覧+詳細モック（番号/ステータス/送信ボタン）
- [x] データ移行マッピング初版（PO im_*/acs_* → 新スキーマ、キー/シーケンス整合）
  - [x] im_project/acs_project 等のカラムと Project との対応表
  - [x] 見積/請求/発注/仕入の番号マッピングと連番採番方針
  - [x] ユーザーID/チームID→UUIDの紐付けサンプルSQL
- [x] CI足場（lint/format/docリンクチェック）とテンプレート（Issue/PR）
  - [x] backend: eslint+prettierの最小設定と`npm run lint`
  - [x] frontend: eslint+prettierの最小設定と`npm run lint`
  - [x] markdownリンクチェック(or lychee) のJob追記
  - [x] .github/ISSUE_TEMPLATE / PULL_REQUEST_TEMPLATE 追加
- [x] バックエンド: 番号採番サービス（number_sequencesラッパ）とメール送信Stubをユーティリティ化
  - [x] numberSequencesテーブル用のupsertエラー処理（シリアル上限、月跨ぎ）
  - [x] メール送信stub（sendInvoiceEmail/sendPurchaseOrderEmail）をservices/notifier.tsに切り出し
  - [x] send routesからstubを呼び出すよう整理
- [x] バックエンド: 承認ルールマッチャー（条件→ステップ生成）の雛形実装
  - [x] approvalRules.conditionsの構造サンプル（金額閾値/定期案件判定/小額スキップ）
  - [x] matcher関数: 入力(FlowType, payload)→steps[] を返すスタブをservices/approval.tsへ
- [x] バックエンド: ダッシュボード用アラートフィードAPI（メール送信Stubと同時に発報履歴保存）
  - [x] GET /alerts?projectId/&status= などの簡易フィルタ
  - [x] POST /jobs/alerts/run 内でAlertレコード保存＋notifier呼び出し
- [x] フロント: 認証モック（Google OIDC想定のセッション+BFFダミー）
  - [x] `/me`へのfetchとロール/グループ保持、未ログイン時の簡易ログインボタン
  - [x] fetchラッパで Authorization ヘッダの付与を集約
- [x] フロント: ダッシュボードでアラート表示（初期はダミーデータorAPI連携）
  - [x] アラートカードコンポーネント（type/対象/日時/ステータス）
  - [x] ダッシュボードで上位5件表示＋「すべて表示」リンク
- [x] フロント: ウェルビーイング Not Good 時のタグ/短文と「ヘルプ/相談」モーダル導線実装（相談先候補・緊急案内表示）
  - [x] モーダルの固定テキスト（相談先候補3件、緊急案内）を配置
  - [x] Not Good選択時のみタグ/コメント入力欄を表示
- [x] 移行: 旧ID→新UUIDマッピングテーブル設計とサンプルスクリプト
  - [x] mapping_users, mapping_projects, mapping_vendors のDDLと例データ
  - [x] 移行後に参照切れを検出するクエリテンプレート
- [x] 監査ログ設計: 主要操作（承認/発番/ウェルビーイング閲覧）のログ項目サマリ
  - [x] audit_logテーブル案（who/when/action/target/from/to/meta）
  - [x] 発番・承認・閲覧(Wellbeing)で記録する項目を列挙
- [x] バックエンド: シンプルなバリデーション (zod / fastify schema) を主要エンドポイントに付与
  - [x] time/expense/estimate/invoice/PO/leave の schema で必須/型/最小値を整理
  - [x] バリデーション失敗時のエラーレスポンスを揃える
- [x] バックエンド: `/me` にロール/グループ等のモックデータを返す
  - [x] roleに応じたownerOrgId/projectsフィルタのモックを追加
- [x] バックエンド: タイムシート修正時の承認ルール適用（変更時のみ approval 起動）
  - [x] PATCH /time-entries/:id 追加、変更点判定でApprovalInstance作成スタブ
- [x] バックエンド: 承認ステップの監査ログ（who/when/from/to/reason）保存
  - [x] ApprovalStep更新時にaudit_logへINSERTするhookスタブ
- [x] バックエンド: 送信Stub（請求書メール/発注書メール）とPDF生成枠のダミー関数
  - [x] services/notifier.ts に sendInvoiceEmail/sendPurchaseOrderEmail
  - [x] services/notifier.ts に PDF生成スタブ（テンプレ名を受け取る）
- [x] バックエンド: RBAC簡易チェック（role + projectId で閲覧をフィルタ）
  - [x] requireRoleにprojectIdチェックのオプションを追加し、time/expenseに適用
- [x] フロント: APIクライアントの共通ラッパ（fetch + エラーハンドリング）
  - [x] ヘッダ付与・エラー時トースト表示・リトライなしのベーシック版
- [x] フロント: 請求ドラフト詳細画面モック（明細、承認状態、送信ボタン）
  - [x] ダミーデータで明細テーブルと承認ステータス表示
- [x] フロント: 工数入力フォーム（プロジェクト/タスク/日付/時間/場所/残業区分）
  - [x] 入力→POST→一覧再取得のハッピーパス
- [x] フロント: ヘルプモーダルの内容（相談先ラベル/説明/緊急案内）を表示
  - [x] 単体コンポーネント化して日報画面に組み込み
- [x] テスト: バックエンド簡易ハッピーパス (contracts/invoices/time/expenses) のスモーク
  - [x] scripts/smoke-backend.sh で /projects→/estimates→/invoices→/send の一連
  - [x] /time-entries, /expenses のPOST/GET を同スクリプトで確認
- [x] テスト: 仕入/承認フローを含むスモークを追加 (#226)
  - [x] vendor/purchase order/vendor invoice/approval-instances を同スクリプトで確認
- [x] シード: 発注/仕入データと承認ルールを追加 (#228)
  - [x] purchase_order/vendor_invoice のApprovalRuleとデモデータを追加
- [x] チェック: PoC整合チェックに発注/仕入を追加 (#230)
  - [x] scripts/checks/poc-integrity.sql に件数/合計の確認を追加
- [x] ドキュメント: 公式ロール一覧の叩き台を追記 (#232)
  - [x] access-control にロール責務/権限のドラフトを追加
- [x] ドキュメント: 付け替え方針の理由コード/締め期間を追記 (#234)
  - [x] reassignment-policy に理由コードと締め期間の叩き台を追加
- [x] ドキュメント: バックアップ/リストア方針の叩き台を追記 (#236)
  - [x] 保持期間/暗号化/添付の扱いを明文化
- [x] ドキュメント: 運用監視の閾値/再送ポリシーを追記 (#238)
  - [x] ops-monitoring に監視閾値と再送の叩き台を追加
- [x] ドキュメント: ID管理のユーザ属性/監査ログ案を追記 (#240)
  - [x] id-management に属性表と監査ログのたたき台を追加
- [x] ドキュメント: ABAC条件フォーマットの叩き台を追記 (#242)
  - [x] access-control にフォーマット例とルール例を追加
- [x] テスト: フロントの手動確認手順（ダッシュボード→日報→工数→請求送信Stub）
  - [x] READMEに手順と期待結果を書き出し
- [x] CI: lint/format のジョブ追加 (GH Actions)、prisma format/validate を走らせる
  - [x] eslint/prettierが失敗した場合にfailさせる
- [x] CI: Vite build テストのジョブ追加
  - [x] `npm run build --prefix packages/frontend` を既存ジョブとは別に明示
- [x] 移行: 抽出→変換→ロードのスクリプト雛形 (Python or SQL) を docs に追加
  - [x] 抽出SQLサンプル（プロジェクト/見積/請求/工数/経費）
  - [x] 変換スクリプト雛形（python/pandas or SQL）
  - [x] ロード手順と検証チェックリスト
- [x] 移行: 重複コード/欠損データの検出ルールと簡易レポート草案
  - [x] コード重複（project code/invoice no/po no）の検出SQL
  - [x] 欠損（工数のprojectId/userId無し、請求の金額0）の検出SQL

## 12/1 週（ステージング前の仕上げ）
- [x] 発番と承認の実装PoC（API + バッチジョブで連携）
- [x] アラート発火の最小実装（予算+10%、残業、承認遅延のダッシュボード表示＋メール送信Stub）
- [x] 定期案件テンプレ生成のジョブテスト（毎月/四半期）
- [x] ウェルビーイング入力と人事閲覧のRBAC/監査ログ実装PoC
- [x] レポート3種の算出ロジック（プロジェクト別工数/予実、グループ別工数、個人別残業）
- [x] 納期範囲の未請求レポート（マイルストーンと請求の紐付け確認）
- [x] フロント: 日報/工数入力のUX改善とバリデーション（モバイル対応）
- [x] フロント: 請求ドラフトの一覧/詳細で番号・ステータスを表示、送信Stub連携
- [x] バックエンド: PDF生成Stub（請求書/発注書）とテンプレAPIの枠
- [x] バックエンド: 休暇/経費/タイムシート修正承認の統一ハンドラ
- [x] QA: 簡易E2Eまたは手順書（ハッピーパス）
- [x] フロント: 人事向け匿名集計ビューの骨組み（5人未満非表示）※簡易でもよい
- [x] バックエンド: metrics計算関数のスタブ（予算消化率、残業時間、承認遅延計測）
- [x] バックエンド: AlertSettingのCRUDと有効/無効切替API
- [x] バックエンド: ApprovalRule CRUDと条件/ステップ保存
- [x] バックエンド: RateCard 適用ロジック（工数×単価計算の枠）
- [x] フロント: アラート設定と承認ルールの簡易設定画面モック（保存は後続でも可）
- [x] 移行: サンプルデータを使ったPoCロード＆整合チェック（工数件数、請求合計）
- [x] CI: prettier/eslint 設定と整合性チェック
- [x] セキュリティ: CORS/ヘッダ/基本的な入力サイズ制限設定
- [x] プロダクト: アラート再送/サプレッションの設計メモ追加
- [x] プロダクト: QA用シードデータセット（プロジェクト/見積/請求/工数/経費）の作成

## 次フェーズ（本番化/運用準備）
- [x] PDF/メール本実装（テンプレ/署名/送信追跡/外部連携） (#139)
  - [x] 送信ログテーブルとAPI追加（請求/発注）
  - [x] 送信履歴の取得API追加
  - [x] SMTPメール送信の実装（請求/発注/アラート）
  - [x] ローカルPDF生成と配信（/pdf-files）
  - [x] SendGridメール送信の実装（請求/発注/アラート）
  - [x] PDF/メール送信の本実装（外部サービス連携）
  - [x] SMTP送信の簡易テスト（バリデーション/フォールバック）
- [x] 認証/IDaaS連携強化（SCIM/プロビジョニング） (#140)
  - [x] JWT Bearer認証モード（AUTH_MODE）とclaimマッピング追加
  - [x] SCIM/プロビジョニング連携の実装
- [x] テーブル設計の正規化/性能チューニング（大規模データ向け） (#141)
  - [x] 主要テーブルの複合インデックス追加（project/status/date, soft delete）
- [x] モバイル/ネイティブ対応（オフライン/Push） (#142)

### 本番化・運用整備（残タスク）
- [x] 性能チューニングの実測（主要クエリのEXPLAIN/統計収集） (#154)
  - [x] 承認一覧/アラート/工数集計のクエリ計画を docs に記録
  - [x] index/partition/summary の判断メモを追記
- [x] 運用監視の最小設計 (#155)
  - [x] バッチ失敗/アラート遅延の監視観点を整理
  - [x] バックアップ/リストア手順の草案作成
- [x] Vendor未登録時のPO作成が500になる (#180)

## Phase 2（拡張・2026H1）
- [x] HR/CRM 連携拡張の要件整理 (#156)
  - [x] HR: wellbeing/ID 連携のデータ範囲/匿名化ポリシー
  - [x] CRM: 顧客/業者/連絡先の同期範囲とマッピング
  - [x] 連携方式/頻度/エラー処理の整理
- [x] モバイル対応 PoC 設計 (#157)
  - [x] PWA/Capacitor の方針決定
  - [x] オフライン下書き（IndexedDB/SQLite）のフロー設計
  - [x] Push 通知の MVP 仕様（APNS/FCM）整理
- [x] 自動化ワークフロー/レポート拡張の設計 (#158)
  - [x] 定期レポート生成・配信の要件整理
  - [x] 承認フローの自動分岐/条件追加の設計
  - [x] レポートテンプレの拡張方針

## 12/10 以降（MVP後続拡張・完了分）
- [x] 承認期限エスカレーション、Slack/Webhook外部通知
- [x] 経費UI高度化（領収書URL入力/リマインダ）
- [x] グループチャット（プロジェクト紐付け、タグ、絵文字）
  - [x] プロジェクト紐付けのチャットAPI
  - [x] タグ/絵文字リアクション対応
- [x] レポート拡充（CSVエクスポート: 収支/工数/納期）
- [x] レポート拡充（カスタムレイアウト、PDFエクスポートの柔軟化）
- [x] データ品質チェックバッチ（コード重複、参照切れ、税率不整合）
- [x] アラートのリマインド/サプレッション設定
- [x] 承認期限エスカレーション設定UIとバッチ
- [x] ウェルビーイング匿名集計の高度化（時系列/部門比較、フィルタ、閾値設定）
  - [x] HR向け匿名集計API（group/月次、期間/閾値フィルタ）
  - [x] HR画面のフィルタ・時系列表示
- [x] 見積/請求テンプレ管理UI（番号ルール、フォーマット、署名挿入）

## 次フェーズ（基盤整備 → 承認・権限制御 → 主要機能拡充）
### 基盤整備
- [x] Prisma migration 方針の文書化（dev/staging/prod の使い分け）
- [x] Podman を使った検証手順の記載（DB起動/seed/チェック）
- [x] seed/検証手順の更新（updatedAt 必須反映）
- [x] DB初期化/検証の簡易スクリプト案の整理

### 承認・権限制御の本番化
- [x] 承認ルール条件の拡張（projectType/customerId/orgUnitId 等の入力整理）
- [x] 並列承認/二重チェックのUI想定とAPI項目の見直し
- [x] 並列承認の二重チェック制約（同一ユーザー禁止）のAPI実装
- [x] 承認インスタンスの閲覧範囲（申請者/プロジェクトメンバー）の実装方針整理
- [x] 監査ログの項目と保存方針の最終化
- [x] 期限超過アラートの運用ルール整理（エスカレーションは後続）

### マスタ管理
- [x] 顧客/業者マスタCRUDの追加 (#184)

### 案件・請求・工数の主要機能拡充
- [x] 案件階層/タスク/マイルストーンの編集フロー整理
- [x] 定期案件テンプレのUI/入力項目の設計
- [x] 見積/請求/発注の運用UI（一覧/詳細/承認）の要件整理
- [x] 損益・工数予実の算出ロジック整理（データソース/期間/単価）

### 実装準備（案件/請求/工数）
- [x] RecurringProjectTemplate のスキーマ拡張（dueDateRule/生成フラグ/マイルストーン初期値）
- [x] 定期案件テンプレの CRUD API と生成履歴の仕様決定
- [x] Project/Task/Milestone の CRUD + 付け替え/削除制約の実装
- [x] 見積/請求/発注/仕入の一覧・詳細 API（フィルタ/承認状態）実装
- [x] 損益・工数予実の集計 API とテスト（期間/単位）
- [x] ドキュメント整合（domain-api-draft/data-model-sketch/schema-prisma-sketch の更新）
- [x] 定期案件生成履歴テーブルの実装（recurring_generation_logs）
- [x] dueDateRule のバリデーション/変換ユーティリティ追加
- [x] Project/Task/Milestone の親子整合チェック（親タスクの同一project検証）
- [x] 収支レポートの集計軸拡張（group/user単位）

## 次の実装（運用・UI整備）
- [x] 顧客/業者マスタのUI（一覧/検索/登録/編集） (#188)
- [x] 取引先連絡先（Contact）のCRUD（API + UI） (#189)
- [x] Project の customerId 選択とバリデーション（API + UI） (#190)
- [x] projectId 手入力の一覧選択化（工数/経費/請求/レポート/チャット） (#191)
- [x] Vendor関連画面の整備（PO/仕入見積/仕入請求の一覧・詳細で名称表示） (#192)
- [x] QA手順の更新（マスタ/連絡先/プロジェクト連携） (#193)
- [x] 仕入/発注一覧UI追加 (#214)
- [x] 仕入/発注の登録UI（発注書/仕入見積/仕入請求の入力） (#215)
- [x] 発注/仕入請求の承認依頼ボタン追加 (#217)
- [x] 承認一覧UI（フィルタ/承認・却下操作） (#218)
- [x] 承認操作の可否UI (#219)
- [x] 承認アクションの権限制御 (#220)
- [x] pending_exec の反映 (#221)
- [x] ダッシュボードに承認待ち件数を表示 (#222)
- [x] 案件ラベル表示の改善 (#223)
- [x] QA手順更新（仕入/承認） (#224)
- [x] プロジェクトメンバー管理（リーダ付与、リーダによるメンバー追加/削除） (#378)

## Phase 3（2026H2〜）
- [x] AI支援/分析モジュールの要件整理 (#177)
- [x] GRC/監査機能強化の要件整理 (#178)

## チャット高度化（Slack/Chatwork代替）
- [x] 未決定/要設計の仕様確定（DM/既読/メンション/検索/通知/AI/外部ユーザ） (#435) ※残件は #440/#445 に分割
  - [x] DMの扱い（管理者設定で禁止、ownerの扱い、external_chat禁止）を確定
  - [x] 未読/既読（自分のみ可視化、他者の既読表示なし）のデータモデルとUXを確定 (#444)
  - [x] 指定対象者の「OK/確認」状況を追える確認メッセージ（特別メッセージ）を設計 (#435)
  - [x] メンション（ユーザ/グループ/全員、補完選択）仕様（@allは投稿前確認 + 投稿回数制限）を確定
  - [x] Markdown方言とサニタイズ方針を確定 (#439)
  - [x] 添付の保存先（Google Drive: システムユーザ専用領域案）の方式決定を #440 に引き継ぎ
  - [x] 検索（チャットのみ/ERP横断）スコープと権限制御を確定
  - [x] 通知チャネル/条件/既定値/ミュート/頻度制御を確定
  - [x] AI機能（要約/アクション抽出/FAQ/検索支援）の範囲と監査は #445 で対応
- [x] ガバナンスと監査break-glassの要件確定/実装計画 (#434)
  - [x] ルーム化（project chat→room chat）移行方針を確定 (#453)
  - [x] break-glass（申請/二重承認/閲覧許可/監査ログ）を実装 (#454)
  - [x] break-glass UI（申請/承認/履歴）+ システムメッセージを実装 (#455)
- [x] ルーム機能（private_group/DMのMVP: 作成/招待/room chat API） (#479)
- [x] ルームUI（private_group/DMの最小UI）+ 設定（DM/private_group作成ON/OFF） (#479)
- [x] ルーム機能（部門/全社）を実装
- [x] ルーム設定UI（公式/私的/外部ユーザ許可/外部連携）を実装 (#485)
- [x] 自分の未読/既読（未読件数/既読更新/未読ハイライト）を実装 (#444)
- [x] 確認メッセージ（指定対象者のOK/確認）を実装 (#438)
- [x] メンション入力支援（補完選択）とメタデータ保持を実装 (#447)
- [x] @all 投稿前確認 + 投稿回数制限を実装 (#448)
- [x] メンション通知（アプリ内通知の最小実装） (#457)
- [x] Markdownレンダリング/サニタイズを実装 (#439)
- [x] Markdownプレビューを実装 (#489)
- [x] 添付（保存/取得/権限制御）を実装
- [x] 添付: Google Drive 実動作確認/運用手順 (#440)
- [x] 添付: 上限/ウイルス対策を追加 (#493)
- [x] 検索（チャット内: ルーム内検索）を実装 (#491)
- [x] 検索（チャット横断: 全ルーム検索）を実装 (#496)
- [x] 検索（ERP横断）を実装 (#496)
- [x] 通知（アプリ内/メール/Push/外部連携）を実装 (#495)
- [x] AI支援（要約/アクション抽出/FAQ/検索支援）を実装 (#445)
  - [x] 手動要約（ローカルスタブ）を実装 (#456)
  - [x] room-based chat（/chat-rooms/:roomId/summary + RoomChat）へ要約を拡張
- [x] AI支援: 外部LLM連携（公式ルームのみ/監査ログ必須） (#483)
