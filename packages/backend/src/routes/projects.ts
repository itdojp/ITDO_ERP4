import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../services/rbac.js';
import { Type } from '@sinclair/typebox';

const prisma = new PrismaClient();

const projectSchema = {
  body: Type.Object({
    code: Type.String(),
    name: Type.String(),
    status: Type.Optional(Type.String()),
    customerId: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.String()),
  }),
};

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
