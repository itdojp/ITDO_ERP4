import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

type ChatMentionNotificationOptions = {
  projectId: string;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  mentionUserIds: string[];
  mentionGroupIds: string[];
  mentionAll: boolean;
};

type ChatAckRequiredNotificationOptions = {
  // Always pass explicitly. Use `null` for non-project rooms.
  projectId: string | null;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  requiredUserIds: string[];
  dueAt?: string | null;
};

type ProjectMemberAddedNotificationOptions = {
  projectId: string;
  actorUserId: string;
  items: Array<{ userId: string; role: 'member' | 'leader' }>;
  source?: 'single' | 'bulk';
};

type ApprovalPendingNotificationOptions = {
  approvalInstanceId: string;
  projectId?: string | null;
  requesterUserId: string;
  actorUserId: string;
  flowType: string;
  targetTable: string;
  targetId: string;
  currentStep?: number | null;
  steps: Array<{
    stepOrder: number;
    status: string;
    approverGroupId?: string | null;
    approverUserId?: string | null;
  }>;
};

type ApprovalOutcomeNotificationOptions = {
  approvalInstanceId: string;
  projectId?: string | null;
  requesterUserId: string;
  actorUserId: string;
  flowType: string;
  targetTable: string;
  targetId: string;
  outcome: 'approved' | 'rejected';
};

function parseMaxRecipients() {
  const raw = process.env.CHAT_MENTION_NOTIFICATION_MAX_RECIPIENTS;
  if (!raw) return 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 200;
  return Math.min(Math.floor(parsed), 500);
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveGroupMemberUserIds(groupIds: string[]) {
  const normalized = groupIds.map((id) => id.trim()).filter(Boolean);
  if (!normalized.length) return new Map<string, string[]>();
  const rows = await prisma.userGroup.findMany({
    where: {
      group: { displayName: { in: normalized }, active: true },
      user: { active: true, deletedAt: null },
    },
    select: {
      group: { select: { displayName: true } },
      user: { select: { userName: true } },
    },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const groupId = row.group.displayName.trim();
    const userId = row.user.userName.trim();
    if (!groupId || !userId) continue;
    const list = map.get(groupId) || [];
    list.push(userId);
    map.set(groupId, list);
  }
  return map;
}

export async function createChatMentionNotifications(
  options: ChatMentionNotificationOptions,
) {
  const recipients = new Set<string>();

  options.mentionUserIds.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.add(trimmed);
  });

  const usesProjectMemberFallback =
    options.mentionAll || options.mentionGroupIds.length > 0;
  if (usesProjectMemberFallback) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: options.projectId },
      select: { userId: true },
    });
    members.forEach((member) => {
      if (member.userId) recipients.add(member.userId);
    });
  }

  recipients.delete(options.senderUserId);

  const maxRecipients = parseMaxRecipients();
  const targetUserIds = Array.from(recipients).slice(0, maxRecipients);
  if (targetUserIds.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated: false,
      usesProjectMemberFallback,
    };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: options.senderUserId,
    excerpt: options.messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    mentionAll: options.mentionAll || undefined,
    mentionGroupIds: options.mentionGroupIds.length
      ? options.mentionGroupIds
      : undefined,
  };

  const created = await prisma.appNotification.createMany({
    data: targetUserIds.map((userId) => ({
      userId,
      kind: 'chat_mention',
      projectId: options.projectId,
      messageId: options.messageId,
      payload,
      createdBy: options.senderUserId,
      updatedBy: options.senderUserId,
    })),
  });

  return {
    created: created.count,
    recipients: targetUserIds,
    truncated: recipients.size > targetUserIds.length,
    usesProjectMemberFallback,
  };
}

export async function createChatAckRequiredNotifications(
  options: ChatAckRequiredNotificationOptions,
) {
  const recipients = new Set<string>();
  options.requiredUserIds.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.add(trimmed);
  });
  recipients.delete(options.senderUserId);

  const truncated = recipients.size > 50;
  const targetUserIds = Array.from(recipients).slice(0, 50);
  if (targetUserIds.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated: false,
    };
  }

  // Keep this operation idempotent at the application layer (schema has no unique constraint).
  const existing = await prisma.appNotification.findMany({
    where: {
      kind: 'chat_ack_required',
      messageId: options.messageId,
      userId: { in: targetUserIds },
    },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((item) => item.userId));
  const createUserIds = targetUserIds.filter(
    (userId) => !existingUserIds.has(userId),
  );
  if (createUserIds.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated,
    };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: options.senderUserId,
    excerpt: options.messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    dueAt: options.dueAt || undefined,
    requiredCount: options.requiredUserIds.length,
  };

  const created = await prisma.appNotification.createMany({
    data: createUserIds.map((userId) => ({
      userId,
      kind: 'chat_ack_required',
      projectId: options.projectId ?? null,
      messageId: options.messageId,
      payload,
      createdBy: options.senderUserId,
      updatedBy: options.senderUserId,
    })),
  });

  return {
    created: created.count,
    recipients: createUserIds,
    truncated,
  };
}

