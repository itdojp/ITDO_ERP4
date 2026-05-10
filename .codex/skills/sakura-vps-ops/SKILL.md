---
name: sakura-vps-ops
description: Use when working on ERP4 Sakura VPS deployment, Google Cloud predeployment, ops runbooks, or ops automation scripts; focus on safety, repeatability, least privilege, dry-run evidence, and human approval boundaries.
---

# Sakura VPS Ops Skill for ERP4

## Scope

Use this skill for ERP4 work involving:

- Sakura VPS deployment runbooks under `docs/ops/`.
- Google Cloud OAuth / Drive predeployment documentation.
- Ops automation scripts under `scripts/ops/`.
- PR review of deployment, rollback, secret handling, and operational safety.

Do not use this skill to execute production VPS or Google Cloud changes without explicit human approval.

## Required checks before editing

1. Read `AGENTS.md` and `docs/ops/codex-ops-workflows.md`.
2. Confirm the task worktree is under `/home/devuser/work/CodeX/ITDO_ERP4/worktrees/`.
3. Identify which Runbook or script owns the change:
   - Sakura VPS: `docs/ops/sakura-vps-deployment.md`
   - Google Cloud: `docs/ops/google-cloud-predeployment.md`
   - Automation: `docs/ops/ops-automation.md` and `scripts/ops/`
4. Keep production secrets, real host credentials, OAuth client secrets, and service account keys out of prompts, docs, examples, logs, and commits.

## Review focus

Flag or fix these issues:

- Real secrets or credential-shaped values in docs, scripts, examples, PR text, or logs.
- Destructive commands without dry-run, rollback, scope, and human approval language.
- Production use of `AUTH_MODE=header` or other auth-bypass patterns.
- Google OAuth / Drive permissions broader than needed for ERP4 chat attachments.
- Service account key generation without owner, storage, rotation, and revocation guidance.
- Rootless Podman, Quadlet, Caddy, backup, or firewall steps that omit verification evidence.
- Links from `docs/ops/index.md` or related Runbooks that become stale.
- Worktree or clone guidance that points to `/tmp` instead of the project worktree directory.

## Preferred verification

For docs-only changes, stage or intent-to-add new files before running the secret scan so `git ls-files` includes them:

```bash
git add -N AGENTS.md docs/ops/codex-ops-workflows.md docs/ops/index.md docs/ops/examples/codex-risk-report.schema.json .codex/skills/sakura-vps-ops/SKILL.md
npm exec --prefix packages/backend -- prettier --check AGENTS.md docs/ops/codex-ops-workflows.md docs/ops/index.md docs/ops/examples/codex-risk-report.schema.json .codex/skills/sakura-vps-ops/SKILL.md
mkdir -p .codex-local/tmp
TMPDIR="$PWD/.codex-local/tmp" bash scripts/secret-scan.sh
git diff --check --cached
git diff --check
```

For ops script changes, add:

```bash
bash -n scripts/ops/*.sh scripts/ops/lib/*.sh
for s in scripts/ops/*.sh; do "$s" --help >/dev/null; done
```

Use script-specific `--dry-run` checks when the changed script supports them.

## Human approval boundary

Codex may draft, review, summarize, and run dry-run checks. A human must approve before:

- Writing to production VPS, firewall, DNS, OAuth, Drive, or service account settings.
- Starting, stopping, replacing, or deleting production containers, volumes, or timers.
- Running database migration, backup restore, or destructive cleanup commands.
- Adding, rotating, exposing, or deleting production secrets.
