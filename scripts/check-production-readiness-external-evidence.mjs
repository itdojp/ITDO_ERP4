#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

export const REQUIRED_EXTERNAL_EVIDENCE = [
  {
    issue: "#1426",
    id: "action-policy-phase3-target-trial",
    title: "ActionPolicy phase3_strict target trial / cutover / rollback",
    fileRe:
      /^\d{4}-\d{2}-\d{2}-action-policy-phase3-target-trial-[A-Za-z0-9._-]+\.md$/,
    statusField: "trialStatus",
    passStatus: "pass",
    gateHeading: "## #1426 completion gate",
    command: "make action-policy-phase3-target-trial-record",
  },
  {
    issue: "#544",
    id: "backup-s3-restore",
    title: "S3 backup -> upload -> download -> restore and integrity",
    fileRe: /^\d{4}-\d{2}-\d{2}-backup-s3-restore-[A-Za-z0-9._-]+\.md$/,
    statusField: "restoreStatus",
    passStatus: "pass",
    gateHeading: "## #544 / #1875 completion gate",
    command: "make backup-s3-restore-record",
  },
  {
    issue: "#1432",
    id: "external-csv-artifact-intake",
    title: "Actual external CSV templates/samples and import-rule material",
    fileRe:
      /^\d{4}-\d{2}-\d{2}-external-csv-artifact-intake-[A-Za-z0-9._-]+\.md$/,
    statusField: "intakeStatus",
    passStatus: "pass",
    gateHeading: "## #1432 completion gate",
    command: "make external-csv-artifact-intake-record",
  },
];

function usage() {
  return `Usage:
  node scripts/check-production-readiness-external-evidence.mjs [options]

Options:
  --root-dir <path>       Repository root. Default: current repository root.
  --evidence-dir <path>   Evidence directory. Default: docs/test-results under root.
  --json                 Print JSON instead of Markdown.
  -h, --help             Show this help.

Exit code:
  0 when all #1875 external Go dependencies have pass evidence with checked completion gates.
  1 when evidence is missing, blocked, failed, or incomplete.
`;
}

