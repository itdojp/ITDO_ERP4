import { FastifyInstance } from 'fastify';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    return { user: req.user };
  });
}
