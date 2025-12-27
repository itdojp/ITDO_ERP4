import { prisma } from './db.js';

type DataQualityItem = {
  key: string;
  count: number;
  sample?: string[];
};

function buildSample(values: string[], limit = 5) {
  return values.slice(0, limit);
}

async function detectDuplicateCodes(model: 'project' | 'customer' | 'vendor') {
  const base =
    model === 'project'
      ? prisma.project
      : model === 'customer'
        ? prisma.customer
        : prisma.vendor;
  const grouped = await base.groupBy({
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

  const invoiceCurrencyMissing = await prisma.invoice.count({
    where: { currency: '' },
  });
  results.push({
    key: 'invoice_currency_missing',
    count: invoiceCurrencyMissing,
  });

  const estimateCurrencyMissing = await prisma.estimate.count({
    where: { currency: '' },
  });
  results.push({
    key: 'estimate_currency_missing',
    count: estimateCurrencyMissing,
  });

  const billingTaxMissing = await prisma.billingLine.count({
    where: {
      OR: [{ taxRate: null }, { taxRate: 0 }],
    },
  });
  results.push({
    key: 'billing_tax_rate_missing',
    count: billingTaxMissing,
  });

  const invoiceNoRegex = /^I[0-9]{4}-[0-9]{2}-[0-9]{4}$/;
  const invoiceNos = await prisma.invoice.findMany({
    select: { id: true, invoiceNo: true },
  });
  const invalidInvoiceNos = invoiceNos.filter(
    (inv) => !invoiceNoRegex.test(inv.invoiceNo),
  );
  results.push({
    key: 'invoice_number_format_invalid',
    count: invalidInvoiceNos.length,
    sample: buildSample(invalidInvoiceNos.map((inv) => inv.invoiceNo)),
  });

  const poNoRegex = /^PO[0-9]{4}-[0-9]{2}-[0-9]{4}$/;
  const poNos = await prisma.purchaseOrder.findMany({
    select: { id: true, poNo: true },
  });
  const invalidPoNos = poNos.filter((po) => !poNoRegex.test(po.poNo));
  results.push({
    key: 'purchase_order_number_format_invalid',
    count: invalidPoNos.length,
    sample: buildSample(invalidPoNos.map((po) => po.poNo)),
  });

  const timeEntries = await prisma.timeEntry.findMany({
    where: { deletedAt: null },
    select: { userId: true, workDate: true, minutes: true },
  });
  const dailyTotals = new Map<string, number>();
  for (const entry of timeEntries) {
    const dateKey = entry.workDate.toISOString().slice(0, 10);
    const key = `${entry.userId}:${dateKey}`;
    const current = dailyTotals.get(key) ?? 0;
    dailyTotals.set(key, current + (entry.minutes || 0));
  }
  const overLimit = Array.from(dailyTotals.entries())
    .filter(([, total]) => total > 1440)
    .map(([key]) => key);
  results.push({
    key: 'time_entries_daily_over_1440',
    count: overLimit.length,
    sample: buildSample(overLimit),
  });

  return { items: results };
}
