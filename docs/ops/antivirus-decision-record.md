# 添付AVスキャン 本番運用決定記録（Issue #886）

## 目的
- `CHAT_ATTACHMENT_AV_PROVIDER` 本番方針と運用条件を、最終承認情報つきで一元記録する。
- 要件本文（`docs/requirements/chat-attachments-antivirus.md`）とRunbook（`docs/ops/antivirus.md`）の「確定」反映前に、決定内容を固定する。

## 前提エビデンス
- 判定ゲート手順: `make av-staging-gate`
- 判定サマリ手順: `make av-staging-readiness`
- 最新実行結果（いずれかを記載）:
  - [ ] 記録済み
  - CI実行URL（例: `https://github.com/ORG/REPO/actions/runs/123456789`）:
  - エビデンスDocパス（例: `docs/test-results/YYYY-MM-DD-av-staging.md`）:

## 決定項目（最終）

### 1. provider方針
- 決定値: `disabled` / `clamav`
- 理由:
- 施行日:

### 2. 障害時方針（スキャナ利用不能）
- 決定値: fail-closed（503）継続 / 例外バイパス導入
- 理由:
- 代替フロー（必要時）:

### 3. 定義更新方式
- 決定値: `freshclam --daemon` / 定期ジョブ / イメージ更新 / 併用
- 更新責任者:
- 実施頻度:
- 障害時復旧:

### 4. 監視/アラートしきい値
- clamd 応答不可:
- `chat_attachment_scan_failed` 件数:
- 503比率:
- `scanDurationMs p95`:
- 監視実装先:

### 5. 本番構成
- 配置方式（同一ホスト別コンテナ/専用ノード 等）:
- 最小リソース:
- 接続方式:

## 承認
- 承認者:
- 承認日時:
- 関連Issue/PR:

## 反映チェック（承認後）
- [ ] `docs/requirements/chat-attachments-antivirus.md` の「確定候補」表現を「確定」へ更新
- [ ] `docs/ops/antivirus.md` の現時点方針を最終決定値へ更新
- [ ] Issue #886 の未完チェック項目を更新
- [ ] 必要な環境変数変更手順を運用Runbookに追記
