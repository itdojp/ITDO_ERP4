import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { computeAndTrigger } from '../services/alert.js';
import { computeApprovalDelay, computeBudgetOverrun, computeOvertime } from '../services/metrics.js';
import { AlertTypeValue } from '../types.js';

export async function registerAlertRoutes(app: FastifyInstance) {
  app.get('/alerts', async (req) => {
    const { projectId, status } = req.query as { projectId?: string; status?: string };
    const alerts = await prisma.alert.findMany({
      where: {
        ...(projectId ? { scopeProjectId: projectId } : {}),
        ...(status ? { status } : {}),
      } as any,
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
    return { items: alerts };
  });

  app.post('/jobs/alerts/run', async () => {
    await computeAndTrigger({
      [AlertTypeValue.budget_overrun]: () => computeBudgetOverrun('demo-project'),
      [AlertTypeValue.overtime]: () => computeOvertime('demo-user'),
      [AlertTypeValue.approval_delay]: () => computeApprovalDelay('demo-instance'),
    });
    return { ok: true };
  });
}
