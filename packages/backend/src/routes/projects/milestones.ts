import type { FastifyInstance } from 'fastify';

import {
  createProjectMilestone,
  deleteProjectMilestone,
  listProjectMilestones,
  updateProjectMilestone,
} from '../../application/projects/milestoneUseCases.js';
import { requireRole } from '../../services/rbac.js';
import {
  deleteReasonSchema,
  projectMilestonePatchSchema,
  projectMilestoneSchema,
} from '../validators.js';
import { sendApplicationResult } from './shared.js';

export async function registerProjectMilestoneRoutes(app: FastifyInstance) {
  app.post(
    '/projects/:projectId/milestones',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectMilestoneSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await createProjectMilestone({
          projectId,
          body: req.body as any,
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/milestones',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await listProjectMilestones({ projectId }),
      );
    },
  );

  app.patch(
    '/projects/:projectId/milestones/:milestoneId',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectMilestonePatchSchema,
    },
    async (req, reply) => {
      const { projectId, milestoneId } = req.params as {
        projectId: string;
        milestoneId: string;
      };
      return sendApplicationResult(
        reply,
        await updateProjectMilestone({
          projectId,
          milestoneId,
          body: req.body as any,
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/milestones/:milestoneId/delete',
    { preHandler: requireRole(['admin', 'mgmt']), schema: deleteReasonSchema },
    async (req, reply) => {
      const { projectId, milestoneId } = req.params as {
        projectId: string;
        milestoneId: string;
      };
      return sendApplicationResult(
        reply,
        await deleteProjectMilestone({
          projectId,
          milestoneId,
          body: req.body as any,
        }),
      );
    },
  );
}
