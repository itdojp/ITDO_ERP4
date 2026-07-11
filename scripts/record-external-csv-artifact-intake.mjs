#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REQUIRED_ARTIFACTS = [
  {
    id: "rakuda_employee_master_template",
    label: "給与らくだ 社員台帳 CSV テンプレート原本",
    sourceTypes: ["actual_template"],
    requiresCsvMetadata: true,
  },
  {
    id: "rakuda_attendance_import_template",
    label: "給与らくだ 勤怠集計 CSV テンプレート原本",
    sourceTypes: ["actual_template"],
    requiresCsvMetadata: true,
  },
  {
    id: "rakuda_report_output_sample",
    label: "給与らくだ 出力帳票 CSV/Excel サンプル",
    sourceTypes: ["actual_report_sample", "masked_actual_sample"],
    requiresCsvMetadata: true,
    requiresSampleRows: true,
  },
  {
    id: "ics_journal_import_template",
    label: "経理上手くんα 仕訳取込 CSV テンプレート原本",
    sourceTypes: ["actual_template"],
    requiresCsvMetadata: true,
  },
  {
    id: "ics_journal_imported_masked_sample",
    label: "経理上手くんα 実際の取込済みマスキング済み sample CSV",
    sourceTypes: ["masked_imported_sample", "masked_actual_sample"],
    requiresCsvMetadata: true,
    requiresSampleRows: true,
  },
  {
    id: "import_rules_material",
    label: "文字数制限 / コード体系 / 再取込条件が分かる運用資料",
    sourceTypes: ["operation_rule_material"],
    requiresRuleTopics: ["fieldLengths", "codeSets", "reimportRules"],
  },
];
const REQUIRED_IDS = new Set(REQUIRED_ARTIFACTS.map((artifact) => artifact.id));

function usage() {
  console.log(`Usage:
  INTAKE_STATUS=pass OPERATOR=alice MANIFEST_FILE=docs/requirements/external-csv-artifact-intake-manifest.json \\
    node scripts/record-external-csv-artifact-intake.mjs

Optional env:
  OUT_DIR=...               default: docs/test-results
  DATE_STAMP=YYYY-MM-DD     default: today
  RUN_LABEL=r1|csv-intake   default: auto-increment rN
  INTAKE_STATUS=pass|blocked|failed
  OPERATOR=...
  MANIFEST_FILE=...
  NOTES='free-form notes'

Validation:
- pass requires all required #1432 artifacts to be received actual artifacts, not canonical samples.
- pass rejects any canonical_sample in the manifest, including non-required artifact IDs.
- pass requires masking approval and per-artifact masking/sensitivity status.
- artifact is non-sensitive only if BOTH containsSensitiveData === false AND containsPersonalData === false.
- CSV/sample artifacts require encoding/newline/delimiter/date/number metadata and columns.
- data/report samples require sampleRows > 0.
- operation rule materials require fieldLengths, codeSets, and reimportRules topics.
- repoPath files must exist and be non-empty; external-only artifacts require a storage reference and sha256.
- Existing output files are never overwritten.`);
}

function die(message) {
  console.error(`[external-csv-artifact-intake][ERROR] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[external-csv-artifact-intake] ${message}`);
}

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function normalizeToAbsolute(input) {
  if (!input) return "";
  return path.isAbsolute(input) ? input : path.join(ROOT_DIR, input);
}

function formatSourcePath(input) {
  if (!input) return "not_provided";
  const absolute = normalizeToAbsolute(input);
  const relative = path.relative(ROOT_DIR, absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return input;
}

function validateDateStamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    die(`DATE_STAMP must be YYYY-MM-DD: ${value}`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    die(`DATE_STAMP is not a valid calendar date: ${value}`);
  }
}

function validateRunLabel(value) {
  if (!value) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    die("RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$");
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function requiredString(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-") return false;
  if (["TBD", "TODO", "YYYY-MM-DD"].includes(trimmed)) return false;
  if (trimmed.includes("<") || trimmed.includes(">") || trimmed.includes("..."))
    return false;
  if (trimmed.includes("YYYY-MM-DD")) return false;
  return true;
}

function hasSha256(value) {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value.trim());
}

