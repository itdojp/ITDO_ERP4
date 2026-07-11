#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const START_MARKER = "<!-- test-results-index:start -->";
const END_MARKER = "<!-- test-results-index:end -->";
const DATE_ENTRY_RE = /^\d{4}-\d{2}-\d{2}-.+/;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function compareStable(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

function readTitle(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) return match[1].trim();
  }
  return path.basename(filePath, ".md");
}

function walk(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(abs));
    } else if (entry.isFile()) {
      result.push(abs);
    }
  }
  return result;
}

export function collectTestResultsIndex(rootDir = process.cwd()) {
  const testResultsDir = path.join(rootDir, "docs", "test-results");
  const files = walk(testResultsDir);
  const markdownFiles = files
    .filter((file) => file.endsWith(".md"))
    .map((file) => ({
      abs: file,
      rel: toPosix(path.relative(rootDir, file)),
      name: path.basename(file),
    }))
    .sort((left, right) => compareStable(left.rel, right.rel));

  const templates = [];
  const performance = [];
  const regular = [];
  const markdownBasenames = new Set();

  for (const file of markdownFiles) {
    if (file.rel === "docs/test-results/README.md") continue;
    if (file.rel === "docs/test-results/perf/README.md") {
      performance.push({ title: "Performance evidence index", path: file.rel });
      continue;
    }
    if (file.name.endsWith("-template.md")) {
      templates.push({ title: readTitle(file.abs), path: file.rel });
      continue;
    }
    if (file.name.startsWith("perf-")) {
      performance.push({ title: readTitle(file.abs), path: file.rel });
      continue;
    }
    if (DATE_ENTRY_RE.test(file.name)) {
      const basename = file.name.slice(0, -".md".length);
      markdownBasenames.add(basename);
      const evidenceDir = path.join(testResultsDir, basename);
      regular.push({
        type: "markdown",
        date: basename.slice(0, 10),
        name: basename,
        title: readTitle(file.abs),
        path: file.rel,
        evidencePath:
          fs.existsSync(evidenceDir) && fs.statSync(evidenceDir).isDirectory()
            ? `docs/test-results/${basename}/`
            : null,
      });
      continue;
    }
  }

  const topLevelEntries = fs.existsSync(testResultsDir)
    ? fs.readdirSync(testResultsDir, { withFileTypes: true })
    : [];
  for (const entry of topLevelEntries) {
    if (!entry.isDirectory()) continue;
    if (!DATE_ENTRY_RE.test(entry.name)) continue;
    if (markdownBasenames.has(entry.name)) continue;
    regular.push({
      type: "directory",
      date: entry.name.slice(0, 10),
      name: entry.name,
      title: `証跡ディレクトリ: ${entry.name}`,
      path: `docs/test-results/${entry.name}/`,
      evidencePath: null,
    });
  }

  regular.sort((left, right) => {
    if (left.date !== right.date) return right.date.localeCompare(left.date);
    return compareStable(left.name, right.name);
  });
  templates.sort((left, right) => compareStable(left.path, right.path));
  performance.sort((left, right) => compareStable(left.path, right.path));

  return { performance, templates, regular };
}

function renderLink(title, target) {
  return `[${title}](${target})`;
}

function toReadmeRelativeTarget(rootRelativePath) {
  const prefix = "docs/test-results/";
  if (!rootRelativePath.startsWith(prefix)) {
    throw new Error(
      `Unexpected docs/test-results index path: ${rootRelativePath}`,
    );
  }
  return rootRelativePath.slice(prefix.length);
}

