# 添付AVスキャン（Runbook）

## 入口
詳細は `docs/requirements/chat-attachments-antivirus.md` を参照。

## 検証用スモーク
添付スキャンのスモークテスト:
- `scripts/smoke-chat-attachments-av.sh`

過去の検証結果:
- `docs/test-results/2026-01-16-chat-attachments-av.md`

## 定義更新（ClamAV）
検証では `docker.io/clamav/clamav` が `freshclam` を同一コンテナ内で起動し、定義更新を行うことを確認しています。
詳細は `docs/requirements/chat-attachments-antivirus.md` を参照。
