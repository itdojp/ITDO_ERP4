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

  const port = Number(process.env.PORT || 3001);
  server.listen({ port, host: '0.0.0.0' }).catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
}

main();
