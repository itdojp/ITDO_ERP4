import { FastifyReply, FastifyRequest } from 'fastify';
import { createApiErrorResponse } from './errors.js';

export function requireRole(allowed: readonly string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const roles = req.user?.roles || [];
    if (!allowed.some((r) => roles.includes(r))) {
      // Short-circuit to avoid downstream handler execution
      return reply.code(403).send(
        createApiErrorResponse('forbidden', 'Forbidden', {
          category: 'permission',
        }),
      );
    }
  };
}

export function hasProjectAccess(
  roles: string[],
  projectIds: string[],
  projectId?: string,
) {
  if (roles.includes('admin') || roles.includes('mgmt')) return true;
  if (!projectId) return false;
  return projectIds.includes(projectId);
}

// admin/管理ロールを優先し、そうでなければ userId が一致するかで許可する簡易チェック
export function requireRoleOrSelf(
  allowed: string[],
  getTargetUserId?: (req: FastifyRequest) => string | undefined,
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const roles = req.user?.roles || [];
    const userId = req.user?.userId;
    if (allowed.some((r) => roles.includes(r))) return;
    const targetUser = getTargetUserId ? getTargetUserId(req) : undefined;
    if (!targetUser || !userId || targetUser !== userId) {
      return reply.code(403).send(
        createApiErrorResponse('forbidden', 'Forbidden', {
          category: 'permission',
        }),
      );
    }
  };
}

// 管理ロールは全許可。そうでない場合、projectId がユーザの projectIds に含まれているかをチェック
export function requireProjectAccess(
  getProjectId: (req: FastifyRequest) => string | undefined,
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const roles = req.user?.roles || [];
    if (roles.includes('admin') || roles.includes('mgmt')) return;
    const userProjects = req.user?.projectIds || [];
    const targetProject = getProjectId(req);
    if (
      targetProject &&
      !hasProjectAccess(roles, userProjects, targetProject)
    ) {
      return reply.code(403).send(
        createApiErrorResponse('forbidden_project', 'Forbidden', {
          category: 'permission',
        }),
      );
    }
  };
}
