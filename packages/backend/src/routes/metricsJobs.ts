import { FastifyInstance } from 'fastify';
import { computeAndTrigger } from '../services/alert.js';
import { runApprovalEscalations } from '../services/approvalEscalation.js';
import {
  computeApprovalDelay,
  computeBudgetOverrun,
  computeDeliveryDue,
  computeOvertime,
} from '../services/metrics.js';
import { AlertTypeValue } from '../types.js';

export async function registerMetricJobRoutes(app: FastifyInstance) {
  app.post('/jobs/alerts/run', async () => {
    await computeAndTrigger({
      [AlertTypeValue.budget_overrun]: (setting) =>
        computeBudgetOverrun(setting),
      [AlertTypeValue.overtime]: (setting) => computeOvertime(setting),
      [AlertTypeValue.approval_delay]: (setting) =>
        computeApprovalDelay(setting),
      [AlertTypeValue.delivery_due]: (setting) => computeDeliveryDue(setting),
    });
    return { ok: true };
  });

  app.post('/jobs/approval-escalations/run', async () => {
    await runApprovalEscalations();
    return { ok: true };
  });
}
