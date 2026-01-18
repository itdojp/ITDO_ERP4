#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

function parseArgs(argv) {
  const args = {
    base: '',
    next: '',
    thresholdReqDrop: 0.2,
    thresholdLatencyIncrease: 0.25,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--base') {
      args.base = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--next') {
      args.next = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--threshold-req-drop') {
      args.thresholdReqDrop = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (value === '--threshold-latency-increase') {
      args.thresholdLatencyIncrease = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function resolveReqAvg(autocannon) {
  return (
    pickNumber(autocannon, ['requests', 'average']) ??
    pickNumber(autocannon, ['requests', 'mean'])
  );
}

function resolveLatencyP99(autocannon) {
  return (
    pickNumber(autocannon, ['latency', 'p99']) ??
    pickNumber(autocannon, ['latency', 'average'])
  );
}

function formatPercent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function compareScenario(options) {
  const base = options.base.autocannon || {};
  const next = options.next.autocannon || {};

  const baseReq = resolveReqAvg(base);
  const nextReq = resolveReqAvg(next);
  const baseLat = resolveLatencyP99(base);
  const nextLat = resolveLatencyP99(next);

  const non2xx = pickNumber(next, ['non2xx']) ?? 0;
  const errors = pickNumber(next, ['errors']) ?? 0;
  const timeouts = pickNumber(next, ['timeouts']) ?? 0;

  const findings = [];

  if (typeof baseReq === 'number' && typeof nextReq === 'number' && baseReq > 0) {
    const drop = (baseReq - nextReq) / baseReq;
    if (drop >= options.thresholdReqDrop) {
      findings.push(
        `requests.average drop ${formatPercent(drop)} (base=${baseReq}, next=${nextReq})`,
      );
    }
  }

  if (typeof baseLat === 'number' && typeof nextLat === 'number' && baseLat > 0) {
    const increase = (nextLat - baseLat) / baseLat;
    if (increase >= options.thresholdLatencyIncrease) {
      findings.push(
        `latency.p99 increase ${formatPercent(increase)} (base=${baseLat}, next=${nextLat})`,
      );
    }
  }

  if (non2xx > 0 || errors > 0 || timeouts > 0) {
    findings.push(`non2xx/errors/timeouts detected (non2xx=${non2xx}, errors=${errors}, timeouts=${timeouts})`);
  }

  return { findings, baseReq, nextReq, baseLat, nextLat };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/perf/compare-api-bench.mjs --base <file> --next <file> [--threshold-req-drop 0.2] [--threshold-latency-increase 0.25]',
    );
    process.exit(0);
  }

  if (!args.base || !args.next) {
    console.error('Both --base and --next are required.');
    process.exit(2);
  }

  const base = readJson(args.base);
  const next = readJson(args.next);

  const baseById = new Map((base.scenarios || []).map((s) => [s.id, s]));
  const nextById = new Map((next.scenarios || []).map((s) => [s.id, s]));

  const thresholdReqDrop =
    Number.isFinite(args.thresholdReqDrop) && args.thresholdReqDrop >= 0
      ? args.thresholdReqDrop
      : 0.2;
  const thresholdLatencyIncrease =
    Number.isFinite(args.thresholdLatencyIncrease) &&
    args.thresholdLatencyIncrease >= 0
      ? args.thresholdLatencyIncrease
      : 0.25;

  const allIds = Array.from(
    new Set([...baseById.keys(), ...nextById.keys()]),
  ).sort();

  const regressions = [];

  for (const id of allIds) {
    const baseScenario = baseById.get(id);
    const nextScenario = nextById.get(id);
    if (!baseScenario || !nextScenario) continue;
    const compared = compareScenario({
      base: baseScenario,
      next: nextScenario,
      thresholdReqDrop,
      thresholdLatencyIncrease,
    });
    if (compared.findings.length) {
      regressions.push({ id, findings: compared.findings });
    }
  }

  if (!regressions.length) {
    console.log('[perf] no regression detected');
    process.exit(0);
  }

  console.log('[perf] regression candidates detected:');
  for (const item of regressions) {
    console.log(`- ${item.id}`);
    for (const finding of item.findings) {
      console.log(`  - ${finding}`);
    }
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

