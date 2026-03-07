#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_HEADERS = {
  users: ["legacyId", "userId", "userName"],
  customers: ["legacyId", "code", "name", "status"],
  vendors: ["legacyId", "code", "name", "status"],
  projects: ["legacyId", "code", "name"],
  tasks: ["legacyId", "projectLegacyId", "name"],
  milestones: ["legacyId", "projectLegacyId", "name", "amount"],
  estimates: ["legacyId", "projectLegacyId", "totalAmount", "currency"],
  invoices: ["legacyId", "projectLegacyId", "currency", "totalAmount"],
  purchase_orders: [
    "legacyId",
    "projectLegacyId",
    "vendorLegacyId",
    "currency",
    "totalAmount",
  ],
  vendor_quotes: [
    "legacyId",
    "projectLegacyId",
    "vendorLegacyId",
    "currency",
    "totalAmount",
  ],
  vendor_invoices: [
    "legacyId",
    "projectLegacyId",
    "vendorLegacyId",
    "currency",
    "totalAmount",
  ],
  time_entries: [
    "legacyId",
    "projectLegacyId",
    "userId",
    "workDate",
    "minutes",
  ],
  expenses: [
    "legacyId",
    "projectLegacyId",
    "userId",
    "category",
    "amount",
    "currency",
    "incurredOn",
  ],
};

function die(message, code = 2) {
  console.error(message);
  process.exit(code);
}

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
  if (!Object.hasOwn(REQUIRED_HEADERS, args.scope)) {
    die(`unsupported scope: ${args.scope}`);
  }
  return args;
}

function parseCsvRaw(value) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  const input = value.replace(/^\uFEFF/, "");
  for (let idx = 0; idx < input.length; idx += 1) {
    const ch = input[idx];
    if (inQuotes) {
      if (ch === '"') {
        const next = input[idx + 1];
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
      if (ch === "\r" && input[idx + 1] === "\n") idx += 1;
      currentRow.push(currentField);
      currentField = "";
      if (!currentRow.every((cell) => !String(cell ?? "").trim())) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }
    currentField += ch;
  }

  currentRow.push(currentField);
  if (!currentRow.every((cell) => !String(cell ?? "").trim())) {
    rows.push(currentRow);
  }
  return rows;
}

function validateCsv(scope, filePath, requiredHeaders) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {
      ok: false,
      message: `empty CSV file: ${path.basename(filePath)}`,
    };
  }

  const rows = parseCsvRaw(raw);
  if (!rows.length) {
    return {
      ok: false,
      message: `empty CSV file: ${path.basename(filePath)}`,
    };
  }

  const header = rows[0].map((cell) => String(cell ?? "").trim());
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

  const requiredHeaders = REQUIRED_HEADERS[scope];
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

main();
