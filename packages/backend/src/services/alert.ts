import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type MetricFetcher = (settingId: string) => Promise<number>;

export async function triggerAlert(settingId: string, metric: number, threshold: number, targetRef: string) {
  return prisma.alert.create({
    data: {
      settingId,
      targetRef,
      status: 'open',
      sentChannels: { set: ['email', 'dashboard'] },
      sentResult: { set: [{ channel: 'email', status: 'stub' }] },
    },
  });
}

export async function computeAndTrigger(fetchers: Record<string, MetricFetcher>) {
  const settings = await prisma.alertSetting.findMany({ where: { isEnabled: true } });
  for (const s of settings) {
    const fetcher = fetchers[s.type as string];
    if (!fetcher) continue;
    const metric = await fetcher(s.id);
    if (metric > Number(s.threshold)) {
      await triggerAlert(s.id, metric, Number(s.threshold), s.scopeProjectId || 'global');
    }
  }
}
