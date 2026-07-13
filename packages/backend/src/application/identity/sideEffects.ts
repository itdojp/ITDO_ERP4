import type { Prisma } from '@prisma/client';
import {
  persistDelegatedScopeDeniedAgentRun,
  type PersistDelegatedScopeDeniedAgentRunInput,
} from '../../services/agentRuns.js';
import {
  deactivatePersonalGeneralAffairsChatRoomMember,
  ensurePersonalGeneralAffairsChatRoom,
} from '../../services/personalGaChatRoom.js';
import { logAudit, type AuditContext } from '../../services/audit.js';

export type DelegatedScopeDeniedAgentRunInput =
  PersistDelegatedScopeDeniedAgentRunInput;

export type ScimUserProvisioningSnapshot = {
  id: string;
  externalId?: string | null;
  userName: string;
  displayName?: string | null;
  active: boolean;
};

type EnsurePersonalGaRoomInput = {
  userAccountId: string;
  userId: string;
  userName: string;
  displayName?: string | null;
  createdBy?: string | null;
  client?: Prisma.TransactionClient;
};

type DeactivatePersonalGaRoomMemberInput = {
  userAccountId: string;
  userId: string;
  reason?: string | null;
  updatedBy?: string | null;
  client?: Prisma.TransactionClient;
};

type AuditInput = AuditContext & {
  action: string;
  targetTable?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
};

type IdentitySideEffectPorts = {
  persistScopeDeniedAgentRun: (
    input: DelegatedScopeDeniedAgentRunInput,
  ) => Promise<unknown>;
  ensurePersonalGaRoom: (
    input: EnsurePersonalGaRoomInput,
  ) => Promise<{ roomId: string }>;
  deactivatePersonalGaRoomMember: (
    input: DeactivatePersonalGaRoomMemberInput,
  ) => Promise<{ roomId: string; updatedCount: number }>;
  logAudit: (entry: AuditInput) => Promise<unknown>;
};

export type IdentitySideEffectPortOverrides = Partial<IdentitySideEffectPorts>;

const defaultPorts: IdentitySideEffectPorts = {
  persistScopeDeniedAgentRun: persistDelegatedScopeDeniedAgentRun,
  ensurePersonalGaRoom: ensurePersonalGeneralAffairsChatRoom,
  deactivatePersonalGaRoomMember:
    deactivatePersonalGeneralAffairsChatRoomMember,
  logAudit,
};

function ports(
  overrides?: IdentitySideEffectPortOverrides,
): IdentitySideEffectPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

export async function recordDelegatedScopeDeniedAgentRun(
  input: DelegatedScopeDeniedAgentRunInput,
  overrides?: IdentitySideEffectPortOverrides,
) {
  return ports(overrides).persistScopeDeniedAgentRun(input);
}

export function resolveScimChatUserId(user: {
  externalId?: string | null;
  userName?: string | null;
}) {
  const externalId =
    typeof user.externalId === 'string' ? user.externalId.trim() : '';
  if (externalId) return externalId;
  const userName =
    typeof user.userName === 'string' ? user.userName.trim() : '';
  return userName;
}

export async function ensureScimPersonalGaRoomForUser(
  options: {
    user: ScimUserProvisioningSnapshot;
    actor?: string | null;
    client?: Prisma.TransactionClient;
  },
  overrides?: IdentitySideEffectPortOverrides,
) {
  const p = ports(overrides);
  const userId = resolveScimChatUserId(options.user);
  if (!userId) return { roomId: null, userId: null };

  const ensured = await p.ensurePersonalGaRoom({
    userAccountId: options.user.id,
    userId,
    userName: options.user.userName,
    displayName: options.user.displayName,
    createdBy: options.actor ?? userId,
    client: options.client,
  });
  return { roomId: ensured.roomId, userId };
}

