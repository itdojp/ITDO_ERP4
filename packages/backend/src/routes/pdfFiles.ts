import { FastifyInstance } from 'fastify';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import {
  isSafePdfFilename,
  resolvePdfFilePath,
  resolvePdfStorageDir,
} from '../services/pdf.js';
import { requireRole } from '../services/rbac.js';
import { createPdfArtifactStorageAdapter } from '../adapters/storage/contextArtifactStorageAdapters.js';
import type { PdfStoragePort } from '../application/pdf/pdfStoragePort.js';

type PdfFileRouteDependencies = {
  createStorage?: () => PdfStoragePort;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function registerPdfFileRoutes(
  app: FastifyInstance,
  dependencies: PdfFileRouteDependencies = {},
) {
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
    '/pdf-files/artifacts/:artifactId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { artifactId } = req.params as { artifactId: string };
      if (!UUID_PATTERN.test(artifactId)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ARTIFACT_ID',
            message: 'Invalid artifact ID',
          },
        });
      }
      try {
        const storage =
          dependencies.createStorage?.() ??
          createPdfArtifactStorageAdapter({ provider: 'gdrive' });
        const opened = await storage.open(artifactId);
        const safeFilename = opened.artifact.originalName.replace(
          /["\\\r\n]/g,
          '_',
        );
        reply.header(
          'Content-Disposition',
          `inline; filename="${safeFilename}"`,
        );
        reply.type(opened.artifact.contentType || 'application/pdf');
        opened.stream.on('error', (err) => {
          opened.stream.destroy();
          if (req.log && typeof req.log.error === 'function') {
            req.log.error(
              { err: err instanceof Error ? err.message : 'stream_failed' },
              'Error while streaming PDF artifact',
            );
          }
          if (!reply.raw.headersSent) {
            reply.status(500).send({ error: 'internal_error' });
          }
        });
        return reply.send(opened.stream);
      } catch (error) {
        if (error instanceof Error && error.message === 'artifact_not_found') {
          return reply.status(404).send({ error: 'not_found' });
        }
        return reply.status(500).send({ error: 'internal_error' });
      }
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
