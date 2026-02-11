# 添付AVスキャン 本番運用決定記録（Issue #886）

## 目的

- `CHAT_ATTACHMENT_AV_PROVIDER` 本番方針と運用条件を、最終承認情報つきで一元記録する。
- 要件本文（`docs/requirements/chat-attachments-antivirus.md`）とRunbook（`docs/ops/antivirus.md`）の「確定」反映前に、決定内容を固定する。

## 前提エビデンス

- 判定ゲート手順: `make av-staging-gate`
- 判定サマリ手順: `make av-staging-readiness`
- 最新実行結果（いずれかを記載）:
  - [x] 記録済み
  - CI実行URL（例: `https://github.com/ORG/REPO/actions/runs/123456789`）: N/A（手動実行）
  - エビデンスDocパス（例: `docs/test-results/YYYY-MM-DD-av-staging.md`）: `docs/test-results/2026-02-09-chat-attachments-av-staging.md`

## 決定項目（最終）

### 1. provider方針

- 決定値: `disabled` を既定として継続（`clamav` は運用条件の追補後に切替を再評価）
- 理由: fail-closed 運用を維持したまま本番切替するため、監視/当番運用の安定化を先行する。
- 施行日: 2026-02-11

### 2. 障害時方針（スキャナ利用不能）

- 決定値: fail-closed（503）継続
- 理由: バイパス保存を許可すると監査・統制要件の一貫性が崩れるため。
- 代替フロー（必要時）: 添付は再試行を案内し、継続障害時は運用窓口で一次受付する。

### 3. 定義更新方式

- 決定値: `freshclam --daemon` と週次イメージ更新の併用
- 更新責任者: Platform/運用担当
- 実施頻度: freshclam は常時、イメージ更新は週次（最低）
- 障害時復旧: `podman logs` で更新失敗確認後、イメージ再pullとコンテナ再作成を実施

### 4. 監視/アラートしきい値

- clamd 応答不可: 3分継続で Critical
- `chat_attachment_scan_failed` 件数: 10分で5件以上で High
- 503比率: 10分窓で1%超で High
- `scanDurationMs p95`: 10分継続で5秒超は Medium
- 監視実装先: 監視基盤導入までは `scripts/report-chat-attachments-av-metrics.mjs` による日次集計で代替

### 5. 本番構成

- 配置方式（同一ホスト別コンテナ/専用ノード 等）: 同一ホスト別コンテナ（初期）
- 最小リソース: clamd 1コンテナ（2 vCPU / 2GB RAM 以上を目安）
- 接続方式: backend -> clamd TCP（`CLAMAV_HOST`/`CLAMAV_PORT`）

## 承認

- 承認者: Issue #886 合意（依頼者）
- 承認日時: 2026-02-11
- 関連Issue/PR: #886, #932

## 反映チェック（承認後）

- [x] `docs/requirements/chat-attachments-antivirus.md` の「確定候補」表現を「確定」へ更新
- [x] `docs/ops/antivirus.md` の現時点方針を最終決定値へ更新
- [x] Issue #886 の未完チェック項目を更新
- [x] 必要な環境変数変更手順を運用Runbookに追記
