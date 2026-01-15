import { timingSafeEqual } from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_ENTERPRISE_SCHEMA =
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

type ScimListResponse<T> = {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
};

type ScimError = {
  schemas: string[];
  status: string;
  detail: string;
  scimType?: string;
};

type ScimEmail = {
  value?: string;
  type?: string;
  primary?: boolean;
};

type ScimPhone = {
  value?: string;
  type?: string;
  primary?: boolean;
};

type ScimUserPayload = {
  id?: string;
  externalId?: string;
  userName?: string;
  displayName?: string;
  active?: boolean;
  name?: { givenName?: string; familyName?: string };
  emails?: ScimEmail[];
  phoneNumbers?: ScimPhone[];
  [SCIM_ENTERPRISE_SCHEMA]?: {
    department?: string;
    organization?: string;
    manager?: { value?: string };
  };
};

type ScimGroupPayload = {
  id?: string;
  externalId?: string;
  displayName?: string;
  members?: Array<{ value?: string; display?: string }>;
};

type ScimPatchPayload = {
  schemas?: string[];
  Operations?: Array<{
    op?: string;
    path?: string;
    value?: unknown;
  }>;
};

// Default SCIM page size used when the client does not request `count` and
// SCIM_PAGE_MAX is not set or invalid.
const DEFAULT_PAGE_SIZE = 100;
// Hard upper limit for SCIM page size to avoid overly large responses.
const MAX_PAGE_SIZE = 500;

function resolvePageSize() {
  const raw = process.env.SCIM_PAGE_MAX;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
  }
  return DEFAULT_PAGE_SIZE;
}

function parsePagination(query: Record<string, unknown>) {
  const startIndexRaw = query.startIndex;
  const countRaw = query.count;
  const startIndex = Number(startIndexRaw ?? 1);
  const count = Number(countRaw ?? resolvePageSize());
  const normalizedStart =
    Number.isFinite(startIndex) && startIndex > 0 ? startIndex : 1;
  const maxPage = resolvePageSize();
  const normalizedCount =
    Number.isFinite(count) && count > 0 ? Math.min(count, maxPage) : maxPage;
  return { startIndex: normalizedStart, count: normalizedCount };
}

function parseFilter(filterRaw?: string) {
  if (!filterRaw) return null;
  const match = filterRaw.match(
    /^([A-Za-z0-9_.]+)\s+eq\s+(?:"((?:\\.|[^"\\])*)"|([^\s]+))$/,
  );
  if (!match) return null;
  const rawValue = match[2] ?? match[3];
  const value = match[2] != null ? rawValue.replace(/\\(.)/g, '$1') : rawValue;
  return { field: match[1], value };
}

function scimError(
  status: number,
  detail: string,
  scimType?: string,
): ScimError {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  };
}

function extractScimError(err: unknown): ScimError | null {
  if (err && typeof err === 'object' && 'scimError' in err) {
    return (err as { scimError: ScimError }).scimError;
  }
  return null;
}

function safeEqualToken(expected: string, provided: string) {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

function requireScimAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.SCIM_BEARER_TOKEN;
  if (!expected) {
    reply.code(503).send(scimError(503, 'SCIM provisioning is not configured'));
    return true;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.code(401).send(scimError(401, 'unauthorized'));
    return true;
  }
  const token = auth.slice('Bearer '.length).trim();
  if (!safeEqualToken(expected, token)) {
    reply.code(401).send(scimError(401, 'unauthorized'));
    return true;
  }
  return false;
}

function normalizeEmails(input?: ScimEmail[]) {
  if (!Array.isArray(input)) return undefined;
  const cleaned = input
    .map((item) => ({
      value: typeof item?.value === 'string' ? item.value.trim() : '',
      type: typeof item?.type === 'string' ? item.type.trim() : undefined,
      primary: Boolean(item?.primary),
    }))
    .filter((item) => item.value);
  return cleaned.length ? cleaned : undefined;
}

function hasPayloadValue(payload: unknown, key: string) {
  return (
    payload &&
    typeof payload === 'object' &&
    Object.prototype.hasOwnProperty.call(payload, key)
  );
}

function normalizePhones(input?: ScimPhone[]) {
  if (!Array.isArray(input)) return undefined;
  const cleaned = input
    .map((item) => ({
      value: typeof item?.value === 'string' ? item.value.trim() : '',
      type: typeof item?.type === 'string' ? item.type.trim() : undefined,
      primary: Boolean(item?.primary),
    }))
    .filter((item) => item.value);
  return cleaned.length ? cleaned : undefined;
}

