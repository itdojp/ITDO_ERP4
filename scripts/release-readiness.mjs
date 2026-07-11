#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DATABASE_URL =
  "postgresql://user:pass@localhost:5432/postgres?schema=public";
const DEFAULT_SECRET_SCAN_REPORT_PATH =
  "tmp/release-readiness-secret-scan-report.tsv";
const VALID_E2E_SCOPES = new Set(["core", "full"]);
const DEFAULT_TIME_ZONE = "Asia/Tokyo";
const SKIP_ARG_RE = /^([^:]+):(.+)$/;

export const EXTERNAL_GO_DEPENDENCIES = [
  {
    issue: "#1426",
    title: "ActionPolicy phase3_strict 対象環境 trial / cutover / rollback",
    status: "external",
  },
  {
    issue: "#544",
    title:
      "S3 バックアップ確定値と実 backup → upload → download → restore 検証",
    status: "external",
  },
  {
    issue: "#1432",
    title: "給料らくだ・経理上手くんαの現物CSVテンプレート／サンプル回収",
    status: "external",
  },
];

function usage() {
  return `Usage:
  node scripts/release-readiness.mjs [--record] [--e2e-scope core|full]
  node scripts/release-readiness.mjs --dry-run [--e2e-scope core|full]

Options:
  --record                 Write a sanitized Markdown evidence file to docs/test-results.
                           Requires RELEASE_E2E_SCOPE=full or --e2e-scope full.
  --e2e-scope <scope>      core|full. Default: RELEASE_E2E_SCOPE or core.
  --skip <id:reason>       Mark a required check as SKIP with an explicit reason.
                           Any required SKIP makes repo-side readiness BLOCKED.
  --allow-dirty            Continue even if git status is dirty; recorded in evidence.
  --log-dir <path>         Raw log directory. Default: tmp/release-readiness/<timestamp>.
  --out-dir <path>         Record output directory. Default: docs/test-results.
  --date-stamp <YYYY-MM-DD>
  --run-label <label>      Defaults to next rN.
  --dry-run                Print the check plan without running commands.
  --json                   Print summary JSON to stdout after execution.
  -h, --help               Show this help.

Environment:
  RELEASE_E2E_SCOPE=core|full
  RELEASE_TIMEZONE=Asia/Tokyo      Used for default DATE_STAMP. Default: Asia/Tokyo.
  RELEASE_ALLOW_DIRTY=0|1          Exploratory mode only; cannot be combined with --record.
  RELEASE_DATABASE_URL=...         Used for backend/OpenAPI checks.
  SECRET_SCAN_REPORT_PATH=...      Default: ${DEFAULT_SECRET_SCAN_REPORT_PATH}
`;
}

function repoRelative(rootDir, value) {
  const relative = path.relative(rootDir, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? toPosix(relative)
    : value;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function sanitizeLabel(value) {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(
      `RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (got: ${value})`,
    );
  }
  return value;
}

function validateDateStamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`DATE_STAMP must be YYYY-MM-DD (got: ${value})`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`DATE_STAMP is not a valid calendar date: ${value}`);
  }
  return value;
}

