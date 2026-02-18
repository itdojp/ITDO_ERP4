#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    logDir: '',
    output: '',
    exitCode: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--log-dir=')) {
      args.logDir = arg.slice('--log-dir='.length);
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
      continue;
    }
    if (arg.startsWith('--exit-code=')) {
      const value = Number(arg.slice('--exit-code='.length));
      args.exitCode = Number.isFinite(value) ? value : null;
    }
  }
  if (!args.logDir) {
    throw new Error('missing --log-dir');
  }
  if (!args.output) {
    throw new Error('missing --output');
  }
  return args;
}

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function extractJsonBlock(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const rest = text.slice(markerIndex + marker.length);
  const startOffset = rest.search(/[{\[]/);
  if (startOffset < 0) return null;
  const open = rest[startOffset];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startOffset; i < rest.length; i += 1) {
    const ch = rest[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        const raw = rest.slice(startOffset, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseLog(text) {
  return {
    summary: extractJsonBlock(text, '[migration-po] summary:'),
    errors: extractJsonBlock(text, '[migration-po] errors:'),
    verifyErrors: extractJsonBlock(text, '[migration-po] verify errors:'),
    integrityOk: text.includes('[migration-po] integrity ok'),
    done: text.includes('[migration-po] done'),
    fatal: (text.match(/\[migration-po\] fatal:\s*(.+)$/m) || [])[1] || null,
  };
}

function summarizeSummaryTable(summary) {
  if (!summary || typeof summary !== 'object') {
    return '- summary: 取得できませんでした';
  }
  const scopes = Object.entries(summary);
  if (scopes.length === 0) {
    return '- summary: 空でした';
  }
  const lines = [
    '| scope | total | created | updated |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const [scope, values] of scopes) {
    const row =
      values && typeof values === 'object'
        ? values
        : { total: '-', created: '-', updated: '-' };
    lines.push(
      `| ${scope} | ${row.total ?? '-'} | ${row.created ?? '-'} | ${row.updated ?? '-'} |`,
    );
  }
  return lines.join('\n');
}

function summarizeErrors(parsed) {
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  const verifyErrors = Array.isArray(parsed.verifyErrors)
    ? parsed.verifyErrors
    : [];
  const lines = [];
  lines.push(`- errors(captured): ${errors.length}`);
  if (errors.length > 0) {
    lines.push(
      `  - first: ${errors[0].scope ?? '-'} / ${errors[0].message ?? '-'}`,
    );
  }
  lines.push(`- verifyErrors(captured): ${verifyErrors.length}`);
  if (verifyErrors.length > 0) {
    lines.push(
      `  - first: ${verifyErrors[0].scope ?? '-'} / ${verifyErrors[0].message ?? '-'}`,
    );
  }
  lines.push(`- integrity ok marker: ${parsed.integrityOk ? 'yes' : 'no'}`);
  lines.push(`- done marker: ${parsed.done ? 'yes' : 'no'}`);
  if (parsed.fatal) {
    lines.push(`- fatal: ${parsed.fatal}`);
  }
  return lines.join('\n');
}

function buildSection(title, logPath, parsed, exists) {
  const lines = [`## ${title}`];
  if (!exists) {
    lines.push('- log: なし');
    return lines.join('\n');
  }
  lines.push(`- log: \`${logPath}\``);
  lines.push(summarizeErrors(parsed));
  lines.push('');
  lines.push(summarizeSummaryTable(parsed.summary));
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logDir = path.resolve(args.logDir);
  const output = path.resolve(args.output);
  const dryRunPath = path.join(logDir, 'dry-run.log');
  const applyPath = path.join(logDir, 'apply.log');
  const integrityPath = path.join(logDir, 'integrity.log');

  const dryRunText = readIfExists(dryRunPath);
  const applyText = readIfExists(applyPath);
  const integrityText = readIfExists(integrityPath);

  const dryRunParsed = dryRunText ? parseLog(dryRunText) : null;
  const applyParsed = applyText ? parseLog(applyText) : null;
  const integrityParsed = integrityText ? parseLog(integrityText) : null;

  const reportLines = [
    '# PO移行リハーサル実行レポート（自動生成）',
    '',
    `- generatedAt: ${new Date().toISOString()}`,
    `- logDir: \`${logDir}\``,
    `- wrapperExitCode: ${args.exitCode != null ? args.exitCode : 'unknown'}`,
    '',
    buildSection('dry-run', dryRunPath, dryRunParsed ?? {}, !!dryRunText),
    '',
    buildSection('apply', applyPath, applyParsed ?? {}, !!applyText),
    '',
    buildSection(
      'integrity',
      integrityPath,
      integrityParsed ?? {},
      !!integrityText,
    ),
    '',
    '## 次アクション（推奨）',
    '- `docs/test-results/po-migration-rehearsal-template.md` に本レポートの結果を転記する',
    '- errors/verifyErrors がある場合は #543 に「入力データ / マッピング / ツール」の分類で記録する',
  ];

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, reportLines.join('\n') + '\n', 'utf8');
  console.log(`[po-migration-report] wrote: ${output}`);
}

main();