function normalizeUserPayload(input: ScimUserPayload) {
  const userNameRaw =
    typeof input.userName === 'string' ? input.userName.trim() : undefined;
  const userName = userNameRaw ? userNameRaw : undefined;
  const displayName =
    typeof input.displayName === 'string'
      ? input.displayName.trim()
      : undefined;
  const givenName =
    typeof input.name?.givenName === 'string'
      ? input.name.givenName.trim()
      : undefined;
  const familyName =
    typeof input.name?.familyName === 'string'
      ? input.name.familyName.trim()
      : undefined;
  const enterprise = input[SCIM_ENTERPRISE_SCHEMA];
  const department =
    typeof enterprise?.department === 'string'
      ? enterprise.department.trim()
      : undefined;
  const organization =
    typeof enterprise?.organization === 'string'
      ? enterprise.organization.trim()
      : undefined;
  const managerUserId =
    typeof enterprise?.manager?.value === 'string'
      ? enterprise.manager.value.trim()
      : undefined;
  const emails = normalizeEmails(input.emails);
  const phones = normalizePhones(input.phoneNumbers);
  return {
    externalId: input.externalId,
    userName,
    displayName,
    givenName,
    familyName,
    active: typeof input.active === 'boolean' ? input.active : undefined,
    emails,
    phones,
    department,
    organization,
    managerUserId,
  };
}

function buildUserResource(user: {
  id: string;
  externalId?: string | null;
  userName: string;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  active: boolean;
  emails?: unknown | null;
  phoneNumbers?: unknown | null;
  department?: string | null;
  organization?: string | null;
  managerUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const emails = Array.isArray(user.emails) ? user.emails : undefined;
  const phoneNumbers = Array.isArray(user.phoneNumbers)
    ? user.phoneNumbers
    : undefined;
  const enterprise =
    user.department || user.organization || user.managerUserId
      ? {
          department: user.department ?? undefined,
          organization: user.organization ?? undefined,
          manager: user.managerUserId
            ? { value: user.managerUserId }
            : undefined,
        }
      : undefined;
  return {
    schemas: enterprise
      ? [SCIM_USER_SCHEMA, SCIM_ENTERPRISE_SCHEMA]
      : [SCIM_USER_SCHEMA],
    id: user.id,
    externalId: user.externalId ?? undefined,
    userName: user.userName,
    displayName: user.displayName ?? undefined,
    active: user.active,
    name: {
      givenName: user.givenName ?? undefined,
      familyName: user.familyName ?? undefined,
    },
    emails,
    phoneNumbers,
    ...(enterprise ? { [SCIM_ENTERPRISE_SCHEMA]: enterprise } : {}),
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

function buildGroupResource(group: {
  id: string;
  externalId?: string | null;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
  members?: Array<{ userId: string; displayName?: string | null }>;
}) {
  const members = Array.isArray(group.members)
    ? group.members.map((member) => ({
        value: member.userId,
        display: member.displayName ?? undefined,
      }))
    : undefined;
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: group.id,
    externalId: group.externalId ?? undefined,
    displayName: group.displayName,
    members,
    meta: {
      resourceType: 'Group',
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
    },
  };
}

function buildListResponse<T>(
  resources: T[],
  totalResults: number,
  startIndex: number,
  itemsPerPage: number,
): ScimListResponse<T> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  };
}

async function isUserNameTaken(userName: string, excludeId?: string) {
  const where: Prisma.UserAccountWhereInput = { userName };
  if (excludeId) {
    where.NOT = { id: excludeId };
  }
  const existing = await prisma.userAccount.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(existing);
}

async function isUserExternalIdTaken(externalId?: string, excludeId?: string) {
  if (!externalId) return false;
  const where: Prisma.UserAccountWhereInput = { externalId };
  if (excludeId) {
    where.NOT = { id: excludeId };
  }
  const existing = await prisma.userAccount.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(existing);
}

async function isGroupNameTaken(displayName: string, excludeId?: string) {
  const where: Prisma.GroupAccountWhereInput = { displayName };
  if (excludeId) {
    where.NOT = { id: excludeId };
  }
  const existing = await prisma.groupAccount.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(existing);
}

