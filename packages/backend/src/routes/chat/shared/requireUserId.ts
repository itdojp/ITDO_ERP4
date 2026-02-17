import type { FastifyReply } from 'fastify';

export function requireUserId(
  reply: FastifyReply,
  userId: string | null | undefined,
) {
  if (userId) return userId;
  return reply.status(400).send({
    error: { code: 'MISSING_USER_ID', message: 'user id is required' },
  });
}
