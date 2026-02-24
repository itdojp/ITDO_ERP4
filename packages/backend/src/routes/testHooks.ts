import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';

function isTestHookEnabled() {
  return (
    process.env.E2E_ENABLE_TEST_HOOKS === '1' &&
    process.env.NODE_ENV !== 'production'
  );
}

export async function registerTestHookRoutes(app: FastifyInstance) {
  if (!isTestHookEnabled()) return;

  app.post(
    '/__test__/evidence-snapshots/reset',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const body = (req.body || {}) as { approvalInstanceId?: unknown };
      const approvalInstanceId =
        typeof body.approvalInstanceId === 'string'
          ? body.approvalInstanceId.trim()
          : '';
      if (!approvalInstanceId) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_APPROVAL_INSTANCE_ID',
            message: 'approvalInstanceId is required',
          },
        });
      }
      const result = await prisma.evidenceSnapshot.deleteMany({
        where: { approvalInstanceId },
      });
      return { deletedCount: result.count };
    },
  );
}
