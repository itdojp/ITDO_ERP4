import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { dispatchNotificationPushes } from './notificationPushes.js';

type ChatMentionNotificationOptions = {
  projectId?: string | null;
  roomId?: string | null;
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
  roomId?: string | null;
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

type ExpenseMarkPaidNotificationOptions = {
  expenseId: string;
  userId: string;
  projectId?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  paidAt?: Date | string | null;
  actorUserId?: string | null;
};

type DailyReportNotificationOptions = {
  userId: string;
  reportDate: string;
  actorUserId?: string | null;
  kind: 'daily_report_submitted' | 'daily_report_updated';
};

type ProjectCreatedNotificationOptions = {
  projectId: string;
  actorUserId: string;
};

type ProjectStatusChangedNotificationOptions = {
  projectId: string;
  actorUserId: string;
  beforeStatus: string;
  afterStatus: string;
  ownerUserId?: string | null;
};

type NotificationSuppressionScope =
  | 'global'
  | 'chat_mentions'
  | 'chat_all_posts';

const DEFAULT_GLOBAL_MUTE_BYPASS_KINDS = [
  'approval_pending',
  'approval_approved',
  'approval_rejected',
  'chat_ack_escalation',
  'daily_report_missing',
  'chat_room_acl_mismatch',
] as const;

function parseMaxRecipients() {
  const raw = process.env.CHAT_MENTION_NOTIFICATION_MAX_RECIPIENTS;
  if (!raw) return 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 200;
  return Math.min(Math.floor(parsed), 500);
}

function parseChatMessageMaxRecipients() {
  const raw = process.env.CHAT_MESSAGE_NOTIFICATION_MAX_RECIPIENTS;
  if (!raw) return 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 200;
  return Math.min(Math.floor(parsed), 500);
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUniqueUserIds(userIds: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const userId of userIds) {
    const normalized = normalizeId(userId);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function resolveGlobalMuteBypassKinds() {
  const raw = process.env.NOTIFICATION_MUTE_BYPASS_KINDS;
  // Use defaults only when env is undefined.
  // Empty string means "no bypass kinds".
  if (raw === undefined) return new Set(DEFAULT_GLOBAL_MUTE_BYPASS_KINDS);
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.length) return new Set<string>();
  return new Set(values);
}

function isGlobalMuteBypassKind(kind: string) {
  return resolveGlobalMuteBypassKinds().has(kind.trim());
}

function dispatchNotificationPushesAsync(options: {
  kind: string;
  userIds: string[];
  payload?: Prisma.InputJsonValue | null;
  messageId?: string | null;
  projectId?: string | null;
  actorUserId?: string | null;
}) {
  void dispatchNotificationPushes(options).catch((err) => {
    console.error('[notification push dispatch failed]', {
      kind: options.kind,
      messageId: options.messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export async function filterNotificationRecipients(options: {
  kind: string;
  userIds: string[];
  roomId?: string | null;
  scope: NotificationSuppressionScope;
  client?: typeof prisma;
  now?: Date;
}) {
  const kind = normalizeId(options.kind);
  const userIds = normalizeUniqueUserIds(options.userIds);
  if (!userIds.length) {
    return { allowed: [] as string[], muted: [] as string[] };
  }
  if (kind && isGlobalMuteBypassKind(kind)) {
    return { allowed: userIds, muted: [] as string[] };
  }

  const client = options.client ?? prisma;
  const now = options.now ?? new Date();

  const mutedUsers = new Set<string>();
  const mutedPreferences = await client.userNotificationPreference.findMany({
    where: { userId: { in: userIds }, muteAllUntil: { gt: now } },
    select: { userId: true, muteAllUntil: true },
  });
  for (const pref of mutedPreferences) {
    const userId = normalizeId(pref.userId);
    if (userId) mutedUsers.add(userId);
  }

  const roomId = normalizeId(options.roomId);
  if (roomId && options.scope === 'chat_mentions') {
    const roomSettings = await client.chatRoomNotificationSetting.findMany({
      where: { roomId, userId: { in: userIds } },
      select: { userId: true, notifyMentions: true, muteUntil: true },
    });
    for (const setting of roomSettings) {
      const userId = normalizeId(setting.userId);
      if (!userId) continue;
      if (setting.muteUntil && setting.muteUntil > now) {
        mutedUsers.add(userId);
        continue;
      }
      if (setting.notifyMentions === false) {
        mutedUsers.add(userId);
      }
    }
  }
  if (roomId && options.scope === 'chat_all_posts') {
    const roomSettings = await client.chatRoomNotificationSetting.findMany({
      where: { roomId, userId: { in: userIds } },
      select: { userId: true, notifyAllPosts: true, muteUntil: true },
    });
    for (const setting of roomSettings) {
      const userId = normalizeId(setting.userId);
      if (!userId) continue;
      if (setting.muteUntil && setting.muteUntil > now) {
        mutedUsers.add(userId);
        continue;
      }
      if (setting.notifyAllPosts === false) {
        mutedUsers.add(userId);
      }
    }
  }

  const allowed: string[] = [];
  const muted: string[] = [];
  for (const userId of userIds) {
    if (mutedUsers.has(userId)) {
      muted.push(userId);
    } else {
      allowed.push(userId);
    }
  }

  return { allowed, muted };
}

export async function filterChatMentionRecipients(options: {
  roomId?: string | null;
  userIds: string[];
  client?: typeof prisma;
  now?: Date;
}) {
  const roomId = normalizeId(options.roomId);
  if (!roomId || options.userIds.length === 0) {
    // Backward compatibility: when roomId is not provided, skip filtering.
    return { allowed: options.userIds, muted: [] as string[] };
  }

  const userIds = options.userIds
    .map((userId) => userId.trim())
    .filter(Boolean);
  if (!userIds.length) {
    return { allowed: [] as string[], muted: [] as string[] };
  }

  return filterNotificationRecipients({
    kind: 'chat_mention',
    roomId,
    userIds,
    scope: 'chat_mentions',
    client: options.client,
    now: options.now,
  });
}

export async function filterChatAllPostRecipients(options: {
  roomId?: string | null;
  userIds: string[];
  client?: typeof prisma;
  now?: Date;
}) {
  const roomId = normalizeId(options.roomId);
  if (!roomId || options.userIds.length === 0) {
    // Backward compatibility: when roomId is not provided, skip filtering.
    return { allowed: options.userIds, muted: [] as string[] };
  }

  const userIds = options.userIds
    .map((userId) => userId.trim())
    .filter(Boolean);
  if (!userIds.length) {
    return { allowed: [] as string[], muted: [] as string[] };
  }

  return filterNotificationRecipients({
    kind: 'chat_message',
    roomId,
    userIds,
    scope: 'chat_all_posts',
    client: options.client,
    now: options.now,
  });
}

async function resolveActiveGroupAccountIdsBySelector(selectors: string[]) {
  const normalized = selectors.map((id) => id.trim()).filter(Boolean);
  if (!normalized.length) return new Map<string, string>();
  const rows = await prisma.groupAccount.findMany({
    where: {
      active: true,
      OR: [{ id: { in: normalized } }, { displayName: { in: normalized } }],
    },
    select: { id: true, displayName: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = normalizeId(row?.id);
    const name = normalizeId(row?.displayName);
    if (!id) continue;
    map.set(id, id);
    if (name && !map.has(name)) map.set(name, id);
  }
  return map;
}

async function resolveGroupMemberUserIds(groupIds: string[]) {
  const normalized = groupIds.map((id) => id.trim()).filter(Boolean);
  if (!normalized.length) return new Map<string, string[]>();

  const selectorToGroupAccountId =
    await resolveActiveGroupAccountIdsBySelector(normalized);
  const resolvedGroupAccountIds = Array.from(
    new Set(
      normalized
        .map((selector) => selectorToGroupAccountId.get(selector) || '')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (!resolvedGroupAccountIds.length) return new Map<string, string[]>();

  const rows = await prisma.userGroup.findMany({
    where: {
      groupId: { in: resolvedGroupAccountIds },
      group: { active: true },
      user: { active: true, deletedAt: null },
    },
    select: {
      groupId: true,
      user: { select: { userName: true } },
    },
  });
  const byGroupAccountId = new Map<string, string[]>();
  for (const row of rows) {
    const groupId = normalizeId(row.groupId);
    const userId = row.user.userName.trim();
    if (!groupId || !userId) continue;
    const list = byGroupAccountId.get(groupId) || [];
    list.push(userId);
    byGroupAccountId.set(groupId, list);
  }

  const map = new Map<string, string[]>();
  for (const selector of normalized) {
    const groupAccountId = selectorToGroupAccountId.get(selector) || '';
    const members = groupAccountId
      ? byGroupAccountId.get(groupAccountId) || []
      : [];
    map.set(selector, members);
  }
  return map;
}

function resolveGroupIdsForRoles(roles: string[]) {
  const raw = process.env.AUTH_GROUP_TO_ROLE_MAP || '';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((pair) => pair.split('=').map((value) => value.trim()))
    .filter(([groupId, role]) => groupId && role && roles.includes(role))
    .map(([groupId]) => groupId);
}

export async function resolveRoleRecipientUserIds(roles: string[]) {
  if (!roles.length) return [] as string[];
  const groupIds = resolveGroupIdsForRoles(roles);
  if (!groupIds.length) return [] as string[];
  const groupMemberMap = await resolveGroupMemberUserIds(groupIds);
  const recipients = new Set<string>();
  for (const userIds of groupMemberMap.values()) {
    userIds.forEach((userId) => recipients.add(userId));
  }
  return Array.from(recipients);
}

export async function createChatMentionNotifications(
  options: ChatMentionNotificationOptions,
) {
  const recipients = new Set<string>();

  options.mentionUserIds.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.add(trimmed);
  });

  const hasProjectFallback =
    Boolean(options.projectId) &&
    (options.mentionAll || options.mentionGroupIds.length > 0);
  if (hasProjectFallback) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: options.projectId ?? undefined },
      select: { userId: true },
    });
    members.forEach((member) => {
      if (member.userId) recipients.add(member.userId);
    });
  }

  recipients.delete(options.senderUserId);

  const maxRecipients = parseMaxRecipients();
  const targetUserIds = Array.from(recipients).slice(0, maxRecipients);
  const truncated = recipients.size > targetUserIds.length;
  const filtered = await filterChatMentionRecipients({
    roomId: options.roomId,
    userIds: targetUserIds,
  });
  if (filtered.allowed.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated,
      usesProjectMemberFallback: hasProjectFallback,
    };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: options.senderUserId,
    roomId: options.roomId || undefined,
    excerpt: options.messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    mentionAll: options.mentionAll || undefined,
    mentionGroupIds: options.mentionGroupIds.length
      ? options.mentionGroupIds
      : undefined,
  };

  const created = await prisma.appNotification.createMany({
    data: filtered.allowed.map((userId) => ({
      userId,
      kind: 'chat_mention',
      projectId: options.projectId ?? null,
      messageId: options.messageId,
      payload,
      createdBy: options.senderUserId,
      updatedBy: options.senderUserId,
    })),
  });
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'chat_mention',
      userIds: filtered.allowed,
      payload,
      messageId: options.messageId,
      projectId: options.projectId ?? null,
      actorUserId: options.senderUserId,
    });
  }

  return {
    created: created.count,
    recipients: filtered.allowed,
    truncated,
    usesProjectMemberFallback: hasProjectFallback,
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
  const filtered = await filterNotificationRecipients({
    kind: 'chat_ack_required',
    roomId: options.roomId,
    userIds: targetUserIds,
    scope: 'chat_mentions',
  });
  if (filtered.allowed.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated,
    };
  }

  // Keep this operation idempotent at the application layer (schema has no unique constraint).
  const existing = await prisma.appNotification.findMany({
    where: {
      kind: 'chat_ack_required',
      messageId: options.messageId,
      userId: { in: filtered.allowed },
    },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((item) => item.userId));
  const createUserIds = filtered.allowed.filter(
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
    roomId: options.roomId || undefined,
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
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'chat_ack_required',
      userIds: createUserIds,
      payload,
      messageId: options.messageId,
      projectId: options.projectId ?? null,
      actorUserId: options.senderUserId,
    });
  }

  return {
    created: created.count,
    recipients: createUserIds,
    truncated,
  };
}

