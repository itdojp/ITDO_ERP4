# 添付AVスキャン（Runbook）

## 入口
詳細は `docs/requirements/chat-attachments-antivirus.md` を参照。

## 運用モード
1. `disabled`（既定）
   - スキャンなし。導入前/方針未確定時の運用。
2. `clamav`
   - clamd 連携でスキャン。利用不能時は 503（fail closed）。

## 本番有効化チェックリスト（Issue #886）
- [ ] `CHAT_ATTACHMENT_AV_PROVIDER` 方針を確定（`disabled` 維持 or `clamav` 有効化）
- [ ] fail closed を業務上許容するかを確定（不可の場合は代替フローを定義）
- [ ] 定義更新方式を確定（`freshclam --daemon` / 定期ジョブ / イメージ更新）
- [ ] 監視/アラート閾値を確定（clamd死活、`chat_attachment_scan_failed`、タイムアウト）
- [ ] 復旧Runbookを確定（検知→切り分け→復旧→再検証）
- [ ] ステージング検証結果を `docs/test-results/` に記録

過去の検証結果:
- `docs/test-results/2026-01-16-chat-attachments-av.md`

## 検証コマンド
- clamd 疎通/EICAR 検証: `bash scripts/podman-clamav.sh check`
- API統合スモーク: `bash scripts/smoke-chat-attachments-av.sh`

## 復旧時の最小手順
1. clamd の死活確認（コンテナ/プロセス/TCP 3310）
2. `chat_attachment_scan_failed` の件数を確認して影響範囲を把握
3. clamd を復旧後、`bash scripts/podman-clamav.sh check` を実行
4. API統合スモークを再実行し、正常化を確認