export async function syncScimPersonalGaRoomMembership(
  options: {
    auditContext: AuditContext;
    before: ScimUserProvisioningSnapshot;
    after: ScimUserProvisioningSnapshot;
    client?: Prisma.TransactionClient;
  },
  overrides?: IdentitySideEffectPortOverrides,
) {
  const p = ports(overrides);
  const { before, after } = options;
  const beforeChatUserId = resolveScimChatUserId(before);
  const afterChatUserId = resolveScimChatUserId(after);
  const activeChanged = before.active !== after.active;
  const identifierChanged = beforeChatUserId !== afterChatUserId;
  if (!activeChanged && !identifierChanged) {
    return;
  }

  const actor =
    afterChatUserId || beforeChatUserId || after.userName.trim() || null;

  if (after.active && afterChatUserId) {
    const ensured = await p.ensurePersonalGaRoom({
      userAccountId: after.id,
      userId: afterChatUserId,
      userName: after.userName,
      displayName: after.displayName,
      createdBy: actor,
      client: options.client,
    });
    await p.logAudit({
      action: 'personal_ga_room_member_reactivated',
      targetTable: 'chat_room_members',
      targetId: `${ensured.roomId}:${afterChatUserId}`,
      metadata: {
        userAccountId: after.id,
        userId: afterChatUserId,
        roomId: ensured.roomId,
        reason: activeChanged
          ? 'scim_user_reactivated'
          : 'scim_user_identifier_changed',
      },
      ...options.auditContext,
    });

    if (identifierChanged && beforeChatUserId) {
      const deactivated = await p.deactivatePersonalGaRoomMember({
        userAccountId: before.id,
        userId: beforeChatUserId,
        updatedBy: actor,
        reason: 'scim_user_identifier_changed',
        client: options.client,
      });
      if (deactivated.updatedCount > 0) {
        await p.logAudit({
          action: 'personal_ga_room_member_deactivated',
          targetTable: 'chat_room_members',
          targetId: `${deactivated.roomId}:${beforeChatUserId}`,
          metadata: {
            userAccountId: before.id,
            userId: beforeChatUserId,
            roomId: deactivated.roomId,
            reason: 'scim_user_identifier_changed',
            replacedByUserId: afterChatUserId,
          },
          ...options.auditContext,
        });
      }
    }
    return;
  }

  const deactivateTargets = new Set<string>();
  if (beforeChatUserId) deactivateTargets.add(beforeChatUserId);
  if (afterChatUserId) deactivateTargets.add(afterChatUserId);
  for (const targetUserId of deactivateTargets) {
    const deactivated = await p.deactivatePersonalGaRoomMember({
      userAccountId: after.id,
      userId: targetUserId,
      updatedBy: actor,
      reason: 'scim_user_deactivated',
      client: options.client,
    });
    if (deactivated.updatedCount > 0) {
      await p.logAudit({
        action: 'personal_ga_room_member_deactivated',
        targetTable: 'chat_room_members',
        targetId: `${deactivated.roomId}:${targetUserId}`,
        metadata: {
          userAccountId: after.id,
          userId: targetUserId,
          roomId: deactivated.roomId,
          reason: 'scim_user_deactivated',
        },
        ...options.auditContext,
      });
    }
  }
}

export async function deactivateScimPersonalGaRoomForUser(
  options: {
    auditContext: AuditContext;
    user: ScimUserProvisioningSnapshot;
    reason: string;
    client?: Prisma.TransactionClient;
  },
  overrides?: IdentitySideEffectPortOverrides,
) {
  const p = ports(overrides);
  const userId = resolveScimChatUserId(options.user);
  if (!userId) return { roomId: null, userId: null, updatedCount: 0 };

  const deactivated = await p.deactivatePersonalGaRoomMember({
    userAccountId: options.user.id,
    userId,
    updatedBy: userId,
    reason: options.reason,
    client: options.client,
  });
  if (deactivated.updatedCount > 0) {
    await p.logAudit({
      action: 'personal_ga_room_member_deactivated',
      targetTable: 'chat_room_members',
      targetId: `${deactivated.roomId}:${userId}`,
      metadata: {
        userAccountId: options.user.id,
        userId,
        roomId: deactivated.roomId,
      },
      ...options.auditContext,
    });
  }

  return { ...deactivated, userId };
}
