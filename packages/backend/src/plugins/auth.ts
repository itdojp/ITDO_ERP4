import fp from 'fastify-plugin';

export type UserContext = {
  userId: string;
  roles: string[];
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
    req.user = { userId, roles };
  });
}

export default fp(authMock);
