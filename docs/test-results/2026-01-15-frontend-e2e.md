# フロントE2E（full + UIエビデンス）

## 実行日時
- 2026-01-15

## 実行コマンド
```bash
E2E_SCOPE=full E2E_CAPTURE=1 ./scripts/e2e-frontend.sh
```

## 実行条件（主要）
- DB: Podman（`E2E_DB_MODE=podman`、デフォルト）
- 証跡: 取得あり（`E2E_CAPTURE=1`）
- 外部LLM: stub（`CHAT_EXTERNAL_LLM_PROVIDER=stub`）
- 画面ベースURL: `http://localhost:5173`（デフォルト）

## 結果
- 29 passed / 1 skipped
- skip: `pwa push subscribe flow @pwa`（`VITE_PUSH_PUBLIC_KEY` 未設定）

## エビデンス格納先
- `docs/test-results/2026-01-15-frontend-e2e/`

### 主なキャプチャ
- `00-current-user.png`
- `01-core-dashboard.png`
- `02-core-daily-report.png`
- `03-core-time-entries.png`
- `06-core-invoices.png`
- `06-core-global-search.png`
- `07-approvals.png`
- `08-reports.png`
- `09-projects.png`
- `10-master-data.png`
- `11-admin-settings.png`
- `12-project-chat.png`
- `13-hr-analytics.png`
- `14-room-chat.png`
- `16-offline-duplicate-time-entry.png`
- `21-project-tasks.png`
- `22-leave-requests.png`
- `23-project-milestones.png`
- `24-chat-break-glass.png`

## 追加実行（UI補完）
- 実行日時: 2026-01-15
- 実行コマンド:
```bash
E2E_DATE=2026-01-15 \
E2E_GREP="frontend smoke core|frontend smoke additional sections" \
E2E_CAPTURE=1 ./scripts/e2e-frontend.sh
```
- 結果: 2 passed
- 追加キャプチャ: `00-current-user.png` / `06-core-global-search.png` / `21-project-tasks.png` / `22-leave-requests.png` / `23-project-milestones.png` / `24-chat-break-glass.png`

## 実行されたテスト（全件）
- `delivery due report @core`
- `leave submit blocks when time entries exist @core`
- `milestone invoice sync @core`
- `project baseline can snapshot tasks @extended`
- `project burndown returns daily remaining minutes @extended`
- `project effort includes plan variance @core`
- `project effort variance handles null planHours @core`
- `project evm returns daily pv/ev/ac/spi/cpi @extended`
- `project parent can be updated with reason @extended`
- `project can set and clear period dates @extended`
- `rate card affects profit report @core`
- `recurring template generates draft invoice @core`
- `task dependencies can be set/cleared and prevents cycles @extended`
- `task parent can be updated and cleared @extended`
- `task plan/actual dates can be set, cleared, validated @extended`
- `task progress percent can be set, cleared, validated @extended`
- `time entries to invoice draft @core`
- `frontend offline queue @extended`
- `pwa offline duplicate time entries @pwa @extended`
- `pwa push subscribe flow @pwa` (skipped)
- `pwa service worker cache refresh @pwa @extended`
- `frontend smoke core @core`
- `frontend smoke vendor approvals @extended`
- `frontend smoke vendor docs create @extended`
- `frontend smoke reports masters settings @extended`
- `frontend smoke chat hr analytics @extended`
- `frontend smoke room chat (private_group/dm) @extended`
- `frontend smoke room chat external summary @extended`
- `frontend smoke external chat invited rooms @extended`
- `task to time entry link @core`
