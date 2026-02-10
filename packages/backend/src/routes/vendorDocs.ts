import type { Prisma } from '@prisma/client';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { createApprovalPendingNotifications } from '../services/appNotifications.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import {
  vendorInvoiceAllocationsSchema,
  vendorInvoiceLinesSchema,
  vendorInvoiceLinkPoSchema,
  vendorInvoiceSchema,
  vendorInvoiceUnlinkPoSchema,
  vendorQuoteSchema,
} from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { checkProjectAndVendor } from '../services/entityChecks.js';
import { parseDateParam } from '../utils/date.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';
import { logActionPolicyOverrideIfNeeded } from '../services/actionPolicyAudit.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { normalizeVendorInvoiceAllocations } from '../services/vendorInvoiceAllocations.js';
import { normalizeVendorInvoiceLines } from '../services/vendorInvoiceLines.js';
import { findExceededPurchaseOrderLineQuantities } from '../services/vendorInvoiceLineReconciliation.js';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumberValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    const candidate = value as { toNumber?: () => number };
    if (typeof candidate.toNumber === 'function') {
      const parsed = candidate.toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function isVendorInvoicePreSubmitStatus(status: string) {
  // VendorInvoice is created in `received` status. Some legacy flows may still use `draft`.
  // When rejected, the invoice is typically returned for correction (treated as editable in normal operations).
  return (
    status === DocStatusValue.received ||
    status === DocStatusValue.draft ||
    status === DocStatusValue.rejected
  );
}

function summarizeVendorInvoiceLineTotals(
  lines: Array<{
    amount: unknown;
    taxAmount: unknown;
    grossAmount: unknown;
  }>,
  invoiceTotal: number,
) {
  let amountTotal = 0;
  let taxTotal = 0;
  let grossTotal = 0;
  for (const line of lines) {
    amountTotal += parseNumberValue(line.amount) ?? 0;
    taxTotal += parseNumberValue(line.taxAmount) ?? 0;
    grossTotal += parseNumberValue(line.grossAmount) ?? 0;
  }
  return {
    amountTotal,
    taxTotal,
    grossTotal,
    diff: invoiceTotal - grossTotal,
  };
}

export async function registerVendorDocRoutes(app: FastifyInstance) {
  app.get(
    '/vendor-quotes',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId, vendorId, status } = req.query as {
        projectId?: string;
        vendorId?: string;
        status?: string;
      };
      const where: Record<string, unknown> = {};
      if (projectId) where.projectId = projectId;
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      const items = await prisma.vendorQuote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/vendor-quotes/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const quote = await prisma.vendorQuote.findUnique({
        where: { id },
      });
      if (!quote) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor quote not found' },
        });
      }
      return quote;
    },
  );

  app.get(
    '/vendor-invoices',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId, vendorId, status } = req.query as {
        projectId?: string;
        vendorId?: string;
        status?: string;
      };
      const where: Record<string, unknown> = {};
      if (projectId) where.projectId = projectId;
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      const items = await prisma.vendorInvoice.findMany({
        where,
        include: { purchaseOrder: { select: { id: true, poNo: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/vendor-invoices/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.vendorInvoice.findUnique({
        where: { id },
        include: { purchaseOrder: { select: { id: true, poNo: true } } },
      });
      if (!invoice) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }
      return invoice;
    },
  );

  app.get(
    '/vendor-invoices/:id/allocations',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.vendorInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          projectId: true,
          vendorId: true,
          purchaseOrderId: true,
          vendorInvoiceNo: true,
          receivedDate: true,
          dueDate: true,
          currency: true,
          totalAmount: true,
          documentUrl: true,
          deletedAt: true,
        },
      });
      if (!invoice || invoice.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }
      const items = await prisma.vendorInvoiceAllocation.findMany({
        where: { vendorInvoiceId: id },
        orderBy: { createdAt: 'asc' },
      });
      return { invoice, items };
    },
  );

  app.get(
    '/vendor-invoices/:id/lines',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.vendorInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          projectId: true,
          vendorId: true,
          purchaseOrderId: true,
          vendorInvoiceNo: true,
          receivedDate: true,
          dueDate: true,
          currency: true,
          totalAmount: true,
          documentUrl: true,
          deletedAt: true,
        },
      });
      if (!invoice || invoice.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }
      const items = await prisma.vendorInvoiceLine.findMany({
        where: { vendorInvoiceId: id },
        orderBy: [{ lineNo: 'asc' }, { createdAt: 'asc' }],
      });
      const invoiceTotal = parseNumberValue(invoice.totalAmount) ?? 0;
      const totals = summarizeVendorInvoiceLineTotals(items, invoiceTotal);
      return { invoice, items, totals };
    },
  );

  app.post(
    '/vendor-quotes',
    { preHandler: requireRole(['admin', 'mgmt']), schema: vendorQuoteSchema },
    async (req, reply) => {
      const body = req.body as any;
      const issueDate = parseDateParam(body.issueDate);
      if (body.issueDate && !issueDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid issueDate' },
        });
      }
      const { projectExists, vendorExists } = await checkProjectAndVendor(
        body.projectId,
        body.vendorId,
      );
      if (!projectExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      if (!vendorExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
      const vendorQuote = await prisma.vendorQuote.create({
        data: {
          ...body,
          issueDate,
          currency: body.currency ?? 'JPY',
        },
      });
      return vendorQuote;
    },
  );

  app.post(
    '/vendor-invoices',
    { preHandler: requireRole(['admin', 'mgmt']), schema: vendorInvoiceSchema },
    async (req, reply) => {
      const body = req.body as any;
      const receivedDate = parseDateParam(body.receivedDate);
      if (body.receivedDate && !receivedDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid receivedDate' },
        });
      }
      const dueDate = parseDateParam(body.dueDate);
      if (body.dueDate && !dueDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid dueDate' },
        });
      }
      if (
        body.purchaseOrderId != null &&
        typeof body.purchaseOrderId !== 'string'
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PURCHASE_ORDER',
            message: 'purchaseOrderId must be string',
          },
        });
      }
      const { projectExists, vendorExists } = await checkProjectAndVendor(
        body.projectId,
        body.vendorId,
      );
      if (!projectExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      if (!vendorExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
      if (body.purchaseOrderId) {
        const purchaseOrder = await prisma.purchaseOrder.findUnique({
          where: { id: body.purchaseOrderId },
          select: {
            id: true,
            projectId: true,
            vendorId: true,
            deletedAt: true,
          },
        });
        if (!purchaseOrder || purchaseOrder.deletedAt) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Purchase order not found' },
          });
        }
        if (purchaseOrder.projectId !== body.projectId) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PURCHASE_ORDER',
              message: 'Purchase order project does not match',
            },
          });
        }
        if (purchaseOrder.vendorId !== body.vendorId) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PURCHASE_ORDER',
              message: 'Purchase order vendor does not match',
            },
          });
        }
      }
      const vi = await prisma.vendorInvoice.create({
        data: {
          ...body,
          receivedDate,
          dueDate,
          currency: body.currency ?? 'JPY',
        },
      });
      return vi;
    },
  );

  app.put(
    '/vendor-invoices/:id/allocations',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: vendorInvoiceAllocationsSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const actorId = req.user?.userId;
      const reasonText = normalizeString(body?.reasonText);
      const autoAdjust = body?.autoAdjust !== false;
      const invoice = await prisma.vendorInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          projectId: true,
          vendorId: true,
          purchaseOrderId: true,
          currency: true,
          totalAmount: true,
          deletedAt: true,
        },
      });
      if (!invoice || invoice.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'update_allocations',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: { status: invoice.status, projectId: invoice.projectId },
        targetTable: 'vendor_invoices',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        if (policyRes.reason === 'reason_required') {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
              details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
            },
          });
        }
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'VendorInvoice allocations cannot be updated',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'update_allocations',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText,
        result: policyRes,
      });

      const requiresReason =
        !policyRes.policyApplied &&
        !isVendorInvoicePreSubmitStatus(invoice.status);
      if (requiresReason && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'REASON_REQUIRED',
            message: 'reasonText is required for override',
          },
        });
      }

      const rawAllocations = Array.isArray(body?.allocations)
        ? body.allocations
        : [];
      const normalizedInputs: Array<{
        projectId: string;
        amount: number;
        taxRate: number | null;
        taxAmount: number | null;
        purchaseOrderLineId: string | null;
      }> = [];
      const projectIds = new Set<string>();
      const purchaseOrderLineIds = new Set<string>();

      for (let i = 0; i < rawAllocations.length; i += 1) {
        const entry = rawAllocations[i] || {};
        const projectId = normalizeString(entry.projectId);
        if (!projectId) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `allocations[${i}].projectId is required`,
            },
          });
        }
        const amount = parseNumberValue(entry.amount);
        if (amount == null || amount < 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_AMOUNT',
              message: `allocations[${i}].amount must be >= 0`,
            },
          });
        }
        const taxRateRaw = entry.taxRate;
        const taxRate =
          taxRateRaw === undefined || taxRateRaw === null
            ? null
            : parseNumberValue(taxRateRaw);
        if (taxRateRaw != null && (taxRate == null || taxRate < 0)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_TAX_RATE',
              message: `allocations[${i}].taxRate must be >= 0`,
            },
          });
        }
        const taxAmountRaw = entry.taxAmount;
        const taxAmount =
          taxAmountRaw === undefined || taxAmountRaw === null
            ? null
            : parseNumberValue(taxAmountRaw);
        if (taxAmountRaw != null && (taxAmount == null || taxAmount < 0)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_TAX_AMOUNT',
              message: `allocations[${i}].taxAmount must be >= 0`,
            },
          });
        }
        const purchaseOrderLineId = normalizeString(entry.purchaseOrderLineId);
        if (purchaseOrderLineId) {
          purchaseOrderLineIds.add(purchaseOrderLineId);
        }
        projectIds.add(projectId);
        normalizedInputs.push({
          projectId,
          amount,
          taxRate,
          taxAmount,
          purchaseOrderLineId: purchaseOrderLineId || null,
        });
      }

      if (projectIds.size > 0) {
        const projects = await prisma.project.findMany({
          where: { id: { in: Array.from(projectIds) }, deletedAt: null },
          select: { id: true },
        });
        const found = new Set(projects.map((project) => project.id));
        const missing = Array.from(projectIds).filter((id) => !found.has(id));
        if (missing.length) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Project not found',
              details: { missingProjectIds: missing.slice(0, 20) },
            },
          });
        }
      }

      if (purchaseOrderLineIds.size > 0) {
        if (!invoice.purchaseOrderId) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PURCHASE_ORDER_LINE',
              message: 'purchaseOrderId is not linked to the invoice',
            },
          });
        }
        const lines = await prisma.purchaseOrderLine.findMany({
          where: { id: { in: Array.from(purchaseOrderLineIds) } },
          select: { id: true, purchaseOrderId: true },
        });
        const lineMap = new Map(lines.map((line) => [line.id, line]));
        const missingLines = Array.from(purchaseOrderLineIds).filter(
          (lineId) => !lineMap.has(lineId),
        );
        if (missingLines.length) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Purchase order line not found',
              details: {
                missingPurchaseOrderLineIds: missingLines.slice(0, 20),
              },
            },
          });
        }
        const invalidLines = lines.filter(
          (line) => line.purchaseOrderId !== invoice.purchaseOrderId,
        );
        if (invalidLines.length) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PURCHASE_ORDER_LINE',
              message: 'Purchase order line does not belong to the linked PO',
              details: {
                invalidPurchaseOrderLineIds: invalidLines
                  .map((line) => line.id)
                  .slice(0, 20),
              },
            },
          });
        }
      }

      const invoiceTotal = parseNumberValue(invoice.totalAmount);
      if (invoiceTotal == null) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_INVOICE_TOTAL',
            message: 'Vendor invoice total is invalid',
          },
        });
      }

      const normalized = normalizeVendorInvoiceAllocations(
        normalizedInputs.map((entry) => ({
          amount: entry.amount,
          taxRate: entry.taxRate,
          taxAmount: entry.taxAmount,
        })),
        invoiceTotal,
        { autoAdjust },
      );
      if (
        normalized.items.length > 0 &&
        Math.abs(normalized.totals.diff) > 0.00001
      ) {
        return reply.status(400).send({
          error: {
            code: 'ALLOCATION_MISMATCH',
            message: 'Allocation totals do not match invoice total',
            details: {
              invoiceTotal,
              allocationTotal: normalized.totals.grossTotal,
              diff: normalized.totals.diff,
            },
          },
        });
      }

      const beforeItems = await prisma.vendorInvoiceAllocation.findMany({
        where: { vendorInvoiceId: id },
        select: { amount: true, taxRate: true, taxAmount: true },
      });
      const beforeSummary = normalizeVendorInvoiceAllocations(
        beforeItems.map((item) => ({
          amount: parseNumberValue(item.amount) ?? 0,
          taxRate: parseNumberValue(item.taxRate),
          taxAmount: parseNumberValue(item.taxAmount),
        })),
        invoiceTotal,
        { autoAdjust: false },
      ).totals;

      await prisma.$transaction(async (tx) => {
        await tx.vendorInvoiceAllocation.deleteMany({
          where: { vendorInvoiceId: id },
        });
        if (normalized.items.length > 0) {
          await tx.vendorInvoiceAllocation.createMany({
            data: normalized.items.map((entry, index) => ({
              vendorInvoiceId: id,
              projectId: normalizedInputs[index].projectId,
              purchaseOrderLineId: normalizedInputs[index].purchaseOrderLineId,
              amount: entry.amount,
              taxRate: entry.taxRate,
              taxAmount: entry.taxAmount,
              createdBy: actorId ?? undefined,
              updatedBy: actorId ?? undefined,
            })),
          });
        }
        await tx.vendorInvoice.update({
          where: { id },
          data: { updatedBy: actorId ?? undefined },
        });
      });

      const items = await prisma.vendorInvoiceAllocation.findMany({
        where: { vendorInvoiceId: id },
        orderBy: { createdAt: 'asc' },
      });

      await logAudit({
        action:
          normalized.items.length > 0
            ? 'vendor_invoice_allocations_update'
            : 'vendor_invoice_allocations_clear',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText: reasonText || undefined,
        metadata: {
          status: invoice.status,
          currency: invoice.currency,
          invoiceTotal,
          before: {
            count: beforeItems.length,
            amountTotal: beforeSummary.amountTotal,
            taxTotal: beforeSummary.taxTotal,
            grossTotal: beforeSummary.grossTotal,
            diff: beforeSummary.diff,
          },
          after: {
            count: normalized.items.length,
            amountTotal: normalized.totals.amountTotal,
            taxTotal: normalized.totals.taxTotal,
            grossTotal: normalized.totals.grossTotal,
            diff: normalized.totals.diff,
            adjusted: normalized.adjusted,
          },
          actionPolicy: policyRes.policyApplied
            ? {
                matchedPolicyId: (policyRes as any).matchedPolicyId ?? null,
                requireReason: (policyRes as any).requireReason ?? false,
              }
            : { matchedPolicyId: null, requireReason: false },
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, actorId ? { userId: actorId } : {}),
      });

      return { items, totals: normalized.totals };
    },
  );

  app.put(
    '/vendor-invoices/:id/lines',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: vendorInvoiceLinesSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const actorId = req.user?.userId;
      const reasonText = normalizeString(body?.reasonText);
      const autoAdjust = body?.autoAdjust !== false;
      const invoice = await prisma.vendorInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          projectId: true,
          vendorId: true,
          purchaseOrderId: true,
          currency: true,
          totalAmount: true,
          deletedAt: true,
        },
      });
      if (!invoice || invoice.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'update_lines',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: { status: invoice.status, projectId: invoice.projectId },
        targetTable: 'vendor_invoices',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        if (policyRes.reason === 'reason_required') {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
              details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
            },
          });
        }
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'Vendor invoice lines cannot be updated',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'update_lines',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText,
        result: policyRes,
      });

      const requiresReason =
        !policyRes.policyApplied &&
        !isVendorInvoicePreSubmitStatus(invoice.status);
      if (requiresReason && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'REASON_REQUIRED',
            message: 'reasonText is required for override',
          },
        });
      }

      const rawLines = Array.isArray(body?.lines) ? body.lines : [];
      const normalizedInputs: Array<{
        lineNo: number;
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number | null;
        taxRate: number | null;
        taxAmount: number | null;
        purchaseOrderLineId: string | null;
      }> = [];
      const lineNos = new Set<number>();
      const purchaseOrderLineIds = new Set<string>();

      for (let i = 0; i < rawLines.length; i += 1) {
        const entry = rawLines[i] || {};
        const lineNoRaw = entry.lineNo;
        const lineNo =
          Number.isInteger(lineNoRaw) && Number(lineNoRaw) > 0
            ? Number(lineNoRaw)
            : i + 1;
        if (lineNo <= 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].lineNo must be >= 1`,
            },
          });
        }
        if (lineNos.has(lineNo)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].lineNo is duplicated`,
            },
          });
        }
        lineNos.add(lineNo);

        const description = normalizeString(entry.description);
        if (!description) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].description is required`,
            },
          });
        }
        const quantity = parseNumberValue(entry.quantity);
        if (quantity == null || quantity <= 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].quantity must be > 0`,
            },
          });
        }
        const unitPrice = parseNumberValue(entry.unitPrice);
        if (unitPrice == null || unitPrice < 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].unitPrice must be >= 0`,
            },
          });
        }
        const amountRaw = entry.amount;
        const amount =
          amountRaw === undefined || amountRaw === null
            ? null
            : parseNumberValue(amountRaw);
        if (amountRaw != null && (amount == null || amount < 0)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].amount must be >= 0`,
            },
          });
        }
        const taxRateRaw = entry.taxRate;
        const taxRate =
          taxRateRaw === undefined || taxRateRaw === null
            ? null
            : parseNumberValue(taxRateRaw);
        if (taxRateRaw != null && (taxRate == null || taxRate < 0)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].taxRate must be >= 0`,
            },
          });
        }
        const taxAmountRaw = entry.taxAmount;
        const taxAmount =
          taxAmountRaw === undefined || taxAmountRaw === null
            ? null
            : parseNumberValue(taxAmountRaw);
        if (taxAmountRaw != null && (taxAmount == null || taxAmount < 0)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: `lines[${i}].taxAmount must be >= 0`,
            },
          });
        }
        const purchaseOrderLineId = normalizeString(entry.purchaseOrderLineId);
        if (purchaseOrderLineId) {
          purchaseOrderLineIds.add(purchaseOrderLineId);
        }
        normalizedInputs.push({
          lineNo,
          description,
          quantity,
          unitPrice,
          amount,
          taxRate,
          taxAmount,
          purchaseOrderLineId: purchaseOrderLineId || null,
        });
      }

      let purchaseOrderLineMap = new Map<
        string,
        { id: string; purchaseOrderId: string; quantity: unknown }
      >();
      if (purchaseOrderLineIds.size > 0) {
        if (!invoice.purchaseOrderId) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PURCHASE_ORDER_LINE',
              message: 'purchaseOrderId is not linked to the invoice',
            },
          });
        }
        const lines = await prisma.purchaseOrderLine.findMany({
          where: { id: { in: Array.from(purchaseOrderLineIds) } },
          select: { id: true, purchaseOrderId: true, quantity: true },
        });
        purchaseOrderLineMap = new Map(lines.map((line) => [line.id, line]));
        const missingLines = Array.from(purchaseOrderLineIds).filter(
          (lineId) => !purchaseOrderLineMap.has(lineId),
        );
        if (missingLines.length) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Purchase order line not found',
              details: {
                missingPurchaseOrderLineIds: missingLines.slice(0, 20),
              },
            },
          });
        }
        const invalidLines = lines.filter(
          (line) => line.purchaseOrderId !== invoice.purchaseOrderId,
        );
        if (invalidLines.length) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PURCHASE_ORDER_LINE',
              message: 'Purchase order line does not belong to the linked PO',
              details: {
                invalidPurchaseOrderLineIds: invalidLines
                  .map((line) => line.id)
                  .slice(0, 20),
              },
            },
          });
        }
      }

      if (purchaseOrderLineIds.size > 0) {
        const existingLines = await prisma.vendorInvoiceLine.findMany({
          where: {
            purchaseOrderLineId: { in: Array.from(purchaseOrderLineIds) },
            vendorInvoiceId: { not: id },
            vendorInvoice: {
              deletedAt: null,
              status: {
                notIn: [DocStatusValue.rejected, DocStatusValue.cancelled],
              },
            },
          },
          select: { purchaseOrderLineId: true, quantity: true },
        });
        const exceeded = findExceededPurchaseOrderLineQuantities({
          purchaseOrderLines: Array.from(purchaseOrderLineMap.values()),
          existingInvoiceLines: existingLines,
          requestedInvoiceLines: normalizedInputs.map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantity: line.quantity,
          })),
        });
        if (exceeded.length) {
          return reply.status(400).send({
            error: {
              code: 'PO_LINE_QUANTITY_EXCEEDED',
              message:
                'Requested quantity exceeds purchase order line quantity',
              details: { exceeded: exceeded.slice(0, 20) },
            },
          });
        }
      }

      const invoiceTotal = parseNumberValue(invoice.totalAmount);
      if (invoiceTotal == null) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_INVOICE_TOTAL',
            message: 'Vendor invoice total is invalid',
          },
        });
      }

      const normalized = normalizeVendorInvoiceLines(
        normalizedInputs.map((line) => ({
          lineNo: line.lineNo,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          purchaseOrderLineId: line.purchaseOrderLineId,
        })),
        invoiceTotal,
        { autoAdjust },
      );
      if (
        normalized.items.length > 0 &&
        Math.abs(normalized.totals.diff) > 0.00001
      ) {
        return reply.status(400).send({
          error: {
            code: 'LINE_TOTAL_MISMATCH',
            message: 'Line totals do not match invoice total',
            details: {
              invoiceTotal,
              lineTotal: normalized.totals.grossTotal,
              diff: normalized.totals.diff,
            },
          },
        });
      }

      const beforeItems = await prisma.vendorInvoiceLine.findMany({
        where: { vendorInvoiceId: id },
        select: {
          amount: true,
          taxAmount: true,
          grossAmount: true,
          quantity: true,
          purchaseOrderLineId: true,
        },
      });
      const beforeSummary = summarizeVendorInvoiceLineTotals(
        beforeItems,
        invoiceTotal,
      );
      const beforeQtyByPoLine = new Map<string, number>();
      for (const item of beforeItems) {
        const lineId = normalizeString(item.purchaseOrderLineId);
        if (!lineId) continue;
        const current = beforeQtyByPoLine.get(lineId) || 0;
        beforeQtyByPoLine.set(
          lineId,
          current + (parseNumberValue(item.quantity) ?? 0),
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.vendorInvoiceLine.deleteMany({
          where: { vendorInvoiceId: id },
        });
        if (normalized.items.length > 0) {
          await tx.vendorInvoiceLine.createMany({
            data: normalized.items.map((line) => ({
              vendorInvoiceId: id,
              lineNo: line.lineNo,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              grossAmount: line.grossAmount,
              purchaseOrderLineId: line.purchaseOrderLineId,
              createdBy: actorId ?? undefined,
              updatedBy: actorId ?? undefined,
            })),
          });
        }
        await tx.vendorInvoice.update({
          where: { id },
          data: { updatedBy: actorId ?? undefined },
        });
      });

      const items = await prisma.vendorInvoiceLine.findMany({
        where: { vendorInvoiceId: id },
        orderBy: [{ lineNo: 'asc' }, { createdAt: 'asc' }],
      });
      const afterQtyByPoLine = new Map<string, number>();
      for (const item of normalized.items) {
        const lineId = normalizeString(item.purchaseOrderLineId);
        if (!lineId) continue;
        const current = afterQtyByPoLine.get(lineId) || 0;
        afterQtyByPoLine.set(lineId, current + item.quantity);
      }

      await logAudit({
        action:
          normalized.items.length > 0
            ? 'vendor_invoice_lines_update'
            : 'vendor_invoice_lines_clear',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText: reasonText || undefined,
        metadata: {
          status: invoice.status,
          currency: invoice.currency,
          invoiceTotal,
          before: {
            count: beforeItems.length,
            amountTotal: beforeSummary.amountTotal,
            taxTotal: beforeSummary.taxTotal,
            grossTotal: beforeSummary.grossTotal,
            diff: beforeSummary.diff,
            quantityByPoLine: Object.fromEntries(beforeQtyByPoLine),
          },
          after: {
            count: normalized.items.length,
            amountTotal: normalized.totals.amountTotal,
            taxTotal: normalized.totals.taxTotal,
            grossTotal: normalized.totals.grossTotal,
            diff: normalized.totals.diff,
            quantityByPoLine: Object.fromEntries(afterQtyByPoLine),
            autoAdjust,
          },
          actionPolicy: policyRes.policyApplied
            ? {
                matchedPolicyId: (policyRes as any).matchedPolicyId ?? null,
                requireReason: (policyRes as any).requireReason ?? false,
              }
            : { matchedPolicyId: null, requireReason: false },
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, actorId ? { userId: actorId } : {}),
      });

      return { items, totals: normalized.totals };
    },
  );

  app.post(
    '/vendor-invoices/:id/link-po',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: vendorInvoiceLinkPoSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const actorId = req.user?.userId;
      const reasonText = normalizeString(body?.reasonText);
      const nextPurchaseOrderId = normalizeString(body?.purchaseOrderId);
      if (!nextPurchaseOrderId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_INPUT',
            message: 'purchaseOrderId must be a non-empty string',
          },
        });
      }

      const before = await prisma.vendorInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          projectId: true,
          vendorId: true,
          purchaseOrderId: true,
          deletedAt: true,
        },
      });
      if (!before || before.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'link_po',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: { status: before.status, projectId: before.projectId },
        targetTable: 'vendor_invoices',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        if (policyRes.reason === 'reason_required') {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
              details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
            },
          });
        }
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'VendorInvoice purchase order cannot be linked',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'link_po',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText,
        result: policyRes,
      });

      const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id: nextPurchaseOrderId },
        select: { id: true, projectId: true, vendorId: true, deletedAt: true },
      });
      if (!purchaseOrder || purchaseOrder.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Purchase order not found' },
        });
      }
      if (purchaseOrder.projectId !== before.projectId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PURCHASE_ORDER',
            message: 'Purchase order project does not match',
          },
        });
      }
      if (purchaseOrder.vendorId !== before.vendorId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PURCHASE_ORDER',
            message: 'Purchase order vendor does not match',
          },
        });
      }

      // If no policy is configured yet (fallback), keep legacy-safe behavior:
      // require a reason when modifying a vendor invoice after it has been submitted.
      const requiresReason =
        !policyRes.policyApplied &&
        !isVendorInvoicePreSubmitStatus(before.status);
      if (requiresReason && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'REASON_REQUIRED',
            message: 'reasonText is required for override',
          },
        });
      }
      if (requiresReason && reasonText) {
        await logAudit({
          action: 'vendor_invoice_link_po_override',
          targetTable: 'vendor_invoices',
          targetId: id,
          reasonText,
          metadata: {
            fromStatus: before.status,
            fromPurchaseOrderId: before.purchaseOrderId ?? null,
            toPurchaseOrderId: purchaseOrder.id,
            actionPolicy: policyRes.policyApplied
              ? {
                  matchedPolicyId: (policyRes as any).matchedPolicyId ?? null,
                  requireReason: (policyRes as any).requireReason ?? false,
                }
              : { matchedPolicyId: null, requireReason: false },
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, actorId ? { userId: actorId } : {}),
        });
      }

      const updated = await prisma.vendorInvoice.update({
        where: { id },
        data: {
          purchaseOrderId: purchaseOrder.id,
          updatedBy: actorId ?? undefined,
        },
        include: { purchaseOrder: { select: { id: true, poNo: true } } },
      });
      await logAudit({
        action: 'vendor_invoice_link_po',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText: reasonText || undefined,
        metadata: {
          projectId: before.projectId,
          vendorId: before.vendorId,
          fromPurchaseOrderId: before.purchaseOrderId ?? null,
          toPurchaseOrderId: purchaseOrder.id,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, actorId ? { userId: actorId } : {}),
      });
      return updated;
    },
  );

  app.post(
    '/vendor-invoices/:id/unlink-po',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: vendorInvoiceUnlinkPoSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const actorId = req.user?.userId;
      const reasonText = normalizeString(body?.reasonText);

      const before = await prisma.vendorInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          projectId: true,
          vendorId: true,
          purchaseOrderId: true,
          deletedAt: true,
        },
      });
      if (!before || before.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'unlink_po',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: { status: before.status, projectId: before.projectId },
        targetTable: 'vendor_invoices',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        if (policyRes.reason === 'reason_required') {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
              details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
            },
          });
        }
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'VendorInvoice purchase order cannot be unlinked',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'unlink_po',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText,
        result: policyRes,
      });

      const requiresReason =
        !policyRes.policyApplied &&
        !isVendorInvoicePreSubmitStatus(before.status);
      if (requiresReason && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'REASON_REQUIRED',
            message: 'reasonText is required for override',
          },
        });
      }
      if (requiresReason && reasonText) {
        await logAudit({
          action: 'vendor_invoice_unlink_po_override',
          targetTable: 'vendor_invoices',
          targetId: id,
          reasonText,
          metadata: {
            fromStatus: before.status,
            fromPurchaseOrderId: before.purchaseOrderId ?? null,
            toPurchaseOrderId: null,
            actionPolicy: policyRes.policyApplied
              ? {
                  matchedPolicyId: (policyRes as any).matchedPolicyId ?? null,
                  requireReason: (policyRes as any).requireReason ?? false,
                }
              : { matchedPolicyId: null, requireReason: false },
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, actorId ? { userId: actorId } : {}),
        });
      }

      const updated = await prisma.vendorInvoice.update({
        where: { id },
        data: {
          purchaseOrderId: null,
          updatedBy: actorId ?? undefined,
        },
        include: { purchaseOrder: { select: { id: true, poNo: true } } },
      });
      await logAudit({
        action: 'vendor_invoice_unlink_po',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText: reasonText || undefined,
        metadata: {
          projectId: before.projectId,
          vendorId: before.vendorId,
          fromPurchaseOrderId: before.purchaseOrderId ?? null,
          toPurchaseOrderId: null,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, actorId ? { userId: actorId } : {}),
      });
      return updated;
    },
  );

  const submitVendorInvoiceApproval = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const reasonText =
      typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
    const vendorInvoice = await prisma.vendorInvoice.findUnique({
      where: { id },
      select: { status: true, projectId: true },
    });
    if (vendorInvoice) {
      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'submit',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: {
          status: vendorInvoice.status,
          projectId: vendorInvoice.projectId,
        },
        targetTable: 'vendor_invoices',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        if (policyRes.reason === 'reason_required') {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
              details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
            },
          });
        }
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'VendorInvoice cannot be submitted',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.vendor_invoice,
        actionKey: 'submit',
        targetTable: 'vendor_invoices',
        targetId: id,
        reasonText,
        result: policyRes,
      });
    }
    const actorUserId = req.user?.userId || 'system';
    const { updated, approval } = await submitApprovalWithUpdate({
      flowType: FlowTypeValue.vendor_invoice,
      targetTable: 'vendor_invoices',
      targetId: id,
      update: (tx) =>
        tx.vendorInvoice.update({
          where: { id },
          data: { status: DocStatusValue.pending_qa },
        }),
      createdBy: req.user?.userId,
    });
    await createApprovalPendingNotifications({
      approvalInstanceId: approval.id,
      projectId: approval.projectId,
      requesterUserId: actorUserId,
      actorUserId,
      flowType: approval.flowType,
      targetTable: approval.targetTable,
      targetId: approval.targetId,
      currentStep: approval.currentStep,
      steps: approval.steps,
    });
    return updated;
  };

  app.post(
    '/vendor-invoices/:id/approve',
    { preHandler: requireRole(['admin', 'mgmt']) },
    submitVendorInvoiceApproval,
  );

  // Alias for consistency: other flowTypes use `/submit` for approval submission.
  // Keep `/approve` for backward compatibility.
  app.post(
    '/vendor-invoices/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt']) },
    submitVendorInvoiceApproval,
  );
}
