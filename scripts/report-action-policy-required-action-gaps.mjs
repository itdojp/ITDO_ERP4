import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { collectCallsites } from './report-action-policy-callsites.mjs';

function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const DEFAULT_CALLSITE_ROOT = resolveFirstExistingPath([
  path.resolve(process.cwd(), 'packages/backend/src/routes'),
  path.resolve(process.cwd(), 'src/routes'),
]);
const DEFAULT_PRESET_FILE = resolveFirstExistingPath([
  path.resolve(process.cwd(), 'packages/backend/src/services/policyEnforcementPreset.ts'),
  path.resolve(process.cwd(), 'src/services/policyEnforcementPreset.ts'),
]);

function parseArgValue(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function parseFormat(raw) {
  if (!raw) return 'text';
  if (raw === 'text' || raw === 'json') return raw;
  throw new Error('format must be text or json');
}

export function parseOptionsFromArgv(argv) {
  return {
    callsiteRoot: path.resolve(
      process.cwd(),
      parseArgValue(argv, 'callsite-root') || DEFAULT_CALLSITE_ROOT,
    ),
    presetFile: path.resolve(
      process.cwd(),
      parseArgValue(argv, 'preset-file') || DEFAULT_PRESET_FILE,
    ),
    format: parseFormat(parseArgValue(argv, 'format')),
  };
}

function extractQuotedValues(text) {
  const values = [];
  const pattern = /'([^']+)'/g;
  for (;;) {
    const match = pattern.exec(text);
    if (!match) break;
    values.push(match[1]);
  }
  return values;
}

export function parsePhase2CoreRequiredActionsFromSource(sourceText) {
  const match = sourceText.match(
    /const\s+PHASE2(?:_CORE)?_ACTION_POLICY_REQUIRED_ACTIONS\s*=\s*\[([\s\S]*?)\](?:\s+as\s+const)?;/,
  );
  if (!match) {
    throw new Error(
      'PHASE2_ACTION_POLICY_REQUIRED_ACTIONS not found in preset source',
    );
  }
  return extractQuotedValues(match[1]);
}

function isStaticFlowTypeExpr(expr) {
  return (
    expr.startsWith('FlowTypeValue.') ||
    (expr.startsWith("'") && expr.endsWith("'")) ||
    (expr.startsWith('"') && expr.endsWith('"'))
  );
}

function isStaticActionKeyExpr(expr) {
  return (
    (expr.startsWith("'") && expr.endsWith("'")) ||
    (expr.startsWith('"') && expr.endsWith('"'))
  );
}

function keyMatchesRequired(key, requiredKey) {
  const [flowType, actionKey] = key.split(':');
  const [requiredFlowType, requiredActionKey] = requiredKey.split(':');
  const flowMatch = requiredFlowType === '*' || requiredFlowType === flowType;
  const actionMatch = requiredActionKey === '*' || requiredActionKey === actionKey;
  return flowMatch && actionMatch;
}

export function compareCallsitesAgainstRequiredActions(callsites, requiredActions) {
  const staticCallsites = [];
  const dynamicCallsites = [];

  for (const callsite of callsites) {
    const staticFlow = isStaticFlowTypeExpr(callsite.flowTypeExpr);
    const staticAction = isStaticActionKeyExpr(callsite.actionKeyExpr);
    if (!staticFlow || !staticAction) {
      dynamicCallsites.push(callsite);
      continue;
    }
    staticCallsites.push(callsite);
  }

  const staticCallsiteKeys = staticCallsites.map(
    (callsite) => `${callsite.flowType}:${callsite.actionKey}`,
  );
  const uniqueStaticKeys = Array.from(new Set(staticCallsiteKeys)).sort((a, b) =>
    a.localeCompare(b),
  );

  const missingStaticCallsites = staticCallsites.filter((callsite) => {
    const key = `${callsite.flowType}:${callsite.actionKey}`;
    return !requiredActions.some((requiredKey) => keyMatchesRequired(key, requiredKey));
  });

  const staleRequiredActions = requiredActions.filter((requiredKey) => {
    const [requiredFlowType, requiredActionKey] = requiredKey.split(':');
    if (requiredFlowType === '*' || requiredActionKey === '*') return false;
    return !uniqueStaticKeys.includes(requiredKey);
  });

  return {
    totals: {
      callsites: callsites.length,
      staticCallsites: staticCallsites.length,
      dynamicCallsites: dynamicCallsites.length,
      requiredActions: requiredActions.length,
    },
    uniqueStaticKeys,
    missingStaticCallsites,
    staleRequiredActions,
    dynamicCallsites,
  };
}

function renderText(report, options) {
  const lines = [];
  lines.push('action policy required-action gap report');
  lines.push(`callsite_root: ${options.callsiteRoot}`);
  lines.push(`preset_file: ${options.presetFile}`);
  lines.push(`callsites: ${report.totals.callsites}`);
  lines.push(`static_callsites: ${report.totals.staticCallsites}`);
  lines.push(`dynamic_callsites: ${report.totals.dynamicCallsites}`);
  lines.push(`required_actions: ${report.totals.requiredActions}`);
  lines.push(`missing_static_callsites: ${report.missingStaticCallsites.length}`);
  lines.push(`stale_required_actions: ${report.staleRequiredActions.length}`);
  lines.push('');

  lines.push('## missing static callsites');
  if (!report.missingStaticCallsites.length) {
    lines.push('(none)');
  } else {
    lines.push('flowType,actionKey,file,line');
    for (const row of report.missingStaticCallsites) {
      lines.push([row.flowType, row.actionKey, row.file, row.line].join(','));
    }
  }
  lines.push('');

  lines.push('## stale required actions');
  if (!report.staleRequiredActions.length) {
    lines.push('(none)');
  } else {
    for (const key of report.staleRequiredActions) {
      lines.push(`- ${key}`);
    }
  }
  lines.push('');

  lines.push('## dynamic callsites');
  if (!report.dynamicCallsites.length) {
    lines.push('(none)');
  } else {
    lines.push('flowTypeExpr,actionKeyExpr,file,line');
    for (const row of report.dynamicCallsites) {
      lines.push([row.flowTypeExpr, row.actionKeyExpr, row.file, row.line].join(','));
    }
  }

  return `${lines.join('\n')}\n`;
}

async function run() {
  const options = parseOptionsFromArgv(process.argv.slice(2));
  const presetSource = fs.readFileSync(options.presetFile, 'utf8');
  const requiredActions = parsePhase2CoreRequiredActionsFromSource(presetSource);
  const callsites = collectCallsites(options.callsiteRoot);
  const report = compareCallsitesAgainstRequiredActions(callsites, requiredActions);

  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify({ ...report, ...options }, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderText(report, options));
}

const runAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  run().catch((err) => {
    console.error('[report-action-policy-required-action-gaps] failed', err);
    process.exit(1);
  });
}
