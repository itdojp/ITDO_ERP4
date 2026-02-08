import { readFileSync } from 'node:fs';

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function asNumber(value, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '-';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '-';
  return numberValue.toFixed(digits);
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('usage: node scripts/extract-chat-attachments-av-gate.mjs <metrics-json-path>');
  }

  const parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
  const totals = asRecord(parsed.totals);
  const windows = asRecord(parsed.windows);
  const scanDurationMs = asRecord(parsed.scanDurationMs);
  const latest = asRecord(windows.latest);

  const violationCount = Array.isArray(windows.violatedByScanFailedCount)
    ? windows.violatedByScanFailedCount.length
    : 0;
  const violationRate = Array.isArray(windows.violatedByScanFailedRate)
    ? windows.violatedByScanFailedRate.length
    : 0;
  const violationLatency = Array.isArray(windows.violatedByScanDurationP95)
    ? windows.violatedByScanDurationP95.length
    : 0;
  const gateStatus =
    violationCount + violationRate + violationLatency === 0 ? 'PASS' : 'FAIL';

  const summary = [
    `attempts=${asNumber(totals.attempts, 0)}`,
    `uploaded=${asNumber(totals.uploaded, 0)}`,
    `blocked=${asNumber(totals.blocked, 0)}`,
    `scanFailed=${asNumber(totals.scanFailed, 0)}`,
    `scanFailedRate=${formatNumber(asNumber(totals.scanFailedRatePct, 0))}%`,
    `scanP95=${formatNumber(scanDurationMs.p95)}ms`,
    `violations_count=${violationCount}`,
    `violations_rate=${violationRate}`,
    `violations_latency=${violationLatency}`,
    `latest_attempts=${asNumber(latest.attempts, 0)}`,
    `latest_scanFailed=${asNumber(latest.scanFailed, 0)}`,
    `latest_scanFailedRate=${formatNumber(asNumber(latest.scanFailedRatePct, 0))}%`,
    `latest_scanP95=${formatNumber(latest.p95Ms)}ms`,
  ].join(' | ');

  console.log(`SUMMARY=${summary}`);
  console.log(`VIOLATION_COUNT=${violationCount}`);
  console.log(`VIOLATION_RATE=${violationRate}`);
  console.log(`VIOLATION_LATENCY=${violationLatency}`);
  console.log(`GATE_STATUS=${gateStatus}`);
}

try {
  main();
} catch (error) {
  console.error('[extract-chat-attachments-av-gate] failed', error);
  process.exit(1);
}
