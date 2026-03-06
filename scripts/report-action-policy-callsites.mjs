import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CALL_NAME = "evaluateActionPolicyWithFallback";

function resolveDefaultRoot() {
  const candidates = [
    path.resolve(process.cwd(), "packages/backend/src/routes"),
    path.resolve(process.cwd(), "src/routes"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const DEFAULT_ROOT = resolveDefaultRoot();

function parseArgValue(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function parseFormat(raw) {
  if (!raw) return "text";
  if (raw === "text" || raw === "json") return raw;
  throw new Error("format must be text or json");
}

export function parseOptionsFromArgv(argv) {
  const root = parseArgValue(argv, "root") || DEFAULT_ROOT;
  return {
    root: path.resolve(process.cwd(), root),
    format: parseFormat(parseArgValue(argv, "format")),
  };
}

function walkTsFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
      continue;
    }
  }
  return -1;
}

function countLine(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function extractFieldExpression(text, field) {
  const pattern = new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`);
  const match = text.match(pattern);
  if (!match) return null;
  return match[1].trim();
}

function normalizeQuoted(raw) {
  if (!raw) return "unknown";
  const value = raw.trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeFlowType(raw) {
  if (!raw) return "unknown";
  const value = raw.trim();
  if (value.startsWith("FlowTypeValue.")) {
    return value.slice("FlowTypeValue.".length);
  }
  return normalizeQuoted(value);
}

function normalizeActionKey(raw) {
  if (!raw) return "unknown";
  return normalizeQuoted(raw);
}

function extractStaticCallsiteDirective(source, start) {
  const windowStart = Math.max(0, start - 400);
  const leadingText = source.slice(windowStart, start);
  const pattern = /\/\/\s*action-policy-static-callsites:\s*(.+)$/gm;
  let lastMatch = null;
  for (;;) {
    const match = pattern.exec(leadingText);
    if (!match) break;
    lastMatch = match;
  }
  if (!lastMatch) return [];
  return lastMatch[1]
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function isStaticFlowTypeExpression(flowTypeExpr) {
  return (
    flowTypeExpr.startsWith("FlowTypeValue.") ||
    (flowTypeExpr.startsWith("'") && flowTypeExpr.endsWith("'")) ||
    (flowTypeExpr.startsWith('"') && flowTypeExpr.endsWith('"'))
  );
}

function isStaticActionKeyExpression(actionKeyExpr) {
  return (
    (actionKeyExpr.startsWith("'") && actionKeyExpr.endsWith("'")) ||
    (actionKeyExpr.startsWith('"') && actionKeyExpr.endsWith('"'))
  );
}

function classifyRisk(flowType, actionKey, flowTypeExpr, actionKeyExpr) {
  if (
    !isStaticFlowTypeExpression(flowTypeExpr) ||
    !isStaticActionKeyExpression(actionKeyExpr)
  ) {
    return "high";
  }
  if (actionKey === "approve" || actionKey === "reject") {
    return "high";
  }
  if (
    flowType === "invoice" ||
    flowType === "purchase_order" ||
    flowType === "vendor_invoice" ||
    flowType === "expense"
  ) {
    return "high";
  }
  if (flowType === "time" || flowType === "leave" || flowType === "estimate") {
    return "medium";
  }
  return "medium";
}

export function collectCallsitesFromSource(source, filePath) {
  const marker = `${CALL_NAME}(`;
  const rows = [];
  let cursor = 0;

  for (;;) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) break;
    const openIndex = source.indexOf("(", start + CALL_NAME.length);
    const closeIndex = findMatchingParen(source, openIndex);
    if (openIndex < 0 || closeIndex < 0) {
      cursor = start + marker.length;
      continue;
    }
    const argsText = source.slice(openIndex + 1, closeIndex);
    const flowTypeExpr =
      extractFieldExpression(argsText, "flowType") || "unknown";
    const actionKeyExpr =
      extractFieldExpression(argsText, "actionKey") || "unknown";
    const targetTableExpr =
      extractFieldExpression(argsText, "targetTable") || "unknown";
    const flowType = normalizeFlowType(flowTypeExpr);
    const actionKey = normalizeActionKey(actionKeyExpr);
    const targetTable = normalizeQuoted(targetTableExpr);
    const file = path
      .relative(process.cwd(), filePath)
      .replaceAll(path.sep, "/");
    const line = countLine(source, start);
    const staticDirectiveKeys = extractStaticCallsiteDirective(source, start);
    if (staticDirectiveKeys.length) {
      for (const key of staticDirectiveKeys) {
        const [directiveFlowType, directiveActionKey] = key.split(":");
        if (!directiveFlowType || !directiveActionKey) continue;
        rows.push({
          file,
          line,
          flowType: directiveFlowType,
          actionKey: directiveActionKey,
          targetTable,
          flowTypeExpr: `'${directiveFlowType}'`,
          actionKeyExpr: `'${directiveActionKey}'`,
          risk: classifyRisk(
            directiveFlowType,
            directiveActionKey,
            `'${directiveFlowType}'`,
            `'${directiveActionKey}'`,
          ),
        });
      }
      cursor = closeIndex + 1;
      continue;
    }
    rows.push({
      file,
      line,
      flowType,
      actionKey,
      targetTable,
      flowTypeExpr,
      actionKeyExpr,
      risk: classifyRisk(flowType, actionKey, flowTypeExpr, actionKeyExpr),
    });
    cursor = closeIndex + 1;
  }
  return rows;
}

export function collectCallsites(rootDir = DEFAULT_ROOT) {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`root directory not found: ${rootDir}`);
  }
  const files = walkTsFiles(rootDir);
  const rows = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    rows.push(...collectCallsitesFromSource(source, filePath));
  }
  rows.sort((left, right) => {
    if (left.flowType !== right.flowType)
      return left.flowType.localeCompare(right.flowType);
    if (left.actionKey !== right.actionKey) {
      return left.actionKey.localeCompare(right.actionKey);
    }
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    return left.line - right.line;
  });
  return rows;
}

function renderText(rows, options) {
  const high = rows.filter((row) => row.risk === "high").length;
  const medium = rows.filter((row) => row.risk === "medium").length;
  const lines = [];
  lines.push("action policy callsites report");
  lines.push(`root: ${options.root}`);
  lines.push(`callsites: ${rows.length}`);
  lines.push(`risk_high: ${high}`);
  lines.push(`risk_medium: ${medium}`);
  lines.push("");
  lines.push(
    "flowType,actionKey,targetTable,risk,file,line,flowTypeExpr,actionKeyExpr",
  );
  for (const row of rows) {
    lines.push(
      [
        row.flowType,
        row.actionKey,
        row.targetTable,
        row.risk,
        row.file,
        row.line,
        row.flowTypeExpr,
        row.actionKeyExpr,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

async function run() {
  const options = parseOptionsFromArgv(process.argv.slice(2));
  const rows = collectCallsites(options.root);

  if (options.format === "json") {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: options.root,
          totals: {
            callsites: rows.length,
            high: rows.filter((row) => row.risk === "high").length,
            medium: rows.filter((row) => row.risk === "medium").length,
          },
          callsites: rows,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(renderText(rows, options));
}

const runAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  run().catch((err) => {
    console.error("[report-action-policy-callsites] failed", err);
    process.exit(1);
  });
}
