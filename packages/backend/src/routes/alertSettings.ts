import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { alertSettingPatchSchema, alertSettingSchema } from './validators.js';

export async function registerAlertSettingRoutes(app: FastifyInstance) {
  app.get('/alert-settings', { preHandler: requireRole(['admin', 'mgmt']) }, async () => {
    const items = await prisma.alertSetting.findMany({ orderBy: { createdAt: 'desc' } });
    return { items };
  });

  app.post('/alert-settings', { preHandler: requireRole(['admin', 'mgmt']), schema: alertSettingSchema }, async (req) => {
    const body = req.body as any;
    const created = await prisma.alertSetting.create({ data: body });
    return created;
  });

  app.patch('/alert-settings/:id', { preHandler: requireRole(['admin', 'mgmt']), schema: alertSettingPatchSchema }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const updated = await prisma.alertSetting.update({ where: { id }, data: body });
    return updated;
  });

  app.post('/alert-settings/:id/enable', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const updated = await prisma.alertSetting.update({ where: { id }, data: { isEnabled: true } });
    return updated;
  });

  app.post('/alert-settings/:id/disable', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const updated = await prisma.alertSetting.update({ where: { id }, data: { isEnabled: false } });
    return updated;
  });
}
