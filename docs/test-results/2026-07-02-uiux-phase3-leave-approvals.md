# 2026-07-02 UI/UX Phase 3 Leave and Approval Evidence

## Scope

- Umbrella issue: #1821
- Phase issue: #1826
- Screens:
  - 休暇申請 (`LeaveRequests`)
  - 承認 (`Approvals`)

## Implementation summary

- Applied the shared workflow UX primitives to leave request and approval screens.
- Added decision summaries for leave request status, paid leave balance, leader view, approval filters, actionable approvals, and evidence visibility.
- Clarified the workflow hierarchy for balance review, new leave request creation, own leave requests, leader review, approval filters, and approval target actions.
- Preserved existing headings, business action labels, and E2E selector contracts.

## Local verification

```bash
npm run test --prefix packages/frontend -- LeaveRequests.test.tsx Approvals.test.tsx
npm run format:check --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run lint --prefix packages/frontend
npm run build --prefix packages/frontend
npm audit --prefix packages/frontend --audit-level=high
```

Result: PASS.

Notes:

- Frontend build completed with the existing Vite chunk-size warning only.

## E2E screenshot evidence

Command:

```bash
TMPDIR="$PWD/.codex-local/tmp/e2e-uiux-phase3" \
XDG_RUNTIME_DIR="$PWD/.codex-local/tmp/xdg-runtime-uiux-phase3" \
BACKEND_PORT=3106 \
FRONTEND_PORT=5181 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-uiux-phase3 \
E2E_CAPTURE=1 \
E2E_GREP='phase 3 leave and approval UX/UI summaries render' \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-07-02-uiux-phase3-leave-approvals" \
./scripts/e2e-frontend.sh
```

Result: PASS, 1 test.

Screenshots:

- `docs/test-results/2026-07-02-uiux-phase3-leave-approvals/01-uiux-leave-requests.png`
- `docs/test-results/2026-07-02-uiux-phase3-leave-approvals/02-uiux-approvals.png`

## Operational note

The E2E run passed and evidence was saved. During cleanup, the Podman test
container `erp4-pg-e2e-uiux-phase3` entered a `Stopping` state and did not
respond to the normal script cleanup. This matches the local rootless Podman
runtime cleanup issue observed in Phase 2 and is not an application test
failure.
