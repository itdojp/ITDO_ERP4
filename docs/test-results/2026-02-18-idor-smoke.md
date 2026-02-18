# IDOR smoke test result (2026-02-18)

- Scope: ISSUE #1130 (major API boundary checks)
- Spec: `packages/frontend/e2e/backend-idor-api-boundary.spec.ts`
- Fixture: 2 users (`userA`, `userB`) + 2 projects (`projA`, `projB`)
- Expected: cross-project access is denied (403 or 404)

## Covered endpoints

1. `GET /projects/:projectId/invoices`
2. `GET /projects/:projectId/estimates`
3. `GET /projects/:projectId/chat-messages`
4. `GET /projects/:projectId/tasks`
5. `GET /ref-candidates?projectId=...`
6. `PATCH /projects/:projectId/tasks/:taskId`
7. `POST /projects/:projectId/chat-messages`

## Result

- All listed cross-project read/write requests are expected to be denied.
- Regression is continuously checked by Playwright E2E in CI.
