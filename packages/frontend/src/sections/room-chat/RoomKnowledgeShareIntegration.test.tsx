import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { KnowledgeShareRoomCard } from '../knowledge-share/knowledgeShareModel';
import {
  KnowledgeThreadPromotionLauncher,
  selectVisibleKnowledgeShareRootMessageIds,
} from './RoomKnowledgeShareIntegration';
import type { ChatMessage, ChatThread } from './roomChatModel';

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

function share(shareId: string): KnowledgeShareRoomCard {
  return {
    shareId,
    status: 'posted',
    version: 1,
    schemaVersion: 1,
    canOpenSource: false,
    card: {
      schemaVersion: 1,
      title: 'Synthetic shared title',
      sourceType: null,
      canonicalUrl: null,
      snapshot: null,
      sharerNote: null,
      labels: [],
      annotations: [],
      turns: [],
      syntheses: [],
      selectedCategories: ['title'],
      omittedCategories: [],
    },
  };
}

afterEach(cleanup);

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

  it('binds each launcher section to a unique accessible heading id', () => {
    const root = message('root-1', {
      parentMessageId: null,
      threadRootId: null,
    });
    const thread: ChatThread = {
      root: { ...root, replyCount: 0, lastReplyAt: null },
      replies: [],
      replyCount: 0,
      lastReplyAt: null,
      nextCursor: null,
    };
    render(
      <>
        <KnowledgeThreadPromotionLauncher thread={thread} share={share('a')} />
        <KnowledgeThreadPromotionLauncher thread={thread} share={share('b')} />
      </>,
    );

    const headings = screen.getAllByRole('heading', {
      name: 'ナレッジへプロモーション',
    });
    expect(headings).toHaveLength(2);
    const headingIds = headings.map((heading) => heading.id);
    expect(headingIds[0]).toBeTruthy();
    expect(headingIds[1]).toBeTruthy();
    expect(headingIds[0]).not.toBe(headingIds[1]);
    headings.forEach((heading) => {
      expect(heading.closest('section')).toHaveAttribute(
        'aria-labelledby',
        heading.id,
      );
    });
  });
});
