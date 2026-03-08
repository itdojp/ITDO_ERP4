#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_FILE = path.join(
  ROOT_DIR,
  "docs/ops/backup-s3-decision-checklist.md",
);

function parseArgs(argv) {
  const options = {
    file: DEFAULT_FILE,
    format: "text",
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--file=")) {
      options.file = path.resolve(process.cwd(), arg.slice("--file=".length));
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error(`--format must be text|json (got: ${options.format})`);
  }

  return options;
}

function normalizeFieldName(raw) {
  return raw.trim();
}

function normalizeValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseChecklist(markdown) {
  const fields = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    fields.set(normalizeFieldName(match[1]), normalizeValue(match[2]));
  }
  return fields;
}

function isPositiveInteger(value) {
  return /^[1-9][0-9]*$/.test(value);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isPlaceholder(value) {
  const normalized = value.trim();
  if (!normalized || normalized === "-") {
    return true;
  }

  const placeholders = new Set([
    "YYYY-MM-DD",
    "prod|staging",
    "<name>",
    "<name1>, <name2>",
    "SSE-KMS|SSE-S3",
    "Enabled|Suspended",
    "enabled|disabled",
    "VPC endpoint|IP allowlist|none",
    "pass|warn|fail",
    "summary-line|legacy-log-scan",
    "yes|no",
    "docs/test-results/YYYY-MM-DD-backup-s3-readiness-rN.md",
  ]);

  if (placeholders.has(normalized)) {
    return true;
  }

  if (/\.\.\./.test(normalized)) {
    return true;
  }

  if (/^<.*>$/.test(normalized)) {
    return true;
  }

  return false;
}

function validateChecklist(fields) {
  const issues = [];
  const get = (name) => fields.get(name) ?? "";
  const requireValue = (name, options = {}) => {
    const value = get(name);
    if (options.allowValues?.includes(value)) {
      return value;
    }
    if (isPlaceholder(value)) {
      issues.push({ field: name, reason: "placeholder_or_empty", value });
    }
    return value;
  };

  const decisionDate = requireValue("decisionDate");
  if (
    decisionDate &&
    !isPlaceholder(decisionDate) &&
    !isCalendarDate(decisionDate)
  ) {
    issues.push({
      field: "decisionDate",
      reason: "invalid_date",
      value: decisionDate,
    });
  }

  const environment = requireValue("environment");
  if (
    environment &&
    !isPlaceholder(environment) &&
    !["prod", "staging"].includes(environment)
  ) {
    issues.push({
      field: "environment",
      reason: "invalid_enum",
      value: environment,
    });
  }

  requireValue("owner");
  requireValue("reviewers");

  const relatedIssue = requireValue("relatedIssue");
  if (
    relatedIssue &&
    !isPlaceholder(relatedIssue) &&
    !/^#\d+$/.test(relatedIssue)
  ) {
    issues.push({
      field: "relatedIssue",
      reason: "invalid_issue_ref",
      value: relatedIssue,
    });
  }

  const bucketName = requireValue("bucketName");
  if (
    bucketName &&
    !isPlaceholder(bucketName) &&
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)
  ) {
    issues.push({
      field: "bucketName",
      reason: "invalid_bucket_name",
      value: bucketName,
    });
  }

  requireValue("AWS account / project");

  const region = requireValue("region");
  if (
    region &&
    !isPlaceholder(region) &&
    !/^[a-z]{2}-[a-z0-9-]+-\d+$/.test(region)
  ) {
    issues.push({ field: "region", reason: "invalid_region", value: region });
  }

  requireValue("s3Prefix");

  const encryptionMode = requireValue("encryptionMode");
  if (
    encryptionMode &&
    !isPlaceholder(encryptionMode) &&
    !["SSE-KMS", "SSE-S3"].includes(encryptionMode)
  ) {
    issues.push({
      field: "encryptionMode",
      reason: "invalid_enum",
      value: encryptionMode,
    });
  }

  const kmsOptional =
    encryptionMode &&
    !isPlaceholder(encryptionMode) &&
    encryptionMode === "SSE-S3";
  const requireKmsField = (name) => {
    const value = get(name);
    if (kmsOptional && ["", "N/A", "n/a", "-"].includes(value.trim())) {
      return value;
    }
    if (isPlaceholder(value)) {
      issues.push({ field: name, reason: "placeholder_or_empty", value });
    }
    return value;
  };

  requireKmsField("kmsKeyIdOrAlias");
  requireKmsField("kmsKeyAdmin");
  requireKmsField("kmsKeyUsagePrincipals");

  const versioning = requireValue("versioning");
  if (
    versioning &&
    !isPlaceholder(versioning) &&
    !["Enabled", "Suspended"].includes(versioning)
  ) {
    issues.push({
      field: "versioning",
      reason: "invalid_enum",
      value: versioning,
    });
  }

  for (const field of [
    "lifecycleDailyDays",
    "lifecycleWeeklyWeeks",
    "lifecycleMonthlyMonths",
  ]) {
    const value = requireValue(field);
    if (value && !isPlaceholder(value) && !isPositiveInteger(value)) {
      issues.push({ field, reason: "invalid_positive_integer", value });
    }
  }

  requireValue("replication / secondary copy");

  const publicAccessBlock = requireValue("publicAccessBlock");
  if (
    publicAccessBlock &&
    !isPlaceholder(publicAccessBlock) &&
    !["enabled", "disabled"].includes(publicAccessBlock)
  ) {
    issues.push({
      field: "publicAccessBlock",
      reason: "invalid_enum",
      value: publicAccessBlock,
    });
  }

  requireValue("writeRoleArn");
  requireValue("readRoleArn");
  requireValue("restoreRoleArn");
  requireValue("CI / automation principal");

  const networkBoundary = requireValue("allowedNetworkBoundary");
  if (
    networkBoundary &&
    !isPlaceholder(networkBoundary) &&
    !["VPC endpoint", "IP allowlist", "none"].includes(networkBoundary)
  ) {
    issues.push({
      field: "allowedNetworkBoundary",
      reason: "invalid_enum",
      value: networkBoundary,
    });
  }

  requireValue("bucketPolicyNotes");
  requireValue("restoreApprover");
  requireValue("restoreExecutor");
  requireValue("auditLogLocation");
  requireValue("incidentEscalation");

  return {
    status: issues.length === 0 ? "pass" : "fail",
    checkedFieldCount: fields.size,
    issueCount: issues.length,
    issues,
  };
}

function printText(result, filePath) {
  console.log(
    `[backup-s3-decision-check] file: ${path.relative(process.cwd(), filePath)}`,
  );
  console.log(`[backup-s3-decision-check] status: ${result.status}`);
  console.log(
    `[backup-s3-decision-check] checkedFieldCount: ${result.checkedFieldCount}`,
  );
  console.log(`[backup-s3-decision-check] issueCount: ${result.issueCount}`);
  for (const issue of result.issues) {
    console.log(
      `[backup-s3-decision-check][ERROR] field=${issue.field} reason=${issue.reason} value=${JSON.stringify(issue.value)}`,
    );
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/check-backup-s3-decision-checklist.mjs [--file=docs/ops/backup-s3-decision-checklist.md] [--format=text|json]",
      );
      process.exit(0);
    }

    const markdown = fs.readFileSync(options.file, "utf8");
    const result = validateChecklist(parseChecklist(markdown));

    if (options.format === "json") {
      console.log(JSON.stringify({ file: options.file, ...result }, null, 2));
    } else {
      printText(result, options.file);
    }

    process.exit(result.status === "pass" ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backup-s3-decision-check][ERROR] ${message}`);
    process.exit(2);
  }
}

await main();
