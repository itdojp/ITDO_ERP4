import { FastifyInstance } from 'fastify';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { isSafePdfFilename, resolvePdfFilePath } from '../services/pdf.js';
import { requireRole } from '../services/rbac.js';

export async function registerPdfFileRoutes(app: FastifyInstance) {
  app.get(
    '/pdf-files/:filename',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { filename } = req.params as { filename: string };
      if (!isSafePdfFilename(filename)) {
        return reply.status(400).send({
          error: { code: 'INVALID_FILENAME', message: 'Invalid PDF filename' },
        });
      }
      const filePath = resolvePdfFilePath(filename);
      try {
        await fs.access(filePath);
      } catch {
        return reply.status(404).send({ error: 'not_found' });
      }
      reply.header(
        'Content-Disposition',
        `inline; filename="${filename}"`,
      );
      reply.type('application/pdf');
      return reply.send(createReadStream(filePath));
    },
  );
}
