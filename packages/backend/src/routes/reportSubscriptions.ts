import { FastifyInstance } from 'fastify';
import { createReportArtifactStorageAdapter } from '../adapters/storage/contextArtifactStorageAdapters.js';
import type { ReportOutputStoragePort } from '../application/reportSubscriptions/reportOutputStoragePort.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
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
  type ReportStorageDependencies,
  type RunBody,
  updateReportSubscription,
} from '../application/reportSubscriptions/useCases.js';

const reportSubscriptionRoles = ['admin', 'mgmt'];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReportSubscriptionRouteDependencies = ReportStorageDependencies & {
  createStorage?: () => ReportOutputStoragePort;
};

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

export async function registerReportSubscriptionRoutes(
  app: FastifyInstance,
  dependencies: ReportSubscriptionRouteDependencies = {},
) {
  app.get(
    '/report-subscriptions',
    { preHandler: requireRole(reportSubscriptionRoles) },
    async () => listReportSubscriptions(),
  );

  app.get(
    '/report-outputs/:artifactId',
    { preHandler: requireRole(reportSubscriptionRoles) },
    async (req, reply) => {
      const { artifactId } = req.params as { artifactId: string };
      if (!UUID_PATTERN.test(artifactId)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_ARTIFACT_ID',
            message: 'Invalid artifact ID',
          },
        });
      }
      try {
        const storage =
          dependencies.createStorage?.() ??
          createReportArtifactStorageAdapter({ provider: 'gdrive' });
        const opened = await storage.open(artifactId);
        const filename = opened.artifact.originalName.replace(
          /["\\\r\n]/g,
          '_',
        );
        reply.header(
          'Content-Disposition',
          `attachment; filename="${filename}"`,
        );
        reply.type(opened.artifact.contentType || 'application/octet-stream');
        await logAudit({
          action: 'report_output_downloaded',
          targetTable: 'storage_artifacts',
          targetId: opened.artifact.artifactId,
          metadata: {
            artifactId: opened.artifact.artifactId,
            checksumSha256: opened.artifact.sha256,
            sizeBytes: opened.artifact.sizeBytes,
          },
          ...auditContextFromRequest(req),
        });
        opened.stream.on('error', (error) => {
          opened.stream.destroy();
          req.log.error(
            {
              error: error instanceof Error ? error.message : 'stream_failed',
            },
            'Error while streaming report output',
          );
          if (!reply.raw.headersSent) {
            reply.status(500).send({ error: 'internal_error' });
          }
        });
        return reply.send(opened.stream);
      } catch (error) {
        if (error instanceof Error && error.message === 'artifact_not_found') {
          return reply.code(404).send({ error: 'not_found' });
        }
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
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
          dependencies,
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
      return runDueReportSubscriptions(
        req.user?.userId,
        Boolean(dryRun),
        dependencies,
      );
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
      return retryDueReportDeliveries(Boolean(dryRun), dependencies);
    },
  );
}
