import { ensureChatRoomContentAccess } from '../../../services/chatRoomAccess.js';
import { buildRoomAccessErrorResponse } from './roomAccessError.js';

type RoomAccessContext = {
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export function readRoomAccessContext(req: {
  user?: {
    roles?: string[];
    projectIds?: string[];
    groupIds?: unknown;
    groupAccountIds?: unknown;
  };
}): RoomAccessContext {
  return {
    roles: req.user?.roles || [],
    projectIds: req.user?.projectIds || [],
    groupIds: Array.isArray(req.user?.groupIds) ? req.user.groupIds : [],
    groupAccountIds: Array.isArray(req.user?.groupAccountIds)
      ? req.user.groupAccountIds
      : [],
  };
}

export async function ensureRoomAccessWithReasonError(options: {
  req: any;
  reply: any;
  roomId: string;
  userId: string;
  accessLevel?: 'read' | 'post';
}) {
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