export async function createChatMessageNotifications(options: {
  projectId?: string | null;
  roomId: string;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  recipientUserIds: string[];
  excludeUserIds?: string[];
}) {
  const recipients = new Set<string>();
  options.recipientUserIds.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.add(trimmed);
  });
  options.excludeUserIds?.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.delete(trimmed);
  });
  recipients.delete(options.senderUserId);

  const maxRecipients = parseChatMessageMaxRecipients();
  const targetUserIds = Array.from(recipients).slice(0, maxRecipients);
  const truncated = recipients.size > targetUserIds.length;
  const filtered = await filterChatAllPostRecipients({
    roomId: options.roomId,
    userIds: targetUserIds,
  });
  if (filtered.allowed.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated,
    };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: options.senderUserId,
    roomId: options.roomId,
    excerpt: options.messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
  };

  const created = await prisma.appNotification.createMany({
    data: filtered.allowed.map((userId) => ({
      userId,
      kind: 'chat_message',
      projectId: options.projectId ?? null,
      messageId: options.messageId,
      payload,
      createdBy: options.senderUserId,
      updatedBy: options.senderUserId,
    })),
  });
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'chat_message',
      userIds: filtered.allowed,
      payload,
      messageId: options.messageId,
      projectId: options.projectId ?? null,
      actorUserId: options.senderUserId,
    });
  }

  return {
    created: created.count,
    recipients: filtered.allowed,
    truncated,
  };
}

