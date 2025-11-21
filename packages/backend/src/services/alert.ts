import { PrismaClient } from '@prisma/client';
import { buildStubResults, sendEmailStub } from './notifier.js';

const prisma = new PrismaClient();

type MetricFetcher = (settingId: string) => Promise<number>;

export async function triggerAlert(settingId: string, metric: number, threshold: number, targetRef: string) {
  const channels = ['email', 'dashboard'];
  const sentResult = buildStubResults(channels);
  await sendEmailStub(['alert@example.com'], `Alert ${settingId}`, `metric ${metric} > ${threshold}`);
  return prisma.alert.create({
    data: {
      settingId,
      targetRef,
      status: 'open',
      sentChannels: { set: channels },
      sentResult: { set: sentResult },
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
