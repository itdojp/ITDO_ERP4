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
      const safeFilename = filename.replace(/["\\\r\n]/g, '_');
      reply.header(
        'Content-Disposition',
        `inline; filename="${safeFilename}"`,
      );
      reply.type('application/pdf');
      const stream = createReadStream(filePath);
      stream.on('error', (err) => {
        stream.destroy();
        if (req.log && typeof req.log.error === 'function') {
          req.log.error({ err, filePath }, 'Error while streaming PDF file');
        }
        if (!reply.raw.headersSent) {
          reply.status(500).send({ error: 'internal_error' });
        }
      });
      return reply.send(stream);
    },
  );
}
