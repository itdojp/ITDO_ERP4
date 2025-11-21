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
