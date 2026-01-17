# バックアップ/リストア（Runbook）

## 入口
詳細は `docs/requirements/backup-restore.md` を参照。

## PoC/検証（Podman DB）
`scripts/podman-poc.sh` にバックアップ/リストア手順が実装済み。

```bash
./scripts/podman-poc.sh backup
RESTORE_CONFIRM=1 ./scripts/podman-poc.sh restore
```

注意:
- リストアは破壊的操作になり得るため `RESTORE_CONFIRM=1` が必要
- 必要に応じて `RESTORE_CLEAN=1` でスキーマの作り直しを行う

