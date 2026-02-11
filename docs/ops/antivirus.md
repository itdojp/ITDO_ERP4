# 添付AVスキャン（Runbook）

## 目的

- チャット添付の AV スキャン運用を、障害時対応まで含めて一貫した手順で実施する。
- 要件詳細は `docs/requirements/chat-attachments-antivirus.md` を参照する。

## 本番運用方針（確定: 2026-02-11）

- 本番は `CHAT_ATTACHMENT_AV_PROVIDER=disabled` を既定として継続する。
- `clamav` 運用時は fail closed（スキャナ利用不能時 503）を維持し、例外バイパスは設けない。
- 定義更新は `freshclam --daemon` と週次イメージ更新を併用する。
- 監視しきい値は本書「監視対象としきい値（確定）」を適用する。
- 最終決定の記録は `docs/ops/antivirus-decision-record.md` を正本とする。
- 最終決定の経緯と詳細な記録は `docs/ops/antivirus-decision-record.md` を参照する。

## 運用モード

1. `disabled`（既定）
   - スキャンなし。運用未確定期間の既定モード。
2. `clamav`
   - clamd 連携でスキャン。`FOUND` は 422、利用不能は 503（fail closed）。

## 検証コマンド

- clamd 疎通/EICAR 検証: `bash scripts/podman-clamav.sh check`
- API 統合スモーク: `bash scripts/smoke-chat-attachments-av.sh`
- ステージング証跡をまとめて記録（推奨）: `make av-staging-evidence`
- ステージング判定ゲートを厳格実行（推奨）: `make av-staging-gate`
- ステージングの本番有効化判定サマリを生成（推奨）: `make av-staging-readiness`
- 検証結果のMarkdown記録（staging向け）: `ENV_NAME=staging bash scripts/record-chat-attachments-av-smoke.sh`
- 監査ログ集計（監視代替/閾値確認）:
  - `node scripts/report-chat-attachments-av-metrics.mjs --from=2026-02-07T00:00:00Z --to=2026-02-08T00:00:00Z --window-minutes=10`
  - `ENV_NAME=staging bash scripts/record-chat-attachments-av-metrics.sh`
  - 閾値を変えて比較する場合（例）:
    - `THRESHOLD_SCAN_FAILED_COUNT=3 THRESHOLD_SCAN_FAILED_RATE_PCT=0.5 THRESHOLD_SCAN_P95_MS=3000 ENV_NAME=staging make av-staging-evidence`

## 監視対象としきい値（確定）

1. 死活監視（必須）
   - 条件: clamd TCP 応答不可が 3 分継続
   - 重要度: Critical
2. スキャン失敗監視（必須）
   - 条件: `chat_attachment_scan_failed` が 10 分で 5 件以上
   - 重要度: High
3. AV 起因の添付失敗率（推奨）
   - 条件: 添付 API の 503 比率が 10 分窓で 1% 超
   - 重要度: High
4. 遅延監視（推奨）
   - 条件: スキャン処理時間 p95 が 5 秒超（10 分継続）
   - 重要度: Medium

注記:

- 監視基盤が整っていない環境では、監査ログ集計で代替し、日次で件数確認する。
- しきい値見直し時は `docs/ops/antivirus-decision-record.md` に変更理由と施行日を追記する。

## 監査ログ集計（監視基盤未整備時の代替）

1. 集計
   - `scripts/report-chat-attachments-av-metrics.mjs` を実行し、10分窓で `scanFailed件数` と `scanFailedRate(=503相当率)` を確認する。
2. エビデンス化
   - `scripts/record-chat-attachments-av-metrics.sh` で `docs/test-results/` に記録する。
   - `FAIL_ON_GATE=1` を指定すると、閾値違反時に終了コード 2 で失敗させる。
3. 判定
   - `scanFailed件数 >= 5 / 10分` または `scanFailedRate > 1% / 10分` が継続する場合は High 扱いで一次対応に入る。
   - `scanDurationMs p95 > 5s` が継続する場合は Medium 扱いで性能要因を調査する。
   - 集計スクリプトの閾値は `--threshold-scan-failed-count` / `--threshold-scan-failed-rate-pct` / `--threshold-scan-p95-ms` で上書きできる。
   - 記録ファイルの `判定ゲート` セクションで `PASS/FAIL` を確認する。

## 障害時対応フロー（fail closed 前提）

1. 検知
   - アラート受信、または `chat_attachment_scan_failed` 急増を確認。
2. 一次切り分け
   - clamd コンテナ状態、TCP 3310 応答、`podman logs` を確認。
3. 復旧
   - clamd 再起動後、`bash scripts/podman-clamav.sh check` を実行。
4. 機能確認
   - `bash scripts/smoke-chat-attachments-av.sh` を再実行して 200/422/503 挙動を確認。
5. 影響確認
   - 障害期間中の添付失敗件数を監査ログから集計し、必要に応じて利用者へ周知。
6. 記録
   - 原因、対応、再発防止策をインシデント記録に残す。

## 本番有効化チェックリスト（Issue #886）

- [x] `CHAT_ATTACHMENT_AV_PROVIDER` 方針を確定（`disabled` 維持）
- [x] fail closed を業務上許容するかを確定（不可の場合は代替フローを定義）
- [x] 定義更新方式を確定（`freshclam --daemon` / 定期ジョブ / イメージ更新）
- [x] 監視/アラート閾値を確定（clamd死活、`chat_attachment_scan_failed`、タイムアウト）
- [x] 復旧Runbookを具体化（検知→切り分け→復旧→再検証）
- [x] ステージング検証結果を `docs/test-results/` に記録

## 検証結果の記録

- 直近の検証（ローカル/PoC）: `docs/test-results/2026-02-06-chat-attachments-av-r2.md`
- 直近の検証（staging）: `docs/test-results/2026-02-09-chat-attachments-av-staging.md`
- 記録テンプレート: `docs/test-results/chat-attachments-av-staging-template.md`
- 補助: `scripts/record-chat-attachments-av-staging.sh`（smoke + audit metrics の同時記録）
- 補助: `scripts/record-chat-attachments-av-readiness.sh`（技術ゲート判定 + 未確定運用判断の整理）
