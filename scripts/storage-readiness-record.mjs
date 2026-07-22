#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const COMPONENTS = [
  "app_gdrive_chat",
  "app_gdrive_pdf",
  "app_gdrive_evidence",
  "app_gdrive_report",
  "backup_local",
  "backup_sakura_primary",
  "backup_gdrive_secondary",
  "restore_evidence",
];
const STATUSES = new Set(["pass", "warn", "fail", "unknown", "not_configured"]);
const METRICS = new Set([
  "folderAccessible",
  "permissionEntries",
  "writeProbe",
  "quota",
  "usagePercent",
  "latestGeneratedAt",
  "retentionCandidates",
  "hourlyGenerations",
  "hourlyMinimum",
  "hourlyOldestGeneratedAt",
  "hourlyLatestGeneratedAt",
  "dailyGenerations",
  "dailyMinimum",
  "dailyOldestGeneratedAt",
  "dailyLatestGeneratedAt",
  "weeklyGenerations",
  "weeklyMinimum",
  "weeklyOldestGeneratedAt",
  "weeklyLatestGeneratedAt",
  "monthlyGenerations",
  "monthlyMinimum",
  "monthlyOldestGeneratedAt",
  "monthlyLatestGeneratedAt",
  "completedAt",
]);
const REASON =
  /^(provider_not_configured|drive_(auth_expired|forbidden|not_found|quota|retryable|permanent|timeout|configuration_invalid|folder_unavailable|quota_unknown|quota_warning|quota_critical)|backup_(auth_expired|forbidden|not_found|quota|retryable|permanent|timeout|configuration_invalid|inventory_unavailable|latest_missing_or_invalid|time_future|freshness_exceeded|checksum_mismatch|duplicate_object|generation_incomplete|invalid_manifest|orphan_pair|zero_size|partial_failure)|retention_(hourly|daily|weekly|monthly)_insufficient|restore_(evidence_not_configured|configuration_invalid|evidence_invalid|evidence_unreadable|time_invalid|time_future|freshness_exceeded|result_not_pass|environment_mismatch|backup_id_mismatch))$/;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMIT_SHA = /^[a-f0-9]{40,64}$/;
const ARGUMENTS = new Set([
  "input",
  "output",
  "basis",
  "commit-sha",
  "environment",
]);

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseArgs(argv) {
  const options = {};
  if (argv.length % 2 !== 0) throw new Error("arguments_invalid");
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("arguments_invalid");
    const name = key.slice(2);
    if (!ARGUMENTS.has(name) || Object.hasOwn(options, name)) {
      throw new Error("arguments_invalid");
    }
    options[name] = value;
  }
  if (
    !options.input ||
    !options.output ||
    !options.basis ||
    !options["commit-sha"] ||
    !options.environment
  ) {
    throw new Error("input_output_basis_commit_environment_required");
  }
  if (!["repo-side", "target-environment"].includes(options.basis)) {
    throw new Error("basis_invalid");
  }
  if (
    !COMMIT_SHA.test(options["commit-sha"]) ||
    !SAFE_LABEL.test(options.environment)
  ) {
    throw new Error("commit_or_environment_invalid");
  }
  return options;
}

function validMetric(key, value) {
  if (key === "folderAccessible") return typeof value === "boolean";
  if (key === "writeProbe") {
    return ["not_requested", "trashed"].includes(value);
  }
  if (key === "quota") return ["available", "unknown"].includes(value);
  if (key.endsWith("GeneratedAt") || key === "completedAt") {
    if (value === null) return true;
    if (typeof value !== "string") return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }
  if (key === "usagePercent") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      Number.isSafeInteger(value * 100)
    );
  }
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
  );
}

function canonicalUtc(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function expectedOverall(components) {
  let status = "pass";
  if (components.some((component) => component.status === "fail")) {
    status = "fail";
  } else if (components.some((component) => component.status === "unknown")) {
    status = "unknown";
  } else if (
    components.some((component) => component.status === "not_configured")
  ) {
    status = components.every(
      (component) => component.status === "not_configured",
    )
      ? "not_configured"
      : "unknown";
  } else if (components.some((component) => component.status === "warn")) {
    status = "warn";
  }
  const exitCode =
    status === "pass" ? 0 : status === "warn" ? 1 : status === "fail" ? 2 : 3;
  const primary = components.find(
    (component) => component.component === "backup_sakura_primary",
  );
  const secondary = components.find(
    (component) => component.component === "backup_gdrive_secondary",
  );
  const reasons =
    primary &&
    secondary &&
    (primary.status === "pass") !== (secondary.status === "pass")
      ? ["backup_partial_failure"]
      : [];
  return { exitCode, reasons, status };
}

function expectedComponentStatus(reasons) {
  if (reasons.length === 0) return "pass";
  const statuses = reasons.map((reason) => {
    if (
      reason === "provider_not_configured" ||
      reason === "restore_evidence_not_configured"
    ) {
      return "not_configured";
    }
    if (reason === "drive_quota_warning") return "warn";
    if (
      /^(drive|backup)_(quota|retryable|timeout)$/.test(reason) ||
      reason === "drive_quota_unknown"
    ) {
      return "unknown";
    }
    return "fail";
  });
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("unknown")) return "unknown";
  if (statuses.includes("warn")) return "warn";
  return "not_configured";
}

