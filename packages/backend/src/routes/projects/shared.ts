import type { FastifyReply, FastifyRequest } from 'fastify';

export async function ensureProjectIdParam(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const projectId = (req.params as { projectId?: string } | undefined)
    ?.projectId;
  if (!projectId) {
    return reply.status(400).send({
      error: { code: 'INVALID_PROJECT', message: 'Project id is required' },
    });
  }
  return undefined;
}

export function projectActorFromRequest(req: FastifyRequest) {
  const user = (req as any).user;
  return {
    userId: user?.userId ?? null,
    roles: user?.roles || [],
    projectIds: user?.projectIds || [],
  };
}

export function projectApplicationLogger(req: FastifyRequest) {
  const warn =
    typeof req.log?.warn === 'function'
      ? req.log.warn.bind(req.log)
      : undefined;
  const error =
    typeof req.log?.error === 'function'
      ? req.log.error.bind(req.log)
      : undefined;
  if (!warn && !error) return undefined;
  return { warn, error };
}

export function sendApplicationResult(reply: FastifyReply, result: any) {
  if (!result.ok) return reply.status(result.statusCode).send(result.body);
  return result.value;
}
