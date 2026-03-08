# Podman smoke

- date: 2026-03-09
- command: `make podman-smoke`
- result: PASS
- sourceLog: `tmp/2026-03-09-podman-smoke.log`
- backendLog: `tmp/podman-smoke-backend.log`

## Notes

- PoC PostgreSQL を Podman で起動し、backend build 後に `scripts/smoke-backend.sh` を完走しました。
- 実行結果は `smoke ok` / `podman smoke ok` です。
