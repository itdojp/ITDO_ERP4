import { FastifyInstance } from 'fastify';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import {
  isSafePdfFilename,
  resolvePdfFilePath,
  resolvePdfStorageDir,
} from '../services/pdf.js';
import { requireRole } from '../services/rbac.js';

export async function registerPdfFileRoutes(app: FastifyInstance) {
  app.get(
    '/pdf-files',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const query = req.query as {
        limit?: string;
        offset?: string;
        prefix?: string;
      };
      const limitRaw = Number(query.limit ?? 50);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(1, Math.floor(limitRaw)), 200)
        : 50;
      const offsetRaw = Number(query.offset ?? 0);
      const offset = Number.isFinite(offsetRaw)
        ? Math.max(0, Math.floor(offsetRaw))
        : 0;
      const prefix = typeof query.prefix === 'string' ? query.prefix : '';
      const storageDir = resolvePdfStorageDir();

      let entries: string[] = [];
      try {
        entries = await fs.readdir(storageDir);
      } catch {
        return {
          items: [],
          total: 0,
          limit,
          offset,
        };
      }

      const filtered = entries.filter(
        (name) =>
          isSafePdfFilename(name) && (!prefix || name.startsWith(prefix)),
      );

      const stats = await Promise.all(
        filtered.map(async (name) => {
          try {
            const stat = await fs.stat(resolvePdfFilePath(name));
            return {
              filename: name,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        }),
      );

      const items = stats
        .filter(
          (
            item,
          ): item is { filename: string; size: number; modifiedAt: string } =>
            Boolean(item),
        )
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

      const total = items.length;
      return {
        items: items.slice(offset, offset + limit),
        total,
        limit,
        offset,
      };
    },
  );

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
      reply.header('Content-Disposition', `inline; filename="${safeFilename}"`);
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
