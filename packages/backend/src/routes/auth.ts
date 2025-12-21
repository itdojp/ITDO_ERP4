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
    const isPrivileged = user.roles.includes('admin') || user.roles.includes('mgmt');
    const ownerProjects = isPrivileged ? 'all' : user.projectIds || demoUser.projectIds;
    const ownerOrgId = isPrivileged ? user.orgId || 'all' : user.orgId || demoUser.orgId;
    return { user: { ...user, ownerOrgId, ownerProjects } };
  });
}