async function isGroupExternalIdTaken(externalId?: string, excludeId?: string) {
  if (!externalId) return false;
  const where: Prisma.GroupAccountWhereInput = { externalId };
  if (excludeId) {
    where.NOT = { id: excludeId };
  }
  const existing = await prisma.groupAccount.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(existing);
}

async function resolveMembersPayload(members?: ScimGroupPayload['members']) {
  if (!members) return [];
  const userIds = members
    .map((member) => member?.value)
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )
    .map((value) => value.trim());
  const uniqueUserIds = Array.from(new Set(userIds));
  if (!uniqueUserIds.length) return [];
  const existing = await prisma.userAccount.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const missing = uniqueUserIds.filter((id) => !existingIds.has(id));
  if (missing.length) {
    const error = scimError(400, `missing_members:${missing.join(',')}`);
    throw Object.assign(new Error(error.detail), { scimError: error });
  }
  return uniqueUserIds;
}

async function syncGroupMembers(groupId: string, memberIds: string[]) {
  await prisma.userGroup.deleteMany({ where: { groupId } });
  if (!memberIds.length) return;
  await prisma.userGroup.createMany({
    data: memberIds.map((userId) => ({ groupId, userId })),
    skipDuplicates: true,
  });
}

async function addGroupMembers(groupId: string, memberIds: string[]) {
  if (!memberIds.length) return;
  await prisma.userGroup.createMany({
    data: memberIds.map((userId) => ({ groupId, userId })),
    skipDuplicates: true,
  });
}

async function removeGroupMembers(groupId: string, memberIds: string[]) {
  if (!memberIds.length) return;
  await prisma.userGroup.deleteMany({
    where: { groupId, userId: { in: memberIds } },
  });
}

