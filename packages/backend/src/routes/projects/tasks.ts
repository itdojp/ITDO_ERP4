import type { FastifyInstance } from 'fastify';

import {
  createProjectBaseline,
  createProjectTask,
  deleteProjectTask,
  getProjectBaseline,
  listProjectBaselines,
  listProjectTaskDependencies,
  listProjectTasks,
  updateProjectTask,
  updateProjectTaskDependencies,
} from '../../application/projects/taskUseCases.js';
import { reassignProjectTask } from '../../application/projects/useCases.js';
import { auditContextFromRequest } from '../../services/audit.js';
import { requireProjectAccess, requireRole } from '../../services/rbac.js';
import {
  deleteReasonSchema,
  projectBaselineSchema,
  projectTaskDependencySchema,
  projectTaskPatchSchema,
  projectTaskSchema,
  reassignSchema,
} from '../validators.js';
import {
  ensureProjectIdParam,
  projectActorFromRequest,
  sendApplicationResult,
} from './shared.js';

export async function registerProjectTaskRoutes(app: FastifyInstance) {
  app.get(
    '/projects/:projectId/tasks',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await listProjectTasks({ projectId }),
      );
    },
  );

  app.post(
    '/projects/:projectId/tasks',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await createProjectTask({ projectId, body: req.body as any }),
      );
    },
  );

  app.patch(
    '/projects/:projectId/tasks/:taskId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskPatchSchema,
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      return sendApplicationResult(
        reply,
        await updateProjectTask({
          projectId,
          taskId,
          body: req.body as any,
          auditContext: auditContextFromRequest(req),
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/tasks/:taskId/dependencies',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      return sendApplicationResult(
        reply,
        await listProjectTaskDependencies({ projectId, taskId }),
      );
    },
  );

  app.put(
    '/projects/:projectId/tasks/:taskId/dependencies',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskDependencySchema,
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      return sendApplicationResult(
        reply,
        await updateProjectTaskDependencies({
          projectId,
          taskId,
          body: req.body as any,
          actor: projectActorFromRequest(req),
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/tasks/:taskId/reassign',
    { preHandler: requireRole(['admin', 'mgmt']), schema: reassignSchema },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      return sendApplicationResult(
        reply,
        await reassignProjectTask({
          projectId,
          taskId,
          body: req.body as any,
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/tasks/:taskId/delete',
    { preHandler: requireRole(['admin', 'mgmt']), schema: deleteReasonSchema },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      return sendApplicationResult(
        reply,
        await deleteProjectTask({
          projectId,
          taskId,
          body: req.body as any,
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/baselines',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await listProjectBaselines({ projectId }),
      );
    },
  );

  app.get(
    '/projects/:projectId/baselines/:baselineId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId, baselineId } = req.params as {
        projectId: string;
        baselineId: string;
      };
      return sendApplicationResult(
        reply,
        await getProjectBaseline({ projectId, baselineId }),
      );
    },
  );

  app.post(
    '/projects/:projectId/baselines',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectBaselineSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await createProjectBaseline({
          projectId,
          body: req.body as any,
          actor: projectActorFromRequest(req),
        }),
      );
    },
  );
}
