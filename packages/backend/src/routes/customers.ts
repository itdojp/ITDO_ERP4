import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { customerPatchSchema, customerSchema } from './validators.js';

type CustomerBody = {
  code: string;
  name: string;
  status: string;
  invoiceRegistrationId?: string;
  taxRegion?: string;
  billingAddress?: string;
  externalSource?: string;
  externalId?: string;
};

export async function registerCustomerRoutes(app: FastifyInstance) {
  app.get(
    '/customers',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { status, code } = req.query as {
        status?: string;
        code?: string;
      };
      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (code) where.code = code;
      const items = await prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/customers/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = await prisma.customer.findUnique({
        where: { id },
      });
      if (!customer) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Customer not found' },
        });
      }
      return customer;
    },
  );

  app.post(
    '/customers',
    { preHandler: requireRole(['admin', 'mgmt']), schema: customerSchema },
    async (req) => {
      const body = req.body as CustomerBody;
      const userId = req.user?.userId;
      const customer = await prisma.customer.create({
        data: {
          ...body,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      return customer;
    },
  );

  app.patch(
    '/customers/:id',
    { preHandler: requireRole(['admin', 'mgmt']), schema: customerPatchSchema },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<CustomerBody>;
      const current = await prisma.customer.findUnique({ where: { id } });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Customer not found' },
        });
      }
      const userId = req.user?.userId;
      const updated = await prisma.customer.update({
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