export function validateSanitizedReport(report) {
  if (
    !hasOnlyKeys(report, [
      "schemaVersion",
      "event",
      "generatedAt",
      "mode",
      "overall",
      "components",
    ]) ||
    !hasOnlyKeys(report?.overall, ["status", "exitCode", "reasons"]) ||
    report?.schemaVersion !== "erp4.storage.readiness.v1" ||
    report?.event !== "erp4.storage_readiness" ||
    !canonicalUtc(report.generatedAt) ||
    !["read", "write_probe"].includes(report.mode) ||
    !STATUSES.has(report.overall?.status) ||
    ![0, 1, 2, 3].includes(report.overall?.exitCode) ||
    !Array.isArray(report.overall?.reasons) ||
    !Array.isArray(report.components) ||
    report.components.length !== COMPONENTS.length
  ) {
    throw new Error("report_schema_invalid");
  }
  if (!report.overall.reasons.every((reason) => REASON.test(reason))) {
    throw new Error("report_reason_invalid");
  }
  const names = report.components.map((component) => component?.component);
  if (JSON.stringify(names) !== JSON.stringify(COMPONENTS)) {
    throw new Error("report_components_invalid");
  }
  for (const component of report.components) {
    if (
      !hasOnlyKeys(component, ["component", "status", "reasons", "metrics"]) ||
      !STATUSES.has(component.status) ||
      !Array.isArray(component.reasons) ||
      !component.reasons.every((reason) => REASON.test(reason)) ||
      component.status !== expectedComponentStatus(component.reasons) ||
      !component.metrics ||
      typeof component.metrics !== "object" ||
      Array.isArray(component.metrics)
    ) {
      throw new Error("report_component_invalid");
    }
    for (const [key, value] of Object.entries(component.metrics)) {
      if (!METRICS.has(key) || !validMetric(key, value)) {
        throw new Error("report_metric_invalid");
      }
    }
  }
  const expected = expectedOverall(report.components);
  if (
    report.overall.status !== expected.status ||
    report.overall.exitCode !== expected.exitCode ||
    JSON.stringify(report.overall.reasons) !== JSON.stringify(expected.reasons)
  ) {
    throw new Error("report_overall_invalid");
  }
  return report;
}

function safe(value) {
  return String(value).replace(/[`|\r\n]/g, "_");
}

export function renderRecord(report, basis, commitSha, environment) {
  const lines = [
    "# ERP4 storage readiness 記録",
    "",
    `- evidenceBasis: \`${basis}\``,
    `- commitSha: \`${commitSha}\``,
    `- environmentLabel: \`${environment}\``,
    `- generatedAt: \`${report.generatedAt}\``,
    `- mode: \`${report.mode}\``,
    `- overallStatus: \`${report.overall.status}\``,
    `- exitCode: \`${report.overall.exitCode}\``,
    `- overallReasons: ${report.overall.reasons.map((reason) => `\`${reason}\``).join(", ") || "-"}`,
    "",
    "| Component | Status | Reasons | Metrics |",
    "| --- | --- | --- | --- |",
  ];
  for (const component of report.components) {
    const metrics = Object.entries(component.metrics)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${safe(value)}`)
      .join(", ");
    lines.push(
      `| ${component.component} | ${component.status} | ${component.reasons.join(", ") || "-"} | ${metrics || "-"} |`,
    );
  }
  lines.push(
    "",
    "## 判定と再開条件",
    "",
    report.overall.status === "pass"
      ? "- 定期timerと次回restore演習期限を継続監視する。"
      : "- private provider logとowner-only入力を確認し、原因を解消後に `make storage-readiness` を再実行する。",
    "",
    "## 証跡境界",
    "",
    basis === "target-environment"
      ? "- target environmentの直接check結果。実identifierとraw logはprivate保管し、本記録には含めない。"
      : "- fake/synthetic fixtureによるrepo-side検証であり、実provider成功を示さない。",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = validateSanitizedReport(
    JSON.parse(await readFile(options.input, "utf8")),
  );
  await writeFile(
    options.output,
    `${renderRecord(
      report,
      options.basis,
      options["commit-sha"],
      options.environment,
    )}\n`,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  console.log(`[storage-readiness-record] wrote: ${options.output}`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(
      `[storage-readiness-record][error] ${error instanceof Error ? error.message : "unknown_error"}`,
    );
    process.exitCode = 1;
  });
}
