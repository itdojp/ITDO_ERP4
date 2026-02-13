import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireUserContext } from '../services/authContext.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';

type RefCandidateKind =
  | 'invoice'
  | 'estimate'
  | 'purchase_order'
  | 'vendor_quote'
  | 'vendor_invoice'
  | 'expense'
  | 'project'
  | 'customer'
  | 'vendor'
  | 'chat_message';

type RefCandidateItem = {
  kind: RefCandidateKind;
  id: string;
  label: string;
  url: string;
  projectId?: string | null;
  projectLabel?: string | null;
  meta?: Record<string, unknown>;
};

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

function buildOpenHash(kind: RefCandidateKind, id: string) {
  const params = new URLSearchParams();
  params.set('kind', kind);
  params.set('id', id);
  return `#/open?${params.toString()}`;
}

function normalizeTypes(raw: unknown): RefCandidateKind[] {
  if (typeof raw !== 'string') return [];
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const supported = new Set<RefCandidateKind>([
    'invoice',
    'estimate',
    'purchase_order',
    'vendor_quote',
    'vendor_invoice',
    'expense',
    'project',
    'customer',
    'vendor',
    'chat_message',
  ]);
  const unique: RefCandidateKind[] = [];
  const seen = new Set<string>();
  for (const value of parts) {
    if (seen.has(value)) continue;
    if (supported.has(value as RefCandidateKind)) {
      unique.push(value as RefCandidateKind);
      seen.add(value);
    }
  }
  return unique;
}

async function resolveProjectScopeIds(projectId: string) {
  const scopeIds = new Set<string>();
  const root = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, parentId: true, deletedAt: true },
  });
  if (!root || root.deletedAt) return null;
  scopeIds.add(root.id);

  // Ancestors (up to the root). Stop when a missing/deleted project is found.
  let cursor = root.parentId;
  while (cursor) {
    const parent = await prisma.project.findUnique({
      where: { id: cursor },
      select: { id: true, parentId: true, deletedAt: true },
    });
    if (!parent || parent.deletedAt) break;
    // Guard against accidental cycles in parent pointers.
    if (scopeIds.has(parent.id)) break;
    scopeIds.add(parent.id);
    cursor = parent.parentId;
  }

  // Descendants (all). BFS by parentId.
  let frontier = [projectId];
  while (frontier.length > 0) {
    const children = await prisma.project.findMany({
      where: { parentId: { in: frontier }, deletedAt: null },
      select: { id: true },
    });
    const next: string[] = [];
    for (const child of children) {
      if (scopeIds.has(child.id)) continue;
      scopeIds.add(child.id);
      next.push(child.id);
    }
    frontier = next;
  }

  return Array.from(scopeIds);
}

function buildProjectLabel(project: { code: string; name: string }) {
  return `${project.code} / ${project.name}`;
}

