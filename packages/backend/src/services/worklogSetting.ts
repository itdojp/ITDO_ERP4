import { prisma } from './db.js';

const DEFAULT_EDITABLE_DAYS = 14;
const DEFAULT_SETTING_ID = 'default';

export async function getEditableDays() {
  try {
    const setting = await prisma.worklogSetting.findUnique({
      where: { id: DEFAULT_SETTING_ID },
      select: { editableDays: true },
    });
    if (!setting || typeof setting.editableDays !== 'number') {
      return DEFAULT_EDITABLE_DAYS;
    }
    return setting.editableDays;
  } catch {
    return DEFAULT_EDITABLE_DAYS;
  }
}
