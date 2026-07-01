# Phase 1 daily/project UX/UI implementation evidence - 2026-07-01

## Scope

- Umbrella Issue: #1821 Improve UX/UI across all frontend screens
- Phase Issue: #1822 Phase 1: Improve daily and project UX/UI baseline
- Cross-screen baseline: `packages/frontend/src/sections/workflowUx.tsx`, `packages/frontend/src/styles.css`
- Daily screens: `DailyReport.tsx`, `TimeEntries.tsx`
- Project screens: `Projects.tsx`, `ProjectTasks.tsx`, `ProjectMilestones.tsx`

## Implemented evidence

- Added reusable workflow UX primitives for page-level guidance, metric summaries, and workflow panels while preserving existing `h2` headings used by navigation/E2E.
- Added daily workflow summaries for target date, logged time, linked projects, condition status, selected project/task, registered minutes, and task availability.
- Added project workflow summaries for project counts, customer linkage, planned effort/budget, task progress/baselines, milestone totals, and delivery-due report status.
- Added scoped workflow control styling for the affected project forms to improve focus visibility, spacing, and control affordance without changing backend/API behavior.
- Added targeted unit coverage for the shared UX primitives and screen-level summary landmarks.
- Added a focused Playwright evidence spec that renders all Phase 1 target screens and captures screenshots.

## Local verification

```bash
npm run test --prefix packages/frontend -- workflowUx.test.tsx DailyReport.test.tsx TimeEntries.test.tsx Projects.test.tsx ProjectTasks.test.tsx ProjectMilestones.test.tsx
npm run format:check --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run lint --prefix packages/frontend
npm run build --prefix packages/frontend

TMPDIR="$PWD/.codex-local/tmp/e2e-uiux-phase1" \
XDG_RUNTIME_DIR="$PWD/.codex-local/tmp/xdg-runtime-uiux-phase1" \
BACKEND_PORT=3104 FRONTEND_PORT=5179 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-uiux-phase1 \
E2E_CAPTURE=1 \
E2E_GREP='phase 1 daily and project UX/UI summaries render' \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-07-01-uiux-phase1-daily-project" \
./scripts/e2e-frontend.sh
```

Result:

- Vitest: 6 files / 36 tests passed.
- Format: Prettier check passed for frontend source files.
- Typecheck: TypeScript no-emit check passed.
- Lint: ESLint passed.
- Build: Vite production build passed. Existing chunk-size warning remains non-blocking.
- Playwright: 1 test passed.
  - `phase 1 daily and project UX/UI summaries render @core`

## Screenshot evidence

- [`01-uiux-daily-report.png`](./2026-07-01-uiux-phase1-daily-project/01-uiux-daily-report.png): daily report guidance, summary cards, date controls, worklog linkage, wellbeing inputs.
- [`02-uiux-time-entries.png`](./2026-07-01-uiux-phase1-daily-project/02-uiux-time-entries.png): time-entry guidance, summary cards, project/task/date/minutes controls, registered entries.
- [`03-uiux-projects.png`](./2026-07-01-uiux-phase1-daily-project/03-uiux-projects.png): project guidance, summary cards, styled project form, project list, recurring template area.
- [`04-uiux-project-tasks.png`](./2026-07-01-uiux-phase1-daily-project/04-uiux-project-tasks.png): task guidance, summary cards, project selector, baseline controls, task form/list.
- [`05-uiux-project-milestones.png`](./2026-07-01-uiux-phase1-daily-project/05-uiux-project-milestones.png): milestone guidance, summary cards, styled milestone form, delivery-due report area.