export async function createProjectMemberAddedNotifications(
  options: ProjectMemberAddedNotificationOptions,
) {
  const recipients: string[] = [];
  const rolesByUserId = new Map<string, 'member' | 'leader'>();
  const seen = new Set<string>();
  for (const item of options.items) {
    const userId = item.userId.trim();
    if (!userId) continue;
    if (userId === options.actorUserId) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    recipients.push(userId);
    rolesByUserId.set(userId, item.role);
  }
  if (!recipients.length) {
    return {
      created: 0,
      recipients: [] as string[],
    };
  }
  const filtered = await filterNotificationRecipients({
    kind: 'project_member_added',
    userIds: recipients,
    scope: 'global',
  });
  if (!filtered.allowed.length) {
    return {
      created: 0,
      recipients: [] as string[],
    };
  }
  const data: Prisma.AppNotificationCreateManyInput[] = filtered.allowed.map(
    (userId) => ({
      userId,
      kind: 'project_member_added',
      projectId: options.projectId,
      payload: {
        fromUserId: options.actorUserId,
        role: rolesByUserId.get(userId),
        source: options.source || undefined,
      } as Prisma.InputJsonValue,
      createdBy: options.actorUserId,
      updatedBy: options.actorUserId,
    }),
  );
  if (!data.length) {
    return {
      created: 0,
      recipients: [] as string[],
    };
  }

  const created = await prisma.appNotification.createMany({ data });
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'project_member_added',
      userIds: filtered.allowed,
      projectId: options.projectId,
      payload: {
        source: options.source || undefined,
      } as Prisma.InputJsonValue,
      actorUserId: options.actorUserId,
    });
  }
  return {
    created: created.count,
    recipients: filtered.allowed,
  };
}

