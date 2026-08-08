import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ackRequest,
  cancelAckRequestById,
  deleteChatMessage,
  fetchChatThread,
  markRoomRead,
  postMessageReaction,
  postRoomAckRequest,
  postThreadReply,
  revokeAckRequest,
} from './roomChatApi';
import {
  isAckRequest,
  newestVisibleMessageBoundary,
  threadPageSize,
  type ChatMessage,
  type ChatThread,
} from './roomChatModel';

type ReplyPayload = {
  body: string;
  tags?: string[];
  mentions?: {
    userIds?: string[];
    groupIds?: string[];
    all?: boolean;
  };
};

type AckReplyPayload = ReplyPayload & {
  requiredUserIds?: string[];
  requiredGroupIds?: string[];
  requiredRoles?: string[];
};

function mergeReplies(current: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...current, ...next]) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => {
    const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

function isReplyForThread(message: ChatMessage, thread: ChatThread): boolean {
  return (
    message.roomId === thread.root.roomId &&
    message.parentMessageId === thread.root.id &&
    message.threadRootId === thread.root.id
  );
}

function replaceThreadReaction(
  thread: ChatThread,
  messageId: string,
  updated: ChatMessage,
): ChatThread {
  if (updated.id !== messageId || updated.roomId !== thread.root.roomId) {
    return thread;
  }
  if (messageId === thread.root.id) {
    if (updated.parentMessageId !== null || updated.threadRootId !== null) {
      return thread;
    }
    return {
      ...thread,
      root: { ...thread.root, reactions: updated.reactions },
    };
  }
  if (!isReplyForThread(updated, thread)) return thread;
  return {
    ...thread,
    replies: thread.replies.map((reply) =>
      reply.id === messageId
        ? { ...reply, reactions: updated.reactions }
        : reply,
    ),
  };
}

function replaceThreadAckRequest(
  thread: ChatThread,
  requestId: string,
  updated: ChatMessage['ackRequest'],
): ChatThread {
  if (!isAckRequest(updated) || updated.id !== requestId) return thread;
  const replace = (message: ChatMessage): ChatMessage =>
    message.ackRequest?.id === requestId
      ? { ...message, ackRequest: updated }
      : message;
  return {
    ...thread,
    root: replace(thread.root) as ChatThread['root'],
    replies: thread.replies.map(replace),
  };
}

function appendCreatedReply(
  thread: ChatThread,
  created: ChatMessage,
  aggregateIsFresh: boolean,
): ChatThread {
  const alreadyIncluded = thread.replies.some((item) => item.id === created.id);
  const replyCount = aggregateIsFresh
    ? thread.replyCount
    : thread.replyCount + (alreadyIncluded ? 0 : 1);
  const lastReplyAt =
    !thread.lastReplyAt ||
    Date.parse(created.createdAt) > Date.parse(thread.lastReplyAt)
      ? created.createdAt
      : thread.lastReplyAt;
  return {
    ...thread,
    root: { ...thread.root, replyCount, lastReplyAt },
    replies: mergeReplies(thread.replies, [created]),
    replyCount,
    lastReplyAt,
  };
}

function redactDeletedMessage(
  thread: ChatThread,
  messageId: string,
  reason: 'user_retract' | 'admin_moderation',
): ChatThread {
  const redact = (message: ChatMessage): ChatMessage =>
    message.id === messageId
      ? {
          ...message,
          body: null,
          tags: [],
          reactions: undefined,
          mentions: null,
          mentionsAll: false,
          ackRequest: null,
          attachments: [],
          deleted: true,
          deletedReason: reason,
        }
      : message;
  return {
    ...thread,
    root: redact(thread.root) as ChatThread['root'],
    replies: thread.replies.map(redact),
  };
}

export function useRoomChatThread(input: {
  roomId: string;
  expectedRootId: string;
  onRootUpdated?: (root: ChatThread['root']) => void;
  onReadUpdated?: (roomId: string) => void | Promise<void>;
}) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState('');
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const rootIdRef = useRef('');
  const lifecycleSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      lifecycleSeqRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  const closeThread = useCallback(() => {
    lifecycleSeqRef.current += 1;
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    rootIdRef.current = '';
    setThread(null);
    setMessage('');
    setIsLoading(false);
    setIsLoadingMore(false);
    setIsMutating(false);
  }, []);

  useEffect(() => {
    if (!thread || thread.root.roomId === input.roomId) return;
    closeThread();
  }, [closeThread, input.roomId, thread]);

  const markDisplayedThreadRead = useCallback(
    async (next: ChatThread) => {
      const boundary = newestVisibleMessageBoundary([
        next.root,
        ...next.replies,
      ]);
      if (!boundary) return true;
      try {
        await markRoomRead(next.root.roomId, boundary);
        await input.onReadUpdated?.(next.root.roomId);
        return true;
      } catch {
        console.warn('Failed to mark chat thread read.');
        return false;
      }
    },
    [input],
  );

  const loadThread = useCallback(
    async (
      messageId: string,
      options?: { append?: boolean; preserveLoaded?: boolean },
    ): Promise<ChatThread | null> => {
      const append = options?.append === true;
      const preserveLoaded = options?.preserveLoaded === true;
      const current = thread;
      const targetId = append ? current?.root.id || '' : messageId;
      const cursor = append ? current?.nextCursor || '' : '';
      if (!targetId || (append && !cursor)) return null;

      const requestSeq = ++requestSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setMessage('');
        if (append) setIsLoadingMore(true);
        else setIsLoading(true);
        const fetched = await fetchChatThread(targetId, {
          limit: threadPageSize,
          cursor: cursor || undefined,
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestSeqRef.current !== requestSeq) {
          return null;
        }
        if (
          fetched.root.roomId !== input.roomId ||
          fetched.root.id !== input.expectedRootId ||
          (rootIdRef.current && fetched.root.id !== rootIdRef.current)
        ) {
          throw new Error('Invalid chat thread identity');
        }
        rootIdRef.current = fetched.root.id;
        const next =
          (append || preserveLoaded) && current
            ? {
                ...fetched,
                replies: mergeReplies(current.replies, fetched.replies),
                nextCursor: append ? fetched.nextCursor : current.nextCursor,
              }
            : fetched;
        setThread(next);
        input.onRootUpdated?.(next.root);
        const readUpdated = await markDisplayedThreadRead(next);
        if (!readUpdated) {
          setMessage('スレッドを表示しましたが既読更新に失敗しました');
        }
        return next;
      } catch {
        if (controller.signal.aborted) return null;
        console.error('Failed to load chat thread.');
        setMessage('スレッドを取得できませんでした');
        if (!append && !preserveLoaded) setThread(null);
        return null;
      } finally {
        if (requestSeqRef.current === requestSeq) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [input, markDisplayedThreadRead, thread],
  );

  const refreshThread = useCallback(async () => {
    const id = rootIdRef.current || thread?.root.id;
    return id ? loadThread(id, { preserveLoaded: true }) : null;
  }, [loadThread, thread?.root.id]);

  const mutateAndRefresh = useCallback(
    async <T>(
      operation: () => Promise<T>,
      successMessage?: string,
      applyCommitted?: (current: ChatThread, result: T) => ChatThread,
    ) => {
      if (!thread) return false;
      const lifecycleSeq = lifecycleSeqRef.current;
      try {
        setIsMutating(true);
        setMessage('');
        const result = await operation();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (applyCommitted) {
          const committed = applyCommitted(thread, result);
          setThread((current) =>
            current ? applyCommitted(current, result) : current,
          );
          input.onRootUpdated?.(committed.root);
        }
        const refreshed = await refreshThread();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (refreshed) {
          if (applyCommitted) {
            const safe = applyCommitted(refreshed, result);
            setThread(safe);
            input.onRootUpdated?.(safe.root);
          }
          if (successMessage) setMessage(successMessage);
        } else {
          setMessage(
            '操作は完了しましたが表示更新に失敗しました。再送せず再読み込みしてください',
          );
        }
        return true;
      } catch {
        console.error('Failed to update chat thread.');
        setMessage('スレッドを更新できませんでした');
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [input, refreshThread, thread],
  );

  const postReply = useCallback(
    async (payload: ReplyPayload) => {
      if (!thread) return false;
      const lifecycleSeq = lifecycleSeqRef.current;
      try {
        setIsMutating(true);
        setMessage('');
        const created = await postThreadReply(thread.root.id, payload);
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (!isReplyForThread(created, thread)) {
          await refreshThread();
          setMessage(
            '投稿結果を確認できません。再送せず再読み込みしてください',
          );
          return true;
        }
        const refreshed = await refreshThread();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        const next = appendCreatedReply(
          refreshed ?? thread,
          created,
          refreshed !== null,
        );
        setThread(next);
        input.onRootUpdated?.(next.root);
        await markDisplayedThreadRead(next);
        setMessage(
          refreshed
            ? '返信を投稿しました'
            : '返信は投稿されましたが表示更新に失敗しました。再送せず再読み込みしてください',
        );
        return true;
      } catch {
        console.error('Failed to post chat thread reply.');
        setMessage('スレッドを更新できませんでした');
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [input, markDisplayedThreadRead, refreshThread, thread],
  );

  const postAckReply = useCallback(
    async (payload: AckReplyPayload) => {
      if (!thread) return false;
      const lifecycleSeq = lifecycleSeqRef.current;
      try {
        setIsMutating(true);
        setMessage('');
        const created = await postRoomAckRequest(thread.root.roomId, {
          ...payload,
          parentMessageId: thread.root.id,
        });
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (!isReplyForThread(created, thread)) {
          await refreshThread();
          setMessage(
            '投稿結果を確認できません。再送せず再読み込みしてください',
          );
          return true;
        }
        const refreshed = await refreshThread();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        const next = appendCreatedReply(
          refreshed ?? thread,
          created,
          refreshed !== null,
        );
        setThread(next);
        input.onRootUpdated?.(next.root);
        await markDisplayedThreadRead(next);
        setMessage(
          refreshed
            ? '確認依頼付きの返信を投稿しました'
            : '確認依頼付きの返信は投稿されましたが表示更新に失敗しました。再送せず再読み込みしてください',
        );
        return true;
      } catch {
        console.error('Failed to post chat thread ack reply.');
        setMessage('スレッドを更新できませんでした');
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [input, markDisplayedThreadRead, refreshThread, thread],
  );

  return {
    thread,
    isLoading,
    isLoadingMore,
    isMutating,
    message,
    setMessage,
    openThread: loadThread,
    closeThread,
    loadMore: () =>
      thread ? loadThread(thread.root.id, { append: true }) : Promise.resolve(),
    refreshThread,
    postReply,
    postAckReply,
    addReaction: (messageId: string, emoji: string) =>
      mutateAndRefresh(
        () => postMessageReaction(messageId, emoji),
        undefined,
        (current, updated) =>
          replaceThreadReaction(current, messageId, updated),
      ),
    ack: (requestId: string) =>
      mutateAndRefresh(
        () => ackRequest(requestId),
        '確認しました',
        (current, updated) =>
          replaceThreadAckRequest(current, requestId, updated),
      ),
    revokeAck: (requestId: string) =>
      mutateAndRefresh(
        () => revokeAckRequest(requestId),
        '確認を取り消しました',
        (current, updated) =>
          replaceThreadAckRequest(current, requestId, updated),
      ),
    cancelAck: (requestId: string, reason?: string) =>
      mutateAndRefresh(
        () => cancelAckRequestById(requestId, reason),
        '確認依頼を撤回しました',
        (current, updated) =>
          replaceThreadAckRequest(current, requestId, updated),
      ),
    deleteMessage: (
      messageId: string,
      reason: 'user_retract' | 'admin_moderation',
    ) =>
      mutateAndRefresh(
        () => deleteChatMessage(messageId, reason),
        'メッセージを削除しました',
        (current) => redactDeletedMessage(current, messageId, reason),
      ),
  };
}
