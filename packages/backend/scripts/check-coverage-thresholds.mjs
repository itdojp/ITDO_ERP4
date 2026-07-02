#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = 'coverage-thresholds.json';

function parseArgs(argv) {
  const args = { config: DEFAULT_CONFIG };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--scope') {
      args.scope = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--config') {
      args.config = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      args.summary = argv[index + 1];
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

export function evaluateCoverageThresholds(summary, thresholds) {
  const total = summary.total;
  if (!total || typeof total !== 'object') {
    throw new Error('coverage summary is missing total metrics');
  }

  return Object.entries(thresholds).map(([metric, minimum]) => {
    const actual = total[metric]?.pct;
    if (typeof actual !== 'number') {
      throw new Error(`coverage summary is missing metric: ${metric}`);
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

  const summaryPath = resolveFromCwd(args.summary || scopeConfig.summary);
  const summary = readJson(summaryPath);
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
      `[coverage-thresholds] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
