import React, { useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, ChatThread } from './roomChatModel';
import {
  KnowledgeShareCard,
  KnowledgeShareCardLoading,
} from './KnowledgeShareCard';
import { KnowledgeThreadPromotionDialog } from './KnowledgeThreadPromotionDialog';
import type { KnowledgeShareRoomCard } from '../knowledge-share/knowledgeShareModel';
import { useRoomKnowledgeShares } from './useRoomKnowledgeShares';

const maximumVisibleKnowledgeShareRoots = 100;

export function selectVisibleKnowledgeShareRootMessageIds(
  currentRoomItems: readonly ChatMessage[],
  threadRootMessageId?: string,
) {
  const ids = new Set<string>();
  if (threadRootMessageId) ids.add(threadRootMessageId);
  for (const message of currentRoomItems) {
    if (message.parentMessageId !== null || message.threadRootId !== null) {
      continue;
    }
    ids.add(message.id);
    if (ids.size >= maximumVisibleKnowledgeShareRoots) break;
  }
  return [...ids].slice(0, maximumVisibleKnowledgeShareRoots);
}

function KnowledgeThreadPromotionLauncher({
  thread,
  share,
}: {
  thread: ChatThread;
  share: KnowledgeShareRoomCard;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const headingId = useId();
  return (
    <section
      className="card"
      aria-labelledby={headingId}
      style={{ padding: 12 }}
    >
      <h3 id={headingId} style={{ marginTop: 0 }}>
        ナレッジへプロモーション
      </h3>
      <p>
        返信は自動選択されません。必要な返信だけを選び、保存内容をプレビューして確定します。
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={() => setIsOpen(true)}
      >
        選択した返信をナレッジへ
      </button>
      <KnowledgeThreadPromotionDialog
        open={isOpen}
        roomId={thread.root.roomId}
        root={thread.root}
        replies={thread.replies}
        knowledgeShare={share}
        onClose={() => setIsOpen(false)}
      />
    </section>
  );
}

export function useRoomKnowledgeShareIntegration(input: {
  roomId: string;
  currentRoomItems: ChatMessage[];
  threadRootMessageId?: string;
  hasAccess: boolean;
}) {
  const visibleRootMessageIds = useMemo(
    () =>
      selectVisibleKnowledgeShareRootMessageIds(
        input.currentRoomItems,
        input.threadRootMessageId,
      ),
    [input.currentRoomItems, input.threadRootMessageId],
  );
  const knowledgeShares = useRoomKnowledgeShares({
    roomId: input.roomId,
    visibleRootMessageIds,
    hasAccess: input.hasAccess,
  });

  const renderKnowledgeShare = useCallback(
    (message: ChatMessage): ReactNode => {
      const card = knowledgeShares.cardsByMessageId.get(message.id);
      if (card) {
        return <KnowledgeShareCard share={card} sharedAt={message.createdAt} />;
      }
      if (
        knowledgeShares.summariesByMessageId.has(message.id) &&
        knowledgeShares.loadingByMessageId.get(message.id)
      ) {
        return <KnowledgeShareCardLoading />;
      }
      const error = knowledgeShares.errorsByMessageId.get(message.id);
      if (error && knowledgeShares.summariesByMessageId.has(message.id)) {
        return <p role="alert">{error.message}</p>;
      }
      return null;
    },
    [knowledgeShares],
  );

  const renderPromotion = useCallback(
    (thread: ChatThread): ReactNode => {
      const share = knowledgeShares.cardsByMessageId.get(thread.root.id);
      if (share?.status !== 'posted' || share.card === null) return null;
      return (
        <KnowledgeThreadPromotionLauncher
          key={`${share.shareId}:${share.version}`}
          thread={thread}
          share={{ ...share, status: 'posted', card: share.card }}
        />
      );
    },
    [knowledgeShares.cardsByMessageId],
  );

  return {
    renderKnowledgeShare,
    renderPromotion,
    purgeKnowledgeShares: knowledgeShares.purgeKnowledgeShares,
  };
}
