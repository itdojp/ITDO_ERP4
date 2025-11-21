import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const dupProjects = await prisma.$queryRawUnsafe<any[]>(
    'SELECT code, COUNT(*) c FROM projects GROUP BY code HAVING COUNT(*) > 1'
  );
  const orphanTime = await prisma.$queryRawUnsafe<any[]>(
    'SELECT id FROM time_entries te WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = te.project_id)'
  );
  const missingCurrency = await prisma.$queryRawUnsafe<any[]>(
    'SELECT id FROM invoices WHERE currency IS NULL'
  );

  const lines: string[] = [];
  dupProjects.forEach((r) => lines.push(`DUP_PROJECT_CODE,${r.code},${r.c}`));
  orphanTime.forEach((r) => lines.push(`ORPHAN_TIME_ENTRY,${r.id}`));
  missingCurrency.forEach((r) => lines.push(`MISSING_CURRENCY_INVOICE,${r.id}`));

  const report = lines.join('\n');
  fs.writeFileSync('/tmp/data-quality-report.csv', report);
  console.log('report written to /tmp/data-quality-report.csv');
}

main().finally(() => prisma.$disconnect());
