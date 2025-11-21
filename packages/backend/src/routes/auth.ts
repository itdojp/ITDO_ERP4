import { FastifyInstance } from 'fastify';

const demoUser = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  groups: ['hr-group', 'manager-group'],
  email: 'demo@example.com',
};

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    return { user: req.user || demoUser };
  });
}