export function formatDateForTimeZone(
  date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function nextRunLabel(outDir, dateStamp) {
  let index = 1;
  while (true) {
    const candidate = `r${index}`;
    const output = path.join(
      outDir,
      `${dateStamp}-release-readiness-${candidate}.md`,
    );
    if (!fs.existsSync(output)) return candidate;
    index += 1;
  }
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${optionName}`);
  }
  return value;
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    rootDir: ROOT_DIR,
    record: false,
    dryRun: false,
    printJson: false,
    allowDirty: env.RELEASE_ALLOW_DIRTY === "1",
    e2eScope: env.RELEASE_E2E_SCOPE || "core",
    timeZone: env.RELEASE_TIMEZONE || DEFAULT_TIME_ZONE,
    skips: new Map(),
    dateStamp:
      env.DATE_STAMP ||
      formatDateForTimeZone(
        new Date(),
        env.RELEASE_TIMEZONE || DEFAULT_TIME_ZONE,
      ),
    runLabel: env.RUN_LABEL || "",
    outDir: env.OUT_DIR || path.join(ROOT_DIR, "docs", "test-results"),
    logDir: env.LOG_DIR || "",
    databaseUrl: env.RELEASE_DATABASE_URL || DEFAULT_DATABASE_URL,
    secretScanReportPath:
      env.SECRET_SCAN_REPORT_PATH || DEFAULT_SECRET_SCAN_REPORT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--record") {
      options.record = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.printJson = true;
      continue;
    }
    if (arg === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }
    if (arg === "--e2e-scope") {
      options.e2eScope = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--e2e-scope=")) {
      options.e2eScope = arg.slice("--e2e-scope=".length);
      continue;
    }
    if (arg === "--skip") {
      addSkip(options.skips, readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--skip=")) {
      addSkip(options.skips, arg.slice("--skip=".length));
      continue;
    }
    if (arg === "--log-dir") {
      options.logDir = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--log-dir=")) {
      options.logDir = arg.slice("--log-dir=".length);
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out-dir=")) {
      options.outDir = arg.slice("--out-dir=".length);
      continue;
    }
    if (arg === "--date-stamp") {
      options.dateStamp = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--date-stamp=")) {
      options.dateStamp = arg.slice("--date-stamp=".length);
      continue;
    }
    if (arg === "--run-label") {
      options.runLabel = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-label=")) {
      options.runLabel = arg.slice("--run-label=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!VALID_E2E_SCOPES.has(options.e2eScope)) {
    throw new Error(`--e2e-scope must be core|full (got: ${options.e2eScope})`);
  }
  options.dateStamp = validateDateStamp(options.dateStamp);
  options.outDir = path.resolve(options.rootDir, options.outDir);
  if (options.runLabel) {
    options.runLabel = sanitizeLabel(options.runLabel);
  }
  if (options.record && options.e2eScope !== "full") {
    throw new Error(
      "--record requires --e2e-scope full. Use non-record mode for core/limited evidence.",
    );
  }
  if (options.record && options.allowDirty) {
    throw new Error(
      "--record cannot be combined with --allow-dirty or RELEASE_ALLOW_DIRTY=1. Official evidence requires a clean checkout.",
    );
  }
  return options;
}

function addSkip(skips, value) {
  const match = value.match(SKIP_ARG_RE);
  if (!match || !match[1].trim() || !match[2].trim()) {
    throw new Error(
      "--skip must use <check-id>:<reason> and the reason cannot be blank",
    );
  }
  skips.set(match[1].trim(), match[2].trim());
}

function check(id, name, ciJob, command, options = {}) {
  return {
    id,
    name,
    ciJob,
    command,
    required: options.required !== false,
    env: options.env || {},
    cwd: options.cwd || ".",
    timeoutMs: options.timeoutMs || null,
  };
}

export function createReleaseReadinessPlan(options = {}) {
  const e2eScope = options.e2eScope || "core";
  const databaseUrl = options.databaseUrl || DEFAULT_DATABASE_URL;
  const secretScanReportPath =
    options.secretScanReportPath || DEFAULT_SECRET_SCAN_REPORT_PATH;
  return [
    check(
      "backend-install",
      "Backend dependency install",
      "CI / backend",
      "npm ci --prefix packages/backend",
    ),
    check(
      "frontend-install",
      "Frontend dependency install",
      "CI / frontend",
      "npm ci --prefix packages/frontend",
    ),
    check(
      "backend-prisma-generate",
      "Backend Prisma generate",
      "CI / backend",
      "npx --prefix packages/backend prisma generate --config packages/backend/prisma.config.ts",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "backend-lint",
      "Backend lint",
      "CI / lint",
      "npm run lint --prefix packages/backend",
    ),
    check(
      "backend-format",
      "Backend format check",
      "CI / lint",
      "npm run format:check --prefix packages/backend",
    ),
    check(
      "backend-typecheck",
      "Backend typecheck",
      "CI / backend",
      "npm run typecheck --prefix packages/backend",
    ),
    check(
      "backend-build",
      "Backend build",
      "CI / backend",
      "npm run build --prefix packages/backend",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "backend-test",
      "Backend unit/integration test",
      "CI / backend",
      "npm run test --prefix packages/backend",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "backend-bounded-context",
      "Backend bounded-context gate",
      "CI / lint",
      "npm run arch:bounded-context --prefix packages/backend",
    ),
    check(
      "coverage-auth",
      "Auth coverage gate",
      "CI / coverage-auth",
      "npm run coverage:auth:check --prefix packages/backend",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "coverage-integrations",
      "Integrations coverage gate",
      "CI / backend",
      "npm run coverage:integrations:check --prefix packages/backend",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "backend-prisma-format",
      "Backend Prisma format check",
      "CI / backend",
      "npx --prefix packages/backend prisma format --config packages/backend/prisma.config.ts && git diff --exit-code -- packages/backend/prisma/schema.prisma packages/backend/prisma/migrations",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "backend-prisma-validate",
      "Backend Prisma validate",
      "CI / backend",
      "npx --prefix packages/backend prisma validate --config packages/backend/prisma.config.ts",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "frontend-lint",
      "Frontend lint",
      "CI / lint",
      "npm run lint --prefix packages/frontend",
    ),
    check(
      "frontend-format",
      "Frontend format check",
      "CI / lint",
      "npm run format:check --prefix packages/frontend",
    ),
    check(
      "frontend-typecheck",
      "Frontend typecheck",
      "CI / frontend",
      "npm run typecheck --prefix packages/frontend",
    ),
    check(
      "frontend-test",
      "Frontend unit test",
      "CI / frontend",
      "npm run test --prefix packages/frontend",
    ),
    check(
      "frontend-build",
      "Frontend build",
      "CI / frontend",
      "npm run build --prefix packages/frontend",
    ),
    check(
      "audit-backend",
      "Backend dependency audit",
      "CI / security-audit",
      "npm audit --prefix packages/backend --audit-level=high",
    ),
    check(
      "audit-frontend",
      "Frontend dependency audit",
      "CI / security-audit",
      "npm audit --prefix packages/frontend --audit-level=high",
    ),
    check(
      "data-quality-test",
      "Data-quality runner tests",
      "CI / data-quality",
      "npm run data-quality:test --prefix packages/backend",
    ),
    check(
      "data-quality-blocking",
      "Blocking data-quality gate",
      "CI / data-quality",
      "npm run data-quality:blocking --prefix packages/backend",
    ),
    check(
      "docs-image-links",
      "Docs image/link check",
      "CI / lint",
      "node scripts/check-doc-image-links.mjs",
    ),
    check(
      "docs-test-results-index",
      "Docs test-results index check",
      "CI / lint",
      "make docs-test-results-index-check",
    ),
    check(
      "ops-docs",
      "Ops docs check",
      "CI / lint",
      "./scripts/check-ops-docs.sh",
    ),
    check(
      "ops-scripts",
      "Ops scripts check",
      "CI / lint",
      "./scripts/check-ops-scripts.sh",
    ),
    check(
      "openapi-snapshot",
      "OpenAPI snapshot check",
      "CI / api-schema",
      "mkdir -p tmp && node scripts/export-openapi.mjs --out tmp/openapi-release-readiness.json && diff -u docs/api/openapi.json tmp/openapi-release-readiness.json",
      {
        env: { DATABASE_URL: databaseUrl },
      },
    ),
    check(
      "secret-scan",
      "Secret scan",
      "CI / secret-scan",
      "./scripts/secret-scan.sh",
      {
        env: { SECRET_SCAN_REPORT_PATH: secretScanReportPath },
      },
    ),
    check(
      "frontend-e2e",
      `Frontend E2E (${e2eScope})`,
      "CI / e2e-frontend",
      "./scripts/e2e-frontend.sh",
      {
        env: {
          E2E_SCOPE: e2eScope,
          E2E_CAPTURE: "0",
          E2E_TRACE_ON_FAILURE: "1",
        },
      },
    ),
  ];
}

function safeVersion(rootDir, command, args = []) {
  try {
    return execFileSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return "missing";
  }
}

function safeGit(rootDir, args) {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function collectMetadata(rootDir = ROOT_DIR) {
  const dirtyOutput = safeGit(rootDir, ["status", "--porcelain"]);
  const branch = safeGit(rootDir, ["branch", "--show-current"]) || "(detached)";
  return {
    commit: safeGit(rootDir, ["rev-parse", "HEAD"]) || "unknown",
    branch,
    dirty: dirtyOutput.length > 0,
    dirtySummary: dirtyOutput ? dirtyOutput.split(/\r?\n/).slice(0, 20) : [],
    toolVersions: {
      node: safeVersion(rootDir, "node", ["--version"]),
      npm: safeVersion(rootDir, "npm", ["--version"]),
      git: safeVersion(rootDir, "git", ["--version"]),
      podman: safeVersion(rootDir, "podman", ["--version"]),
      uname: safeVersion(rootDir, "uname", ["-srmo"]),
    },
  };
}

export function redactText(value, rootDir = ROOT_DIR) {
  return String(value)
    .replaceAll(rootDir, "<repo>")
    .replace(/(https?:\/\/[^:\s]+:)[^@\s]+(@)/g, "$1<redacted>$2")
    .replace(
      /(^|[\s|(["'`])\/(?:home|Users|root|tmp|var|private|mnt|media|run|srv|opt|etc)\/[^\s|`'")]+/g,
      "$1<redacted-path>",
    )
    .replace(/(^|[\s|(["'`])[A-Za-z]:\\[^\s|`'")]+/g, "$1<redacted-path>")
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, "<redacted-token>")
    .replace(/(github_pat_[A-Za-z0-9_]+)/g, "<redacted-token>")
    .replace(/(sk-[A-Za-z0-9]{20,})/g, "<redacted-token>")
    .replace(/(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})/g, "<redacted-aws-key>");
}

function publicEnvKeys(env) {
  return Object.keys(env || {}).sort();
}

function displayCommand(item) {
  const keys = publicEnvKeys(item.env);
  if (keys.length === 0) return item.command;
  return `${keys.map((key) => `${key}=<redacted>`).join(" ")} ${item.command}`;
}

async function runCommand(item, rootDir, logPath) {
  await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
  const startedAt = new Date();
  const output = fs.createWriteStream(logPath, { flags: "w" });
  output.write(`# ${item.id}\n`);
  output.write(`# command: ${displayCommand(item)}\n`);
  output.write(`# started_at: ${startedAt.toISOString()}\n\n`);

  const child = spawn(item.command, {
    cwd: path.resolve(rootDir, item.cwd || "."),
    shell: true,
    detached: true,
    env: { ...process.env, ...item.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    output.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    output.write(chunk);
  });

  let timedOut = false;
  let timeoutHandle = null;
  if (item.timeoutMs) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      output.write(
        `\n[release-readiness] timed out after ${item.timeoutMs}ms\n`,
      );
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, item.timeoutMs);
  }

  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      output.write(`\n[release-readiness] spawn error: ${error.message}\n`);
      resolve(timedOut ? 124 : 127);
    });
    child.on("close", (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal)
        output.write(`\n[release-readiness] terminated by signal: ${signal}\n`);
      resolve(timedOut ? 124 : typeof code === "number" ? code : 1);
    });
  });

  const endedAt = new Date();
  output.write(`\n# ended_at: ${endedAt.toISOString()}\n`);
  output.write(`# exit_code: ${exitCode}\n`);
  await new Promise((resolve) => output.end(resolve));
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    exitCode,
    status: exitCode === 0 ? "PASS" : "FAIL",
    rawLog: repoRelative(rootDir, logPath),
  };
}

