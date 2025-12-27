import { FastifyInstance } from 'fastify';
import { runDataQualityChecks } from '../services/dataQuality.js';
import { requireRole } from '../services/rbac.js';

export async function registerDataQualityJobRoutes(app: FastifyInstance) {
  app.post(
    '/jobs/data-quality/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const res = await runDataQualityChecks();
      return res;
    },
  );
}
