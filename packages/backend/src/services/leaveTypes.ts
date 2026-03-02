import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

type LeaveTypeUnit = 'daily' | 'hourly' | 'mixed';
type AttachmentPolicy = 'required' | 'optional' | 'none';

type LeaveTypeSeed = {
  code: string;
  name: string;
  description?: string;
  isPaid: boolean;
  unit: LeaveTypeUnit;
  requiresApproval: boolean;
  attachmentPolicy: AttachmentPolicy;
  displayOrder: number;
};

const DEFAULT_LEAVE_TYPES: LeaveTypeSeed[] = [
  {
    code: 'paid',
    name: '年次有給休暇',
    description: '有給休暇（終日/時間休）',
    isPaid: true,
    unit: 'mixed',
    requiresApproval: true,
    attachmentPolicy: 'optional',
    displayOrder: 10,
  },
  {
    code: 'special',
    name: '特別休暇',
    description: '慶弔・夏季などの特別休暇',
    isPaid: true,
    unit: 'daily',
    requiresApproval: true,
    attachmentPolicy: 'optional',
    displayOrder: 20,
  },
  {
    code: 'substitute',
    name: '振替休日',
    description: '振替休日',
    isPaid: true,
    unit: 'daily',
    requiresApproval: true,
    attachmentPolicy: 'none',
    displayOrder: 30,
  },
  {
    code: 'compensatory',
    name: '代休',
    description: '代休',
    isPaid: true,
    unit: 'daily',
    requiresApproval: true,
    attachmentPolicy: 'none',
    displayOrder: 40,
  },
  {
    code: 'unpaid',
    name: '欠勤（無給）',
    description: '無給休暇 / 欠勤',
    isPaid: false,
    unit: 'daily',
    requiresApproval: true,
    attachmentPolicy: 'optional',
    displayOrder: 90,
  },
];

function normalizeLeaveTypeCode(code: string) {
  return code.trim().toLowerCase();
}

export function normalizeLeaveTypeApplicableGroupIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    ids.push(trimmed);
  }
  return Array.from(new Set(ids));
}

export async function ensureDefaultLeaveTypes(options?: {
  actorId?: string | null;
  client?: Prisma.TransactionClient | typeof prisma;
}) {
  const client = options?.client ?? prisma;
  const actor = options?.actorId?.trim() || null;
  const codes = DEFAULT_LEAVE_TYPES.map((seed) => seed.code);
  const existing = await client.leaveType.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((item) => item.code));
  for (const seed of DEFAULT_LEAVE_TYPES) {
    if (existingCodes.has(seed.code)) continue;
    try {
      await client.leaveType.create({
        data: {
          code: seed.code,
          name: seed.name,
          description: seed.description ?? null,
          isPaid: seed.isPaid,
          unit: seed.unit,
          requiresApproval: seed.requiresApproval,
          attachmentPolicy: seed.attachmentPolicy,
          displayOrder: seed.displayOrder,
          createdBy: actor,
          updatedBy: actor,
        },
      });
    } catch (error: any) {
      // Parallel requests can race when seeding; duplicate create is safe to ignore.
      if (error?.code !== 'P2002') throw error;
    }
  }
}

export async function listLeaveTypes(options?: {
  includeInactive?: boolean;
  asOf?: Date;
  client?: Prisma.TransactionClient | typeof prisma;
}) {
  const includeInactive = options?.includeInactive === true;
  const asOf = options?.asOf ?? new Date();
  const client = options?.client ?? prisma;
  return client.leaveType.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      effectiveFrom: { lte: asOf },
    },
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
  });
}

export async function findLeaveTypeByCode(options: {
  code: string;
  includeInactive?: boolean;
  asOf?: Date;
  client?: Prisma.TransactionClient | typeof prisma;
}) {
  const normalizedCode = normalizeLeaveTypeCode(options.code);
  if (!normalizedCode) return null;
  const includeInactive = options.includeInactive === true;
  const asOf = options.asOf ?? new Date();
  const client = options.client ?? prisma;
  return client.leaveType.findFirst({
    where: {
      code: normalizedCode,
      ...(includeInactive ? {} : { active: true }),
      effectiveFrom: { lte: asOf },
    },
  });
}

export function normalizeLeaveTypeInput(code: unknown) {
  if (typeof code !== 'string') return '';
  return normalizeLeaveTypeCode(code);
}

export const leaveTypeUnits: LeaveTypeUnit[] = ['daily', 'hourly', 'mixed'];
export const leaveTypeAttachmentPolicies: AttachmentPolicy[] = [
  'required',
  'optional',
  'none',
];