function formatRefTimestamp(value: Date) {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

export async function registerRefCandidateRoutes(app: FastifyInstance) {
  const allowedRoles = ['admin', 'mgmt', 'exec', 'user', 'hr'];

  app.get(
    '/ref-candidates',
    {
      preHandler: [
        requireRole(allowedRoles),
        requireProjectAccess((req) => (req.query as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { userId, roles, projectIds = [] } = requireUserContext(req);
      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const query = (req.query || {}) as {
        projectId?: string;
        q?: string;
        types?: string;
        limit?: string;
      };
      const projectId = normalizeQuery(query.projectId);
      if (!projectId) {
        return reply.status(400).send({ error: 'projectId_required' });
      }

      const trimmed = normalizeQuery(query.q);
      if (trimmed.length > 100) {
        return reply.status(400).send({ error: 'query_too_long' });
      }
      if (trimmed.length < 2) {
        return reply.status(400).send({ error: 'query_too_short' });
      }

      const take = parseLimit(query.limit, 20);
      const parsedTypes = normalizeTypes(query.types);
      const requestedTypes =
        parsedTypes.length > 0
          ? parsedTypes
          : ([
              'invoice',
              'estimate',
              'purchase_order',
              'vendor_quote',
              'vendor_invoice',
              'expense',
              'project',
              'customer',
              'vendor',
              'chat_message',
            ] as RefCandidateKind[]);

      const canSeeAllProjects =
        roles.includes('admin') || roles.includes('mgmt');
      const canAccessMaster = roles.includes('admin') || roles.includes('mgmt');

      const rawScopeIds = await resolveProjectScopeIds(projectId);
      if (!rawScopeIds) {
        return reply.status(404).send({ error: 'project_not_found' });
      }

      let scopeProjectIds = rawScopeIds;
      if (!canSeeAllProjects) {
        const projectIdSet = new Set(projectIds);
        scopeProjectIds = rawScopeIds.filter((id) => projectIdSet.has(id));
      }

      const effectiveTypes = requestedTypes.filter((type) => {
        if ((type === 'customer' || type === 'vendor') && !canAccessMaster) {
          return false;
        }
        return true;
      });
      if (effectiveTypes.length === 0) {
        return { items: [] as RefCandidateItem[] };
      }
      const takePerType = Math.max(1, Math.ceil(take / effectiveTypes.length));

      const items: RefCandidateItem[] = [];

      for (const type of effectiveTypes) {
        if (items.length >= take) break;

        if (type === 'invoice') {
          const invoices = await prisma.invoice.findMany({
            where: {
              deletedAt: null,
              projectId: { in: scopeProjectIds },
              invoiceNo: { contains: trimmed, mode: 'insensitive' },
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            include: { project: { select: { code: true, name: true } } },
          });
          items.push(
            ...invoices.map(
              (invoice): RefCandidateItem => ({
                kind: 'invoice',
                id: invoice.id,
                label: `${invoice.invoiceNo}（${buildProjectLabel(invoice.project)}）`,
                url: buildOpenHash('invoice', invoice.id),
                projectId: invoice.projectId,
                projectLabel: buildProjectLabel(invoice.project),
                meta: {
                  invoiceNo: invoice.invoiceNo,
                  status: invoice.status,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'estimate') {
          const estimates = await prisma.estimate.findMany({
            where: {
              deletedAt: null,
              projectId: { in: scopeProjectIds },
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
            take: takePerType,
            include: { project: { select: { code: true, name: true } } },
          });
          items.push(
            ...estimates.map(
              (estimate): RefCandidateItem => ({
                kind: 'estimate',
                id: estimate.id,
                label: `${estimate.estimateNo}（${buildProjectLabel(estimate.project)}）`,
                url: buildOpenHash('estimate', estimate.id),
                projectId: estimate.projectId,
                projectLabel: buildProjectLabel(estimate.project),
                meta: {
                  estimateNo: estimate.estimateNo,
                  status: estimate.status,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'purchase_order') {
          const purchaseOrders = await prisma.purchaseOrder.findMany({
            where: {
              deletedAt: null,
              projectId: { in: scopeProjectIds },
              OR: [
                { poNo: { contains: trimmed, mode: 'insensitive' } },
                {
                  vendor: { name: { contains: trimmed, mode: 'insensitive' } },
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            include: {
              project: { select: { code: true, name: true } },
              vendor: { select: { name: true } },
            },
          });
          items.push(
            ...purchaseOrders.map(
              (po): RefCandidateItem => ({
                kind: 'purchase_order',
                id: po.id,
                label: `${po.poNo} / ${po.vendor.name}（${buildProjectLabel(po.project)}）`,
                url: buildOpenHash('purchase_order', po.id),
                projectId: po.projectId,
                projectLabel: buildProjectLabel(po.project),
                meta: {
                  poNo: po.poNo,
                  vendorName: po.vendor.name,
                  status: po.status,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'vendor_quote') {
          const vendorQuotes = await prisma.vendorQuote.findMany({
            where: {
              deletedAt: null,
              projectId: { in: scopeProjectIds },
              OR: [
                { quoteNo: { contains: trimmed, mode: 'insensitive' } },
                {
                  vendor: { name: { contains: trimmed, mode: 'insensitive' } },
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            include: {
              project: { select: { code: true, name: true } },
              vendor: { select: { name: true } },
            },
          });
          items.push(
            ...vendorQuotes.map(
              (vq): RefCandidateItem => ({
                kind: 'vendor_quote',
                id: vq.id,
                label: `${vq.quoteNo || '（no quoteNo）'} / ${vq.vendor.name}（${buildProjectLabel(vq.project)}）`,
                url: buildOpenHash('vendor_quote', vq.id),
                projectId: vq.projectId,
                projectLabel: buildProjectLabel(vq.project),
                meta: {
                  quoteNo: vq.quoteNo,
                  vendorName: vq.vendor.name,
                  status: vq.status,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'vendor_invoice') {
          const vendorInvoices = await prisma.vendorInvoice.findMany({
            where: {
              deletedAt: null,
              projectId: { in: scopeProjectIds },
              OR: [
                { vendorInvoiceNo: { contains: trimmed, mode: 'insensitive' } },
                {
                  vendor: { name: { contains: trimmed, mode: 'insensitive' } },
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            include: {
              project: { select: { code: true, name: true } },
              vendor: { select: { name: true } },
            },
          });
          items.push(
            ...vendorInvoices.map(
              (vi): RefCandidateItem => ({
                kind: 'vendor_invoice',
                id: vi.id,
                label: `${vi.vendorInvoiceNo || '（no invoiceNo）'} / ${vi.vendor.name}（${buildProjectLabel(vi.project)}）`,
                url: buildOpenHash('vendor_invoice', vi.id),
                projectId: vi.projectId,
                projectLabel: buildProjectLabel(vi.project),
                meta: {
                  vendorInvoiceNo: vi.vendorInvoiceNo,
                  vendorName: vi.vendor.name,
                  status: vi.status,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'expense') {
          const expenses = await prisma.expense.findMany({
            where: {
              deletedAt: null,
              projectId: { in: scopeProjectIds },
              category: { contains: trimmed, mode: 'insensitive' },
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            include: { project: { select: { code: true, name: true } } },
          });
          items.push(
            ...expenses.map(
              (expense): RefCandidateItem => ({
                kind: 'expense',
                id: expense.id,
                label: `${expense.category} ${String(expense.amount)} ${expense.currency}（${buildProjectLabel(expense.project)}）`,
                url: buildOpenHash('expense', expense.id),
                projectId: expense.projectId,
                projectLabel: buildProjectLabel(expense.project),
                meta: {
                  category: expense.category,
                  amount: String(expense.amount),
                  currency: expense.currency,
                  status: expense.status,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'project') {
          const projects = await prisma.project.findMany({
            where: {
              deletedAt: null,
              id: { in: scopeProjectIds },
              OR: [
                { code: { contains: trimmed, mode: 'insensitive' } },
                { name: { contains: trimmed, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            select: { id: true, code: true, name: true },
          });
          items.push(
            ...projects.map(
              (project): RefCandidateItem => ({
                kind: 'project',
                id: project.id,
                label: buildProjectLabel(project),
                url: buildOpenHash('project', project.id),
                projectId: project.id,
                projectLabel: buildProjectLabel(project),
                meta: {
                  code: project.code,
                  name: project.name,
                },
              }),
            ),
          );
          continue;
        }

        if (type === 'customer') {
          const customers = await prisma.customer.findMany({
            where: {
              OR: [
                { code: { contains: trimmed, mode: 'insensitive' } },
                { name: { contains: trimmed, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            select: { id: true, code: true, name: true },
          });
          items.push(
            ...customers.map(
              (customer): RefCandidateItem => ({
                kind: 'customer',
                id: customer.id,
                label: `${customer.code} / ${customer.name}`,
                url: buildOpenHash('customer', customer.id),
                meta: { code: customer.code, name: customer.name },
              }),
            ),
          );
          continue;
        }

        if (type === 'vendor') {
          const vendors = await prisma.vendor.findMany({
            where: {
              OR: [
                { code: { contains: trimmed, mode: 'insensitive' } },
                { name: { contains: trimmed, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            select: { id: true, code: true, name: true },
          });
          items.push(
            ...vendors.map(
              (vendor): RefCandidateItem => ({
                kind: 'vendor',
                id: vendor.id,
                label: `${vendor.code} / ${vendor.name}`,
                url: buildOpenHash('vendor', vendor.id),
                meta: { code: vendor.code, name: vendor.name },
              }),
            ),
          );
          continue;
        }

        if (type === 'chat_message') {
          const messages = await prisma.chatMessage.findMany({
            where: {
              deletedAt: null,
              body: { contains: trimmed, mode: 'insensitive' },
              room: {
                deletedAt: null,
                type: 'project',
                projectId: { in: scopeProjectIds },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: takePerType,
            include: {
              room: {
                select: {
                  id: true,
                  type: true,
                  name: true,
                  projectId: true,
                  project: { select: { code: true, name: true } },
                },
              },
            },
          });
          items.push(
            ...messages.map((message) => {
              const excerpt = message.body
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
              const projectLabel = message.room.project
                ? buildProjectLabel(message.room.project)
                : null;
              const roomName =
                typeof message.room.name === 'string' &&
                message.room.name.trim()
                  ? message.room.name.trim()
                  : message.roomId;
              const roomLabel = projectLabel
                ? `${projectLabel} / ${roomName}`
                : roomName;
              const createdLabel = formatRefTimestamp(message.createdAt);
              return {
                kind: 'chat_message',
                id: message.id,
                label: `Chat（${roomLabel} / ${createdLabel} / ${message.userId}）: ${excerpt}`,
                url: buildOpenHash('chat_message', message.id),
                projectId: message.room.projectId ?? null,
                projectLabel,
                meta: {
                  roomId: message.roomId,
                  roomName: message.room.name,
                  roomType: message.room.type,
                  userId: message.userId,
                  createdAt: message.createdAt,
                  excerpt,
                },
              } satisfies RefCandidateItem;
            }),
          );
          continue;
        }
      }

      await logAudit({
        action: 'ref_candidates_search',
        targetTable: 'ref_candidates',
        metadata: {
          projectId,
          query: trimmed.slice(0, 100),
          limit: take,
          types: effectiveTypes,
          scopeProjectCount: scopeProjectIds.length,
          canSeeAllProjects,
          canAccessMaster,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return { items: items.slice(0, take) };
    },
  );
}
