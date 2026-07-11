import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const scriptPath = path.join(rootDir, "scripts", "data-quality-check.mjs");
const validFixture = path.join(
  rootDir,
  "scripts",
  "fixtures",
  "data-quality-valid.json",
);
const invalidFixture = path.join(
  rootDir,
  "scripts",
  "fixtures",
  "data-quality-invalid.json",
);
const advisoryFixture = path.join(
  rootDir,
  "scripts",
  "fixtures",
  "data-quality-advisory-warning.json",
);

function makeTempDir() {
  fs.mkdirSync(path.join(rootDir, "tmp"), { recursive: true });
  return fs.mkdtempSync(path.join(rootDir, "tmp", "data-quality-test-"));
}

function runDataQuality(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function failingCheckNames(report) {
  return new Set(
    report.checks
      .filter((check) => check.status === "fail" || check.status === "warning")
      .map((check) => check.name),
  );
}

test("blocking mode passes with the clean fixture and writes a report", () => {
  const tempDir = makeTempDir();
  try {
    const output = path.join(tempDir, "blocking.json");
    const summary = path.join(tempDir, "blocking.md");
    const result = runDataQuality([
      "--mode",
      "blocking",
      "--fixture",
      validFixture,
      "--output",
      output,
      "--summary",
      summary,
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = readJson(output);
    assert.equal(report.status, "pass");
    assert.equal(report.summary.blockingFindings, 0);
    assert.equal(report.summary.advisoryFindings, 0);
    assert.ok(report.checks.length > 0);
    assert.match(
      fs.readFileSync(summary, "utf8"),
      /Blocking data-quality checks/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("blocking mode fails with deterministic invalid fixture violations", () => {
  const tempDir = makeTempDir();
  try {
    const output = path.join(tempDir, "blocking-invalid.json");
    const summary = path.join(tempDir, "blocking-invalid.md");
    const result = runDataQuality([
      "--mode",
      "blocking",
      "--fixture",
      invalidFixture,
      "--output",
      output,
      "--summary",
      summary,
    ]);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = readJson(output);
    assert.equal(report.status, "fail");
    assert.ok(report.summary.blockingFindings > 0);
    const names = failingCheckNames(report);
    for (const expected of [
      "required_id_missing",
      "required_code_missing",
      "duplicate_project_code",
      "duplicate_customer_code",
      "duplicate_vendor_code",
      "orphan_time_entry_project",
      "orphan_billing_line_invoice",
      "orphan_accounting_journal_event",
      "invoice_currency_missing",
      "billing_tax_rate_missing",
      "invoice_header_line_total_mismatch",
      "accounting_event_source_key_duplicate",
      "accounting_journal_ready_missing_side",
      "accounting_journal_ready_export_field_missing",
      "accounting_journal_debit_credit_mismatch",
      "statutory_accounting_import_count_mismatch",
    ]) {
      assert.ok(
        names.has(expected),
        `missing expected failing check ${expected}`,
      );
    }
    assert.match(fs.readFileSync(summary, "utf8"), /reproduction|Reproduce/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("advisory mode records warnings but exits successfully", () => {
  const tempDir = makeTempDir();
  try {
    const output = path.join(tempDir, "advisory.json");
    const summary = path.join(tempDir, "advisory.md");
    const result = runDataQuality([
      "--mode",
      "advisory",
      "--fixture",
      advisoryFixture,
      "--output",
      output,
      "--summary",
      summary,
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = readJson(output);
    assert.equal(report.status, "warning");
    assert.equal(report.summary.blockingFindings, 0);
    assert.ok(report.summary.advisoryFindings > 0);
    const names = failingCheckNames(report);
    assert.ok(names.has("time_entries_daily_over_1440"));
    assert.ok(names.has("invoice_number_format_invalid"));
    assert.ok(names.has("purchase_order_number_format_invalid"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("help prints usage without requiring a fixture", () => {
  const result = runDataQuality(["--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage: node scripts\/data-quality-check\.mjs/);
});

test("missing fixture path is treated as a runner/configuration error", () => {
  const result = runDataQuality([
    "--mode",
    "blocking",
    "--fixture",
    path.join(rootDir, "scripts", "fixtures", "does-not-exist.json"),
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /ENOENT|no such file/i);
});
