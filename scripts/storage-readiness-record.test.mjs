import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  renderRecord,
  validateSanitizedReport,
} from "./storage-readiness-record.mjs";

const root = path.resolve(import.meta.dirname, "..");

function report() {
  const components = [
    "app_gdrive_chat",
    "app_gdrive_pdf",
    "app_gdrive_evidence",
    "app_gdrive_report",
    "backup_local",
    "backup_sakura_primary",
    "backup_gdrive_secondary",
    "restore_evidence",
  ].map((component) => ({
    component,
    status: "pass",
    reasons: [],
    metrics: {},
  }));
  components[0].metrics = {
    folderAccessible: true,
    permissionEntries: 1,
    quota: "available",
    usagePercent: 10,
    writeProbe: "not_requested",
  };
  return {
    schemaVersion: "erp4.storage.readiness.v1",
    event: "erp4.storage_readiness",
    generatedAt: "2026-07-22T10:00:00.000Z",
    mode: "read",
    overall: { status: "pass", exitCode: 0, reasons: [] },
    components,
  };
}

test("recorder accepts only allowlisted sanitized fields", () => {
  const input = report();
  assert.equal(validateSanitizedReport(input), input);
  assert.match(
    renderRecord(input, "repo-side", "a".repeat(40), "repo-side"),
    /fake\/synthetic fixture/,
  );
  assert.match(
    renderRecord(input, "repo-side", "a".repeat(40), "repo-side"),
    /overallReasons: -/,
  );
  const unsafe = structuredClone(input);
  unsafe.components[0].metrics.folderId = "identifier-placeholder";
  assert.throws(() => validateSanitizedReport(unsafe), /report_metric_invalid/);
  const unsafeReason = structuredClone(input);
  unsafeReason.components[0].reasons = ["private-value-placeholder"];
  assert.throws(
    () => validateSanitizedReport(unsafeReason),
    /report_component_invalid/,
  );
  const extraTopLevel = structuredClone(input);
  extraTopLevel.privateDetail = "not-allowlisted";
  assert.throws(
    () => validateSanitizedReport(extraTopLevel),
    /report_schema_invalid/,
  );
  const extraComponent = structuredClone(input);
  extraComponent.components[0].providerIdentifier = "not-allowlisted";
  assert.throws(
    () => validateSanitizedReport(extraComponent),
    /report_component_invalid/,
  );
  const inconsistent = structuredClone(input);
  inconsistent.components[0].status = "fail";
  assert.throws(
    () => validateSanitizedReport(inconsistent),
    /report_component_invalid/,
  );
  const partial = structuredClone(input);
  partial.components.find(
    (component) => component.component === "backup_sakura_primary",
  ).status = "fail";
  partial.components.find(
    (component) => component.component === "backup_sakura_primary",
  ).reasons = ["backup_permanent"];
  partial.overall = {
    status: "fail",
    exitCode: 2,
    reasons: ["backup_partial_failure"],
  };
  assert.match(
    renderRecord(
      validateSanitizedReport(partial),
      "repo-side",
      "a".repeat(40),
      "repo-side",
    ),
    /overallReasons: `backup_partial_failure`/,
  );
  const nonCanonicalTime = structuredClone(input);
  nonCanonicalTime.generatedAt = "2026-07-22T10:00:00Z";
  assert.throws(
    () => validateSanitizedReport(nonCanonicalTime),
    /report_schema_invalid/,
  );
});

test("recorder CLI writes once and refuses overwrite", async () => {
  const scratchRoot = path.join(root, ".codex-local", "tmp");
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, "record-test-"));
  const input = path.join(scratch, "input.json");
  const output = path.join(scratch, "output.md");
  try {
    await writeFile(input, `${JSON.stringify(report())}\n`, { mode: 0o600 });
    const args = [
      "scripts/storage-readiness-record.mjs",
      "--input",
      input,
      "--output",
      output,
      "--basis",
      "target-environment",
      "--commit-sha",
      "a".repeat(40),
      "--environment",
      "trial-a",
    ];
    const first = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    const recorded = await readFile(output, "utf8");
    assert.match(recorded, /target environmentの直接check結果/);
    assert.match(recorded, /commitSha: `a{40}`/);
    assert.match(recorded, /environmentLabel: `trial-a`/);
    const second = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /EEXIST|exist/);
    const unknown = spawnSync(
      process.execPath,
      [...args, "--unknown-option", "value"],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /arguments_invalid/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
