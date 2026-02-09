.PHONY: lint format-check typecheck build test e2e ui-evidence pr-comments audit design-system-package-check av-staging-evidence av-staging-gate av-staging-readiness

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

pr-comments:
	@test -n "$(PR)" || (echo "Usage: make pr-comments PR=<number> [OUT_DIR=...]" >&2; exit 1)
	./scripts/gh-pr-export-comments.sh "$(PR)" "$(OUT_DIR)"

audit:
	npm audit --prefix packages/backend --audit-level=high
	npm audit --prefix packages/frontend --audit-level=high

design-system-package-check:
	./scripts/check-design-system-package.sh

av-staging-evidence:
	./scripts/record-chat-attachments-av-staging.sh

av-staging-gate:
	FAIL_ON_GATE=1 ./scripts/record-chat-attachments-av-staging.sh

av-staging-readiness:
	FAIL_ON_GATE=1 ./scripts/record-chat-attachments-av-readiness.sh