export async function createDailyReportNotifications(
  options: DailyReportNotificationOptions,
) {
  const userId = normalizeId(options.userId);
  const reportDate = normalizeId(options.reportDate);
  if (!userId || !reportDate) {
    return { created: 0 };
  }

  const kind = options.kind;
  const filtered = await filterNotificationRecipients({
    kind,
    userIds: [userId],
    scope: 'global',
  });
  if (!filtered.allowed.length) {
    return { created: 0 };
  }
  const messageId = `${kind}:${userId}:${reportDate}`;
  const existing = await prisma.appNotification.findFirst({
    where: { kind, messageId, userId: filtered.allowed[0] },
    select: { id: true },
  });
  if (existing) return { created: 0 };

  const actorUserId = normalizeId(options.actorUserId ?? undefined);
  const payload: Prisma.InputJsonValue = {
    reportDate,
    fromUserId: actorUserId || undefined,
  };
  await prisma.appNotification.create({
    data: {
      userId: filtered.allowed[0],
      kind,
      messageId,
      payload,
      createdBy: actorUserId || undefined,
      updatedBy: actorUserId || undefined,
    },
  });
  dispatchNotificationPushesAsync({
    kind,
    userIds: filtered.allowed,
    payload,
    messageId,
    actorUserId,
  });

  return { created: 1 };
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
  const filtered = await filterNotificationRecipients({
    kind: 'approval_pending',
    userIds: targetUserIds,
    scope: 'global',
  });
  if (!filtered.allowed.length) {
    return { created: 0, recipients: [] as string[], truncated };
  }

  const messageId = `${approvalInstanceId}:${currentStep}`;
  const existing = await prisma.appNotification.findMany({
    where: {
      kind: 'approval_pending',
      messageId,
      userId: { in: filtered.allowed },
    },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((item) => item.userId));
  const createUserIds = filtered.allowed.filter(
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
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'approval_pending',
      userIds: createUserIds,
      payload,
      messageId,
      projectId: normalizeId(options.projectId) || undefined,
      actorUserId: normalizeId(options.actorUserId) || undefined,
    });
  }

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
  const filtered = await filterNotificationRecipients({
    kind,
    userIds: [requesterUserId],
    scope: 'global',
  });
  if (!filtered.allowed.length) {
    return { created: 0 };
  }
  const existing = await prisma.appNotification.findFirst({
    where: {
      kind,
      messageId: approvalInstanceId,
      userId: filtered.allowed[0],
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
      userId: filtered.allowed[0],
      kind,
      projectId: normalizeId(options.projectId) || undefined,
      messageId: approvalInstanceId,
      payload,
      createdBy: normalizeId(options.actorUserId) || undefined,
      updatedBy: normalizeId(options.actorUserId) || undefined,
    },
  });
  dispatchNotificationPushesAsync({
    kind,
    userIds: filtered.allowed,
    payload,
    messageId: approvalInstanceId,
    projectId: normalizeId(options.projectId) || undefined,
    actorUserId: normalizeId(options.actorUserId) || undefined,
  });

  return { created: 1 };
}