export async function registerScimRoutes(app: FastifyInstance) {
  app.get(
    '/scim/status',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const token = process.env.SCIM_BEARER_TOKEN;
      return {
        configured: Boolean(token && token.trim()),
        pageMax: resolvePageSize(),
      };
    },
  );

  app.get('/scim/v2/ServiceProviderConfig', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: resolvePageSize() },
      changePassword: { supported: false },
      sort: { supported: true },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer Token',
          description: 'Authorization: Bearer <token>',
        },
      ],
    };
  });

  app.get('/scim/v2/ResourceTypes', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        {
          id: 'User',
          name: 'User',
          endpoint: '/scim/v2/Users',
          schema: SCIM_USER_SCHEMA,
          schemaExtensions: [
            {
              schema: SCIM_ENTERPRISE_SCHEMA,
              required: false,
            },
          ],
        },
        {
          id: 'Group',
          name: 'Group',
          endpoint: '/scim/v2/Groups',
          schema: SCIM_GROUP_SCHEMA,
        },
      ],
    };
  });

  app.get('/scim/v2/Users', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const query = req.query as Record<string, unknown>;
    const { startIndex, count } = parsePagination(query);
    const filter = parseFilter(
      typeof query.filter === 'string' ? query.filter : undefined,
    );
    const where: Prisma.UserAccountWhereInput = {};
    if (filter) {
      const value = filter.value;
      switch (filter.field) {
        case 'userName':
          where.userName = value;
          break;
        case 'externalId':
          where.externalId = value;
          break;
        case 'id':
          where.id = value;
          break;
        case 'active':
          where.active = value.toLowerCase() === 'true';
          break;
        default:
          return reply
            .code(400)
            .send(scimError(400, 'unsupported_filter', 'invalidFilter'));
      }
    }
    const totalResults = await prisma.userAccount.count({ where });
    const users = await prisma.userAccount.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: startIndex - 1,
      take: count,
    });
    const resources = users.map(buildUserResource);
    return buildListResponse(resources, totalResults, startIndex, users.length);
  });

  app.get('/scim/v2/Users/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const user = await prisma.userAccount.findUnique({ where: { id } });
    if (!user) {
      return reply.code(404).send(scimError(404, 'user_not_found'));
    }
    return buildUserResource(user);
  });

  app.post('/scim/v2/Users', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const payload = req.body as ScimUserPayload;
    const normalized = normalizeUserPayload(payload);
    if (!normalized.userName) {
      return reply.code(400).send(scimError(400, 'userName_required'));
    }
    if (await isUserNameTaken(normalized.userName)) {
      return reply.code(409).send(scimError(409, 'user_exists'));
    }
    if (await isUserExternalIdTaken(normalized.externalId)) {
      return reply.code(409).send(scimError(409, 'externalId_exists'));
    }
    let created;
    try {
      created = await prisma.userAccount.create({
        data: {
          externalId: normalized.externalId,
          userName: normalized.userName,
          displayName: normalized.displayName,
          givenName: normalized.givenName,
          familyName: normalized.familyName,
          active: normalized.active ?? true,
          emails: normalized.emails as Prisma.InputJsonValue | undefined,
          phoneNumbers: normalized.phones as Prisma.InputJsonValue | undefined,
          department: normalized.department,
          organization: normalized.organization,
          managerUserId: normalized.managerUserId,
          scimMeta: payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return reply.code(409).send(scimError(409, 'user_exists'));
      }
      throw err;
    }
    await logAudit({
      action: 'scim_user_create',
      targetTable: 'UserAccount',
      targetId: created.id,
      metadata: { externalId: created.externalId, userName: created.userName },
      ...auditContextFromRequest(req, { source: 'scim' }),
    });
    return reply.code(201).send(buildUserResource(created));
  });

  app.put('/scim/v2/Users/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const payload = req.body as ScimUserPayload;
    const normalized = normalizeUserPayload(payload);
    if (!normalized.userName) {
      return reply.code(400).send(scimError(400, 'userName_required'));
    }
    const current = await prisma.userAccount.findUnique({ where: { id } });
    if (!current) {
      return reply.code(404).send(scimError(404, 'user_not_found'));
    }
    if (normalized.userName !== current.userName) {
      if (await isUserNameTaken(normalized.userName, id)) {
        return reply.code(409).send(scimError(409, 'user_exists'));
      }
    }
    if (normalized.externalId !== current.externalId) {
      if (await isUserExternalIdTaken(normalized.externalId, id)) {
        return reply.code(409).send(scimError(409, 'externalId_exists'));
      }
    }
    let updated;
    try {
      updated = await prisma.userAccount.update({
        where: { id },
        data: {
          externalId: normalized.externalId,
          userName: normalized.userName,
          displayName: normalized.displayName,
          givenName: normalized.givenName,
          familyName: normalized.familyName,
          active: normalized.active ?? true,
          emails: normalized.emails as Prisma.InputJsonValue | undefined,
          phoneNumbers: normalized.phones as Prisma.InputJsonValue | undefined,
          department: normalized.department,
          organization: normalized.organization,
          managerUserId: normalized.managerUserId,
          scimMeta: payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return reply.code(409).send(scimError(409, 'user_exists'));
      }
      throw err;
    }
    await logAudit({
      action: 'scim_user_update',
      targetTable: 'UserAccount',
      targetId: updated.id,
      metadata: { externalId: updated.externalId, userName: updated.userName },
      ...auditContextFromRequest(req, { source: 'scim' }),
    });
    return buildUserResource(updated);
  });

  app.patch('/scim/v2/Users/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const payload = req.body as ScimPatchPayload;
    const ops = payload.Operations || [];
    const update: Prisma.UserAccountUpdateInput = {
      scimMeta: payload as Prisma.InputJsonValue,
    };
    for (const op of ops) {
      const opName = (op.op || '').toLowerCase();
      const path = op.path || '';
      if (opName === 'replace' || opName === 'add') {
        const value = op.value as ScimUserPayload;
        const normalized = normalizeUserPayload(value);
        const hasUserName =
          path === 'userName' || (!path && hasPayloadValue(value, 'userName'));
        if (hasUserName) {
          if (!normalized.userName) {
            return reply.code(400).send(scimError(400, 'userName_required'));
          }
          update.userName = normalized.userName;
        }
        const hasExternalId =
          path === 'externalId' ||
          (!path && hasPayloadValue(value, 'externalId'));
        if (hasExternalId) {
          update.externalId = normalized.externalId ?? null;
        }
        const hasDisplayName =
          path === 'displayName' ||
          (!path && hasPayloadValue(value, 'displayName'));
        if (hasDisplayName) {
          update.displayName = normalized.displayName ?? null;
        }
        const hasGivenName =
          path === 'name.givenName' ||
          (!path && hasPayloadValue(value, 'name'));
        if (hasGivenName) {
          update.givenName = normalized.givenName ?? null;
        }
        const hasFamilyName =
          path === 'name.familyName' ||
          (!path && hasPayloadValue(value, 'name'));
        if (hasFamilyName) {
          update.familyName = normalized.familyName ?? null;
        }
        if (!path || path === 'active') {
          if (typeof normalized.active === 'boolean') {
            update.active = normalized.active;
          }
        }
        const hasEmails =
          path === 'emails' || (!path && hasPayloadValue(value, 'emails'));
        if (hasEmails) {
          update.emails = normalized.emails
            ? (normalized.emails as Prisma.InputJsonValue)
            : Prisma.DbNull;
        }
        const hasPhones =
          path === 'phoneNumbers' ||
          (!path && hasPayloadValue(value, 'phoneNumbers'));
        if (hasPhones) {
          update.phoneNumbers = normalized.phones
            ? (normalized.phones as Prisma.InputJsonValue)
            : Prisma.DbNull;
        }
        if (!path || path === `${SCIM_ENTERPRISE_SCHEMA}.department`) {
          if (normalized.department) update.department = normalized.department;
        }
        if (!path || path === `${SCIM_ENTERPRISE_SCHEMA}.organization`) {
          if (normalized.organization)
            update.organization = normalized.organization;
        }
        if (!path || path === `${SCIM_ENTERPRISE_SCHEMA}.manager`) {
          if (normalized.managerUserId) {
            update.managerUserId = normalized.managerUserId;
          }
        }
      } else if (opName === 'remove') {
        if (path === 'emails') update.emails = Prisma.DbNull;
        if (path === 'phoneNumbers') update.phoneNumbers = Prisma.DbNull;
        if (path === 'displayName') update.displayName = null;
        if (path === 'name.givenName') update.givenName = null;
        if (path === 'name.familyName') update.familyName = null;
        if (path === 'active') update.active = false;
      }
    }
    try {
      const updated = await prisma.userAccount.update({
        where: { id },
        data: update,
      });
      await logAudit({
        action: 'scim_user_patch',
        targetTable: 'UserAccount',
        targetId: updated.id,
        metadata: {
          externalId: updated.externalId,
          userName: updated.userName,
        },
        ...auditContextFromRequest(req, { source: 'scim' }),
      });
      return buildUserResource(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          return reply.code(404).send(scimError(404, 'user_not_found'));
        }
        if (err.code === 'P2002') {
          return reply.code(409).send(scimError(409, 'user_exists'));
        }
      }
      throw err;
    }
  });

  app.delete('/scim/v2/Users/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    try {
      const updated = await prisma.userAccount.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
      });
      await logAudit({
        action: 'scim_user_deactivate',
        targetTable: 'UserAccount',
        targetId: updated.id,
        ...auditContextFromRequest(req, { source: 'scim' }),
      });
      return reply.code(204).send();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return reply.code(404).send(scimError(404, 'user_not_found'));
      }
      throw err;
    }
  });

  app.get('/scim/v2/Groups', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const query = req.query as Record<string, unknown>;
    const { startIndex, count } = parsePagination(query);
    const filter = parseFilter(
      typeof query.filter === 'string' ? query.filter : undefined,
    );
    const where: Prisma.GroupAccountWhereInput = {};
    if (filter) {
      const value = filter.value;
      switch (filter.field) {
        case 'displayName':
          where.displayName = value;
          break;
        case 'externalId':
          where.externalId = value;
          break;
        case 'id':
          where.id = value;
          break;
        default:
          return reply
            .code(400)
            .send(scimError(400, 'unsupported_filter', 'invalidFilter'));
      }
    }
    const totalResults = await prisma.groupAccount.count({ where });
    const groups = await prisma.groupAccount.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: startIndex - 1,
      take: count,
      include: {
        memberships: {
          include: { user: { select: { id: true, displayName: true } } },
        },
      },
    });
    const resources = groups.map((group) =>
      buildGroupResource({
        ...group,
        members: group.memberships.map((member) => ({
          userId: member.userId,
          displayName: member.user.displayName,
        })),
      }),
    );
    return buildListResponse(
      resources,
      totalResults,
      startIndex,
      groups.length,
    );
  });

  app.get('/scim/v2/Groups/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const group = await prisma.groupAccount.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { user: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!group) {
      return reply.code(404).send(scimError(404, 'group_not_found'));
    }
    return buildGroupResource({
      ...group,
      members: group.memberships.map((member) => ({
        userId: member.userId,
        displayName: member.user.displayName,
      })),
    });
  });

  app.post('/scim/v2/Groups', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const payload = req.body as ScimGroupPayload;
    const displayName =
      typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
    if (!displayName) {
      return reply.code(400).send(scimError(400, 'displayName_required'));
    }
    if (await isGroupNameTaken(displayName)) {
      return reply.code(409).send(scimError(409, 'group_exists'));
    }
    if (await isGroupExternalIdTaken(payload.externalId)) {
      return reply.code(409).send(scimError(409, 'externalId_exists'));
    }
    let memberIds: string[] = [];
    try {
      memberIds = await resolveMembersPayload(payload.members);
    } catch (err) {
      const scimErr = extractScimError(err);
      if (scimErr) {
        return reply.code(400).send(scimErr);
      }
      throw err;
    }
    let created;
    try {
      created = await prisma.groupAccount.create({
        data: {
          externalId: payload.externalId,
          displayName,
          scimMeta: payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return reply.code(409).send(scimError(409, 'group_exists'));
      }
      throw err;
    }
    await syncGroupMembers(created.id, memberIds);
    const group = await prisma.groupAccount.findUnique({
      where: { id: created.id },
      include: {
        memberships: {
          include: { user: { select: { id: true, displayName: true } } },
        },
      },
    });
    await logAudit({
      action: 'scim_group_create',
      targetTable: 'GroupAccount',
      targetId: created.id,
      ...auditContextFromRequest(req, { source: 'scim' }),
    });
    return reply.code(201).send(
      buildGroupResource({
        ...created,
        members:
          group?.memberships.map((member) => ({
            userId: member.userId,
            displayName: member.user.displayName,
          })) || [],
      }),
    );
  });

  app.put('/scim/v2/Groups/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const payload = req.body as ScimGroupPayload;
    const displayName =
      typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
    if (!displayName) {
      return reply.code(400).send(scimError(400, 'displayName_required'));
    }
    const current = await prisma.groupAccount.findUnique({ where: { id } });
    if (!current) {
      return reply.code(404).send(scimError(404, 'group_not_found'));
    }
    if (displayName !== current.displayName) {
      if (await isGroupNameTaken(displayName, id)) {
        return reply.code(409).send(scimError(409, 'group_exists'));
      }
    }
    if (payload.externalId !== current.externalId) {
      if (await isGroupExternalIdTaken(payload.externalId, id)) {
        return reply.code(409).send(scimError(409, 'externalId_exists'));
      }
    }
    let memberIds: string[] = [];
    try {
      memberIds = await resolveMembersPayload(payload.members);
    } catch (err) {
      const scimErr = extractScimError(err);
      if (scimErr) {
        return reply.code(400).send(scimErr);
      }
      throw err;
    }
    let updated;
    try {
      updated = await prisma.groupAccount.update({
        where: { id },
        data: {
          externalId: payload.externalId,
          displayName,
          scimMeta: payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return reply.code(404).send(scimError(404, 'group_not_found'));
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return reply.code(409).send(scimError(409, 'group_exists'));
      }
      throw err;
    }
    await syncGroupMembers(updated.id, memberIds);
    const group = await prisma.groupAccount.findUnique({
      where: { id: updated.id },
      include: {
        memberships: {
          include: { user: { select: { id: true, displayName: true } } },
        },
      },
    });
    await logAudit({
      action: 'scim_group_update',
      targetTable: 'GroupAccount',
      targetId: updated.id,
      ...auditContextFromRequest(req, { source: 'scim' }),
    });
    return buildGroupResource({
      ...updated,
      members:
        group?.memberships.map((member) => ({
          userId: member.userId,
          displayName: member.user.displayName,
        })) || [],
    });
  });

  app.patch('/scim/v2/Groups/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const payload = req.body as ScimPatchPayload;
    const ops = payload.Operations || [];
    const current = await prisma.groupAccount.findUnique({ where: { id } });
    if (!current) {
      return reply.code(404).send(scimError(404, 'group_not_found'));
    }
    const update: Prisma.GroupAccountUpdateInput = {
      scimMeta: payload as Prisma.InputJsonValue,
    };
    for (const op of ops) {
      const opName = (op.op || '').toLowerCase();
      const path = op.path || '';
      if (opName === 'replace' || opName === 'add') {
        const value =
          typeof op.value === 'object' && op.value !== null
            ? (op.value as ScimGroupPayload)
            : undefined;
        const hasDisplayName =
          path === 'displayName' ||
          (!path && hasPayloadValue(value, 'displayName'));
        if (hasDisplayName) {
          const displayNameRaw =
            typeof op.value === 'string'
              ? op.value
              : typeof value?.displayName === 'string'
                ? value.displayName
                : '';
          const displayName = displayNameRaw.trim();
          if (!displayName) {
            return reply.code(400).send(scimError(400, 'displayName_required'));
          }
          update.displayName = displayName;
        }
        const hasExternalId =
          path === 'externalId' ||
          (!path && hasPayloadValue(value, 'externalId'));
        if (hasExternalId) {
          const externalId =
            typeof op.value === 'string'
              ? op.value.trim()
              : typeof value?.externalId === 'string'
                ? value.externalId.trim()
                : null;
          update.externalId = externalId || null;
        }
      } else if (opName === 'remove') {
        if (path === 'externalId') update.externalId = null;
      }
    }
    const nextDisplayName =
      typeof update.displayName === 'string' ? update.displayName : undefined;
    const nextExternalId =
      typeof update.externalId === 'string'
        ? update.externalId
        : update.externalId === null
          ? null
          : undefined;
    if (nextDisplayName !== undefined) {
      if (
        nextDisplayName !== current.displayName &&
        (await isGroupNameTaken(nextDisplayName, id))
      ) {
        return reply.code(409).send(scimError(409, 'group_exists'));
      }
    }
    if (nextExternalId !== undefined) {
      if (
        nextExternalId !== current.externalId &&
        (await isGroupExternalIdTaken(nextExternalId ?? undefined, id))
      ) {
        return reply.code(409).send(scimError(409, 'externalId_exists'));
      }
    }
    try {
      await prisma.groupAccount.update({ where: { id }, data: update });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          return reply.code(404).send(scimError(404, 'group_not_found'));
        }
        if (err.code === 'P2002') {
          return reply.code(409).send(scimError(409, 'group_exists'));
        }
      }
      throw err;
    }
    for (const op of ops) {
      const opName = (op.op || '').toLowerCase();
      const path = op.path || '';
      if (opName === 'replace' && (path === 'members' || !path)) {
        const value = op.value as ScimGroupPayload;
        try {
          const memberIds = await resolveMembersPayload(value?.members);
          await syncGroupMembers(id, memberIds);
        } catch (err) {
          const scimErr = extractScimError(err);
          if (scimErr) {
            return reply.code(400).send(scimErr);
          }
          throw err;
        }
      }
      if (opName === 'add' && path === 'members') {
        const value = op.value as { members?: ScimGroupPayload['members'] };
        try {
          const memberIds = await resolveMembersPayload(value?.members);
          await addGroupMembers(id, memberIds);
        } catch (err) {
          const scimErr = extractScimError(err);
          if (scimErr) {
            return reply.code(400).send(scimErr);
          }
          throw err;
        }
      }
      if (opName === 'remove' && path === 'members') {
        const value = op.value as { members?: ScimGroupPayload['members'] };
        try {
          const memberIds = await resolveMembersPayload(value?.members);
          await removeGroupMembers(id, memberIds);
        } catch (err) {
          const scimErr = extractScimError(err);
          if (scimErr) {
            return reply.code(400).send(scimErr);
          }
          throw err;
        }
      }
    }
    const group = await prisma.groupAccount.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { user: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!group) {
      return reply.code(404).send(scimError(404, 'group_not_found'));
    }
    await logAudit({
      action: 'scim_group_patch',
      targetTable: 'GroupAccount',
      targetId: group.id,
      ...auditContextFromRequest(req, { source: 'scim' }),
    });
    return buildGroupResource({
      ...group,
      members: group.memberships.map((member) => ({
        userId: member.userId,
        displayName: member.user.displayName,
      })),
    });
  });

  app.delete('/scim/v2/Groups/:id', async (req, reply) => {
    if (requireScimAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    try {
      const updated = await prisma.groupAccount.update({
        where: { id },
        data: { active: false },
      });
      await logAudit({
        action: 'scim_group_disable',
        targetTable: 'GroupAccount',
        targetId: updated.id,
        ...auditContextFromRequest(req, { source: 'scim' }),
      });
      return reply.code(204).send();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return reply.code(404).send(scimError(404, 'group_not_found'));
      }
      throw err;
    }
  });
}