function summarizeStatus(results) {
  if (results.some((result) => result.status === "FAIL")) return "FAIL";
  if (results.some((result) => result.status === "SKIP")) return "BLOCKED";
  return "PASS";
}

function goDecision(
  repoSideStatus,
  externalDependencies = EXTERNAL_GO_DEPENDENCIES,
) {
  if (repoSideStatus === "FAIL") return "NO-GO";
  if (repoSideStatus === "BLOCKED") return "BLOCKED";
  if (externalDependencies.some((dependency) => dependency.status !== "done")) {
    return "NO-GO";
  }
  return "GO";
}

export async function runReleaseReadiness(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const logDir =
    options.logDir ||
    path.join(rootDir, "tmp", "release-readiness", timestampForPath());
  const plan = options.plan || createReleaseReadinessPlan(options);
  const metadata = collectMetadata(rootDir);
  const startedAt = new Date();
  const results = [];

  if (metadata.dirty && !options.allowDirty) {
    const endedAt = new Date();
    results.push({
      id: "preflight-clean-checkout",
      name: "Clean checkout preflight",
      ciJob: "local preflight",
      required: true,
      command: "git status --porcelain",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      exitCode: 1,
      status: "FAIL",
      rawLog: null,
      reason:
        "Working tree is dirty. Commit/stash changes or rerun with --allow-dirty for exploratory evidence.",
    });
    return buildSummary({
      rootDir,
      startedAt,
      endedAt,
      metadata,
      e2eScope: options.e2eScope || "core",
      results,
      dateStamp: options.dateStamp,
      externalDependencies: options.externalDependencies,
    });
  }

  if (options.record && metadata.commit === "unknown") {
    const endedAt = new Date();
    results.push({
      id: "preflight-git-commit",
      name: "Git commit SHA preflight",
      ciJob: "local preflight",
      required: true,
      command: "git rev-parse HEAD",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      exitCode: 1,
      status: "FAIL",
      rawLog: null,
      reason:
        "Could not resolve git commit SHA. Ensure git is installed and the working directory is a git checkout.",
    });
    return buildSummary({
      rootDir,
      startedAt,
      endedAt,
      metadata,
      e2eScope: options.e2eScope || "core",
      results,
      dateStamp: options.dateStamp,
      externalDependencies: options.externalDependencies,
    });
  }

  for (const item of plan) {
    const skipReason = options.skips?.get(item.id);
    if (skipReason) {
      const now = new Date().toISOString();
      results.push({
        ...publicCheckFields(item),
        startedAt: now,
        endedAt: now,
        durationMs: 0,
        exitCode: null,
        status: "SKIP",
        reason: skipReason,
        rawLog: null,
      });
      continue;
    }

    const logPath = path.join(
      logDir,
      `${String(results.length + 1).padStart(2, "0")}-${item.id}.log`,
    );
    const commandResult = await runCommand(item, rootDir, logPath);
    results.push({ ...publicCheckFields(item), ...commandResult });
  }

  return buildSummary({
    rootDir,
    startedAt,
    endedAt: new Date(),
    metadata,
    e2eScope: options.e2eScope || "core",
    results,
    dateStamp: options.dateStamp,
    externalDependencies: options.externalDependencies,
  });
}