function readManifest(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    die(
      `MANIFEST_FILE is not valid JSON: ${formatSourcePath(filePath)} (${error.message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    die("MANIFEST_FILE root must be a JSON object");
  }
  if (!Array.isArray(parsed.artifacts)) {
    die("MANIFEST_FILE must contain artifacts[]");
  }
  return parsed;
}

function artifactLocationIsValid(artifact) {
  if (requiredString(artifact.repoPath)) {
    const absolute = normalizeToAbsolute(artifact.repoPath);
    if (!existsSync(absolute))
      return { ok: false, reason: `repoPath not found: ${artifact.repoPath}` };
    if (!statSync(absolute).isFile())
      return {
        ok: false,
        reason: `repoPath is not a file: ${artifact.repoPath}`,
      };
    if (statSync(absolute).size === 0)
      return { ok: false, reason: `repoPath is empty: ${artifact.repoPath}` };
    return { ok: true, location: formatSourcePath(artifact.repoPath) };
  }
  if (
    requiredString(artifact.externalStorageRef) &&
    hasSha256(artifact.checksumSha256)
  ) {
    return { ok: true, location: artifact.externalStorageRef };
  }
  return {
    ok: false,
    reason: "repoPath or externalStorageRef + checksumSha256 is required",
  };
}

function artifactMaskingIsValid(manifest, artifact) {
  if (manifest.maskingPolicy?.approved !== true) {
    return { ok: false, reason: "maskingPolicy.approved must be true" };
  }
  if (
    !requiredString(manifest.maskingPolicy?.approvedBy) ||
    !requiredString(manifest.maskingPolicy?.approvedAt)
  ) {
    return {
      ok: false,
      reason: "maskingPolicy approvedBy/approvedAt are required",
    };
  }
  const maskingStatus = String(artifact.maskingStatus ?? "").toLowerCase();
  if (maskingStatus === "masked" || maskingStatus === "not_required") {
    return { ok: true };
  }
  if (
    artifact.containsSensitiveData === false &&
    artifact.containsPersonalData === false
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "artifact must be masked, not_required, or explicitly non-sensitive",
  };
}

function validateCsvMetadata(artifact) {
  const errors = [];
  for (const field of [
    "encoding",
    "newline",
    "delimiter",
    "dateFormat",
    "numberFormat",
  ]) {
    if (!requiredString(artifact[field])) errors.push(`${field} is required`);
  }
  if (!Array.isArray(artifact.columns) || artifact.columns.length === 0) {
    errors.push("columns[] is required");
  } else {
    artifact.columns.forEach((column, index) => {
      if (!requiredString(column?.name))
        errors.push(`columns[${index}].name is required`);
      if (typeof column?.required !== "boolean")
        errors.push(`columns[${index}].required must be boolean`);
    });
  }
  return errors;
}

function validateRuleTopics(artifact, requiredTopics) {
  const topics = new Set(
    Array.isArray(artifact.ruleTopics) ? artifact.ruleTopics : [],
  );
  return requiredTopics
    .filter((topic) => !topics.has(topic))
    .map((topic) => `ruleTopics must include ${topic}`);
}

function validateArtifact(manifest, required, artifact) {
  const errors = [];
  if (!artifact) {
    return [`missing required artifact: ${required.id}`];
  }
  if (artifact.status !== "received") errors.push("status must be received");
  if (!required.sourceTypes.includes(artifact.sourceType)) {
    errors.push(`sourceType must be one of ${required.sourceTypes.join(", ")}`);
  }
  if (
    artifact.sourceType === "canonical_sample" ||
    artifact.headerOnly === true
  ) {
    errors.push(
      "canonical_sample/headerOnly artifacts do not satisfy #1432 completion",
    );
  }
  const location = artifactLocationIsValid(artifact);
  if (!location.ok) errors.push(location.reason);
  const masking = artifactMaskingIsValid(manifest, artifact);
  if (!masking.ok) errors.push(masking.reason);
  if (!requiredString(artifact.product)) errors.push("product is required");
  if (!requiredString(artifact.description))
    errors.push("description is required");
  if (required.requiresCsvMetadata)
    errors.push(...validateCsvMetadata(artifact));
  if (
    required.requiresSampleRows &&
    !(Number.isInteger(artifact.sampleRows) && artifact.sampleRows > 0)
  ) {
    errors.push("sampleRows must be a positive integer");
  }
  if (required.requiresRuleTopics)
    errors.push(...validateRuleTopics(artifact, required.requiresRuleTopics));
  return errors;
}

function validateManifest(manifest) {
  const byId = new Map();
  const duplicateIds = [];
  for (const artifact of manifest.artifacts) {
    if (!requiredString(artifact?.id)) continue;
    if (byId.has(artifact.id)) duplicateIds.push(artifact.id);
    byId.set(artifact.id, artifact);
  }

  const invalid = [];
  if (duplicateIds.length > 0)
    invalid.push({
      id: "manifest",
      errors: [`duplicate artifact ids: ${duplicateIds.join(", ")}`],
    });
  if (!requiredString(manifest.collectionDate))
    invalid.push({ id: "manifest", errors: ["collectionDate is required"] });
  if (!requiredString(manifest.collector))
    invalid.push({ id: "manifest", errors: ["collector is required"] });

  for (const required of REQUIRED_ARTIFACTS) {
    const errors = validateArtifact(manifest, required, byId.get(required.id));
    if (errors.length > 0) invalid.push({ id: required.id, errors });
  }

  const extraCanonical = manifest.artifacts
    .filter(
      (artifact) =>
        !REQUIRED_IDS.has(artifact.id) &&
        artifact.sourceType === "canonical_sample",
    )
    .map((artifact) => artifact.id);
  return { byId, invalid, extraCanonical };
}

function getGitValue(args, fallback = "unknown") {
  try {
    return (
      execFileSync("git", ["-C", ROOT_DIR, ...args], {
        encoding: "utf8",
      }).trim() || fallback
    );
  } catch {
    return fallback;
  }
}

function resolveOutputFile(outDir, dateStamp, runLabel) {
  if (runLabel) {
    const outputFile = path.join(
      outDir,
      `${dateStamp}-external-csv-artifact-intake-${runLabel}.md`,
    );
    if (existsSync(outputFile))
      die(`output file already exists: ${formatSourcePath(outputFile)}`);
    return outputFile;
  }
  for (let n = 1; ; n += 1) {
    const outputFile = path.join(
      outDir,
      `${dateStamp}-external-csv-artifact-intake-r${n}.md`,
    );
    if (!existsSync(outputFile)) return outputFile;
  }
}

function checkbox(value) {
  return value ? "[x]" : "[ ]";
}

function artifactSummary(required, artifact, errors) {
  const location = artifact
    ? artifactLocationIsValid(artifact)
    : { ok: false, location: "missing" };
  return {
    id: required.id,
    label: required.label,
    status: artifact?.status ?? "missing",
    sourceType: artifact?.sourceType ?? "missing",
    location: location.ok ? location.location : "not_valid",
    result: errors.length === 0 ? "pass" : errors.join("; "),
  };
}

function writeReport({
  outputFile,
  manifestFile,
  manifest,
  validation,
  intakeStatus,
  operator,
  notes,
}) {
  const branch = getGitValue(["branch", "--show-current"]);
  const commit = getGitValue(["rev-parse", "HEAD"]);
  const requiredSummaries = REQUIRED_ARTIFACTS.map((required) =>
    artifactSummary(
      required,
      validation.byId.get(required.id),
      validation.invalid.find((item) => item.id === required.id)?.errors ?? [],
    ),
  );
  const allRequiredComplete =
    validation.invalid.filter((item) => item.id !== "manifest").length === 0;
  const manifestComplete =
    validation.invalid.filter((item) => item.id === "manifest").length === 0;
  const noCanonicalSubstitution =
    validation.extraCanonical.length === 0 &&
    requiredSummaries.every((item) => item.sourceType !== "canonical_sample");
  const lines = [];
  lines.push("# External CSV artifact intake 記録");
  lines.push("");
  lines.push(
    `- generatedAt: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
  );
  lines.push(`- intakeStatus: \`${intakeStatus}\``);
  lines.push(`- operator: \`${operator}\``);
  lines.push(`- manifestFile: \`${formatSourcePath(manifestFile)}\``);
  lines.push(
    `- collectionDate: \`${manifest.collectionDate ?? "not_provided"}\``,
  );
  lines.push(`- collector: \`${manifest.collector ?? "not_provided"}\``);
  lines.push(`- branch: ${branch}`);
  lines.push(`- commit: ${commit}`);
  lines.push(`- invalidCount: ${validation.invalid.length}`);
  lines.push("");
  lines.push("## #1432 completion gate");
  lines.push("");
  lines.push(
    `- ${checkbox(manifestComplete)} manifest metadata and masking approval are complete`,
  );
  lines.push(
    `- ${checkbox(allRequiredComplete)} required actual templates/samples/rule materials are received and reviewable`,
  );
  lines.push(
    `- ${checkbox(noCanonicalSubstitution)} repo canonical samples are not used as substitutes for actual artifacts`,
  );
  lines.push("");
  lines.push("## Required artifacts");
  lines.push("");
  lines.push("| artifactId | status | sourceType | location | validation |");
  lines.push("| ---------- | ------ | ---------- | -------- | ---------- |");
  for (const item of requiredSummaries) {
    lines.push(
      `| \`${item.id}\` | ${item.status} | ${item.sourceType} | ${item.location} | ${item.result} |`,
    );
  }
  if (validation.invalid.length > 0) {
    lines.push("");
    lines.push("## Validation errors");
    lines.push("");
    for (const item of validation.invalid) {
      lines.push(`- ${item.id}: ${item.errors.join("; ")}`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(notes || "-");
  writeFileSync(outputFile, `${lines.join("\n")}\n`, { flag: "wx" });
}

function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    usage();
    return;
  }

  const outDir = normalizeToAbsolute(
    env("OUT_DIR", path.join(ROOT_DIR, "docs/test-results")),
  );
  const dateStamp = env("DATE_STAMP", today());
  const runLabel = env("RUN_LABEL");
  const intakeStatus = env("INTAKE_STATUS");
  const operator = env("OPERATOR");
  const manifestFile = normalizeToAbsolute(env("MANIFEST_FILE"));
  const notes = env("NOTES");

  validateDateStamp(dateStamp);
  validateRunLabel(runLabel);
  if (!["pass", "blocked", "failed"].includes(intakeStatus))
    die("INTAKE_STATUS is required and must be pass, blocked, or failed");
  if (!requiredString(operator)) die("OPERATOR is required");
  if (!manifestFile) die("MANIFEST_FILE is required");
  if (!existsSync(manifestFile))
    die(`MANIFEST_FILE not found: ${formatSourcePath(manifestFile)}`);

  const manifest = readManifest(manifestFile);
  const validation = validateManifest(manifest);
  if (
    intakeStatus === "pass" &&
    (validation.invalid.length > 0 || validation.extraCanonical.length > 0)
  ) {
    const parts = [];
    if (validation.invalid.length > 0) {
      parts.push(
        validation.invalid
          .map((item) => `${item.id}: ${item.errors.join("; ")}`)
          .join(" | "),
      );
    }
    if (validation.extraCanonical.length > 0) {
      parts.push(
        `canonical_sample artifacts not allowed in pass manifest: ${validation.extraCanonical.join(", ")}`,
      );
    }
    die(
      `INTAKE_STATUS=pass requires complete actual CSV artifacts (${parts.join(" | ")})`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const outputFile = resolveOutputFile(outDir, dateStamp, runLabel);
  writeReport({
    outputFile,
    manifestFile,
    manifest,
    validation,
    intakeStatus,
    operator,
    notes,
  });
  log(`wrote: ${formatSourcePath(outputFile)}`);
}

main();
