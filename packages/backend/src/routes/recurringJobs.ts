import { FastifyInstance } from 'fastify';
import { runRecurringTemplates } from '../services/recurring.js';
import { requireRole } from '../services/rbac.js';

export async function registerRecurringJobRoutes(app: FastifyInstance) {
  const requireAdmin = requireRole(['admin', 'mgmt']);
  app.post(
    '/jobs/recurring-projects/run',
    {
      preHandler: async (req, reply) => {
        const tokenHeader = req.headers['x-recurring-jobs-token'];
        const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
        const expectedToken = process.env.RECURRING_JOBS_TOKEN;
        if (expectedToken && token === expectedToken) {
          return;
        }
        return requireAdmin(req, reply);
      },
    },
    async (req, reply) => {
      try {
        const result = await runRecurringTemplates();
        return result;
      } catch (error) {
        req.log.error({ err: error }, 'Failed to run recurring templates');
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );
}
