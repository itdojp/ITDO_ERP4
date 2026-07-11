import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSummary,
  createReleaseReadinessPlan,
  formatDateForTimeZone,
  parseArgs,
  redactText,
  renderMarkdownReport,
  runReleaseReadiness,
} from "./release-readiness.mjs";

function makeCleanGitFixture() {
  const base = path.join(process.cwd(), "tmp", "release-readiness-test");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(gitDir);
  fs.writeFileSync(path.join(root, "placeholder.txt"), "ok\n");
  return root;
}

test("createReleaseReadinessPlan includes current required quality gates", () => {
  const plan = createReleaseReadinessPlan({ e2eScope: "full" });
  const ids = plan.map((item) => item.id);

  for (const id of [
    "backend-install",
    "frontend-install",
    "backend-prisma-generate",
    "backend-lint",
    "backend-format",
    "backend-typecheck",
    "backend-build",
    "backend-test",
    "backend-bounded-context",
    "coverage-auth",
    "coverage-integrations",
    "backend-prisma-format",
    "backend-prisma-validate",
    "frontend-lint",
    "frontend-format",
    "frontend-typecheck",
    "frontend-test",
    "frontend-build",
    "audit-backend",
    "audit-frontend",
    "data-quality-test",
    "data-quality-blocking",
    "docs-image-links",
    "docs-test-results-index",
    "ops-docs",
    "ops-scripts",
    "openapi-snapshot",
    "secret-scan",
    "frontend-e2e",
  ]) {
    assert.ok(ids.includes(id), `${id} is included`);
  }

  const e2e = plan.find((item) => item.id === "frontend-e2e");
  assert.equal(e2e.env.E2E_SCOPE, "full");
});

test("parseArgs rejects reasonless skips and record mode without full E2E", () => {
  assert.throws(
    () => parseArgs(["--skip", "frontend-e2e:  "], {}),
    /--skip must use <check-id>:<reason>/,
  );
  assert.throws(
    () => parseArgs(["--record", "--e2e-scope", "core"], {}),
    /--record requires --e2e-scope full/,
  );
  const parsed = parseArgs(["--skip", "frontend-e2e:Podman unavailable"], {
    RELEASE_E2E_SCOPE: "full",
  });
  assert.equal(parsed.skips.get("frontend-e2e"), "Podman unavailable");
});

test("parseArgs rejects official record mode from dirty-checkout exploratory mode", () => {
  assert.throws(
    () => parseArgs(["--record", "--allow-dirty", "--e2e-scope", "full"], {}),
    /--record cannot be combined with --allow-dirty/,
  );
  assert.throws(
    () =>
      parseArgs(["--record"], {
        RELEASE_E2E_SCOPE: "full",
        RELEASE_ALLOW_DIRTY: "1",
      }),
    /--record cannot be combined with --allow-dirty/,
  );
});

test("formatDateForTimeZone uses JST for default release evidence dates", () => {
  assert.equal(
    formatDateForTimeZone(new Date("2026-07-11T17:30:00.000Z"), "Asia/Tokyo"),
    "2026-07-12",
  );
  assert.equal(
    parseArgs([], {
      RELEASE_TIMEZONE: "Asia/Tokyo",
    }).timeZone,
    "Asia/Tokyo",
  );
});

test("redactText removes private absolute paths before evidence is rendered", () => {
  const redacted = redactText(
    "see /home/devuser/private-vpn/down and C:\\Users\\devuser\\secret.txt",
  );

  assert.doesNotMatch(redacted, /\/home\/devuser/);
  assert.doesNotMatch(redacted, /C:\\Users\\devuser/);
  assert.match(redacted, /<redacted-path>/);
});

test("runReleaseReadiness returns non-pass status when a required command fails", async () => {
  const root = makeCleanGitFixture();
  const summary = await runReleaseReadiness({
    rootDir: root,
    allowDirty: true,
    logDir: path.join(root, "tmp", "logs"),
    e2eScope: "core",
    plan: [
      {
        id: "pass-check",
        name: "Pass check",
        ciJob: "local",
        command: 'node -e "process.exit(0)"',
        required: true,
        env: {},
        cwd: ".",
      },
      {
        id: "fail-check",
        name: "Fail check",
        ciJob: "local",
        command: 'node -e "process.exit(7)"',
        required: true,
        env: {},
        cwd: ".",
      },
    ],
    externalDependencies: [],
  });

  assert.equal(summary.repoSideStatus, "FAIL");
  assert.equal(summary.overallGoDecision, "NO-GO");
  assert.equal(summary.checks[0].status, "PASS");
  assert.equal(summary.checks[1].status, "FAIL");
  assert.equal(summary.checks[1].exitCode, 7);
});

