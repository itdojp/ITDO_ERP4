import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes/index.js';
import authPlugin from './plugins/auth.js';

async function main() {
  const server = Fastify({ logger: true });
  await server.register(cors, { origin: true, maxAge: 86400 });
  await server.register(authPlugin);

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
