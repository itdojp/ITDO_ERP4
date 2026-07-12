import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_REGISTRY = path.join(
  DEFAULT_BACKEND_ROOT,
  'bounded-context-registry.cjs',
);

const TARGET_FILE_RE = /^src\/(routes|services)\/.+\.ts$/;
const EXPLICIT_REASON_KINDS = new Set(['excluded', 'generated']);

function usage() {
  return `Usage: node scripts/check-bounded-context-coverage.mjs [options]

Options:
  --backend-root <dir>   backend package root (default: current backend package)
  --registry <file>      classification registry .cjs file
  --format text|json     output format (default: text)
  --help                 show this help
`;
}

function parseArgs(argv) {
  const options = {
    backendRoot: DEFAULT_BACKEND_ROOT,
    registryPath: DEFAULT_REGISTRY,
    format: 'text',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--backend-root') {
      index += 1;
      if (!argv[index]) throw new Error('--backend-root requires a directory');
      options.backendRoot = path.resolve(argv[index]);
      continue;
    }
    if (arg.startsWith('--backend-root=')) {
      options.backendRoot = path.resolve(arg.slice('--backend-root='.length));
      continue;
    }
    if (arg === '--registry') {
      index += 1;
      if (!argv[index]) throw new Error('--registry requires a file');
      options.registryPath = path.resolve(argv[index]);
      continue;
    }
    if (arg.startsWith('--registry=')) {
      options.registryPath = path.resolve(arg.slice('--registry='.length));
      continue;
    }
    if (arg === '--format') {
      index += 1;
      if (!argv[index]) throw new Error('--format requires text or json');
      options.format = argv[index];
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error('--format must be text or json');
  }
  return options;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function collectTsFiles(rootDir) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['dist', 'coverage', 'node_modules', 'test'].includes(entry.name)) {
          continue;
        }
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(toPosix(path.relative(rootDir, abs)));
      }
    }
  }
  walk(path.join(rootDir, 'src'));
  return files.sort();
}

function compilePatterns(entry, kind) {
  return entry.patterns.map((pattern) => ({
    entryName: entry.name,
    kind,
    displayName: entry.displayName || entry.name,
    pattern,
    regex: new RegExp(pattern),
  }));
}

function normalizeRegistry(registry) {
  const contexts = Array.isArray(registry.contexts) ? registry.contexts : [];
  const layers = Array.isArray(registry.layers) ? registry.layers : [];
  const entries = [
    ...contexts.map((entry) => ({ ...entry, kind: 'bounded-context' })),
    ...layers.map((entry) => ({ ...entry, kind: entry.kind || 'layer' })),
  ];

  const invalidEntries = [];
  for (const entry of entries) {
    if (
      !entry.name ||
      !Array.isArray(entry.patterns) ||
      entry.patterns.length === 0
    ) {
      invalidEntries.push({
        entry: entry.name || '<unnamed>',
        reason: 'entry requires name and at least one pattern',
      });
    }
    if (EXPLICIT_REASON_KINDS.has(entry.kind)) {
      const reason =
        typeof entry.reason === 'string' ? entry.reason.trim() : '';
      if (!reason) {
        invalidEntries.push({
          entry: entry.name || '<unnamed>',
          reason: `${entry.kind} entries require a non-empty reason`,
        });
      }
    }
  }

  const compiledPatterns = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.patterns)) continue;
    try {
      compiledPatterns.push(...compilePatterns(entry, entry.kind));
    } catch (error) {
      invalidEntries.push({
        entry: entry.name || '<unnamed>',
        reason: `invalid regular expression: ${error.message}`,
      });
    }
  }

  return { contexts, layers, entries, compiledPatterns, invalidEntries };
}

