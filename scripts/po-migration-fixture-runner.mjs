#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.slice("--mode=".length) : "dry-run";
const allowedModes = new Set(["dry-run", "apply", "all"]);
if (!allowedModes.has(mode)) {
  throw new Error(`invalid --mode: ${mode}`);
}
const prepareDb = process.argv.includes("--prepare-db");
const preflightOnly = process.argv.includes("--preflight-only");
const defaultDatabaseUrl =
  "postgresql://user:pass@localhost:5432/po_migration_fixture?schema=public";
const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl;
process.env.DATABASE_URL = databaseUrl;

const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
  throw new Error(
    "Refusing to run PO migration fixtures against a non-local DATABASE_URL host",
  );
}
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
const fixtureSchema = parsedUrl.searchParams.get("schema") || "public";
const allowSharedDatabase =
  process.env.PO_MIGRATION_FIXTURE_ALLOW_SHARED_DATABASE === "1";
if (!allowSharedDatabase && !databaseName.startsWith("po_migration_fixture")) {
  throw new Error(
    `Refusing to run PO migration fixtures outside a dedicated po_migration_fixture* database: ${databaseName}`,
  );
}

const backendDir = path.join(repoRoot, "packages/backend");
const npmCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function runPrismaDbPush() {
  const result = spawnSync(
    npmCommand,
    ["prisma", "db", "push", "--config", "./prisma.config.ts"],
    {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `prisma db push failed with exit code ${result.status ?? 1}`,
    );
  }
}

if (preflightOnly) {
  console.log(
    `[po-fixture] preflight ok: host=${parsedUrl.hostname} database=${databaseName} schema=${fixtureSchema}`,
  );
  process.exit(0);
}
if (prepareDb) {
  runPrismaDbPush();
}

const { prisma } = await import("../packages/backend/dist/services/db.js");
const { makePoMigrationId } =
  await import("../packages/backend/dist/migration/legacyIds.js");

const validFixture = path.join(
  repoRoot,
  "scripts/fixtures/po-migration/minimal-valid-json",
);
const invalidProjectFixture = path.join(
  repoRoot,
  "scripts/fixtures/po-migration/invalid-project-csv",
);
const parseErrorFixture = path.join(
  repoRoot,
  "scripts/fixtures/po-migration/parse-error-json",
);
const warningOnlyFixture = path.join(
  repoRoot,
  "scripts/fixtures/po-migration/warning-only-json",
);

const fixtureIds = {
  user: "po-fixture-user-alpha",
  customer: makePoMigrationId("customer", "fixture-customer-alpha"),
  vendor: makePoMigrationId("vendor", "fixture-vendor-alpha"),
  project: makePoMigrationId("project", "fixture-project-alpha"),
  task: makePoMigrationId("task", "fixture-task-alpha"),
  milestone: makePoMigrationId("milestone", "fixture-milestone-alpha"),
  estimate: makePoMigrationId("estimate", "fixture-estimate-alpha"),
  invoice: makePoMigrationId("invoice", "fixture-invoice-alpha"),
  purchaseOrder: makePoMigrationId("purchase_order", "fixture-po-alpha"),
  vendorQuote: makePoMigrationId("vendor_quote", "fixture-vendor-quote-alpha"),
  vendorInvoice: makePoMigrationId(
    "vendor_invoice",
    "fixture-vendor-invoice-alpha",
  ),
  timeEntry: makePoMigrationId("time_entry", "fixture-time-entry-alpha"),
  expense: makePoMigrationId("expense", "fixture-expense-alpha"),
};

const cliArgs = [
  "--prefix",
  "packages/backend",
  "ts-node-esm",
  "--project",
  "packages/backend/tsconfig.json",
  "scripts/migrate-po.ts",
];

function runCli(args, envOverrides = {}) {
  const result = spawnSync(npmCommand, [...cliArgs, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--no-warnings"]
        .filter(Boolean)
        .join(" "),
      TS_NODE_COMPILER_OPTIONS: '{"types":["node"]}',
      ...envOverrides,
    },
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function assert(condition, message, details = "") {
  if (!condition) {
    throw new Error(details ? `${message}\n${details}` : message);
  }
}

function extractJsonAfter(output, marker) {
  const start = output.indexOf(marker);
  assert(start >= 0, `missing marker: ${marker}`, output);
  let index = start + marker.length;
  while (output[index] && /\s/.test(output[index])) index += 1;
  assert(
    output[index] === "{" || output[index] === "[",
    `missing JSON after ${marker}`,
    output,
  );
  const opener = output[index];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < output.length; cursor += 1) {
    const ch = output[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth += 1;
    if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(output.slice(index, cursor + 1));
      }
    }
  }
  throw new Error(`unterminated JSON after ${marker}`);
}

