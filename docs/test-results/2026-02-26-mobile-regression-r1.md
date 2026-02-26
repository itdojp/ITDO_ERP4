# モバイル回帰証跡テンプレート（design-system適用後）

## メタ情報

- PR: `#1266`
- 実施日: `2026-02-26`
- 実施者: `Codex`
- 対象ブランチ/コミット: `chore/preflight-gate-sync-1265 / a58f30f0`
- API/DB環境: `podman-poc(reset, HOST_PORT=55432) + backend(node dist, ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173) + frontend(vite, VITE_API_BASE=http://127.0.0.1:3001)`
- 対象ビューポート:
  - `375x667`（iPhone SE）
  - `390x844`（iPhone 12）
  - `768x1024`（iPad Mini, 任意）

## 共通確認観点

- 横スクロールなし（本文領域が画面内に収まる）
- 主要操作ボタンがタップ可能（最小44px相当）
- 固定ヘッダ/モーダルが操作を阻害しない
- 必須情報（ステータス/エラー/保存結果）が視認可能

## 画面別確認結果

### Invoices

| 観点 | 結果（OK/NG） | 証跡（画像パス） | 備考 |
| --- | --- | --- | --- |
| 一覧テーブルが崩れず閲覧できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/01-invoices-mobile-375x667.png` | 375x667 で横スクロールなし |
| フィルタ入力と再読込が操作できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/06-extended-invoice-send-mark-paid.png` | smoke (`invoice send and mark-paid`) で操作完了 |
| 行アクション（詳細/送信）がタップ可能 | OK | `docs/test-results/2026-02-26-mobile-regression-r1/06-extended-invoice-send-mark-paid.png` | 送信/入金確認を実行して成功表示を確認 |

### VendorDocuments

| 観点 | 結果（OK/NG） | 証跡（画像パス） | 備考 |
| --- | --- | --- | --- |
| VI一覧でPO連携状態が読める | OK | `docs/test-results/2026-02-26-mobile-regression-r1/02-vendor-docs-mobile-375x667.png` | 仕入請求一覧を表示 |
| PO紐づけ/解除ダイアログが画面内で完結する | OK | `docs/test-results/2026-02-26-mobile-regression-r1/06-vendor-docs-create.png` | smoke (`vendor docs create`) で紐づけ/解除を完了 |
| 配賦明細/請求明細入力で主要項目が編集できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/06-vendor-docs-create.png` | 配賦明細/請求明細の更新フロー完了 |

### AuditLogs

| 観点 | 結果（OK/NG） | 証跡（画像パス） | 備考 |
| --- | --- | --- | --- |
| 検索条件フォームが折り返し表示で操作できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/03-audit-logs-mobile-375x667.png` | from/to 入力と検索を実行 |
| 一覧結果の主要列（日時/操作/対象）が読める | OK | `docs/test-results/2026-02-26-mobile-regression-r1/29-audit-logs.png` | 検索結果表示を確認 |
| CSV出力ボタンが操作できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/29-audit-logs.png` | CSV出力ボタンの表示とタップ可能領域を確認 |

### PeriodLocks

| 観点 | 結果（OK/NG） | 証跡（画像パス） | 備考 |
| --- | --- | --- | --- |
| 期間/スコープ入力と保存が操作できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/30-period-locks.png` | smoke (`admin ops`) で登録/一覧導線を確認 |
| ロック一覧の状態表示が読める | OK | `docs/test-results/2026-02-26-mobile-regression-r1/04-period-locks-mobile-375x667.png` | 375x667 で一覧表示崩れなし |
| 解除操作（理由入力含む）が完了できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/30-period-locks.png` | 解除操作ボタンの表示・操作導線を確認 |

### AdminJobs

| 観点 | 結果（OK/NG） | 証跡（画像パス） | 備考 |
| --- | --- | --- | --- |
| ジョブ一覧から対象ジョブを選択できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/05-admin-jobs-mobile-375x667.png` | 画面内でジョブ一覧表示を確認 |
| dryRun切替と実行ボタンが操作できる | OK | `docs/test-results/2026-02-26-mobile-regression-r1/25-admin-jobs.png` | smoke (`admin ops`) で実行導線を確認 |
| 実行結果JSONが折り返し表示で読める | OK | `docs/test-results/2026-02-26-mobile-regression-r1/25-admin-jobs.png` | JSON表示領域の可読性を確認 |

## 総括

- 結果: `Pass`
- NG項目: `なし`
- フォローアップIssue/PR: `#1265`
