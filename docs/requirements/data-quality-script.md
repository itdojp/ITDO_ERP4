# データ品質チェック スクリプト雛形（Node/SQL）

目的: 1日1回、主要なデータ不整合を検知しレポートする。PoCでは手動実行でも可。

## サンプルSQL
```sql
-- project_code 重複
SELECT code, COUNT(*) c FROM projects GROUP BY code HAVING COUNT(*) > 1;

-- time_entries の参照切れ
SELECT id FROM time_entries te WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = te.project_id);

-- 通貨未設定
SELECT id FROM invoices WHERE currency IS NULL;

-- 税率NULL
SELECT id FROM billing_lines WHERE tax_rate IS NULL;
```

## Nodeから実行する例（擬似）
```ts
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
const prisma = new PrismaClient();

async function main() {
  const dupProjects = await prisma.$queryRawUnsafe('SELECT code, COUNT(*) c FROM projects GROUP BY code HAVING COUNT(*) > 1');
  const orphans = await prisma.$queryRawUnsafe('SELECT id FROM time_entries te WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = te.project_id)');
  const lines: string[] = [];
  dupProjects.forEach((row: any) => lines.push(`DUP_PROJECT_CODE,${row.code},${row.c}`));
  orphans.forEach((row: any) => lines.push(`ORPHAN_TIME_ENTRY,${row.id}`));
  fs.writeFileSync('/tmp/data-quality-report.csv', lines.join('\n'));
}

main().finally(() => prisma.$disconnect());
```

## 運用
- 初期は手動 or cron（1日1回）
- レポートをメールStubまたはアラートに載せる
- 検出された不整合は移行データ修正 or 手動修正
