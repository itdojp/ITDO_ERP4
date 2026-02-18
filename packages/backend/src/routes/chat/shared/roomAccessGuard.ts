import type { FastifyReply, FastifyRequest } from 'fastify';
import { ensureChatRoomContentAccess } from '../../../services/chatRoomAccess.js';
import { buildRoomAccessErrorResponse } from './roomAccessError.js';

type RoomAccessResult = Awaited<ReturnType<typeof ensureChatRoomContentAccess>>;
type RoomAccessSuccess = Extract<RoomAccessResult, { ok: true }>;

type RoomAccessContext = {
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export function readRoomAccessContext(req: FastifyRequest): RoomAccessContext {
  return {
    roles: req.user?.roles || [],
    projectIds: req.user?.projectIds || [],
    groupIds: req.user?.groupIds || [],
    groupAccountIds: req.user?.groupAccountIds || [],
  };
}

export async function ensureRoomAccessWithReasonError(options: {
  req: FastifyRequest;
  reply: FastifyReply;
  roomId: string;
  userId: string;
  accessLevel?: 'read' | 'post';
}): Promise<RoomAccessSuccess | null> {
  const accessContext = readRoomAccessContext(options.req);
  const access = await ensureChatRoomContentAccess({
    roomId: options.roomId,
    userId: options.userId,
    roles: accessContext.roles,
    projectIds: accessContext.projectIds,
    groupIds: accessContext.groupIds,
    groupAccountIds: accessContext.groupAccountIds,
    accessLevel: options.accessLevel,
  });
  if (access.ok) return access;

  const roomAccessError = buildRoomAccessErrorResponse(access.reason);
  options.reply.status(roomAccessError.status).send(roomAccessError.body);
  return null;
}