function parseArgs(argv) {
  const options = { rootDir: ROOT_DIR, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root-dir") {
      options.rootDir = path.resolve(readOptionValue(argv, ++i, arg));
    } else if (arg === "--evidence-dir") {
      options.evidenceDir = path.resolve(readOptionValue(argv, ++i, arg));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!options.evidenceDir) {
    options.evidenceDir = path.join(options.rootDir, "docs", "test-results");
  }
  return options;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function readMarkdownFiles(evidenceDir) {
  if (!fs.existsSync(evidenceDir)) return [];
  return fs
    .readdirSync(evidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({
      name: entry.name,
      absolutePath: path.join(evidenceDir, entry.name),
    }));
}

function repoRelative(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : filePath;
}

function extractStatus(content, field) {
  const re = new RegExp(
    "^-\\s*" + escapeRegExp(field) + ":\\s*`?([^`\\n]+)`?\\s*$",
    "im",
  );
  return content.match(re)?.[1]?.trim() ?? "missing";
}

function extractSection(content, heading) {
  const start = content.indexOf(heading);
  if (start < 0) return null;
  const rest = content.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
}

function uncheckedGateLines(section) {
  if (!section) return [];
  return section.split(/\r?\n/).filter((line) => /^- \[ \]/.test(line.trim()));
}

function checkedGateLines(section) {
  if (!section) return [];
  return section.split(/\r?\n/).filter((line) => /^- \[x\]/i.test(line.trim()));
}

function evidenceSortKey(fileName) {
  const match = fileName.match(
    /^(\d{4}-\d{2}-\d{2})-.+-([A-Za-z0-9._-]+)\.md$/,
  );
  const label = match?.[2] ?? "";
  const run = label.match(/^r(\d+)$/);
  return {
    date: match?.[1] ?? "",
    runNumber: run ? Number(run[1]) : -1,
    label,
    fileName,
  };
}

function compareEvidenceFilesNewestFirst(a, b) {
  const left = evidenceSortKey(a.name);
  const right = evidenceSortKey(b.name);
  if (left.date !== right.date) return right.date.localeCompare(left.date);
  if (left.runNumber !== right.runNumber) {
    return right.runNumber - left.runNumber;
  }
  if (left.label !== right.label) return right.label.localeCompare(left.label);
  return right.fileName.localeCompare(left.fileName);
}

function evaluateCandidate(definition, file, rootDir) {
  const content = fs.readFileSync(file.absolutePath, "utf8");
  const status = extractStatus(content, definition.statusField);
  const gate = extractSection(content, definition.gateHeading);
  const unchecked = uncheckedGateLines(gate);
  const checked = checkedGateLines(gate);
  const passStatus = status === definition.passStatus;
  const gatePresent = Boolean(gate);
  const gateComplete =
    gatePresent && checked.length > 0 && unchecked.length === 0;
  return {
    file: repoRelative(rootDir, file.absolutePath),
    status,
    result: passStatus && gateComplete ? "PASS" : "INCOMPLETE",
    gatePresent,
    checkedGateCount: checked.length,
    uncheckedGateCount: unchecked.length,
    uncheckedGateLines: unchecked,
  };
}

function evaluateDefinition(definition, files, rootDir) {
  const { fileRe, ...publicDefinition } = definition;
  const candidates = files
    .filter((file) => fileRe.test(file.name))
    .sort(compareEvidenceFilesNewestFirst)
    .map((file) => evaluateCandidate(definition, file, rootDir));
  const latest = candidates[0];
  if (latest?.result === "PASS") {
    return {
      ...publicDefinition,
      overallStatus: "PASS",
      evidenceFile: latest.file,
      statusValue: latest.status,
      candidates,
    };
  }
  return {
    ...publicDefinition,
    overallStatus: latest ? "INCOMPLETE" : "MISSING",
    evidenceFile: latest?.file ?? null,
    statusValue: latest?.status ?? "missing",
    candidates,
  };
}

export function evaluateExternalEvidence({
  rootDir = ROOT_DIR,
  evidenceDir = path.join(rootDir, "docs", "test-results"),
  definitions = REQUIRED_EXTERNAL_EVIDENCE,
} = {}) {
  const files = readMarkdownFiles(evidenceDir);
  const dependencies = definitions.map((definition) =>
    evaluateDefinition(definition, files, rootDir),
  );
  const overallStatus = dependencies.every(
    (dependency) => dependency.overallStatus === "PASS",
  )
    ? "PASS"
    : "NO-GO";
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceDir: repoRelative(rootDir, evidenceDir),
    overallStatus,
    dependencies,
  };
}

function renderMarkdown(summary) {
  const lines = [];
  lines.push("# Production Readiness external evidence check");
  lines.push("");
  lines.push(`- overallStatus: \`${summary.overallStatus}\``);
  lines.push(`- evidenceDir: \`${summary.evidenceDir}\``);
  lines.push("");
  lines.push("| issue | status | statusValue | evidence | next command |");
  lines.push("| ----- | ------ | ----------- | -------- | ------------ |");
  for (const dependency of summary.dependencies) {
    lines.push(
      `| ${dependency.issue} | ${dependency.overallStatus} | \`${dependency.statusValue}\` | ${dependency.evidenceFile ? `\`${dependency.evidenceFile}\`` : "missing"} | \`${dependency.command}\` |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- `PASS` requires a generated `docs/test-results/` record with status `pass` and all lines in the corresponding completion gate checked.",
  );
  lines.push(
    "- `MISSING` / `INCOMPLETE` means #1875 must remain open; create or fix the relevant evidence record before Go decision.",
  );
  for (const dependency of summary.dependencies) {
    const latest = dependency.candidates[0];
    if (latest?.uncheckedGateLines?.length) {
      lines.push("");
      lines.push(`### ${dependency.issue} unchecked gates in latest evidence`);
      for (const line of latest.uncheckedGateLines) lines.push(line);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  const summary = evaluateExternalEvidence(options);
  process.stdout.write(
    options.json
      ? `${JSON.stringify(summary, null, 2)}\n`
      : renderMarkdown(summary),
  );
  return summary.overallStatus === "PASS" ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        `[production-readiness-external-evidence][ERROR] ${error.message}`,
      );
      process.exit(1);
    },
  );
}
