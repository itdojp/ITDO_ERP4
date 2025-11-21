import { FastifyReply, FastifyRequest } from 'fastify';

export function requireRole(allowed: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const roles = req.user?.roles || [];
    if (!allowed.some((r) => roles.includes(r))) {
      reply.code(403).send({ error: 'forbidden' });
    }
  };
}
