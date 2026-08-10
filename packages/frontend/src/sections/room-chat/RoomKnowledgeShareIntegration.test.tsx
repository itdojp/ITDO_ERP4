import { describe, expect, it } from 'vitest';

import { selectVisibleKnowledgeShareRootMessageIds } from './RoomKnowledgeShareIntegration';
import type { ChatMessage } from './roomChatModel';

function message(
  id: string,
  relation: { parentMessageId: string | null; threadRootId: string | null },
): ChatMessage {
  return {
    id,
    roomId: 'room-1',
    userId: 'user-1',
    body: id,
    messageType: 'text',
    parentMessageId: relation.parentMessageId,
    threadRootId: relation.threadRootId,
    deleted: false,
    deletedAt: null,
    deletedReason: null,
    createdAt: '2026-08-10T01:00:00.000Z',
    replyCount: 0,
    lastReplyAt: null,
  };
}

describe('selectVisibleKnowledgeShareRootMessageIds', () => {
  it('keeps only roots and gives the opened thread root priority at the 100 item bound', () => {
    const roots = Array.from({ length: 105 }, (_, index) =>
      message(`root-${index + 1}`, {
        parentMessageId: null,
        threadRootId: null,
      }),
    );
    const replies = Array.from({ length: 120 }, (_, index) =>
      message(`reply-${index + 1}`, {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
      }),
    );

    const result = selectVisibleKnowledgeShareRootMessageIds(
      [...replies, ...roots],
      'opened-thread-root',
    );

    expect(result).toHaveLength(100);
    expect(result[0]).toBe('opened-thread-root');
    expect(result).toContain('root-1');
    expect(result).not.toContain('root-100');
    expect(result.some((id) => id.startsWith('reply-'))).toBe(false);
  });

  it('deduplicates an opened root already present in the timeline', () => {
    const root = message('root-1', {
      parentMessageId: null,
      threadRootId: null,
    });

    expect(selectVisibleKnowledgeShareRootMessageIds([root], root.id)).toEqual([
      root.id,
    ]);
  });
});
