import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthState } from '../../api';
import { getRoomChatActorContext } from './roomChatActorContext';

vi.mock('../../api', () => ({
  getAuthState: vi.fn(),
}));

describe('getRoomChatActorContext', () => {
  beforeEach(() => {
    vi.mocked(getAuthState).mockReset();
  });

  it('uses the existing demo actor defaults when auth state is unavailable', () => {
    vi.mocked(getAuthState).mockReturnValue(null);

    expect(getRoomChatActorContext()).toEqual({
      roles: [],
      currentUserId: 'demo-user',
      canUseGeneralAffairsInbox: false,
      canSeeAllMeta: false,
    });
  });

  it('combines canonical group sources and preserves privileged role checks', () => {
    vi.mocked(getAuthState).mockReturnValue({
      userId: 'actor-1',
      roles: ['member', 'mgmt'],
      groupIds: [' general_affairs ', ''],
      groupAccountIds: ['group-2'],
    });

    expect(getRoomChatActorContext()).toEqual({
      roles: ['member', 'mgmt'],
      currentUserId: 'actor-1',
      canUseGeneralAffairsInbox: true,
      canSeeAllMeta: true,
    });
  });
});