export async function createProjectMemberAddedNotifications(
  options: ProjectMemberAddedNotificationOptions,
) {
  const data: Prisma.AppNotificationCreateManyInput[] = [];
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const item of options.items) {
    const userId = item.userId.trim();
    if (!userId) continue;
    if (userId === options.actorUserId) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    recipients.push(userId);
    data.push({
      userId,
      kind: 'project_member_added',
      projectId: options.projectId,
      payload: {
        fromUserId: options.actorUserId,
        role: item.role,
        source: options.source || undefined,
      } as Prisma.InputJsonValue,
      createdBy: options.actorUserId,
      updatedBy: options.actorUserId,
    });
  }

  if (data.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
    };
  }

  const created = await prisma.appNotification.createMany({ data });
  return {
    created: created.count,
    recipients,
  };
}

export async function createApprovalPendingNotifications(
  options: ApprovalPendingNotificationOptions,
) {
  const approvalInstanceId = normalizeId(options.approvalInstanceId);
  if (!approvalInstanceId) {
    return { created: 0, recipients: [] as string[], truncated: false };
  }

  const currentStep = options.currentStep ?? null;
  if (!currentStep) {
    return { created: 0, recipients: [] as string[], truncated: false };
  }

  const pendingSteps = options.steps.filter(
    (step) =>
      step.stepOrder === currentStep &&
      (step.status === 'pending_qa' || step.status === 'pending_exec'),
  );
  if (!pendingSteps.length) {
    return { created: 0, recipients: [] as string[], truncated: false };
  }

  const recipients = new Set<string>();
  const groupIds = new Set<string>();
  for (const step of pendingSteps) {
    const approverUserId = normalizeId(step.approverUserId);
    const approverGroupId = normalizeId(step.approverGroupId);
    if (approverUserId) recipients.add(approverUserId);
    if (approverGroupId) groupIds.add(approverGroupId);
  }

  const groupMemberMap = await resolveGroupMemberUserIds(Array.from(groupIds));
  for (const [groupId, userIds] of groupMemberMap) {
    if (!groupIds.has(groupId)) continue;
    userIds.forEach((userId) => recipients.add(userId));
  }

  recipients.delete(normalizeId(options.requesterUserId));

  const maxRecipients = parseMaxRecipients();
  const targetUserIds = Array.from(recipients).slice(0, maxRecipients);
  const truncated = recipients.size > targetUserIds.length;
  if (!targetUserIds.length) {
    return { created: 0, recipients: [] as string[], truncated };
  }

  const messageId = `${approvalInstanceId}:${currentStep}`;
  const existing = await prisma.appNotification.findMany({
    where: {
      kind: 'approval_pending',
      messageId,
      userId: { in: targetUserIds },
    },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((item) => item.userId));
  const createUserIds = targetUserIds.filter(
    (userId) => !existingUserIds.has(userId),
  );
  if (!createUserIds.length) {
    return { created: 0, recipients: [] as string[], truncated };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: normalizeId(options.requesterUserId) || undefined,
    approvalInstanceId,
    flowType: normalizeId(options.flowType) || undefined,
    targetTable: normalizeId(options.targetTable) || undefined,
    targetId: normalizeId(options.targetId) || undefined,
    currentStep,
  };

  const created = await prisma.appNotification.createMany({
    data: createUserIds.map((userId) => ({
      userId,
      kind: 'approval_pending',
      projectId: normalizeId(options.projectId) || undefined,
      messageId,
      payload,
      createdBy: normalizeId(options.actorUserId) || undefined,
      updatedBy: normalizeId(options.actorUserId) || undefined,
    })),
  });

  return { created: created.count, recipients: createUserIds, truncated };
}

export async function createApprovalOutcomeNotification(
  options: ApprovalOutcomeNotificationOptions,
) {
  const approvalInstanceId = normalizeId(options.approvalInstanceId);
  const requesterUserId = normalizeId(options.requesterUserId);
  if (!approvalInstanceId || !requesterUserId) {
    return { created: 0 };
  }

  const kind =
    options.outcome === 'approved' ? 'approval_approved' : 'approval_rejected';
  const existing = await prisma.appNotification.findFirst({
    where: {
      kind,
      messageId: approvalInstanceId,
      userId: requesterUserId,
    },
    select: { id: true },
  });
  if (existing) return { created: 0 };

  const payload: Prisma.InputJsonValue = {
    fromUserId: normalizeId(options.actorUserId) || undefined,
    approvalInstanceId,
    flowType: normalizeId(options.flowType) || undefined,
    targetTable: normalizeId(options.targetTable) || undefined,
    targetId: normalizeId(options.targetId) || undefined,
    outcome: options.outcome,
  };

  await prisma.appNotification.create({
    data: {
      userId: requesterUserId,
      kind,
      projectId: normalizeId(options.projectId) || undefined,
      messageId: approvalInstanceId,
      payload,
      createdBy: normalizeId(options.actorUserId) || undefined,
      updatedBy: normalizeId(options.actorUserId) || undefined,
    },
  });

  return { created: 1 };
}
