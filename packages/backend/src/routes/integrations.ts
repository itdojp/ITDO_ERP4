import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import {
  integrationSettingPatchSchema,
  integrationSettingSchema,
} from './validators.js';

type IntegrationSettingBody = {
  type: 'hr' | 'crm';
  name?: string;
  provider?: string;
  status?: 'active' | 'disabled';
  schedule?: string;
  config?: unknown;
};

export async function registerIntegrationRoutes(app: FastifyInstance) {
  app.get(
    '/integration-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const items = await prisma.integrationSetting.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/integration-settings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationSettingSchema,
    },
    async (req) => {
      const body = req.body as IntegrationSettingBody;
      const userId = req.user?.userId;
      const created = await prisma.integrationSetting.create({
        data: {
          ...body,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      return created;
    },
  );

  app.patch(
    '/integration-settings/:id',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationSettingPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<IntegrationSettingBody>;
      const current = await prisma.integrationSetting.findUnique({
        where: { id },
      });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const userId = req.user?.userId;
      const updated = await prisma.integrationSetting.update({
        where: { id },
        data: { ...body, updatedBy: userId },
      });
      return updated;
    },
  );

  app.post(
    '/integration-settings/:id/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const setting = await prisma.integrationSetting.findUnique({
        where: { id },
      });
      if (!setting) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const userId = req.user?.userId;
      const now = new Date();
      const run = await prisma.integrationRun.create({
        data: {
          settingId: id,
          status: 'success',
          startedAt: now,
          finishedAt: now,
          message: 'stub',
          createdBy: userId,
        },
      });
      await prisma.integrationSetting.update({
        where: { id },
        data: { lastRunAt: now, lastRunStatus: 'success', updatedBy: userId },
      });
      return run;
    },
  );

  app.get(
    '/integration-runs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { settingId } = req.query as { settingId?: string };
      const items = await prisma.integrationRun.findMany({
        where: settingId ? { settingId } : undefined,
        orderBy: { startedAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.get(
    '/integrations/crm/exports/customers',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const items = await prisma.customer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return { items };
    },
  );

  app.get(
    '/integrations/crm/exports/vendors',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const items = await prisma.vendor.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return { items };
    },
  );

  app.get(
    '/integrations/crm/exports/contacts',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const items = await prisma.contact.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return { items };
    },
  );
}
