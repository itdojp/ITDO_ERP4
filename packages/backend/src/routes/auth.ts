import { FastifyInstance } from 'fastify';

const demoUser = {
  userId: 'demo-user',
  roles: ['user'],
  orgId: 'org-demo',
  projectIds: ['00000000-0000-0000-0000-000000000001'],
};

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const user = req.user || demoUser;
    const ownerProjects = user.roles.includes('admin') || user.roles.includes('mgmt') ? 'all' : user.projectIds || demoUser.projectIds;
    return { user: { ...user, ownerProjects } };
  });
}
