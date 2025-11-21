import { FastifyReply, FastifyRequest } from 'fastify';

export function requireRole(allowed: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const roles = req.user?.roles || [];
    if (!allowed.some((r) => roles.includes(r))) {
      // Short-circuit to avoid downstream handler execution
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}

// admin/管理ロールを優先し、そうでなければ userId が一致するかで許可する簡易チェック
export function requireRoleOrSelf(allowed: string[], getTargetUserId?: (req: FastifyRequest) => string | undefined) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const roles = req.user?.roles || [];
    const userId = req.user?.userId;
    if (allowed.some((r) => roles.includes(r))) return;
    const targetUser = getTargetUserId ? getTargetUserId(req) : undefined;
    if (!targetUser || !userId || targetUser !== userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}
