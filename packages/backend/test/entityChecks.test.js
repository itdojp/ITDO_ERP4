import assert from 'node:assert/strict';
import test from 'node:test';

import { checkProjectAndVendor } from '../dist/services/entityChecks.js';
import { prisma } from '../dist/services/db.js';

async function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  try {
    return await fn();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

test('checkProjectAndVendor reports project/vendor existence independently', async () => {
  const calls = [];
  await withPrismaStubs(
    {
      'project.findUnique': async (args) => {
        calls.push(['project', args.where.id, args.select]);
        return args.where.id === 'project-ok' ? { id: args.where.id } : null;
      },
      'vendor.findUnique': async (args) => {
        calls.push(['vendor', args.where.id, args.select]);
        return args.where.id === 'vendor-ok' ? { id: args.where.id } : null;
      },
    },
    async () => {
      assert.deepEqual(
        await checkProjectAndVendor('project-ok', 'vendor-missing'),
        { projectExists: true, vendorExists: false },
      );
      assert.deepEqual(
        await checkProjectAndVendor('project-missing', 'vendor-ok'),
        { projectExists: false, vendorExists: true },
      );
    },
  );

  assert.deepEqual(calls, [
    ['project', 'project-ok', { id: true }],
    ['vendor', 'vendor-missing', { id: true }],
    ['project', 'project-missing', { id: true }],
    ['vendor', 'vendor-ok', { id: true }],
  ]);
});
