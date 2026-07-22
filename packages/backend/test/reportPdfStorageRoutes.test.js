import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://user:pass@127.0.0.1:5432/postgres?schema=public';
const { registerReportRoutes } = await import('../dist/routes/reports.js');
const { prisma } = await import('../dist/services/db.js');

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

test('report PDF route does not return a stub success when gdrive storage fails', async () => {
  await withPrismaStubs(
    {
      'project.findUnique': async () => ({
        currency: 'JPY',
        planHours: 8,
      }),
      'timeEntry.aggregate': async () => ({ _sum: { minutes: 240 } }),
      'expense.findFirst': async () => null,
      'expense.aggregate': async () => ({ _sum: { amount: 1000 } }),
    },
    async () => {
      const app = Fastify({ logger: false });
      app.addHook('onRequest', async (req) => {
        req.user = {
          userId: 'admin-placeholder',
          roles: ['admin'],
        };
      });
      await registerReportRoutes(app, {
        generatePdf: async () => ({
          provider: 'gdrive',
          url: 'stub://pdf/report:project-effort:default/project-placeholder',
        }),
      });
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/reports/project-effort/project-placeholder?format=pdf',
        });
        assert.equal(response.statusCode, 500, response.body);
        assert.equal(response.json().error.code, 'PDF_GENERATION_FAILED');
        assert.equal(response.body.includes('stub://pdf'), false);
        assert.equal(response.body.includes('PDF_GDRIVE_FOLDER_ID'), false);
      } finally {
        await app.close();
      }
    },
  );
});
