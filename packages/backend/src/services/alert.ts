import type { AlertSetting } from '@prisma/client';
import { buildStubResults, sendEmailStub } from './notifier.js';
import { prisma } from './db.js';

type MetricResult = { metric: number; targetRef: string };
type MetricFetcher = (setting: AlertSetting) => Promise<MetricResult | null>;

type AlertRecipients = {
  emails?: string[];
  roles?: string[];
  users?: string[];
};

function normalizeChannels(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((c) => String(c)).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.keys(raw).filter((key) => (raw as Record<string, boolean>)[key]);
  }
  return ['dashboard'];
}

function resolveEmails(recipients: AlertRecipients | null | undefined): string[] {
  const emails = recipients?.emails?.filter(Boolean) || [];
  return emails.length ? emails : ['alert@example.com'];
}

export async function triggerAlert(setting: { id: string; recipients: unknown; channels: unknown }, metric: number, threshold: number, targetRef: string) {
  const channels = normalizeChannels(setting.channels);
  const otherChannels = channels.filter((c) => c !== 'email');
  const sentResult = [...buildStubResults(otherChannels)];
  if (channels.includes('email')) {
    const emailResult = await sendEmailStub(resolveEmails(setting.recipients as AlertRecipients), `Alert ${setting.id}`, `metric ${metric} > ${threshold}`);
    sentResult.unshift(emailResult);
  }
  const sentChannels = sentResult.map((r) => r.channel);
  return prisma.alert.create({
    data: {
      settingId: setting.id,
      targetRef,
      status: 'open',
      sentChannels: { set: sentChannels },
      sentResult: { set: sentResult },
    },
  });
}

export async function computeAndTrigger(fetchers: Record<string, MetricFetcher>) {
  const settings = await prisma.alertSetting.findMany({ where: { isEnabled: true } });
  for (const s of settings) {
    const fetcher = fetchers[s.type as string];
    if (!fetcher) continue;
    const result = await fetcher(s);
    if (!result) continue;
    if (result.metric > Number(s.threshold)) {
      await triggerAlert(
        { id: s.id, recipients: s.recipients, channels: s.channels },
        result.metric,
        Number(s.threshold),
        result.targetRef || s.scopeProjectId || 'global',
      );
    }
  }
}
