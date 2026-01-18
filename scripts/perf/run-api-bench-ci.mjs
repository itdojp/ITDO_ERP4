#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_CONNECTIONS = 10;
const DEFAULT_DURATION_SECONDS = 20;
const AUTOCANNON_VERSION = '8.0.0';

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://localhost:3003',
    projectId: DEFAULT_PROJECT_ID,
    outJson: 'tmp/perf-ci/result.json',
    outMd: 'tmp/perf-ci/result.md',
    connections: DEFAULT_CONNECTIONS,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    userId: 'perf-user',
    roles: 'admin',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--base-url') {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--project-id') {
      args.projectId = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--out-json') {
      args.outJson = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--out-md') {
      args.outMd = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--connections') {
      args.connections = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (value === '--duration') {
      args.durationSeconds = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (value === '--user-id') {
      args.userId = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--roles') {
      args.roles = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('baseUrl is required');
  return trimmed;
}

function pickNumber(obj, pathParts) {
  let current = obj;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  if (typeof current === 'number' && Number.isFinite(current)) return current;
  return null;
}

async function runAutocannon(options) {
  const headerArgs = [];
  for (const header of options.headers) {
    headerArgs.push('-H', header);
  }
  const args = [
    '--yes',
    `autocannon@${AUTOCANNON_VERSION}`,
    '-j',
    '-c',
    String(options.connections),
    '-d',
    String(options.durationSeconds),
    ...headerArgs,
    options.url,
  ];

  const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (stderr.trim()) {
    process.stderr.write(stderr);
  }

  if (exitCode !== 0) {
    throw new Error(`autocannon failed: exit=${exitCode}`);
  }

  try {
    return JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`autocannon JSON parse failed: ${(err && err.message) || err}`);
  }
}

function buildMarkdown(result) {
  const lines = [];
  const meta = result.meta || {};
  lines.push(`# Performance (api-bench)`);
  lines.push('');
  lines.push(`- generatedAt: ${meta.generatedAt || ''}`);
  lines.push(`- commit: ${meta.commit || ''}`);
  lines.push(`- node: ${meta.node || ''}`);
  lines.push(`- autocannon: ${meta.autocannon || ''}`);
  lines.push(`- connections: ${meta.connections ?? ''}`);
  lines.push(`- durationSeconds: ${meta.durationSeconds ?? ''}`);
  lines.push('');
  lines.push('| scenario | req/s(avg) | latency(avg,ms) | latency(p99,ms) | non2xx | errors | timeouts |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const scenario of result.scenarios || []) {
    const r = scenario.autocannon || {};
    const reqAvg = pickNumber(r, ['requests', 'average']);
    const latAvg = pickNumber(r, ['latency', 'average']);
    const latP99 = pickNumber(r, ['latency', 'p99']);
    const non2xx = pickNumber(r, ['non2xx']);
    const errors = pickNumber(r, ['errors']);
    const timeouts = pickNumber(r, ['timeouts']);
    lines.push(
      `| ${scenario.id} | ${reqAvg ?? ''} | ${latAvg ?? ''} | ${latP99 ?? ''} | ${non2xx ?? ''} | ${errors ?? ''} | ${timeouts ?? ''} |`,
    );
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

async function resolveCommit() {
  const fromEnv = process.env.GITHUB_SHA || process.env.COMMIT_SHA;
  if (fromEnv) return fromEnv;
  try {
    const { execSync } = await import('node:child_process');
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch {
    return '';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/perf/run-api-bench-ci.mjs [--base-url <url>] [--project-id <uuid>] [--out-json <path>] [--out-md <path>]',
    );
    process.exit(0);
  }

  const baseUrl = normalizeUrl(args.baseUrl);
  const projectId = String(args.projectId || DEFAULT_PROJECT_ID).trim();

  const connections =
    Number.isFinite(args.connections) && args.connections > 0
      ? Math.floor(args.connections)
      : DEFAULT_CONNECTIONS;
  const durationSeconds =
    Number.isFinite(args.durationSeconds) && args.durationSeconds > 0
      ? Math.floor(args.durationSeconds)
      : DEFAULT_DURATION_SECONDS;

  const headers = [
    `x-user-id: ${String(args.userId || 'perf-user').trim()}`,
    `x-roles: ${String(args.roles || 'admin').trim()}`,
  ];

  const scenarios = [
    {
      id: 'projects',
      method: 'GET',
      path: '/projects',
      url: `${baseUrl}/projects`,
    },
    {
      id: 'project_profit',
      method: 'GET',
      path: `/reports/project-profit/${projectId}`,
      url: `${baseUrl}/reports/project-profit/${projectId}`,
    },
    {
      id: 'project_profit_by_user',
      method: 'GET',
      path: `/reports/project-profit/${projectId}/by-user`,
      url: `${baseUrl}/reports/project-profit/${projectId}/by-user`,
    },
  ];

  const commit = await resolveCommit();
  const generatedAt = new Date().toISOString();

  const results = [];
  for (const scenario of scenarios) {
    const autocannon = await runAutocannon({
      url: scenario.url,
      headers,
      connections,
      durationSeconds,
    });
    results.push({ ...scenario, autocannon });
  }

  const payload = {
    meta: {
      generatedAt,
      commit,
      node: process.version,
      autocannon: AUTOCANNON_VERSION,
      connections,
      durationSeconds,
    },
    scenarios: results,
  };

  const outJsonPath = path.resolve(args.outJson);
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(payload, null, 2) + '\n');

  const outMdPath = path.resolve(args.outMd);
  fs.mkdirSync(path.dirname(outMdPath), { recursive: true });
  fs.writeFileSync(outMdPath, buildMarkdown(payload));

  console.log(`[perf] wrote: ${args.outJson}`);
  console.log(`[perf] wrote: ${args.outMd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

