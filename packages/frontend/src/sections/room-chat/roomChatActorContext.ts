import { getAuthState } from '../../api';

export function getRoomChatActorContext() {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const groupIds = new Set(
    [
      ...(Array.isArray(auth?.groupIds) ? auth.groupIds : []),
      ...(Array.isArray(auth?.groupAccountIds) ? auth.groupAccountIds : []),
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return {
    roles,
    currentUserId: auth?.userId || 'demo-user',
    canUseGeneralAffairsInbox: groupIds.has('general_affairs'),
    canSeeAllMeta:
      roles.includes('admin') ||
      roles.includes('mgmt') ||
      roles.includes('exec'),
  };
}
