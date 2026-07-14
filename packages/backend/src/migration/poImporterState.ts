export function isPrismaUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (!('code' in err)) return false;
  return (err as any).code === 'P2002';
}

export async function existsOrPlanned(
  id: string,
  planned: Set<string>,
  cache: Map<string, boolean>,
  check: () => Promise<boolean>,
): Promise<boolean> {
  if (planned.has(id)) return true;
  const cached = cache.get(id);
  if (cached != null) return cached;
  const ok = await check();
  cache.set(id, ok);
  return ok;
}

export const existsCache = {
  user: new Map<string, boolean>(),
  customer: new Map<string, boolean>(),
  vendor: new Map<string, boolean>(),
  project: new Map<string, boolean>(),
  task: new Map<string, boolean>(),
  milestone: new Map<string, boolean>(),
  estimate: new Map<string, boolean>(),
  invoice: new Map<string, boolean>(),
  purchaseOrder: new Map<string, boolean>(),
  vendorQuote: new Map<string, boolean>(),
  vendorInvoice: new Map<string, boolean>(),
  timeEntry: new Map<string, boolean>(),
  expense: new Map<string, boolean>(),
};
export function clearExistsCache(): void {
  for (const cache of Object.values(existsCache)) {
    cache.clear();
  }
}
