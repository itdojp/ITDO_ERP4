import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import {
  projectSchema,
  projectPatchSchema,
  projectMemberSchema,
  projectMemberBulkSchema,
} from './validators.js';
import { auditContextFromRequest } from '../services/audit.js';
import {
  addProjectMember,
  bulkAddProjectMembers,
  createProject,
  listProjectMemberCandidates,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  updateProject,
} from '../application/projects/useCases.js';
import { registerProjectMilestoneRoutes } from './projects/milestones.js';
import { registerProjectRecurringRoutes } from './projects/recurring.js';
import { registerProjectTaskRoutes } from './projects/tasks.js';
import {
  ensureProjectIdParam,
  projectActorFromRequest,
  projectApplicationLogger,
  sendApplicationResult,
} from './projects/shared.js';

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      return sendApplicationResult(
        reply,
        await listProjects({ actor: projectActorFromRequest(req) }),
      );
    },
  );

  app.post(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectSchema },
    async (req, reply) => {
      return sendApplicationResult(
        reply,
        await createProject({
          body: req.body as any,
          actor: projectActorFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.patch(
    '/projects/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectPatchSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await updateProject({
          projectId,
          body: req.body as any,
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/members',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await listProjectMembers({
          projectId,
          actor: projectActorFromRequest(req),
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/member-candidates',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { q } = req.query as { q?: string };
      return sendApplicationResult(
        reply,
        await listProjectMemberCandidates({
          projectId,
          query: q,
          actor: projectActorFromRequest(req),
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/members',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
      schema: projectMemberSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await addProjectMember({
          projectId,
          body: req.body as { userId: string; role?: 'member' | 'leader' },
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/members/bulk',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
      schema: projectMemberBulkSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await bulkAddProjectMembers({
          projectId,
          body: req.body as {
            items: Array<{ userId: string; role?: 'member' | 'leader' }>;
          },
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.delete(
    '/projects/:projectId/members/:userId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId, userId: targetUserId } = req.params as {
        projectId: string;
        userId: string;
      };
      return sendApplicationResult(
        reply,
        await removeProjectMember({
          projectId,
          userId: targetUserId,
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
        }),
      );
    },
  );

  await registerProjectTaskRoutes(app);
  await registerProjectMilestoneRoutes(app);
  await registerProjectRecurringRoutes(app);
}
