import fp from 'fastify-plugin';

export type UserContext = {
  userId: string;
  roles: string[];
  orgId?: string;
  projectIds?: string[];
  groupIds?: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserContext;
  }
}

async function authMock(fastify: any) {
  fastify.addHook('onRequest', async (req: any) => {
    const userId = (req.headers['x-user-id'] as string) || 'demo-user';
    const rolesHeader = (req.headers['x-roles'] as string) || 'user';
    const roles = rolesHeader.split(',').map((r: string) => r.trim()).filter(Boolean);
    const projectIdsHeader = (req.headers['x-project-ids'] as string) || '';
    const projectIds = projectIdsHeader
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);
    const groupIdsHeader = (req.headers['x-group-ids'] as string) || '';
    const groupIds = groupIdsHeader
      .split(',')
      .map((g: string) => g.trim())
      .filter(Boolean);
    req.user = { userId, roles, projectIds, groupIds };
  });
}

export default fp(authMock);
