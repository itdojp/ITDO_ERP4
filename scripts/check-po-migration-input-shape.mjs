#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INPUT_CONTRACT_PATH = path.join(
  SCRIPT_DIR,
  "po-migration-input-contract.json",
);

function die(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function loadInputContract() {
  const raw = fs.readFileSync(INPUT_CONTRACT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const requiredHeaders =
    parsed && typeof parsed === "object" && parsed.requiredHeaders
      ? parsed.requiredHeaders
      : null;
  if (!requiredHeaders || typeof requiredHeaders !== "object") {
    throw new Error("invalid input contract: requiredHeaders is missing");
  }
  return {
    requiredHeaders,
  };
}

const INPUT_CONTRACT = loadInputContract();

function parseArgs(argv) {
  const args = {
    scope: "",
    file: "",
    format: "",
  };
  for (const arg of argv) {
    if (arg.startsWith("--scope=")) {
      args.scope = arg.slice("--scope=".length);
      continue;
    }
    if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
      continue;
    }
    if (arg.startsWith("--format=")) {
      args.format = arg.slice("--format=".length);
    }
  }
  if (!args.scope) die("missing --scope");
  if (!args.file) die("missing --file");
  if (!args.format || !["csv", "json"].includes(args.format)) {
    die("missing or invalid --format (expected: csv|json)");
  }
  if (!Object.hasOwn(INPUT_CONTRACT.requiredHeaders, args.scope)) {
    die(`unsupported scope: ${args.scope}`);
  }
  return args;
}

function readFirstCsvRecord(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(4096);
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;
  let isFirstChar = true;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (let idx = 0; idx < chunk.length; idx += 1) {
        let ch = chunk[idx];
        if (isFirstChar) {
          isFirstChar = false;
          if (ch === "\uFEFF") continue;
        }

        if (inQuotes) {
          if (ch === '"') {
            const next = chunk[idx + 1];
            if (next === '"') {
              currentField += '"';
              idx += 1;
              continue;
            }
            inQuotes = false;
            continue;
          }
          currentField += ch;
          continue;
        }

        if (ch === '"') {
          inQuotes = true;
          continue;
        }
        if (ch === ",") {
          currentRow.push(currentField);
          currentField = "";
          continue;
        }
        if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && chunk[idx + 1] === "\n") idx += 1;
          currentRow.push(currentField);
          currentField = "";
          if (!currentRow.every((cell) => !String(cell ?? "").trim())) {
            return currentRow;
          }
          currentRow = [];
          continue;
        }
        currentField += ch;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  currentRow.push(currentField);
  if (!currentRow.every((cell) => !String(cell ?? "").trim())) {
    return currentRow;
  }
  return [];
}

function validateCsv(scope, filePath, requiredHeaders) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    return {
      ok: false,
      message: `empty CSV file: ${path.basename(filePath)}`,
    };
  }

  const header = readFirstCsvRecord(filePath).map((cell) =>
    String(cell ?? "").trim(),
  );
  if (!header.length || header.every((value) => !value)) {
    return {
      ok: false,
      message: `invalid CSV header: ${path.basename(filePath)}`,
    };
  }

  const missingHeaders = requiredHeaders.filter((key) => !header.includes(key));
  if (missingHeaders.length) {
    return {
      ok: false,
      message: `missing required headers: ${missingHeaders.join(", ")}`,
    };
  }

  return {
    ok: true,
    message: `validated required headers: ${scope}`,
  };
}

function validateJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {
      ok: false,
      message: `empty JSON file: ${path.basename(filePath)}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      message: "JSON root must be an array",
    };
  }

  return {
    ok: true,
    message: `validated JSON array root: ${path.basename(filePath)}`,
  };
}

function main() {
  const { scope, file, format } = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    die(`file not found: ${filePath}`);
  }

  const requiredHeaders = INPUT_CONTRACT.requiredHeaders[scope];
  const result =
    format === "csv"
      ? validateCsv(scope, filePath, requiredHeaders)
      : validateJson(filePath);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  process.stdout.write(`${result.message}\n`);
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exit(2);
}
