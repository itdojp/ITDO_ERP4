import type { FastifyInstance } from 'fastify';

import {
  getProjectRecurringTemplate,
  listProjectRecurringGenerationLogs,
  upsertProjectRecurringTemplate,
} from '../../application/projects/recurringTemplateUseCases.js';
import { requireRole } from '../../services/rbac.js';
import { recurringTemplateSchema } from '../validators.js';
import { projectApplicationLogger, sendApplicationResult } from './shared.js';

export async function registerProjectRecurringRoutes(app: FastifyInstance) {
  app.get(
    '/projects/:id/recurring-template',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const params = req.params as { id: string };
      return sendApplicationResult(
        reply,
        await getProjectRecurringTemplate({ projectId: params.id }),
      );
    },
  );

  app.post(
    '/projects/:id/recurring-template',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: recurringTemplateSchema,
    },
    async (req, reply) => {
      const params = req.params as { id: string };
      return sendApplicationResult(
        reply,
        await upsertProjectRecurringTemplate({
          projectId: params.id,
          body: req.body as any,
          ports: { logger: projectApplicationLogger(req) },
        }),
      );
    },
  );

  app.get(
    '/projects/:id/recurring-generation-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return sendApplicationResult(
        reply,
        await listProjectRecurringGenerationLogs({
          projectId: id,
          query: req.query as {
            limit?: string;
            templateId?: string;
            periodKey?: string;
          },
        }),
      );
    },
  );
}