function assertEntitySummary(summary, expectedCreated, expectedUpdated) {
  const scopes = [
    "users",
    "customers",
    "vendors",
    "projects",
    "tasks",
    "milestones",
    "estimates",
    "invoices",
    "purchase_orders",
    "vendor_quotes",
    "vendor_invoices",
    "time_entries",
    "expenses",
  ];
  for (const scope of scopes) {
    assert(
      summary[scope]?.total === 1,
      `expected ${scope}.total=1`,
      JSON.stringify(summary, null, 2),
    );
    assert(
      summary[scope]?.created === expectedCreated,
      `expected ${scope}.created=${expectedCreated}`,
      JSON.stringify(summary, null, 2),
    );
    assert(
      summary[scope]?.updated === expectedUpdated,
      `expected ${scope}.updated=${expectedUpdated}`,
      JSON.stringify(summary, null, 2),
    );
  }
}

async function cleanupFixtureRows() {
  await prisma.purchaseOrderLine.deleteMany({
    where: { purchaseOrderId: fixtureIds.purchaseOrder },
  });
  await prisma.billingLine.deleteMany({
    where: { invoiceId: fixtureIds.invoice },
  });
  await prisma.estimateLine.deleteMany({
    where: { estimateId: fixtureIds.estimate },
  });
  await prisma.vendorInvoiceLine.deleteMany({
    where: { vendorInvoiceId: fixtureIds.vendorInvoice },
  });
  await prisma.vendorInvoiceAllocation.deleteMany({
    where: { vendorInvoiceId: fixtureIds.vendorInvoice },
  });
  await prisma.timeEntry.deleteMany({ where: { id: fixtureIds.timeEntry } });
  await prisma.expense.deleteMany({ where: { id: fixtureIds.expense } });
  await prisma.purchaseOrder.deleteMany({
    where: { id: fixtureIds.purchaseOrder },
  });
  await prisma.vendorInvoice.deleteMany({
    where: { id: fixtureIds.vendorInvoice },
  });
  await prisma.vendorQuote.deleteMany({
    where: { id: fixtureIds.vendorQuote },
  });
  await prisma.invoice.deleteMany({ where: { id: fixtureIds.invoice } });
  await prisma.estimate.deleteMany({ where: { id: fixtureIds.estimate } });
  await prisma.projectMilestone.deleteMany({
    where: { id: fixtureIds.milestone },
  });
  await prisma.projectTask.deleteMany({ where: { id: fixtureIds.task } });
  await prisma.chatRoom.deleteMany({
    where: { projectId: fixtureIds.project },
  });
  await prisma.project.deleteMany({ where: { id: fixtureIds.project } });
  await prisma.customer.deleteMany({ where: { id: fixtureIds.customer } });
  await prisma.vendor.deleteMany({ where: { id: fixtureIds.vendor } });
  await prisma.userAccount.deleteMany({ where: { id: fixtureIds.user } });
}

async function countFixtureRows() {
  const [
    users,
    customers,
    vendors,
    projects,
    tasks,
    milestones,
    estimates,
    estimateLines,
    invoices,
    billingLines,
    purchaseOrders,
    purchaseOrderLines,
    vendorQuotes,
    vendorInvoices,
    timeEntries,
    expenses,
  ] = await Promise.all([
    prisma.userAccount.count({ where: { id: fixtureIds.user } }),
    prisma.customer.count({ where: { id: fixtureIds.customer } }),
    prisma.vendor.count({ where: { id: fixtureIds.vendor } }),
    prisma.project.count({ where: { id: fixtureIds.project } }),
    prisma.projectTask.count({ where: { id: fixtureIds.task } }),
    prisma.projectMilestone.count({ where: { id: fixtureIds.milestone } }),
    prisma.estimate.count({ where: { id: fixtureIds.estimate } }),
    prisma.estimateLine.count({ where: { estimateId: fixtureIds.estimate } }),
    prisma.invoice.count({ where: { id: fixtureIds.invoice } }),
    prisma.billingLine.count({ where: { invoiceId: fixtureIds.invoice } }),
    prisma.purchaseOrder.count({ where: { id: fixtureIds.purchaseOrder } }),
    prisma.purchaseOrderLine.count({
      where: { purchaseOrderId: fixtureIds.purchaseOrder },
    }),
    prisma.vendorQuote.count({ where: { id: fixtureIds.vendorQuote } }),
    prisma.vendorInvoice.count({ where: { id: fixtureIds.vendorInvoice } }),
    prisma.timeEntry.count({ where: { id: fixtureIds.timeEntry } }),
    prisma.expense.count({ where: { id: fixtureIds.expense } }),
  ]);
  return {
    users,
    customers,
    vendors,
    projects,
    tasks,
    milestones,
    estimates,
    estimateLines,
    invoices,
    billingLines,
    purchaseOrders,
    purchaseOrderLines,
    vendorQuotes,
    vendorInvoices,
    timeEntries,
    expenses,
  };
}

