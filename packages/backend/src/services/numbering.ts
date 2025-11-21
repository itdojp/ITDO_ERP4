import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// prefixMap maps kind to prefix used in numbering
const prefixMap: Record<string, string> = {
  estimate: 'Q',
  invoice: 'I',
  delivery: 'D',
  purchase_order: 'PO',
  vendor_quote: 'VQ',
  vendor_invoice: 'VI',
};

export async function nextNumber(kind: keyof typeof prefixMap, date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const prefix = prefixMap[kind];
  if (!prefix) throw new Error(`Unsupported kind: ${kind}`);

  return await prisma.$transaction(
    async (tx: any) => {
      const seq = await tx.numberSequence.upsert({
        where: { kind_year_month: { kind, year, month } },
        create: { kind, year, month, currentSerial: 1 },
        update: { currentSerial: { increment: 1 } },
      });
      const current = seq.currentSerial;
      if (current > 9999) {
        throw new Error('Serial overflow');
      }
      const number = `${prefix}${year}-${`${month}`.padStart(2, '0')}-${`${current}`.padStart(4, '0')}`;
      return { number, serial: current };
    },
    { isolationLevel: 'Serializable' },
  );
}
