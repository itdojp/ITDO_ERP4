import { createDailyReportNotifications as defaultCreateDailyReportNotifications } from '../../services/appNotifications.js';

export type DailyReportNotificationSideEffectPorts = {
  createDailyReportNotifications?: typeof defaultCreateDailyReportNotifications;
};

export type NotifyDailyReportChangedInput = Parameters<
  typeof defaultCreateDailyReportNotifications
>[0];

export async function notifyDailyReportChanged(
  input: NotifyDailyReportChangedInput,
  ports: DailyReportNotificationSideEffectPorts = {},
) {
  const createDailyReportNotifications =
    ports.createDailyReportNotifications ??
    defaultCreateDailyReportNotifications;
  return createDailyReportNotifications(input);
}
