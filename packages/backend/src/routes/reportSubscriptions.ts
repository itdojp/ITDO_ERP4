import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import {
  reportSubscriptionPatchSchema,
  reportSubscriptionRunSchema,
  reportSubscriptionSchema,
} from './validators.js';
import {
  createReportSubscription,
  listReportDeliveries,
  listReportSubscriptions,
  ReportParamError,
  ReportSubscriptionNotFoundError,
  retryDueReportDeliveries,
  runDueReportSubscriptions,
  runReportSubscriptionById,
  type ReportSubscriptionBody,
  type RunBody,
  updateReportSubscription,
} from '../application/reportSubscriptions/useCases.js';

const reportSubscriptionRoles = ['admin', 'mgmt'];

function sendApplicationError(reply: any, err: unknown) {
  if (err instanceof ReportSubscriptionNotFoundError) {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (err instanceof ReportParamError) {
    return reply.code(400).send({
      error: { code: err.code, message: err.message },
    });
  }
  throw err;
}

export async function registerReportSubscriptionRoutes(app: FastifyInstance) {
  app.get(
    '/report-subscriptions',
    { preHandler: requireRole(reportSubscriptionRoles) },
    async () => listReportSubscriptions(),
  );

  app.get(
    '/report-deliveries',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: {
        querystring: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string', format: 'uuid' },
            limit: { type: 'string' },
            offset: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const query = req.query as {
        subscriptionId?: string;
        limit?: string;
        offset?: string;
      };
      return listReportDeliveries(query);
    },
  );

  app.post(
    '/report-subscriptions',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionSchema,
    },
    async (req, reply) => {
      try {
        return await createReportSubscription(
          req.body as ReportSubscriptionBody,
          req.user?.userId,
        );
      } catch (err) {
        return sendApplicationError(reply, err);
      }
    },
  );

  app.patch(
    '/report-subscriptions/:id',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        return await updateReportSubscription(
          id,
          req.body as ReportSubscriptionBody,
          req.user?.userId,
        );
      } catch (err) {
        return sendApplicationError(reply, err);
      }
    },
  );

  app.post(
    '/report-subscriptions/:id/run',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as RunBody;
      try {
        return await runReportSubscriptionById(
          id,
          req.user?.userId,
          Boolean(body.dryRun),
        );
      } catch (err) {
        return sendApplicationError(reply, err);
      }
    },
  );

  app.post(
    '/jobs/report-subscriptions/run',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req) => {
      const { dryRun } = (req.body || {}) as RunBody;
      return runDueReportSubscriptions(req.user?.userId, Boolean(dryRun));
    },
  );

  app.post(
    '/jobs/report-deliveries/retry',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req) => {
      const { dryRun } = (req.body || {}) as RunBody;
      return retryDueReportDeliveries(Boolean(dryRun));
    },
  );
}
