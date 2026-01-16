.PHONY: lint format-check typecheck build test e2e

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