export function checkBoundedContextCoverage({ backendRoot, registryPath }) {
  const require = createRequire(import.meta.url);
  const registry = require(registryPath);
  const normalized = normalizeRegistry(registry);
  const allSourceFiles = collectTsFiles(backendRoot);
  const targetFiles = allSourceFiles.filter((file) =>
    TARGET_FILE_RE.test(file),
  );
  const contextPatterns = normalized.compiledPatterns.filter(
    (pattern) => pattern.kind === 'bounded-context',
  );

  const stalePatterns = normalized.compiledPatterns
    .filter(
      (pattern) => !allSourceFiles.some((file) => pattern.regex.test(file)),
    )
    .map(({ entryName, kind, pattern }) => ({
      entry: entryName,
      kind,
      pattern,
    }))
    .sort(compareProblemPattern);

  const unclassifiedFiles = [];
  const duplicateBoundedContextFiles = [];
  const ambiguousClassifiedFiles = [];

  for (const file of targetFiles) {
    const matches = normalized.compiledPatterns.filter((pattern) =>
      pattern.regex.test(file),
    );
    const contextMatches = contextPatterns.filter((pattern) =>
      pattern.regex.test(file),
    );
    if (matches.length === 0) {
      unclassifiedFiles.push(file);
    }
    if (contextMatches.length > 1) {
      duplicateBoundedContextFiles.push({
        file,
        contexts: contextMatches.map((match) => match.entryName).sort(),
      });
    }
    const uniqueEntries = [...new Set(matches.map((match) => match.entryName))];
    if (uniqueEntries.length > 1) {
      ambiguousClassifiedFiles.push({ file, entries: uniqueEntries.sort() });
    }
  }

  const problems = {
    invalidEntries: normalized.invalidEntries.sort(compareInvalidEntry),
    stalePatterns,
    unclassifiedFiles: unclassifiedFiles.sort(),
    duplicateBoundedContextFiles:
      duplicateBoundedContextFiles.sort(compareFileProblem),
    ambiguousClassifiedFiles: ambiguousClassifiedFiles.sort(compareFileProblem),
  };

  const summary = {
    sourceFiles: allSourceFiles.length,
    targetFiles: targetFiles.length,
    contexts: normalized.contexts.length,
    layers: normalized.layers.length,
    invalidEntries: problems.invalidEntries.length,
    stalePatterns: problems.stalePatterns.length,
    unclassifiedFiles: problems.unclassifiedFiles.length,
    duplicateBoundedContextFiles: problems.duplicateBoundedContextFiles.length,
    ambiguousClassifiedFiles: problems.ambiguousClassifiedFiles.length,
  };

  const failed = Object.values(problems).some((items) => items.length > 0);
  return {
    status: failed ? 'fail' : 'pass',
    summary,
    problems,
  };
}

function compareProblemPattern(a, b) {
  return (
    a.entry.localeCompare(b.entry) ||
    a.kind.localeCompare(b.kind) ||
    a.pattern.localeCompare(b.pattern)
  );
}

function compareInvalidEntry(a, b) {
  return a.entry.localeCompare(b.entry) || a.reason.localeCompare(b.reason);
}

function compareFileProblem(a, b) {
  return a.file.localeCompare(b.file);
}

function printText(result) {
  const lines = [];
  lines.push(`Bounded-context coverage: ${result.status.toUpperCase()}`);
  lines.push(`source files: ${result.summary.sourceFiles}`);
  lines.push(`target route/service files: ${result.summary.targetFiles}`);
  lines.push(`contexts: ${result.summary.contexts}`);
  lines.push(`layers: ${result.summary.layers}`);
  lines.push(`invalid entries: ${result.summary.invalidEntries}`);
  lines.push(`stale patterns: ${result.summary.stalePatterns}`);
  lines.push(`unclassified files: ${result.summary.unclassifiedFiles}`);
  lines.push(
    `duplicate bounded-context files: ${result.summary.duplicateBoundedContextFiles}`,
  );
  lines.push(
    `ambiguous classification files: ${result.summary.ambiguousClassifiedFiles}`,
  );

  appendProblemSection(
    lines,
    'Invalid registry entries',
    result.problems.invalidEntries,
    (item) => `${item.entry}: ${item.reason}`,
  );
  appendProblemSection(
    lines,
    'Stale patterns',
    result.problems.stalePatterns,
    (item) => `${item.entry} (${item.kind}): ${item.pattern}`,
  );
  appendProblemSection(
    lines,
    'Unclassified files',
    result.problems.unclassifiedFiles,
    (item) => item,
  );
  appendProblemSection(
    lines,
    'Duplicate bounded-context files',
    result.problems.duplicateBoundedContextFiles,
    (item) => `${item.file}: ${item.contexts.join(', ')}`,
  );
  appendProblemSection(
    lines,
    'Ambiguous classification files',
    result.problems.ambiguousClassifiedFiles,
    (item) => `${item.file}: ${item.entries.join(', ')}`,
  );

  return `${lines.join('\n')}\n`;
}

function appendProblemSection(lines, title, items, formatItem) {
  if (items.length === 0) return;
  lines.push('');
  lines.push(`## ${title}`);
  for (const item of items) {
    lines.push(`- ${formatItem(item)}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  try {
    const result = checkBoundedContextCoverage(options);
    if (options.format === 'json') {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(printText(result));
    }
    process.exit(result.status === 'pass' ? 0 : 1);
  } catch (error) {
    console.error(`bounded-context coverage check failed: ${error.message}`);
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
