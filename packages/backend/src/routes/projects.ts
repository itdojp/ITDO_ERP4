import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return { items: projects };
  });

  app.post('/projects', async (req) => {
    const body = req.body as any;
    const project = await prisma.project.create({ data: body });
    return project;
  });
}
