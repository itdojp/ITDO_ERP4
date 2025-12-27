import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import { projectSchema, recurringTemplateSchema } from './validators.js';
import { prisma } from '../services/db.js';

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: projects };
  });

  app.post(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectSchema },
    async (req) => {
      const body = req.body as any;
      const project = await prisma.project.create({ data: body });
      return project;
    },
  );

  app.get(
    '/projects/:id/recurring-template',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const params = req.params as { id: string };
      const template = await prisma.recurringProjectTemplate.findUnique({
        where: { projectId: params.id },
      });
      return template;
    },
  );

  app.post(
    '/projects/:id/recurring-template',
    { preHandler: requireRole(['admin', 'mgmt']), schema: recurringTemplateSchema },
    async (req) => {
      const params = req.params as { id: string };
      const body = req.body as any;
      const data = {
        frequency: body.frequency,
        nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : undefined,
        timezone: body.timezone,
        defaultAmount: body.defaultAmount,
        defaultCurrency: body.defaultCurrency,
        defaultTaxRate: body.defaultTaxRate,
        defaultTerms: body.defaultTerms,
        defaultMilestoneName: body.defaultMilestoneName,
        billUpon: body.billUpon,
        dueDateRule: body.dueDateRule,
        shouldGenerateEstimate: body.shouldGenerateEstimate,
        shouldGenerateInvoice: body.shouldGenerateInvoice,
        isActive: body.isActive,
      };
      const template = await prisma.recurringProjectTemplate.upsert({
        where: { projectId: params.id },
        create: {
          projectId: params.id,
          ...data,
        },
        update: data,
      });
      return template;
    },
  );
}
