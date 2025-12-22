import { FastifyInstance } from 'fastify';
import { getPdfTemplate, listPdfTemplates } from '../services/pdfTemplates.js';
import { requireRole } from '../services/rbac.js';

export async function registerPdfTemplateRoutes(app: FastifyInstance) {
  app.get('/pdf-templates', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { kind } = req.query as { kind?: string };
    const items = listPdfTemplates(kind);
    return { items };
  });

  app.get('/pdf-templates/:id', { preHandler: requireRole(['admin', 'mgmt']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = getPdfTemplate(id);
    if (!template) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return template;
  });
}
