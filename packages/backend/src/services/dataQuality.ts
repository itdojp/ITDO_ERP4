import { prisma } from './db.js';
import { Prisma } from '@prisma/client';

type DataQualityItem = {
  key: string;
  count: number;
  sample?: string[];
};

function buildSample(values: string[], limit = 5) {
  return values.slice(0, limit);
}

async function detectDuplicateCodes(model: 'project' | 'customer' | 'vendor') {
  if (model === 'project') {
    const grouped = await prisma.project.groupBy({
      by: ['code'],
      where: { deletedAt: null },
      _count: { _all: true },
      having: {
        _count: {
          _all: { gt: 1 },
        },
      },
    });
    const codes = grouped.map((row) => row.code);
    return {
      count: grouped.length,
      sample: buildSample(codes),
    };
  }
  if (model === 'customer') {
    const grouped = await prisma.customer.groupBy({
      by: ['code'],
      _count: { _all: true },
      having: {
        _count: {
          _all: { gt: 1 },
        },
      },
    });
    const codes = grouped.map((row) => row.code);
    return {
      count: grouped.length,
      sample: buildSample(codes),
    };
  }
  const grouped = await prisma.vendor.groupBy({
    by: ['code'],
    _count: { _all: true },
    having: {
      _count: {
        _all: { gt: 1 },
      },
    },
  });
  const codes = grouped.map((row) => row.code);
  return {
    count: grouped.length,
    sample: buildSample(codes),
  };
}

export async function runDataQualityChecks() {
  const results: DataQualityItem[] = [];

  const projectDupes = await detectDuplicateCodes('project');
  results.push({
    key: 'duplicate_project_code',
    count: projectDupes.count,
    sample: projectDupes.sample,
  });

  const customerDupes = await detectDuplicateCodes('customer');
  results.push({
    key: 'duplicate_customer_code',
    count: customerDupes.count,
    sample: customerDupes.sample,
  });

  const vendorDupes = await detectDuplicateCodes('vendor');
  results.push({
    key: 'duplicate_vendor_code',
    count: vendorDupes.count,
    sample: vendorDupes.sample,
  });

  const invoiceCurrencyMissingRows = await prisma.$queryRaw<
    { count: bigint }[]
  >(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "Invoice"
    WHERE "currency" IS NULL OR "currency" = ''
  `);
  const invoiceCurrencyMissing = Number(invoiceCurrencyMissingRows[0]?.count ?? 0);
  results.push({
    key: 'invoice_currency_missing',
    count: invoiceCurrencyMissing,
  });

  const estimateCurrencyMissingRows = await prisma.$queryRaw<
    { count: bigint }[]
  >(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "Estimate"
    WHERE "currency" IS NULL OR "currency" = ''
  `);
  const estimateCurrencyMissing = Number(
    estimateCurrencyMissingRows[0]?.count ?? 0,
  );
  results.push({
    key: 'estimate_currency_missing',
    count: estimateCurrencyMissing,
  });

  const billingTaxMissing = await prisma.billingLine.count({
    where: {
      taxRate: null,
    },
  });
  results.push({
    key: 'billing_tax_rate_missing',
    count: billingTaxMissing,
  });

  const invoiceNoRegex = /^I[0-9]{4}-[0-9]{2}-[0-9]{4}$/;
  const invoicePageSize = 1000;
  let invalidInvoiceCount = 0;
  const invalidInvoiceSample: string[] = [];
  let invoiceCursor: { id: string } | undefined = undefined;
  while (true) {
    const invoiceBatch = await prisma.invoice.findMany({
      select: { id: true, invoiceNo: true },
      orderBy: { id: 'asc' },
      take: invoicePageSize,
      ...(invoiceCursor ? { skip: 1, cursor: invoiceCursor } : {}),
    });
    if (invoiceBatch.length === 0) break;
    for (const inv of invoiceBatch) {
      if (!invoiceNoRegex.test(inv.invoiceNo)) {
        invalidInvoiceCount += 1;
        if (invalidInvoiceSample.length < 5) {
          invalidInvoiceSample.push(inv.invoiceNo);
        }
      }
    }
    invoiceCursor = { id: invoiceBatch[invoiceBatch.length - 1].id };
  }
  results.push({
    key: 'invoice_number_format_invalid',
    count: invalidInvoiceCount,
    sample: buildSample(invalidInvoiceSample),
  });

  const poNoRegex = /^PO[0-9]{4}-[0-9]{2}-[0-9]{4}$/;
  const poPageSize = 1000;
  let invalidPoCount = 0;
  const invalidPoSample: string[] = [];
  let poCursor: { id: string } | undefined = undefined;
  while (true) {
    const poBatch = await prisma.purchaseOrder.findMany({
      select: { id: true, poNo: true },
      orderBy: { id: 'asc' },
      take: poPageSize,
      ...(poCursor ? { skip: 1, cursor: poCursor } : {}),
    });
    if (poBatch.length === 0) break;
    for (const po of poBatch) {
      if (!poNoRegex.test(po.poNo)) {
        invalidPoCount += 1;
        if (invalidPoSample.length < 5) {
          invalidPoSample.push(po.poNo);
        }
      }
    }
    poCursor = { id: poBatch[poBatch.length - 1].id };
  }
  results.push({
    key: 'purchase_order_number_format_invalid',
    count: invalidPoCount,
    sample: buildSample(invalidPoSample),
  });

  const timeOverLimitRows = await prisma.$queryRaw<
    { userId: string; workDate: string }[]
  >(Prisma.sql`
    SELECT "userId", DATE("workDate") AS "workDate"
    FROM "TimeEntry"
    WHERE "deletedAt" IS NULL
    GROUP BY "userId", DATE("workDate")
    HAVING SUM("minutes") > 1440
  `);
  const overLimit = timeOverLimitRows.map(
    (row) => `${row.userId}:${row.workDate}`,
  );
  results.push({
    key: 'time_entries_daily_over_1440',
    count: overLimit.length,
    sample: buildSample(overLimit),
  });

  return { items: results };
}