function publicCheckFields(item) {
  return {
    id: item.id,
    name: item.name,
    ciJob: item.ciJob,
    required: item.required,
    command: displayCommand(item),
  };
}

function timestampForPath() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function buildSummary({
  rootDir = ROOT_DIR,
  startedAt,
  endedAt,
  metadata,
  e2eScope,
  results,
  dateStamp = formatDateForTimeZone(endedAt),
  externalDependencies = EXTERNAL_GO_DEPENDENCIES,
}) {
  const repoSideStatus = summarizeStatus(results);
  return {
    schemaVersion: 1,
    generatedAt: endedAt.toISOString(),
    dateStamp,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    repoSideStatus,
    overallGoDecision: goDecision(repoSideStatus, externalDependencies),
    e2eScope,
    metadata: {
      ...metadata,
      dirtySummary: (metadata.dirtySummary || []).map((line) =>
        redactText(line, rootDir),
      ),
    },
    checks: results.map((result) => ({
      ...result,
      command: redactText(result.command, rootDir),
      rawLog: result.rawLog ? redactText(result.rawLog, rootDir) : null,
      reason: result.reason ? redactText(result.reason, rootDir) : undefined,
    })),
    externalGoDependencies: externalDependencies,
  };
}

export function renderMarkdownReport(summary) {
  const lines = [];
  lines.push(
    `# Release Candidate Readiness Evidence - ${summary.dateStamp || summary.generatedAt.slice(0, 10)}`,
  );
  lines.push("");
  lines.push("## 判定");
  lines.push("");
  lines.push(`- Repo-side readiness: **${summary.repoSideStatus}**`);
  lines.push(`- Overall Go/No-Go: **${summary.overallGoDecision}**`);
  lines.push(`- E2E scope: **${summary.e2eScope}**`);
  lines.push("");
  lines.push(
    "> この証跡は repo-side quality gate の再現結果です。対象環境での ActionPolicy 切替、実 S3 restore、外部製品現物CSV確認は別証跡が揃うまで完了扱いにしません。",
  );
  lines.push(
    "> `CI job` 欄は GitHub Actions required checks との対応先を示す参照であり、workflow の完全再実行ではありません。GitHub Actions / Link Check / CodeQL の実結果はPRまたは対象コミット上で別途確認してください。",
  );
  lines.push(
    "> `make release-readiness` が出力する `tmp/release-readiness/*/summary.md` は限定・調査用証跡です。release Go の正式 repo-side 証跡は clean checkout で `RELEASE_E2E_SCOPE=full make release-readiness-record` が生成した `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` のみです。",
  );
  lines.push("");
  lines.push("## 実行対象");
  lines.push("");
  lines.push(`- Commit: \`${summary.metadata.commit}\``);
  lines.push(`- Branch: \`${summary.metadata.branch}\``);
  lines.push(`- Dirty: \`${summary.metadata.dirty ? "yes" : "no"}\``);
  if (summary.metadata.dirtySummary?.length) {
    lines.push("- Dirty summary:");
    for (const line of summary.metadata.dirtySummary)
      lines.push(`  - \`${line}\``);
  }
  lines.push(`- Started: ${summary.startedAt}`);
  lines.push(`- Ended: ${summary.endedAt}`);
  lines.push(`- Duration: ${formatDuration(summary.durationMs)}`);
  lines.push("");
  lines.push("## Tool versions");
  lines.push("");
  for (const [name, version] of Object.entries(
    summary.metadata.toolVersions || {},
  )) {
    lines.push(`- ${name}: \`${version}\``);
  }
  lines.push("");
  lines.push("## Check results");
  lines.push("");
  lines.push(
    "| check | CI job | status | exit | duration | command | raw log |",
  );
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
  for (const check of summary.checks) {
    lines.push(
      `| ${escapeTable(check.id)} | ${escapeTable(check.ciJob)} | ${check.status} | ${check.exitCode ?? ""} | ${formatDuration(check.durationMs)} | \`${escapeTable(check.command)}\` | ${check.rawLog ? `\`${escapeTable(check.rawLog)}\`` : ""} |`,
    );
    if (check.status === "SKIP" && check.reason) {
      lines.push(
        `| ${escapeTable(check.id)} reason |  | SKIP |  |  | ${escapeTable(check.reason)} |  |`,
      );
    }
  }
  lines.push("");
  lines.push("## External Go dependencies");
  lines.push("");
  lines.push("| issue | status | dependency |");
  lines.push("| --- | --- | --- |");
  for (const dependency of summary.externalGoDependencies || []) {
    lines.push(
      `| ${dependency.issue} | ${dependency.status} | ${escapeTable(dependency.title)} |`,
    );
  }
  lines.push("");
  lines.push("## Re-run command");
  lines.push("");
  lines.push("```bash");
  lines.push(`RELEASE_E2E_SCOPE=${summary.e2eScope} make release-readiness`);
  if (summary.e2eScope === "full") {
    lines.push(`RELEASE_E2E_SCOPE=full make release-readiness-record`);
  }
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0
    ? `${minutes}m${String(rest).padStart(2, "0")}s`
    : `${seconds}s`;
}

function escapeTable(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

async function writeSummaryFiles(summary, options) {
  const logDir = options.logDir;
  await fs.promises.mkdir(logDir, { recursive: true });
  const jsonPath = path.join(logDir, "summary.json");
  const markdownPath = path.join(logDir, "summary.md");
  await fs.promises.writeFile(
    jsonPath,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await fs.promises.writeFile(markdownPath, renderMarkdownReport(summary));

  const written = { jsonPath, markdownPath };
  if (options.record && summary.metadata?.dirty) {
    throw new Error(
      "record mode requires a clean checkout; rerun without --record for exploratory dirty evidence.",
    );
  }
  if (options.record) {
    await fs.promises.mkdir(options.outDir, { recursive: true });
    const runLabel =
      options.runLabel || nextRunLabel(options.outDir, options.dateStamp);
    const recordPath = path.join(
      options.outDir,
      `${options.dateStamp}-release-readiness-${runLabel}.md`,
    );
    if (fs.existsSync(recordPath)) {
      throw new Error(
        `record output already exists: ${repoRelative(options.rootDir, recordPath)}`,
      );
    }
    await fs.promises.writeFile(recordPath, renderMarkdownReport(summary));
    written.recordPath = recordPath;
  }
  return written;
}

function exitCodeFor(summary) {
  if (summary.repoSideStatus === "PASS") return 0;
  if (summary.repoSideStatus === "BLOCKED") return 2;
  return 1;
}

async function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[release-readiness][ERROR] ${error.message}`);
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const timestamp = timestampForPath();
  options.logDir = path.resolve(
    options.rootDir,
    options.logDir || path.join("tmp", "release-readiness", timestamp),
  );
  const plan = createReleaseReadinessPlan(options);

  if (options.dryRun) {
    for (const item of plan) {
      console.log(`${item.id}\t${item.ciJob}\t${displayCommand(item)}`);
    }
    return;
  }

  const summary = await runReleaseReadiness({ ...options, plan });
  const written = await writeSummaryFiles(summary, options);
  console.log(
    `[release-readiness] summary json: ${repoRelative(options.rootDir, written.jsonPath)}`,
  );
  console.log(
    `[release-readiness] summary md: ${repoRelative(options.rootDir, written.markdownPath)}`,
  );
  if (written.recordPath) {
    console.log(
      `[release-readiness] record: ${repoRelative(options.rootDir, written.recordPath)}`,
    );
  }
  if (options.printJson) {
    console.log(JSON.stringify(summary, null, 2));
  }
  process.exitCode = exitCodeFor(summary);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(`[release-readiness][ERROR] ${error.stack || error.message}`);
    process.exit(1);
  });
}
