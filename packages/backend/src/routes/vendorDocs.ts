import type { Prisma } from '@prisma/client';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import {
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

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isVendorInvoicePreSubmitStatus(status: string) {
  // VendorInvoice is created in `received` status. Some legacy flows may still use `draft`.
  return status === DocStatusValue.received || status === DocStatusValue.draft;
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
    const { updated } = await submitApprovalWithUpdate({
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
