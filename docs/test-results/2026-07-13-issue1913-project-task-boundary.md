# Issue #1913 Projects task / WBS / dependency extraction verification

## Scope

Issue: <https://github.com/itdojp/ITDO_ERP4/issues/1913>

This change is a behavior-compatible backend refactor for the existing project task, task dependency, and baseline endpoints.

Extracted endpoints:

| Method | Path | New route module | Application service |
| --- | --- | --- | --- |
| GET | `/projects/:projectId/tasks` | `src/routes/projects/tasks.ts` | `listProjectTasks` |
| POST | `/projects/:projectId/tasks` | `src/routes/projects/tasks.ts` | `createProjectTask` |
| PATCH | `/projects/:projectId/tasks/:taskId` | `src/routes/projects/tasks.ts` | `updateProjectTask` |
| GET | `/projects/:projectId/tasks/:taskId/dependencies` | `src/routes/projects/tasks.ts` | `listProjectTaskDependencies` |
| PUT | `/projects/:projectId/tasks/:taskId/dependencies` | `src/routes/projects/tasks.ts` | `updateProjectTaskDependencies` |
| POST | `/projects/:projectId/tasks/:taskId/delete` | `src/routes/projects/tasks.ts` | `deleteProjectTask` |
| GET | `/projects/:projectId/baselines` | `src/routes/projects/tasks.ts` | `listProjectBaselines` |
| GET | `/projects/:projectId/baselines/:baselineId` | `src/routes/projects/tasks.ts` | `getProjectBaseline` |
| POST | `/projects/:projectId/baselines` | `src/routes/projects/tasks.ts` | `createProjectBaseline` |

Existing task reassignment remains in `src/application/projects/useCases.ts` from #1912, but its HTTP endpoint was moved into the task route module to keep all task HTTP registration together.

Non-scope for this PR:

- Milestone and recurring template handling remain in `routes/projects.ts` for #1914.
- A dedicated task restore endpoint does not exist in the current API surface and was not added.
- A dedicated WBS hierarchy endpoint does not exist in the current API surface; existing `parentTaskId` semantics are preserved through task list/update responses.

## Route and boundary evidence

Line counts after the split:

```text
  537 packages/backend/src/routes/projects.ts
  245 packages/backend/src/routes/projects/tasks.ts
   35 packages/backend/src/routes/projects/shared.ts
  691 packages/backend/src/application/projects/taskUseCases.ts
```

Boundary changes:

- `src/application/projects/taskUseCases.ts` contains task, dependency, and baseline database orchestration without accepting Fastify request/reply objects.
- `src/routes/projects/tasks.ts` is limited to HTTP preHandler/schema wiring, DTO extraction, audit-context extraction, and application-result mapping.
- `src/routes/projects/shared.ts` centralizes project route request helpers introduced by #1912.
- `src/services/taskDependencyGraph.ts` remains the pure graph helper location and now also exposes parent-task cycle helpers:
  - `buildTaskParentMap`
  - `hasTaskParentCycle`
- `packages/backend/bounded-context-registry.cjs` now classifies `src/routes/projects/.+\.ts` under Org & Project, so the new route submodule is covered by the architecture coverage gate.

## Compatibility notes

Preserved behavior:

- Task list ordering and `take: 200` limit.
- Task create/update date range errors: `VALIDATION_ERROR` with the existing field-pair messages.
- Parent task validation errors for missing/deleted parent, cross-project parent, self parent, missing reason, and ancestor cycle.
- Parent-change audit action `project_task_parent_updated` and metadata shape.
- Dependency replacement semantics: normalized unique predecessor list, self-dependency rejection, predecessor existence check, path cycle rejection, `deleteMany` + `createMany(..., skipDuplicates: true)` transaction, and `{ predecessorIds, added, removed }` response shape.
- Task soft-delete linked-record guard and dependency cleanup transaction.
- Baseline list/get/create project existence checks, leader/admin guard, default name format, task snapshot fields, and `taskCount` response.

Intentional implementation clarification:

- Parent-task cycle detection now uses a pure helper over a task parent map, with DB I/O only used to load the current project task parent rows.
- No milestone/recurring behavior was moved in this PR to avoid overlapping #1914.

## Verification

### Local targeted checks

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node --test \
  packages/backend/test/projectTaskApplicationUseCases.test.js \
  packages/backend/test/taskDependencyGraph.test.js \
  packages/backend/test/projectApplicationUseCases.test.js
npm run lint --prefix packages/backend
npm run format:check --prefix packages/backend
npm run arch:bounded-context --prefix packages/backend
npm run arch:bounded-context:coverage --prefix packages/backend
```

Current results:

- Backend build: PASS.
- Targeted project/task application and graph tests: PASS, 14 tests.
- Backend lint: PASS.
- Backend format-check: PASS.
- Bounded-context direction: PASS, 45 known violations ignored.
- Bounded-context coverage: PASS, 195 source files / 184 target route/service files / unclassified 0 / stale 0.

### Broad checks

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend
npm audit --prefix packages/backend --audit-level=high
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
node scripts/check-test-results-index.mjs
node scripts/check-doc-image-links.mjs
git diff --check
```

Results:

- Backend `test:ci`: PASS, 1,149 tests. Existing non-fatal vendor invoice audit `P1001` warnings appeared, consistent with prior runs.
- Backend `npm audit --audit-level=high`: PASS, 0 vulnerabilities.
- Core frontend E2E: PASS, 105 tests. Podman DB port fallback: 55433 -> 55437.
- `node scripts/check-test-results-index.mjs`: PASS.
- `node scripts/check-doc-image-links.mjs`: PASS, 115 image links in 311 markdown files.
- `git diff --check`: PASS.
