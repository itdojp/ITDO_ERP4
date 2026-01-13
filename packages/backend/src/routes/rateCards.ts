import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseOptionalString(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isValidUnitPrice(unitPrice: number) {
  return Number.isFinite(unitPrice) && unitPrice > 0;
}

export async function registerRateCardRoutes(app: FastifyInstance) {
  const requireAdmin = requireRole(['admin', 'mgmt']);

  app.get('/rate-cards', { preHandler: requireAdmin }, async (req, reply) => {
    const query = (req.query || {}) as {
      projectId?: string;
      workType?: string;
      includeGlobal?: string;
      active?: string;
    };
    const projectId = parseOptionalString(query.projectId);
    const workType = parseOptionalString(query.workType);
    const includeGlobal = query.includeGlobal !== '0';
    const activeOnly = query.active === '1';
    const now = new Date();

    const and: any[] = [];
    if (projectId) {
      if (includeGlobal) {
        and.push({ OR: [{ projectId }, { projectId: null }] });
      } else {
        and.push({ projectId });
      }
    } else if (!includeGlobal) {
      and.push({ projectId: { not: null } });
    }
    if (workType !== null) {
      and.push({ workType });
    }
    if (activeOnly) {
      and.push({ OR: [{ validTo: null }, { validTo: { gte: now } }] });
    }
    const where = and.length ? { AND: and } : {};

    const items = await prisma.rateCard.findMany({
      where,
      orderBy: [{ projectId: 'asc' }, { validFrom: 'desc' }],
      take: 500,
    });
    return { items };
  });

  app.post('/rate-cards', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const projectId = parseOptionalString(body.projectId);
    const role = parseOptionalString(body.role);
    const workType = parseOptionalString(body.workType);
    const currency = parseOptionalString(body.currency);
    const unitPrice = Number(body.unitPrice);
    const validFrom = parseDate(body.validFrom);
    const validTo = parseDate(body.validTo);

    if (!role) {
      return reply.code(400).send({ error: 'role_required' });
    }
    if (!currency) {
      return reply.code(400).send({ error: 'currency_required' });
    }
    if (!isValidUnitPrice(unitPrice)) {
      return reply.code(400).send({ error: 'unit_price_invalid' });
    }
    if (!validFrom) {
      return reply.code(400).send({ error: 'valid_from_invalid' });
    }
    if (validTo && validTo.getTime() < validFrom.getTime()) {
      return reply.code(400).send({ error: 'valid_to_before_from' });
    }
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.code(404).send({ error: 'project_not_found' });
      }
    }

    const created = await prisma.rateCard.create({
      data: {
        projectId,
        role,
        workType,
        unitPrice,
        validFrom,
        validTo: validTo ?? null,
        currency,
      },
    });
    return created;
  });

  app.patch(
    '/rate-cards/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const current = await prisma.rateCard.findUnique({ where: { id } });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const projectId = parseOptionalString(body.projectId);
      const role = parseOptionalString(body.role);
      const workType = parseOptionalString(body.workType);
      const currency = parseOptionalString(body.currency);
      const unitPrice =
        body.unitPrice === undefined ? undefined : Number(body.unitPrice);
      const validFrom =
        body.validFrom === undefined ? undefined : parseDate(body.validFrom);
      const validTo =
        body.validTo === undefined ? undefined : parseDate(body.validTo);

      if (body.projectId !== undefined && projectId) {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, deletedAt: true },
        });
        if (!project || project.deletedAt) {
          return reply.code(404).send({ error: 'project_not_found' });
        }
      }
      if (body.role !== undefined && !role) {
        return reply.code(400).send({ error: 'role_required' });
      }
      if (body.currency !== undefined && !currency) {
        return reply.code(400).send({ error: 'currency_required' });
      }
      if (unitPrice !== undefined) {
        if (!isValidUnitPrice(unitPrice)) {
          return reply.code(400).send({ error: 'unit_price_invalid' });
        }
      }
      if (body.validFrom !== undefined && !validFrom) {
        return reply.code(400).send({ error: 'valid_from_invalid' });
      }
      if (body.validTo !== undefined && body.validTo !== null && !validTo) {
        return reply.code(400).send({ error: 'valid_to_invalid' });
      }
      const nextValidFrom = validFrom ?? current.validFrom;
      const nextValidTo =
        body.validTo === undefined ? current.validTo : validTo;
      if (nextValidTo && nextValidTo.getTime() < nextValidFrom.getTime()) {
        return reply.code(400).send({ error: 'valid_to_before_from' });
      }

      const updated = await prisma.rateCard.update({
        where: { id },
        data: {
          projectId: body.projectId === undefined ? undefined : projectId,
          role: body.role === undefined ? undefined : (role ?? undefined),
          workType: body.workType === undefined ? undefined : workType,
          currency:
            body.currency === undefined ? undefined : (currency ?? undefined),
          unitPrice: unitPrice === undefined ? undefined : unitPrice,
          validFrom:
            validFrom === undefined ? undefined : (validFrom ?? undefined),
          validTo: body.validTo === undefined ? undefined : nextValidTo,
        },
      });
      return updated;
    },
  );

  app.post(
    '/rate-cards/:id/disable',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const current = await prisma.rateCard.findUnique({ where: { id } });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const now = new Date();
      if (current.validTo && current.validTo.getTime() <= now.getTime()) {
        return current;
      }
      const updated = await prisma.rateCard.update({
        where: { id },
        data: {
          validTo: now,
        },
      });
      return updated;
    },
  );
}
