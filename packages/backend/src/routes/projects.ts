import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import { projectSchema } from './validators.js';
import { prisma } from '../services/db.js';

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return { items: projects };
  });

  app.post('/projects', { preHandler: requireRole(['admin', 'mgmt']), schema: projectSchema }, async (req) => {
    const body = req.body as any;
    const project = await prisma.project.create({ data: body });
    return project;
  });
}
