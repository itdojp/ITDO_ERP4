import { FastifyInstance } from 'fastify';
import { runRecurringTemplates } from '../services/recurring.js';

export async function registerRecurringJobRoutes(app: FastifyInstance) {
  app.post('/jobs/recurring-projects/run', async () => {
    const result = await runRecurringTemplates();
    return result;
  });
}
