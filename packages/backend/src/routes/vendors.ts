import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { vendorPatchSchema, vendorSchema } from './validators.js';

type VendorBody = {
  code: string;
  name: string;
  status: string;
  bankInfo?: string;
  taxRegion?: string;
  externalSource?: string;
  externalId?: string;
};

export async function registerVendorRoutes(app: FastifyInstance) {
  app.get(
    '/vendors',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { status, code } = req.query as {
        status?: string;
        code?: string;
      };
      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (code) where.code = code;
      const items = await prisma.vendor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/vendors/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const vendor = await prisma.vendor.findUnique({
        where: { id },
      });
      if (!vendor) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
      return vendor;
    },
  );

  app.post(
    '/vendors',
    { preHandler: requireRole(['admin', 'mgmt']), schema: vendorSchema },
    async (req) => {
      const body = req.body as VendorBody;
      const userId = req.user?.userId;
      const vendor = await prisma.vendor.create({
        data: {
          ...body,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      return vendor;
    },
  );

  app.patch(
    '/vendors/:id',
    { preHandler: requireRole(['admin', 'mgmt']), schema: vendorPatchSchema },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<VendorBody>;
      const current = await prisma.vendor.findUnique({ where: { id } });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
      const userId = req.user?.userId;
      const updated = await prisma.vendor.update({
        where: { id },
        data: {
          ...body,
          updatedBy: userId,
        },
      });
      return updated;
    },
  );
}