test("runReleaseReadiness records reasoned skips as blocked", async () => {
  const root = makeCleanGitFixture();
  const skips = new Map([
    ["frontend-e2e", "Podman unavailable: /home/devuser/private-vpn/down"],
  ]);
  const summary = await runReleaseReadiness({
    rootDir: root,
    allowDirty: true,
    logDir: path.join(root, "tmp", "logs"),
    e2eScope: "core",
    skips,
    plan: [
      {
        id: "frontend-e2e",
        name: "Frontend E2E",
        ciJob: "CI / e2e-frontend",
        command: "./scripts/e2e-frontend.sh",
        required: true,
        env: {},
        cwd: ".",
      },
    ],
    externalDependencies: [],
  });

  assert.equal(summary.repoSideStatus, "BLOCKED");
  assert.equal(summary.overallGoDecision, "BLOCKED");
  assert.equal(summary.checks[0].status, "SKIP");
  assert.match(summary.checks[0].reason, /Podman unavailable/);
  assert.doesNotMatch(summary.checks[0].reason, /\/home\/devuser/);
  assert.match(summary.checks[0].reason, /<redacted-path>/);
});

test("runReleaseReadiness times out a hanging command and reports exit code 124", async () => {
  const root = makeCleanGitFixture();
  const summary = await runReleaseReadiness({
    rootDir: root,
    allowDirty: true,
    logDir: path.join(root, "tmp", "logs"),
    e2eScope: "core",
    plan: [
      {
        id: "hang-check",
        name: "Hanging command",
        ciJob: "local",
        command: 'node -e "setTimeout(()=>{},5000)"',
        required: true,
        env: {},
        cwd: ".",
        timeoutMs: 200,
      },
    ],
    externalDependencies: [],
  });

  assert.equal(summary.repoSideStatus, "FAIL");
  assert.equal(summary.checks[0].exitCode, 124);
  assert.equal(summary.checks[0].status, "FAIL");
});

test("runReleaseReadiness blocks --record when git commit SHA is unknown", async () => {
  const base = path.join(os.tmpdir(), "release-readiness-test-no-git");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  let summary;
  try {
    summary = await runReleaseReadiness({
      rootDir: root,
      allowDirty: true,
      record: true,
      logDir: path.join(root, "tmp", "logs"),
      e2eScope: "full",
      plan: [],
      externalDependencies: [],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.equal(summary.repoSideStatus, "FAIL");
  assert.equal(summary.checks.length, 1);
  assert.equal(summary.checks[0].id, "preflight-git-commit");
  assert.equal(summary.checks[0].status, "FAIL");
  assert.match(summary.checks[0].reason, /git commit SHA/);
});

test("renderMarkdownReport is deterministic and separates repo-side from external Go dependencies", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  const summary = buildSummary({
    startedAt: now,
    endedAt: new Date("2026-07-12T00:00:02.000Z"),
    e2eScope: "full",
    metadata: {
      commit: "abc123",
      branch: "main",
      dirty: false,
      dirtySummary: [],
      toolVersions: { node: "v20.19.0", npm: "10.8.2" },
    },
    results: [
      {
        id: "backend-test",
        name: "Backend test",
        ciJob: "CI / backend",
        command: 'node -e "console.log(`tick`)" && echo C:\\tmp\\x | cat',
        required: true,
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        durationMs: 2000,
        exitCode: 0,
        status: "PASS",
        rawLog: "tmp/release-readiness/backend-test.log",
      },
    ],
    externalDependencies: [
      { issue: "#1426", title: "ActionPolicy trial", status: "external" },
    ],
  });

  const markdown = renderMarkdownReport(summary);
  assert.match(markdown, /Repo-side readiness: \*\*PASS\*\*/);
  assert.match(markdown, /Overall Go\/No-Go: \*\*NO-GO\*\*/);
  assert.match(markdown, /#1426/);
  assert.match(markdown, /GitHub Actions \/ Link Check \/ CodeQL/);
  assert.match(markdown, /workflow の完全再実行ではありません/);
  assert.match(markdown, /限定・調査用証跡/);
  assert.match(markdown, /正式 repo-side 証跡/);
  assert.match(markdown, /<redacted-path> \\\| cat/);
  assert.match(markdown, /console\.log\(\\`tick\\`\)/);
  assert.match(
    markdown,
    /RELEASE_E2E_SCOPE=full make release-readiness-record/,
  );
});
