import { ensureChatRoomContentAccess } from '../../services/chatRoomAccess.js';

export type RoomAccessContext = {
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export function readRoomAccessContext(req: any): RoomAccessContext {
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
  reply: any;
  roomId: string;
  userId: string;
  accessContext: RoomAccessContext;
  accessLevel?: 'read' | 'post';
}) {
  const access = await ensureChatRoomContentAccess({
    roomId: options.roomId,
    userId: options.userId,
    roles: options.accessContext.roles,
    projectIds: options.accessContext.projectIds,
    groupIds: options.accessContext.groupIds,
    groupAccountIds: options.accessContext.groupAccountIds,
    accessLevel: options.accessLevel,
  });
  if (access.ok) return access;
  options.reply
    .status(access.reason === 'not_found' ? 404 : 403)
    .send({ error: access.reason });
  return null;
}
