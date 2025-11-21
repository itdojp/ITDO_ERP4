import { FastifyInstance } from 'fastify';

const demoUser = {
  userId: 'demo-user',
  roles: ['user'],
};

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    return { user: req.user || demoUser };
  });
}
