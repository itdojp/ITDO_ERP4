# バックアップ/リストア（Runbook）

## 入口

詳細は `docs/requirements/backup-restore.md` を参照。
DR計画（RTO/RPO/復元演習）は `docs/ops/dr-plan.md` を参照。
S3 の確定値は `docs/ops/backup-s3-decision-checklist.md` に記録する。入力妥当性は `make backup-s3-decision-check` で確認する。

## PoC/検証（Podman DB）

`scripts/podman-poc.sh` にバックアップ/リストア手順が実装済み。

```bash
./scripts/podman-poc.sh backup
RESTORE_CONFIRM=1 ./scripts/podman-poc.sh restore
```

注意:

- リストアは破壊的操作になり得るため `RESTORE_CONFIRM=1` が必要
- 必要に応じて `RESTORE_CLEAN=1` でスキーマの作り直しを行う