export function renderTestResultsIndex(index) {
  const lines = [];
  lines.push(START_MARKER);
  lines.push("");
  lines.push(
    "> この一覧は `node scripts/check-test-results-index.mjs --write` で生成します。手編集した場合は `make docs-test-results-index-check` で差分を確認してください。",
  );
  lines.push("");
  lines.push("### Performance");
  lines.push("");
  if (index.performance.length === 0) {
    lines.push("- （なし）");
  } else {
    for (const item of index.performance) {
      lines.push(
        `- ${renderLink(item.title, toReadmeRelativeTarget(item.path))}`,
      );
    }
  }
  lines.push("");
  lines.push("### Template");
  lines.push("");
  if (index.templates.length === 0) {
    lines.push("- （なし）");
  } else {
    for (const item of index.templates) {
      lines.push(
        `- ${renderLink(item.title, toReadmeRelativeTarget(item.path))}`,
      );
    }
  }
  lines.push("");

  const groups = new Map();
  for (const item of index.regular) {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item);
  }
  for (const [date, items] of groups) {
    lines.push(`### ${date}`);
    lines.push("");
    for (const item of items) {
      lines.push(
        `- ${renderLink(item.title, toReadmeRelativeTarget(item.path))}`,
      );
      if (item.evidencePath) {
        lines.push(
          `  - 証跡: ${renderLink(item.evidencePath, toReadmeRelativeTarget(item.evidencePath))}`,
        );
      }
    }
    lines.push("");
  }

  lines.push(END_MARKER);
  lines.push("");
  return lines.join("\n");
}

export function replaceIndexSection(readmeContent, generatedIndex) {
  const start = readmeContent.indexOf(START_MARKER);
  const end = readmeContent.indexOf(END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + END_MARKER.length;
    const prefix = readmeContent.slice(0, start).replace(/[ \t\n]*$/, "\n\n");
    const suffix = readmeContent.slice(afterEnd).replace(/^\s*/, "");
    return `${prefix}${generatedIndex}${suffix}`;
  }

  const headingMatch = readmeContent.match(/^## 一覧[ \t]*$/m);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error(
      'docs/test-results/README.md must contain "## 一覧" or test-results-index markers',
    );
  }
  const prefix = readmeContent
    .slice(0, headingMatch.index + headingMatch[0].length)
    .replace(/[ \t]*$/, "");
  return `${prefix}\n\n${generatedIndex}`;
}

export function buildExpectedReadme(
  rootDir = process.cwd(),
  readmePath = path.join(rootDir, "docs", "test-results", "README.md"),
) {
  const current = fs.readFileSync(readmePath, "utf8");
  const generated = renderTestResultsIndex(collectTestResultsIndex(rootDir));
  return replaceIndexSection(current, generated);
}

function parseArgs(argv) {
  const options = { write: false, rootDir: process.cwd(), readmePath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a value");
      options.rootDir = path.resolve(value);
      index += 1;
    } else if (arg === "--readme") {
      const value = argv[index + 1];
      if (!value) throw new Error("--readme requires a value");
      options.readmePath = path.resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.readmePath) {
    options.readmePath = path.join(
      options.rootDir,
      "docs",
      "test-results",
      "README.md",
    );
  }
  return options;
}

function printHelp() {
  console.log(
    `Usage: node scripts/check-test-results-index.mjs [--write] [--root <repo-root>] [--readme <path>]\n\nChecks that docs/test-results/README.md indexes date-stamped evidence, templates, and performance results deterministically. Use --write to update the index.`,
  );
}

export function checkOrWriteIndex(options) {
  const expected = buildExpectedReadme(options.rootDir, options.readmePath);
  const current = fs.readFileSync(options.readmePath, "utf8");
  if (options.write) {
    fs.writeFileSync(options.readmePath, expected);
    return { changed: current !== expected };
  }
  if (current !== expected) {
    const currentLines = current.split(/\r?\n/).length;
    const expectedLines = expected.split(/\r?\n/).length;
    throw new Error(
      `docs/test-results index is stale. Run: node scripts/check-test-results-index.mjs --write (current lines=${currentLines}, expected lines=${expectedLines})`,
    );
  }
  return { changed: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = checkOrWriteIndex(options);
  if (options.write) {
    console.log(
      result.changed
        ? "docs/test-results index updated"
        : "docs/test-results index already up to date",
    );
  } else {
    console.log("docs/test-results index is up to date");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
