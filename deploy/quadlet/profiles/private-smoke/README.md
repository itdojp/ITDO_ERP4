# private-smoke Quadlet overlay

`private-smoke` は非公開の rootless Podman / Quadlet stack smoke 用プロファイルです。

- Caddy をインストール・起動しません。
- backend / frontend / PostgreSQL を host へ publish しません。
- DB probe は `podman exec` または明示的な SSH tunnel 内で実施します。

使い方:

```bash
ERP4_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
ERP4_IMAGE_TAG="$ERP4_IMAGE_TAG" ./scripts/quadlet/install-user-units.sh --profile private-smoke
cp deploy/quadlet/env/erp4-backend.private-smoke.env.example ~/.config/containers/systemd/erp4-backend.env
cp deploy/quadlet/env/erp4-frontend-build.private-smoke.env.example deploy/quadlet/env/erp4-frontend-build.env
./scripts/quadlet/check-env.sh --profile private-smoke --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
./scripts/quadlet/start-stack.sh --profile private-smoke
```

公開 profile ではないため、`erp4-caddy.container`、`erp4-caddy.env`、`erp4-caddy.Caddyfile` は配置しません。
installer は private-smoke 用 PostgreSQL overlay を自動選択します。対象ディレクトリに既存の Caddy artifact がある場合は安全のため停止し、自動削除しません。
