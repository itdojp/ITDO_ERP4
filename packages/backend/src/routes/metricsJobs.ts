import { FastifyInstance } from 'fastify';
import { computeAndTrigger } from '../services/alert.js';
import { computeApprovalDelay, computeBudgetOverrun, computeDeliveryDue, computeOvertime } from '../services/metrics.js';
import { AlertTypeValue } from '../types.js';

export async function registerMetricJobRoutes(app: FastifyInstance) {
  app.post('/jobs/alerts/run', async () => {
    await computeAndTrigger({
      [AlertTypeValue.budget_overrun]: () => computeBudgetOverrun('demo-project'),
      [AlertTypeValue.overtime]: () => computeOvertime('demo-user'),
      [AlertTypeValue.approval_delay]: () => computeApprovalDelay('demo-instance'),
      [AlertTypeValue.delivery_due]: () => computeDeliveryDue(),
    });
    return { ok: true };
  });
}
