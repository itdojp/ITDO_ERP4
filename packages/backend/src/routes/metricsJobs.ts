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
import { requireRole } from '../services/rbac.js';

export async function registerMetricJobRoutes(app: FastifyInstance) {
  app.post(
    '/jobs/alerts/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      await computeAndTrigger({
        [AlertTypeValue.budget_overrun]: (setting) =>
          computeBudgetOverrun(setting),
        [AlertTypeValue.overtime]: (setting) => computeOvertime(setting),
        [AlertTypeValue.approval_delay]: (setting) =>
          computeApprovalDelay(setting),
        [AlertTypeValue.delivery_due]: (setting) => computeDeliveryDue(setting),
      });
      return { ok: true };
    },
  );

  app.post(
    '/jobs/approval-escalations/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      await runApprovalEscalations();
      return { ok: true };
    },
  );
}
