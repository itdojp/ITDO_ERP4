# https-trial Quadlet profile

`https-trial` は trial 専用 FQDN + HTTPS + trial 専用 Google OAuth client で利用者向け試用を行うプロファイルです。

- Caddy を起動し、80/443 を公開します。
- `AUTH_MODE=jwt_bff`、`NODE_ENV=production`、`AUTH_SESSION_COOKIE_SECURE=true` を必須にします。
- production credential / production domain / production S3 は使いません。
- `MAIL_TRANSPORT=stub` と local storage provider を既定にします。

使い方:

```bash
cp deploy/quadlet/env/erp4-backend.https-trial.env.example ~/.config/containers/systemd/erp4-backend.env
cp deploy/quadlet/env/erp4-frontend-build.https-trial.env.example deploy/quadlet/env/erp4-frontend-build.env
cp deploy/quadlet/env/erp4-caddy.env.example ~/.config/containers/systemd/erp4-caddy.env
./scripts/quadlet/check-env.sh --profile https-trial --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
./scripts/quadlet/check-trial-readiness.sh --profile https-trial --include-proxy
```
