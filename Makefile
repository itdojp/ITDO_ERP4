.PHONY: lint format-check typecheck build test test-backend test-frontend data-quality-test data-quality-blocking data-quality-advisory coverage coverage-auth coverage-integrations coverage-integrations-check coverage-frontend coverage-frontend-core e2e ui-evidence ui-visual-regression ui-visual-regression-update mobile-regression-log frontend-dev-api podman-smoke pr-comments audit docs-image-links-check docs-test-results-index-check ops-quality design-system-package-check eslint10-readiness-check eslint10-readiness-record dependabot-alerts-check dependabot-alerts-record dependabot-token-readiness-check dependency-watch-record backup-s3-readiness-check backup-s3-readiness-record backup-s3-restore-record external-csv-artifact-intake-record po-migration-input-readiness-check po-migration-record po-migration-run-and-record av-staging-evidence av-staging-gate av-staging-readiness action-policy-callsites-report action-policy-callsites-report-json action-policy-required-action-gaps action-policy-required-action-gaps-json action-policy-fallback-report action-policy-fallback-report-json release-readiness release-readiness-record action-policy-phase3-readiness action-policy-phase3-readiness-json action-policy-phase3-readiness-record action-policy-phase3-cutover-record action-policy-phase3-trial-record action-policy-phase3-target-trial-record

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

test: test-backend test-frontend

test-backend:
	npm run test --prefix packages/backend

test-frontend:
	npm run test --prefix packages/frontend

data-quality-test:
	npm run data-quality:test --prefix packages/backend

data-quality-blocking:
	npm run data-quality:blocking --prefix packages/backend

data-quality-advisory:
	npm run data-quality:advisory --prefix packages/backend

coverage:
	npm run coverage --prefix packages/backend

coverage-auth:
	npm run coverage:auth --prefix packages/backend

coverage-integrations:
	npm run coverage:integrations --prefix packages/backend

coverage-integrations-check:
	npm run coverage:integrations:check --prefix packages/backend

coverage-frontend:
	npm run coverage --prefix packages/frontend

coverage-frontend-core:
	npm run coverage:ui-core --prefix packages/frontend
e2e:
	./scripts/e2e-frontend.sh

ui-evidence:
	./scripts/e2e-ui-evidence.sh

ui-visual-regression:
	./scripts/e2e-uiux-visual-regression.sh

ui-visual-regression-update:
	./scripts/e2e-uiux-visual-regression.sh --update-snapshots

frontend-dev-api:
	VITE_API_BASE=http://localhost:3001 npm run dev --prefix packages/frontend

podman-smoke:
	./scripts/podman-smoke.sh

mobile-regression-log:
	./scripts/new-mobile-regression-log.sh

pr-comments:
	@test -n "$(PR)" || (echo "Usage: make pr-comments PR=<number> [OUT_DIR=...]" >&2; exit 1)
	./scripts/gh-pr-export-comments.sh "$(PR)" "$(OUT_DIR)"

audit:
	npm audit --prefix packages/backend --audit-level=high
	npm audit --prefix packages/frontend --audit-level=high

docs-image-links-check:
	node scripts/check-doc-image-links.mjs

docs-test-results-index-check:
	node --test scripts/check-test-results-index.test.mjs
	node scripts/check-test-results-index.mjs

ops-quality:
	./scripts/check-ops-docs.sh
	./scripts/check-ops-scripts.sh

design-system-package-check:
	./scripts/check-design-system-package.sh

eslint10-readiness-check:
	./scripts/check-eslint10-readiness.sh

eslint10-readiness-record:
	./scripts/record-eslint10-readiness.sh

dependabot-alerts-check:
	./scripts/check-dependabot-alerts.sh

dependabot-alerts-record:
	./scripts/record-dependabot-alerts.sh

dependabot-token-readiness-check:
	./scripts/check-dependabot-alerts-token.sh

dependency-watch-record:
	./scripts/run-and-record-dependency-watch.sh

backup-s3-readiness-check:
	./scripts/check-backup-s3-readiness.sh

backup-s3-readiness-record:
	./scripts/record-backup-s3-readiness.sh

backup-s3-restore-record:
	./scripts/record-backup-s3-restore.sh

external-csv-artifact-intake-record:
	node scripts/record-external-csv-artifact-intake.mjs

po-migration-input-readiness-check:
	./scripts/check-po-migration-input-readiness.sh

po-migration-record:
	./scripts/record-po-migration-rehearsal.sh

po-migration-run-and-record:
	./scripts/run-and-record-po-migration-rehearsal.sh

av-staging-evidence:
	./scripts/record-chat-attachments-av-staging.sh

av-staging-gate:
	FAIL_ON_GATE=1 ./scripts/record-chat-attachments-av-staging.sh

av-staging-readiness:
	FAIL_ON_GATE=1 ./scripts/record-chat-attachments-av-readiness.sh


release-readiness:
	RELEASE_E2E_SCOPE="$${RELEASE_E2E_SCOPE:-core}" node scripts/release-readiness.mjs

release-readiness-record:
	RELEASE_E2E_SCOPE=full node scripts/release-readiness.mjs --record --e2e-scope full

action-policy-callsites-report:
	node scripts/report-action-policy-callsites.mjs --format=text

action-policy-callsites-report-json:
	node scripts/report-action-policy-callsites.mjs --format=json

action-policy-required-action-gaps:
	node scripts/report-action-policy-required-action-gaps.mjs --format=text

action-policy-required-action-gaps-json:
	node scripts/report-action-policy-required-action-gaps.mjs --format=json

action-policy-fallback-report:
	node scripts/report-action-policy-fallback-allowed.mjs --format=text

action-policy-fallback-report-json:
	node scripts/report-action-policy-fallback-allowed.mjs --format=json

action-policy-phase3-readiness:
	node scripts/report-action-policy-phase3-readiness.mjs --format=text

action-policy-phase3-readiness-json:
	node scripts/report-action-policy-phase3-readiness.mjs --format=json

action-policy-phase3-readiness-record:
	./scripts/run-and-record-action-policy-phase3-readiness.sh

action-policy-phase3-cutover-record:
	./scripts/record-action-policy-phase3-cutover.sh

action-policy-phase3-trial-record:
	./scripts/run-and-record-action-policy-phase3-trial.sh

action-policy-phase3-target-trial-record:
	./scripts/record-action-policy-phase3-target-trial.sh
