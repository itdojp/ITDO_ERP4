#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = 'coverage-thresholds.json';

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${optionName}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { config: DEFAULT_CONFIG };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--scope') {
      args.scope = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--config') {
      args.config = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      args.summary = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.scope) {
    throw new Error('missing required argument: --scope <name>');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), value);
}

function emptyMetric() {
  return { total: 0, covered: 0, skipped: 0, pct: 100 };
}

function addMetric(target, source) {
  target.total += Number(source.total || 0);
  target.covered += Number(source.covered || 0);
  target.skipped += Number(source.skipped || 0);
  target.pct = target.total === 0 ? 100 : (target.covered / target.total) * 100;
}

function findSummaryEntry(summary, configuredFile) {
  const absolute = resolveFromCwd(configuredFile);
  const normalized = configuredFile.replace(/\\/g, '/');
  const entry = Object.entries(summary).find(([summaryPath]) => {
    const summaryPathNormalized = summaryPath.replace(/\\/g, '/');
    return (
      summaryPath === absolute ||
      summaryPathNormalized.endsWith(`/${normalized}`)
    );
  });
  return entry?.[1];
}

export function validateConfiguredFilesExist(files) {
  if (!Array.isArray(files) || files.length === 0) return;

  const missing = files.filter((file) => !fs.existsSync(resolveFromCwd(file)));
  if (missing.length > 0) {
    throw new Error(
      `coverage configured file does not exist: ${missing.join(', ')}`,
    );
  }
}

export function summarizeConfiguredFiles(summary, files) {
  if (!Array.isArray(files) || files.length === 0) {
    return summary;
  }

  const total = {
    statements: emptyMetric(),
    branches: emptyMetric(),
    functions: emptyMetric(),
    lines: emptyMetric(),
  };
  const missing = [];

  for (const file of files) {
    const entry = findSummaryEntry(summary, file);
    if (!entry) {
      missing.push(file);
      continue;
    }
    for (const metric of Object.keys(total)) {
      addMetric(total[metric], entry[metric] || emptyMetric());
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `coverage summary is missing configured file(s): ${missing.join(', ')}`,
    );
  }

  return { total };
}

export function evaluateCoverageThresholds(summary, thresholds) {
  const total = summary.total;
  if (!total || typeof total !== 'object') {
    throw new Error('coverage summary is missing total metrics');
  }

  return Object.entries(thresholds).map(([metric, minimum]) => {
    if (typeof minimum !== 'number' || !Number.isFinite(minimum)) {
      throw new Error(
        `invalid threshold for metric ${metric}: expected number`,
      );
    }

    const actual = total[metric]?.pct;
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      throw new Error(`coverage summary is missing numeric metric: ${metric}`);
    }

    return {
      metric,
      actual,
      minimum,
      passed: actual >= minimum,
    };
  });
}

export function runCoverageThresholdCheck(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const configPath = resolveFromCwd(args.config);
  const config = readJson(configPath);
  const scopeConfig = config[args.scope];
  if (!scopeConfig) {
    throw new Error(`coverage threshold scope not found: ${args.scope}`);
  }

  const thresholds = scopeConfig.thresholds;
  if (!thresholds || typeof thresholds !== 'object') {
    throw new Error(
      `coverage threshold scope has no thresholds: ${args.scope}`,
    );
  }

  validateConfiguredFilesExist(scopeConfig.files);

  const summaryPath = resolveFromCwd(args.summary || scopeConfig.summary);
  const summary = summarizeConfiguredFiles(
    readJson(summaryPath),
    scopeConfig.files,
  );
  const results = evaluateCoverageThresholds(summary, thresholds);
  const failures = results.filter((result) => !result.passed);

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(
      `[coverage-thresholds] ${args.scope} ${result.metric}: ${result.actual.toFixed(2)}% >= ${result.minimum.toFixed(2)}% ${status}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `coverage threshold failed for ${args.scope}: ${failures
        .map(
          (failure) =>
            `${failure.metric} ${failure.actual.toFixed(2)}% < ${failure.minimum.toFixed(2)}%`,
        )
        .join(', ')}`,
    );
  }
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMain) {
  try {
    runCoverageThresholdCheck();
  } catch (error) {
    console.error(
      `[coverage-thresholds] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}
