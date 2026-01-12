import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { contactPatchSchema, contactSchema } from './validators.js';

type ContactBody = {
  customerId?: string;
  vendorId?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary?: boolean;
};

type ContactUpdateBody = {
  customerId?: string | null;
  vendorId?: string | null;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary?: boolean;
  updatedBy?: string;
};

const hasBothOwners = (body: { customerId?: string; vendorId?: string }) =>
  Boolean(body.customerId) && Boolean(body.vendorId);

const ownerFilter = (customerId?: string | null, vendorId?: string | null) =>
  customerId ? { customerId } : { vendorId: vendorId ?? undefined };

export async function registerContactRoutes(app: FastifyInstance) {
  app.get(
    '/contacts',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { customerId, vendorId } = req.query as {
        customerId?: string;
        vendorId?: string;
      };
      if (customerId && vendorId) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Specify either customerId or vendorId',
          },
        });
      }
      if (customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      if (vendorId) {
        const vendor = await prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { id: true },
        });
        if (!vendor) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Vendor not found' },
          });
        }
      }
      const where: Record<string, unknown> = {};
      if (customerId) where.customerId = customerId;
      if (vendorId) where.vendorId = vendorId;
      const items = await prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/contacts/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const contact = await prisma.contact.findUnique({ where: { id } });
      if (!contact) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Contact not found' },
        });
      }
      return contact;
    },
  );

  app.post(
    '/contacts',
    { preHandler: requireRole(['admin', 'mgmt']), schema: contactSchema },
    async (req, reply) => {
      const body = req.body as ContactBody;
      if (!body.customerId && !body.vendorId) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Either customerId or vendorId is required',
          },
        });
      }
      if (hasBothOwners(body)) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Specify either customerId or vendorId',
          },
        });
      }
      if (body.customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: body.customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      if (body.vendorId) {
        const vendor = await prisma.vendor.findUnique({
          where: { id: body.vendorId },
          select: { id: true },
        });
        if (!vendor) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Vendor not found' },
          });
        }
      }
      const userId = req.user?.userId;
      const contact = await prisma.$transaction(async (tx) => {
        if (body.isPrimary) {
          await tx.contact.updateMany({
            where: { ...ownerFilter(body.customerId, body.vendorId) },
            data: { isPrimary: false },
          });
        }
        return tx.contact.create({
          data: {
            customerId: body.customerId,
            vendorId: body.vendorId,
            name: body.name,
            email: body.email,
            phone: body.phone,
            role: body.role,
            isPrimary: body.isPrimary ?? false,
            createdBy: userId,
            updatedBy: userId,
          },
        });
      });
      return contact;
    },
  );

  app.patch(
    '/contacts/:id',
    { preHandler: requireRole(['admin', 'mgmt']), schema: contactPatchSchema },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<ContactBody>;
      const current = await prisma.contact.findUnique({ where: { id } });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Contact not found' },
        });
      }
      if (hasBothOwners(body)) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Specify either customerId or vendorId',
          },
        });
      }
      const hasCustomerIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'customerId',
      );
      const hasVendorIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'vendorId',
      );
      let finalCustomerId = current.customerId;
      let finalVendorId = current.vendorId;
      if (hasCustomerIdProp) {
        finalCustomerId = body.customerId ?? null;
      }
      if (hasVendorIdProp) {
        finalVendorId = body.vendorId ?? null;
      }
      if (body.customerId) {
        finalVendorId = null;
      }
      if (body.vendorId) {
        finalCustomerId = null;
      }
      const hasCustomerOwner = Boolean(finalCustomerId);
      const hasVendorOwner = Boolean(finalVendorId);
      if (hasCustomerOwner === hasVendorOwner) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Contact must have exactly one owner',
          },
        });
      }
      if (body.customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: body.customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      if (body.vendorId) {
        const vendor = await prisma.vendor.findUnique({
          where: { id: body.vendorId },
          select: { id: true },
        });
        if (!vendor) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Vendor not found' },
          });
        }
      }
      const userId = req.user?.userId;
      const data: ContactUpdateBody = {
        ...body,
        updatedBy: userId,
      };
      if (body.customerId) {
        data.vendorId = null;
      }
      if (body.vendorId) {
        data.customerId = null;
      }
      const willBePrimary =
        typeof body.isPrimary === 'boolean'
          ? body.isPrimary
          : current.isPrimary;
      const updated = await prisma.$transaction(async (tx) => {
        if (willBePrimary) {
          await tx.contact.updateMany({
            where: {
              ...ownerFilter(finalCustomerId, finalVendorId),
              id: { not: id },
            },
            data: { isPrimary: false },
          });
        }
        return tx.contact.update({
          where: { id },
          data,
        });
      });
      return updated;
    },
  );
}
