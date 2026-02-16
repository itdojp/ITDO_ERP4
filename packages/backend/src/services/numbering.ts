import { prisma } from './db.js';

// prefixMap maps kind to prefix used in numbering
const prefixMap: Record<string, string> = {
  estimate: 'Q',
  invoice: 'I',
  delivery: 'D',
  purchase_order: 'PO',
  vendor_quote: 'VQ',
  vendor_invoice: 'VI',
};

type RetryableError = { code?: string };
type NumberingClient = Pick<typeof prisma, '$transaction'>;
type NextNumberOptions = {
  client?: NumberingClient;
  maxRetries?: number;
};
const DEFAULT_MAX_RETRIES = 3;
const MAX_MAX_RETRIES = 10;

function normalizeMaxRetries(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_RETRIES;
  }
  return Math.min(Math.floor(value), MAX_MAX_RETRIES);
}

function isRetryableError(err: unknown): err is RetryableError {
  return !!err && typeof err === 'object' && 'code' in err;
}

export async function nextNumber(
  kind: keyof typeof prefixMap,
  date: Date,
  options: NextNumberOptions = {},
) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const prefix = prefixMap[kind];
  if (!prefix) throw new Error(`Unsupported kind: ${kind}`);

  const client = options.client ?? prisma;
  const maxRetries = normalizeMaxRetries(options.maxRetries);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx: any) => {
          const seq = await tx.numberSequence.upsert({
            where: { kind_year_month: { kind, year, month } },
            create: { kind, year, month, currentSerial: 1 },
            update: { currentSerial: { increment: 1 } },
          });
          const current = seq.currentSerial;
          if (current > 9999) {
            throw new Error('Serial overflow (>=10000)');
          }
          const number = `${prefix}${year}-${`${month}`.padStart(2, '0')}-${`${current}`.padStart(4, '0')}`;
          return { number, serial: current };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'Serial overflow (>=10000)') {
        throw err;
      }
      const retryable = isRetryableError(err) && err.code === 'P2034';
      if (retryable && attempt < maxRetries - 1) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Failed to allocate number');
}
