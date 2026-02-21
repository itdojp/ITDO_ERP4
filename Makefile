.PHONY: lint format-check typecheck build test e2e ui-evidence mobile-regression-log frontend-dev-api podman-smoke pr-comments audit design-system-package-check eslint10-readiness-check dependabot-alerts-check backup-s3-readiness-check po-migration-input-readiness-check po-migration-record av-staging-evidence av-staging-gate av-staging-readiness

lint:
	npm run lint --prefix packages/backend
	npm run lint --prefix packages/frontend

format-check:
	npm run format:check --prefix packages/backend
	npm run format:check --prefix packages/frontend

typecheck:
	npm run typecheck --prefix packages/backend
	npm run typecheck --prefix packages/frontend

build:
	npm run build --prefix packages/backend
	npm run build --prefix packages/frontend

test:
	npm run test --prefix packages/backend

e2e:
	./scripts/e2e-frontend.sh

ui-evidence:
	./scripts/e2e-ui-evidence.sh

frontend-dev-api:
	VITE_API_BASE=http://localhost:3001 npm run dev --prefix packages/frontend

podman-smoke:
	./scripts/podman-poc.sh reset
	./scripts/smoke-backend.sh

mobile-regression-log:
	./scripts/new-mobile-regression-log.sh

pr-comments:
	@test -n "$(PR)" || (echo "Usage: make pr-comments PR=<number> [OUT_DIR=...]" >&2; exit 1)
	./scripts/gh-pr-export-comments.sh "$(PR)" "$(OUT_DIR)"

audit:
	npm audit --prefix packages/backend --audit-level=high
	npm audit --prefix packages/frontend --audit-level=high

design-system-package-check:
	./scripts/check-design-system-package.sh

eslint10-readiness-check:
	./scripts/check-eslint10-readiness.sh

dependabot-alerts-check:
	./scripts/check-dependabot-alerts.sh

backup-s3-readiness-check:
	./scripts/check-backup-s3-readiness.sh

po-migration-input-readiness-check:
	./scripts/check-po-migration-input-readiness.sh

po-migration-record:
	./scripts/record-po-migration-rehearsal.sh

av-staging-evidence:
	./scripts/record-chat-attachments-av-staging.sh

av-staging-gate:
	FAIL_ON_GATE=1 ./scripts/record-chat-attachments-av-staging.sh

av-staging-readiness:
	FAIL_ON_GATE=1 ./scripts/record-chat-attachments-av-readiness.sh