export async function createExpenseMarkPaidNotification(
  options: ExpenseMarkPaidNotificationOptions,
) {
  const expenseId = normalizeId(options.expenseId);
  const userId = normalizeId(options.userId);
  if (!expenseId || !userId) return { created: 0 };
  const filtered = await filterNotificationRecipients({
    kind: 'expense_mark_paid',
    userIds: [userId],
    scope: 'global',
  });
  if (!filtered.allowed.length) return { created: 0 };

  const existing = await prisma.appNotification.findFirst({
    where: {
      kind: 'expense_mark_paid',
      messageId: expenseId,
      userId: filtered.allowed[0],
    },
    select: { id: true },
  });
  if (existing) return { created: 0 };

  const actorUserId = normalizeId(options.actorUserId ?? undefined);
  const paidAt =
    options.paidAt instanceof Date
      ? options.paidAt
      : options.paidAt
        ? new Date(options.paidAt)
        : null;
  const paidAtValue =
    paidAt && !Number.isNaN(paidAt.getTime())
      ? paidAt.toISOString()
      : undefined;
  const amountValue =
    options.amount === null || options.amount === undefined
      ? undefined
      : String(options.amount);
  const currencyValue = normalizeId(options.currency ?? undefined) || undefined;

  await prisma.appNotification.create({
    data: {
      userId: filtered.allowed[0],
      kind: 'expense_mark_paid',
      messageId: expenseId,
      projectId: options.projectId ?? undefined,
      payload: {
        expenseId,
        amount: amountValue,
        currency: currencyValue,
        paidAt: paidAtValue,
        fromUserId: actorUserId || undefined,
      } as Prisma.InputJsonValue,
      createdBy: actorUserId || undefined,
      updatedBy: actorUserId || undefined,
    },
  });
  dispatchNotificationPushesAsync({
    kind: 'expense_mark_paid',
    userIds: filtered.allowed,
    payload: {
      expenseId,
      amount: amountValue,
      currency: currencyValue,
      paidAt: paidAtValue,
      fromUserId: actorUserId || undefined,
    } as Prisma.InputJsonValue,
    messageId: expenseId,
    projectId: options.projectId ?? undefined,
    actorUserId: actorUserId || undefined,
  });

  return { created: 1 };
}

