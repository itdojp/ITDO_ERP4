import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { collectCallsites } from "./report-action-policy-callsites.mjs";
import {
  buildFallbackReport,
  parseOptionsFromArgv as parseFallbackOptionsFromArgv,
} from "./report-action-policy-fallback-allowed.mjs";
import {
  compareCallsitesAgainstRequiredActions,
  parseOptionsFromArgv as parseGapOptionsFromArgv,
  parsePhase2CoreRequiredActionsFromSource,
} from "./report-action-policy-required-action-gaps.mjs";

function parseFormat(raw) {
  if (!raw) return "text";
  if (raw === "text" || raw === "json") return raw;
  throw new Error("format must be text or json");
}

function parseArgValue(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

export function parseOptionsFromArgv(argv, now = new Date()) {
  const fallbackOptions = parseFallbackOptionsFromArgv(argv, now);
  const gapOptions = parseGapOptionsFromArgv(argv);
  return {
    from: fallbackOptions.from,
    to: fallbackOptions.to,
    take: fallbackOptions.take,
    callsiteRoot: gapOptions.callsiteRoot,
    presetFile: gapOptions.presetFile,
    format: parseFormat(
      parseArgValue(argv, "format") || fallbackOptions.format,
    ),
  };
}

function buildCallsiteRiskMap(callsites) {
  const riskMap = new Map();
  for (const callsite of callsites) {
    const key = `${callsite.flowType}:${callsite.actionKey}:${callsite.targetTable}`;
    riskMap.set(key, callsite.risk);
  }
  return riskMap;
}

function annotateFallbackKeys(keys, riskMap) {
  return keys.map((key) => {
    const compositeKey = `${key.flowType}:${key.actionKey}:${key.targetTable}`;
    return {
      ...key,
      compositeKey,
      risk: riskMap.get(compositeKey) || "unknown",
    };
  });
}

function buildBlockers(requiredActionReport, annotatedFallbackKeys) {
  const blockers = [];
  if (requiredActionReport.missingStaticCallsites.length > 0) {
    blockers.push({
      code: "missing_static_callsites",
      count: requiredActionReport.missingStaticCallsites.length,
      message: "required actions report still has missing static callsites",
    });
  }
  if (requiredActionReport.staleRequiredActions.length > 0) {
    blockers.push({
      code: "stale_required_actions",
      count: requiredActionReport.staleRequiredActions.length,
      message: "required actions report still has stale required actions",
    });
  }
  if (requiredActionReport.dynamicCallsites.length > 0) {
    blockers.push({
      code: "dynamic_callsites",
      count: requiredActionReport.dynamicCallsites.length,
      message: "dynamic action-policy callsites remain",
    });
  }
  if (annotatedFallbackKeys.length > 0) {
    blockers.push({
      code: "fallback_keys_detected",
      count: annotatedFallbackKeys.length,
      message: "action_policy_fallback_allowed keys are still present",
    });
  }
  return blockers;
}

export function evaluatePhase3Readiness({
  requiredActionReport,
  fallbackReport,
  callsites,
}) {
  const riskMap = buildCallsiteRiskMap(callsites);
  const annotatedFallbackKeys = annotateFallbackKeys(
    fallbackReport.keys,
    riskMap,
  );
  const blockers = buildBlockers(requiredActionReport, annotatedFallbackKeys);
  const fallbackByRisk = {
    high: annotatedFallbackKeys.filter((item) => item.risk === "high").length,
    medium: annotatedFallbackKeys.filter((item) => item.risk === "medium")
      .length,
    unknown: annotatedFallbackKeys.filter((item) => item.risk === "unknown")
      .length,
  };
  return {
    ready: blockers.length === 0,
    blockers,
    requiredActionGaps: requiredActionReport,
    fallbackSummary: {
      totals: {
        ...fallbackReport.totals,
        highRiskKeys: fallbackByRisk.high,
        mediumRiskKeys: fallbackByRisk.medium,
        unknownRiskKeys: fallbackByRisk.unknown,
      },
      keys: annotatedFallbackKeys,
    },
  };
}

export function buildJsonReport(report, options) {
  return {
    ready: report.ready,
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    callsiteRoot: options.callsiteRoot,
    presetFile: options.presetFile,
    blockers: report.blockers,
    requiredActionGaps: report.requiredActionGaps,
    fallbackSummary: report.fallbackSummary,
  };
}

export function renderTextReport(report, options) {
  const lines = [];
  lines.push("action policy phase3 readiness report");
  lines.push(`ready: ${report.ready ? "yes" : "no"}`);
  lines.push(`from: ${options.from.toISOString()}`);
  lines.push(`to: ${options.to.toISOString()}`);
  lines.push(`callsite_root: ${options.callsiteRoot}`);
  lines.push(`preset_file: ${options.presetFile}`);
  lines.push(
    `missing_static_callsites: ${report.requiredActionGaps.missingStaticCallsites.length}`,
  );
  lines.push(
    `stale_required_actions: ${report.requiredActionGaps.staleRequiredActions.length}`,
  );
  lines.push(
    `dynamic_callsites: ${report.requiredActionGaps.dynamicCallsites.length}`,
  );
  lines.push(
    `fallback_unique_keys: ${report.fallbackSummary.totals.uniqueKeys}`,
  );
  lines.push(
    `fallback_high_risk_keys: ${report.fallbackSummary.totals.highRiskKeys}`,
  );
  lines.push(
    `fallback_medium_risk_keys: ${report.fallbackSummary.totals.mediumRiskKeys}`,
  );
  lines.push(
    `fallback_unknown_risk_keys: ${report.fallbackSummary.totals.unknownRiskKeys}`,
  );
  lines.push("");

  lines.push("## blockers");
  if (!report.blockers.length) {
    lines.push("(none)");
  } else {
    lines.push("code,count,message");
    for (const blocker of report.blockers) {
      lines.push([blocker.code, blocker.count, blocker.message].join(","));
    }
  }
  lines.push("");

  lines.push("## fallback keys");
  if (!report.fallbackSummary.keys.length) {
    lines.push("(none)");
  } else {
    lines.push(
      "risk,flowType,actionKey,targetTable,count,firstSeen,lastSeen,sampleTargetId",
    );
    for (const key of report.fallbackSummary.keys) {
      lines.push(
        [
          key.risk,
          key.flowType,
          key.actionKey,
          key.targetTable,
          key.count,
          key.firstSeen,
          key.lastSeen,
          key.sampleTargetId || "",
        ].join(","),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function run() {
  const options = parseOptionsFromArgv(process.argv.slice(2));
  const presetSource = fs.readFileSync(options.presetFile, "utf8");
  const requiredActions =
    parsePhase2CoreRequiredActionsFromSource(presetSource);
  const callsites = collectCallsites(options.callsiteRoot);
  const requiredActionReport = compareCallsitesAgainstRequiredActions(
    callsites,
    requiredActions,
  );

  let prisma;
  try {
    ({ prisma } = await import("../packages/backend/dist/services/db.js"));
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : undefined;
    console.error(
      "[report-action-policy-phase3-readiness] failed to import backend Prisma client",
    );
    if (code === "ERR_MODULE_NOT_FOUND") {
      console.error(
        "Run `npm run build --prefix packages/backend` before this script.",
      );
    } else {
      console.error(
        "Ensure backend build artifacts and required environment variables (for example, DATABASE_URL) are available.",
      );
    }
    throw err;
  }

  try {
    const fallbackReport = await buildFallbackReport(prisma, options);
    const report = evaluatePhase3Readiness({
      requiredActionReport,
      fallbackReport,
      callsites,
    });
    if (options.format === "json") {
      process.stdout.write(
        `${JSON.stringify(buildJsonReport(report, options), null, 2)}\n`,
      );
      return;
    }
    process.stdout.write(renderTextReport(report, options));
  } finally {
    await prisma.$disconnect();
  }
}

const runAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  run().catch((err) => {
    console.error("[report-action-policy-phase3-readiness] failed", err);
    process.exit(1);
  });
}
