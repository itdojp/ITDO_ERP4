import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireUserContext } from '../services/authContext.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';

function parseLimit(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 50);
}

function normalizeQuery(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export async function registerSearchRoutes(app: FastifyInstance) {
  const allowedRoles = ['admin', 'mgmt', 'exec', 'user', 'hr', 'external_chat'];
  const searchRateLimit = getRouteRateLimitOptions('RATE_LIMIT_SEARCH', {
    max: 120,
    timeWindow: '1 minute',
  });

  app.get(
    '/search',
    {
      preHandler: requireRole(allowedRoles),
      config: { rateLimit: searchRateLimit },
    },
    async (req, reply) => {
      const { userId, roles, projectIds = [] } = requireUserContext(req);
      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const query = (req.query || {}) as { q?: string; limit?: string };
      const trimmed = normalizeQuery(query.q);
      if (trimmed.length > 100) {
        return reply.code(400).send({ error: 'query_too_long' });
      }
      if (trimmed.length < 2) {
        return reply.code(400).send({ error: 'query_too_short' });
      }

      const take = parseLimit(query.limit, 10);

      const isExternal = roles.includes('external_chat');
      const canSeeAllProjects =
        roles.includes('admin') || roles.includes('mgmt');

      const result = {
        query: trimmed,
        projects: [] as any[],
        invoices: [] as any[],
        estimates: [] as any[],
        expenses: [] as any[],
        timeEntries: [] as any[],
        purchaseOrders: [] as any[],
        vendorQuotes: [] as any[],
        vendorInvoices: [] as any[],
      };

      if (!isExternal) {
        const projectScope = canSeeAllProjects
          ? undefined
          : projectIds.length > 0
            ? { in: projectIds }
            : null;

        if (canSeeAllProjects || projectScope) {
          result.projects = await prisma.project.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { id: { in: projectIds }, deletedAt: null }),
              OR: [
                { code: { contains: trimmed, mode: 'insensitive' } },
                { name: { contains: trimmed, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take,
            select: { id: true, code: true, name: true, status: true },
          });
        }

        if (canSeeAllProjects || projectScope) {
          result.invoices = await prisma.invoice.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              invoiceNo: { contains: trimmed, mode: 'insensitive' },
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: { project: { select: { code: true, name: true } } },
          });

          result.estimates = await prisma.estimate.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              OR: [
                { estimateNo: { contains: trimmed, mode: 'insensitive' } },
                { notes: { contains: trimmed, mode: 'insensitive' } },
                {
                  lines: {
                    some: {
                      description: { contains: trimmed, mode: 'insensitive' },
                    },
                  },
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: { project: { select: { code: true, name: true } } },
          });

          result.expenses = await prisma.expense.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              category: { contains: trimmed, mode: 'insensitive' },
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: { project: { select: { code: true, name: true } } },
          });

          result.timeEntries = await prisma.timeEntry.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              OR: [
                { notes: { contains: trimmed, mode: 'insensitive' } },
                { workType: { contains: trimmed, mode: 'insensitive' } },
                { location: { contains: trimmed, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: { project: { select: { code: true, name: true } } },
          });

          result.purchaseOrders = await prisma.purchaseOrder.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              poNo: { contains: trimmed, mode: 'insensitive' },
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: {
              project: { select: { code: true, name: true } },
              vendor: { select: { name: true } },
            },
          });

          result.vendorQuotes = await prisma.vendorQuote.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              OR: [
                { quoteNo: { contains: trimmed, mode: 'insensitive' } },
                {
                  vendor: { name: { contains: trimmed, mode: 'insensitive' } },
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: {
              project: { select: { code: true, name: true } },
              vendor: { select: { name: true } },
            },
          });

          result.vendorInvoices = await prisma.vendorInvoice.findMany({
            where: {
              deletedAt: null,
              ...(canSeeAllProjects
                ? {}
                : { projectId: { in: projectIds }, deletedAt: null }),
              OR: [
                {
                  vendorInvoiceNo: { contains: trimmed, mode: 'insensitive' },
                },
                {
                  vendor: { name: { contains: trimmed, mode: 'insensitive' } },
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: {
              project: { select: { code: true, name: true } },
              vendor: { select: { name: true } },
            },
          });
        }
      }

      const counts = {
        projects: result.projects.length,
        invoices: result.invoices.length,
        estimates: result.estimates.length,
        expenses: result.expenses.length,
        timeEntries: result.timeEntries.length,
        purchaseOrders: result.purchaseOrders.length,
        vendorQuotes: result.vendorQuotes.length,
        vendorInvoices: result.vendorInvoices.length,
      };

      await logAudit({
        action: 'erp_search',
        targetTable: 'search',
        metadata: {
          query: trimmed.slice(0, 100),
          limit: take,
          counts,
          isExternal,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return result;
    },
  );
}
