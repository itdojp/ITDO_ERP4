import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { registerRoutes } from './routes/index.js';
import authPlugin from './plugins/auth.js';

async function main() {
  const server = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  await server.register(cors, {
    origin:
      allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : false,
    maxAge: 86400,
  });
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
      },
    },
  });
  await server.register(authPlugin);
  const chatAttachmentMaxBytes = Number(
    process.env.CHAT_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024,
  );
  await server.register(multipart, {
    limits: {
      fileSize:
        Number.isFinite(chatAttachmentMaxBytes) && chatAttachmentMaxBytes > 0
          ? Math.floor(chatAttachmentMaxBytes)
          : 10 * 1024 * 1024,
    },
  });

  // health
  server.get('/health', async () => ({ ok: true }));
  await registerRoutes(server);

  server.setErrorHandler((err: any, _req, reply) => {
    const status = err.statusCode || 500;
    if (err.validation) {
      return reply.status(status).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: err.validation,
        },
      });
    }
    return reply.status(status).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    });
  });

  const port = Number(process.env.PORT || 3001);
  server.listen({ port, host: '0.0.0.0' }).catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
}

main();