export async function createProjectCreatedNotifications(
  options: ProjectCreatedNotificationOptions,
) {
  const projectId = normalizeId(options.projectId);
  const actorUserId = normalizeId(options.actorUserId);
  if (!projectId) return { created: 0, recipients: [] as string[] };

  const roleRecipients = await resolveRoleRecipientUserIds(['admin', 'mgmt']);
  const recipients = roleRecipients.filter((userId) => userId !== actorUserId);
  if (!recipients.length) {
    return { created: 0, recipients: [] as string[] };
  }
  const filtered = await filterNotificationRecipients({
    kind: 'project_created',
    userIds: recipients,
    scope: 'global',
  });
  if (!filtered.allowed.length) {
    return { created: 0, recipients: [] as string[] };
  }

  const created = await prisma.appNotification.createMany({
    data: filtered.allowed.map((userId) => ({
      userId,
      kind: 'project_created',
      projectId,
      messageId: projectId,
      payload: {
        fromUserId: actorUserId || undefined,
      } as Prisma.InputJsonValue,
      createdBy: actorUserId || undefined,
      updatedBy: actorUserId || undefined,
    })),
  });
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'project_created',
      userIds: filtered.allowed,
      projectId,
      payload: {
        fromUserId: actorUserId || undefined,
      } as Prisma.InputJsonValue,
      messageId: projectId,
      actorUserId: actorUserId || undefined,
    });
  }

  return { created: created.count, recipients: filtered.allowed };
}

export async function createProjectStatusChangedNotifications(
  options: ProjectStatusChangedNotificationOptions,
) {
  const projectId = normalizeId(options.projectId);
  const actorUserId = normalizeId(options.actorUserId);
  const beforeStatus = normalizeId(options.beforeStatus);
  const afterStatus = normalizeId(options.afterStatus);
  if (
    !projectId ||
    !beforeStatus ||
    !afterStatus ||
    beforeStatus === afterStatus
  ) {
    return { created: 0, recipients: [] as string[] };
  }

  const [roleRecipients, leaders] = await Promise.all([
    resolveRoleRecipientUserIds(['admin', 'mgmt']),
    prisma.projectMember.findMany({
      where: { projectId, role: 'leader' },
      select: { userId: true },
    }),
  ]);
  const recipients = new Set<string>(roleRecipients);
  leaders.forEach((row) => {
    const leaderId = normalizeId(row.userId);
    if (leaderId) recipients.add(leaderId);
  });
  const ownerUserId = normalizeId(options.ownerUserId ?? '');
  if (ownerUserId) recipients.add(ownerUserId);
  if (actorUserId) recipients.delete(actorUserId);

  const targetUserIds = Array.from(recipients);
  if (!targetUserIds.length) {
    return { created: 0, recipients: [] as string[] };
  }
  const filtered = await filterNotificationRecipients({
    kind: 'project_status_changed',
    userIds: targetUserIds,
    scope: 'global',
  });
  if (!filtered.allowed.length) {
    return { created: 0, recipients: [] as string[] };
  }

  const created = await prisma.appNotification.createMany({
    data: filtered.allowed.map((userId) => ({
      userId,
      kind: 'project_status_changed',
      projectId,
      payload: {
        fromUserId: actorUserId || undefined,
        beforeStatus,
        afterStatus,
      } as Prisma.InputJsonValue,
      createdBy: actorUserId || undefined,
      updatedBy: actorUserId || undefined,
    })),
  });
  if (created.count > 0) {
    dispatchNotificationPushesAsync({
      kind: 'project_status_changed',
      userIds: filtered.allowed,
      projectId,
      payload: {
        fromUserId: actorUserId || undefined,
        beforeStatus,
        afterStatus,
      } as Prisma.InputJsonValue,
      actorUserId: actorUserId || undefined,
    });
  }

  return { created: created.count, recipients: filtered.allowed };
}
