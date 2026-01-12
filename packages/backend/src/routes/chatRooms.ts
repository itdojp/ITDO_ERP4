import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';

export async function registerChatRoomRoutes(app: FastifyInstance) {
  const chatRoles = ['admin', 'mgmt', 'user', 'hr', 'exec', 'external_chat'];

  app.get(
    '/chat-rooms',
    { preHandler: requireRole(chatRoles) },
    async (req) => {
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      const projectIds = req.user?.projectIds || [];
      const canSeeAllProjects =
        roles.includes('admin') || roles.includes('mgmt');

      if (!canSeeAllProjects && projectIds.length === 0) {
        return { items: [] };
      }

      const projects = await prisma.project.findMany({
        where: canSeeAllProjects
          ? { deletedAt: null }
          : { id: { in: projectIds }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          code: true,
          name: true,
          createdAt: true,
        },
      });

      const targetProjectIds = projects.map((project) => project.id);
      if (targetProjectIds.length === 0) {
        return { items: [] };
      }

      const existing = await prisma.chatRoom.findMany({
        where: {
          type: 'project',
          projectId: { in: targetProjectIds },
          deletedAt: null,
        },
        select: {
          id: true,
          type: true,
          name: true,
          isOfficial: true,
          projectId: true,
          groupId: true,
          allowExternalUsers: true,
          allowExternalIntegrations: true,
          createdAt: true,
          createdBy: true,
          updatedAt: true,
          updatedBy: true,
        },
      });

      const existingByProject = new Map(
        existing
          .filter(
            (room) => typeof room.projectId === 'string' && room.projectId,
          )
          .map((room) => [room.projectId as string, room]),
      );
      const missingProjects = projects.filter(
        (project) => !existingByProject.has(project.id),
      );

      if (missingProjects.length > 0) {
        await prisma.chatRoom.createMany({
          data: missingProjects.map((project) => ({
            id: project.id,
            type: 'project',
            name: project.code,
            isOfficial: true,
            projectId: project.id,
            createdBy: userId || null,
          })),
          skipDuplicates: true,
        });
      }

      const rooms = await prisma.chatRoom.findMany({
        where: {
          type: 'project',
          projectId: { in: targetProjectIds },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          name: true,
          isOfficial: true,
          projectId: true,
          groupId: true,
          allowExternalUsers: true,
          allowExternalIntegrations: true,
          createdAt: true,
          createdBy: true,
          updatedAt: true,
          updatedBy: true,
        },
      });

      const projectMap = new Map(
        projects.map((project) => [
          project.id,
          { code: project.code, name: project.name },
        ]),
      );

      const items = rooms
        .map((room) => {
          const projectId = room.projectId || null;
          const project = projectId ? projectMap.get(projectId) : undefined;
          return {
            id: room.id,
            type: room.type,
            name: room.name,
            isOfficial: room.isOfficial,
            projectId,
            projectCode: project?.code || null,
            projectName: project?.name || null,
            groupId: room.groupId || null,
            allowExternalUsers: room.allowExternalUsers,
            allowExternalIntegrations: room.allowExternalIntegrations,
            createdAt: room.createdAt,
            createdBy: room.createdBy || null,
            updatedAt: room.updatedAt,
            updatedBy: room.updatedBy || null,
          };
        })
        .filter((item) => item.projectId);

      return { items };
    },
  );
}
