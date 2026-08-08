import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationSql = readFileSync(
  new URL(
    '../prisma/migrations/20260809090000_add_chat_read_message_boundary/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('chat activity sequence migration deterministically backfills legacy rows before enabling the default', () => {
  assert.match(migrationSql, /^--[\s\S]*\nBEGIN;\n/);
  assert.match(migrationSql, /\nCOMMIT;\s*$/);
  assert.doesNotMatch(migrationSql, /BIGSERIAL\s+NOT\s+NULL/i);
  assert.match(
    migrationSql,
    /ROW_NUMBER\(\)\s+OVER\s*\(ORDER BY\s+"createdAt"\s+ASC,\s+"id"\s+ASC\)/i,
  );
  assert.match(
    migrationSql,
    /SET\s+DEFAULT\s+nextval\('\"ChatMessage_activitySequence_seq\"'\)/i,
  );
  assert.match(migrationSql, /SET\s+NOT\s+NULL/i);

  const backfillIndex = migrationSql.indexOf('ROW_NUMBER()');
  const defaultIndex = migrationSql.indexOf('SET DEFAULT');
  const notNullIndex = migrationSql.indexOf('SET NOT NULL');
  assert.ok(backfillIndex >= 0 && backfillIndex < defaultIndex);
  assert.ok(defaultIndex < notNullIndex);
});