async function runDryRunChecks() {
  await cleanupFixtureRows();
  const before = await countFixtureRows();

  const first = runCli([`--input-dir=${validFixture}`]);
  assert(
    first.status === 0,
    "valid dry-run failed",
    `${first.stdout}\n${first.stderr}`,
  );
  assert(
    first.stdout.includes("[migration-po] done"),
    "valid dry-run did not finish",
    first.stdout,
  );
  assertEntitySummary(
    extractJsonAfter(first.stdout, "[migration-po] summary:"),
    1,
    0,
  );

  const second = runCli([`--input-dir=${validFixture}`]);
  assert(
    second.status === 0,
    "second valid dry-run failed",
    `${second.stdout}\n${second.stderr}`,
  );
  assert(
    first.stdout === second.stdout,
    "dry-run output is not deterministic between two runs",
  );

  const after = await countFixtureRows();
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    "dry-run mutated fixture-owned database rows",
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );

  const invalid = runCli([
    `--input-dir=${invalidProjectFixture}`,
    "--input-format=csv",
    "--only=projects",
  ]);
  assert(invalid.status === 1, "invalid project fixture should fail");
  assert(
    invalid.stderr.includes("startDate must be before or equal to endDate"),
    "invalid project fixture did not report expected validation error",
    invalid.stderr,
  );

  const parseError = runCli([
    `--input-dir=${parseErrorFixture}`,
    "--only=users",
  ]);
  assert(parseError.status === 1, "parse error fixture should fail");
  assert(
    parseError.stderr.includes("[migration-po] fatal:"),
    "parse error did not use fatal path",
    parseError.stderr,
  );

  // The current CLI has no non-blocking warning channel. This fixture fixes the
  // compatibility expectation that optional blank fields default silently and do
  // not become blocking errors or stderr output.
  const warningOnly = runCli([
    `--input-dir=${warningOnlyFixture}`,
    "--only=users",
  ]);
  assert(
    warningOnly.status === 0,
    "warning-only/defaulting fixture should not fail",
    `${warningOnly.stdout}\n${warningOnly.stderr}`,
  );
  assert(
    warningOnly.stderr.trim() === "",
    "warning-only/defaulting fixture should not emit stderr",
    warningOnly.stderr,
  );
  const warningSummary = extractJsonAfter(
    warningOnly.stdout,
    "[migration-po] summary:",
  );
  assert(
    warningSummary.users?.total === 1,
    "warning-only/defaulting fixture should include one user",
    warningOnly.stdout,
  );

  await cleanupFixtureRows();
  console.log("[po-fixture] dry-run checks passed");
}

async function runApplyChecks() {
  await cleanupFixtureRows();

  const first = runCli([`--input-dir=${validFixture}`, "--apply"], {
    MIGRATION_CONFIRM: "1",
  });
  assert(
    first.status === 0,
    "valid apply failed",
    `${first.stdout}\n${first.stderr}`,
  );
  assert(
    first.stdout.includes("[migration-po] integrity ok"),
    "apply did not run integrity checks",
    first.stdout,
  );
  assertEntitySummary(
    extractJsonAfter(first.stdout, "[migration-po] summary:"),
    1,
    0,
  );

  const counts = await countFixtureRows();
  for (const [scope, count] of Object.entries(counts)) {
    assert(
      count === 1,
      `expected applied fixture count for ${scope}=1`,
      JSON.stringify(counts, null, 2),
    );
  }

  const second = runCli([`--input-dir=${validFixture}`, "--apply"], {
    MIGRATION_CONFIRM: "1",
  });
  assert(
    second.status === 0,
    "second valid apply failed",
    `${second.stdout}\n${second.stderr}`,
  );
  assert(
    second.stdout.includes("[migration-po] integrity ok"),
    "second apply did not run integrity checks",
    second.stdout,
  );
  assertEntitySummary(
    extractJsonAfter(second.stdout, "[migration-po] summary:"),
    0,
    1,
  );

  const afterSecond = await countFixtureRows();
  assert(
    JSON.stringify(afterSecond) === JSON.stringify(counts),
    "rerun changed fixture-owned row counts",
    `before=${JSON.stringify(counts)} after=${JSON.stringify(afterSecond)}`,
  );

  const invalid = runCli(
    [
      `--input-dir=${invalidProjectFixture}`,
      "--input-format=csv",
      "--only=projects",
      "--apply",
    ],
    { MIGRATION_CONFIRM: "1" },
  );
  assert(invalid.status === 1, "invalid apply fixture should fail");
  assert(
    invalid.stderr.includes("startDate must be before or equal to endDate"),
    "invalid apply fixture did not report expected validation error",
    invalid.stderr,
  );

  await cleanupFixtureRows();
  console.log("[po-fixture] apply checks passed");
}

try {
  if (mode === "dry-run" || mode === "all") {
    await runDryRunChecks();
  }
  if (mode === "apply" || mode === "all") {
    await runApplyChecks();
  }
} finally {
  await prisma.$disconnect();
}
