import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APPROVAL_DEFAULT_RULE_EFFECTIVE_FROM_SQL,
  APPROVAL_DEFAULT_RULE_SPECS,
} from '../dist/services/approvalDefaultRules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..', '..');

const MIGRATION_SQL_PATH = path.join(
  backendRoot,
  'prisma',
  'migrations',
  '20260305113000_add_approval_rule_db_defaults',
  'migration.sql',
);
const DEMO_SEED_SQL_PATH = path.join(repoRoot, 'scripts', 'seed-demo.sql');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertRuleTupleInMigration(sql, spec) {
  const conditions = JSON.stringify(spec.conditions);
  const steps = JSON.stringify(spec.steps);
  const pattern = new RegExp(
    `'${escapeRegExp(spec.flowType)}'\\s*,\\s*'${escapeRegExp(spec.ruleKey)}'\\s*,\\s*1\\s*,\\s*true\\s*,\\s*'${escapeRegExp(
      APPROVAL_DEFAULT_RULE_EFFECTIVE_FROM_SQL,
    )}'\\s*,\\s*'${escapeRegExp(conditions)}'::jsonb\\s*,\\s*'${escapeRegExp(steps)}'::jsonb`,
    'm',
  );
  assert.match(sql, pattern);
}

function assertRuleTupleInDemoSeed(sql, spec) {
  const conditions = JSON.stringify(spec.conditions);
  const steps = JSON.stringify(spec.steps);
  const pattern = new RegExp(
    `'${escapeRegExp(spec.flowType)}'\\s*,\\s*'${escapeRegExp(spec.ruleKey)}'\\s*,\\s*1\\s*,\\s*true\\s*,\\s*'${escapeRegExp(
      APPROVAL_DEFAULT_RULE_EFFECTIVE_FROM_SQL,
    )}'\\s*,\\s*'${escapeRegExp(conditions)}'\\s*,\\s*'${escapeRegExp(steps)}'`,
    'm',
  );
  assert.match(sql, pattern);
}

function countSystemDefaultRuleKeyLiterals(sql) {
  return (sql.match(/'system-default:[^']+'/g) ?? []).length;
}

test('approval default rules are consistent across runtime spec, migration, and demo seed', () => {
  const migrationSql = readFile(MIGRATION_SQL_PATH);
  const demoSeedSql = readFile(DEMO_SEED_SQL_PATH);

  assert.equal(
    countSystemDefaultRuleKeyLiterals(migrationSql),
    APPROVAL_DEFAULT_RULE_SPECS.length,
  );
  assert.equal(
    countSystemDefaultRuleKeyLiterals(demoSeedSql),
    APPROVAL_DEFAULT_RULE_SPECS.length,
  );

  for (const spec of APPROVAL_DEFAULT_RULE_SPECS) {
    assertRuleTupleInMigration(migrationSql, spec);
    assertRuleTupleInDemoSeed(demoSeedSql, spec);
  }
});
