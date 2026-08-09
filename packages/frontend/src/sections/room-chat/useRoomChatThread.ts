import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ackRequest,
  cancelAckRequestById,
  deleteChatMessage,
  fetchChatThread,
  isDefiniteChatRequestFailure,
  isUnavailableChatRequestFailure,
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

export type ChatPostLifecycle = 'idle' | 'in_flight' | 'uncertain';

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
  onAccessRevoked?: (roomId: string, message: string) => void;
  onAccessCheckRequired?: (roomId: string) => Promise<boolean>;
  onMessageDeleted?: (roomId: string, messageId: string) => void;
  postLifecycle?: ChatPostLifecycle;
  onPostLifecycleChange?: (lifecycle: ChatPostLifecycle) => void;
}) {
  const {
    roomId,
    expectedRootId,
    onRootUpdated,
    onReadUpdated,
    onAccessRevoked,
    onAccessCheckRequired,
    onMessageDeleted,
  } = input;
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [localPostLifecycle, setLocalPostLifecycle] =
    useState<ChatPostLifecycle>('idle');
  const onPostLifecycleChange = input.onPostLifecycleChange;
  const postLifecycle = input.postLifecycle ?? localPostLifecycle;
  const postLifecycleRef = useRef(postLifecycle);
  const mountedRef = useRef(true);
  const [message, setMessage] = useState('');
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const rootIdRef = useRef('');
  const lifecycleSeqRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    postLifecycleRef.current = postLifecycle;
  }, [postLifecycle]);

  const updatePostLifecycle = useCallback(
    (next: ChatPostLifecycle) => {
      postLifecycleRef.current = next;
      if (onPostLifecycleChange) {
        onPostLifecycleChange(next);
      } else if (mountedRef.current) {
        setLocalPostLifecycle(next);
      }
    },
    [onPostLifecycleChange],
  );

  const revalidateRoomAccess = useCallback(async () => {
    try {
      return (await onAccessCheckRequired?.(roomId)) === true;
    } catch {
      return false;
    }
  }, [onAccessCheckRequired, roomId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lifecycleSeqRef.current += 1;
      requestSeqRef.current += 1;
      rootIdRef.current = '';
      mutationInFlightRef.current = false;
      loadMoreInFlightRef.current = false;
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
    };
  }, []);

  const closeThread = useCallback(() => {
    lifecycleSeqRef.current += 1;
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    rootIdRef.current = '';
    mutationInFlightRef.current = false;
    loadMoreInFlightRef.current = false;
    setThread(null);
    setMessage('');
    setIsLoading(false);
    setIsLoadingMore(false);
    setIsMutating(false);
  }, []);

  useEffect(() => {
    if (!thread || thread.root.roomId === roomId) return;
    closeThread();
  }, [closeThread, roomId, thread]);

  const markDisplayedThreadRead = useCallback(
    async (next: ChatThread) => {
      const boundary = newestVisibleMessageBoundary(
        [next.root, ...next.replies],
        {
          excludeNewestTimestamp: Boolean(next.nextCursor),
        },
      );
      if (!boundary) return true;
      try {
        await markRoomRead(next.root.roomId, boundary);
        await onReadUpdated?.(next.root.roomId);
        return true;
      } catch (error) {
        if (isUnavailableChatRequestFailure(error)) {
          return (await revalidateRoomAccess())
            ? ('failed' as const)
            : ('access_revoked' as const);
        }
        console.warn('Failed to mark chat thread read.');
        return 'failed' as const;
      }
    },
    [onReadUpdated, revalidateRoomAccess],
  );

  const loadThread = useCallback(
    async (
      messageId: string,
      options?: {
        append?: boolean;
        preserveLoaded?: boolean;
        suppressAccessCheck?: boolean;
      },
    ): Promise<ChatThread | null> => {
      const append = options?.append === true;
      const preserveLoaded = options?.preserveLoaded === true;
      const current = thread;
      const targetId = append ? current?.root.id || '' : messageId;
      const cursor = append ? current?.nextCursor || '' : '';
      if (!targetId || (append && !cursor)) return null;

      const requestSeq = ++requestSeqRef.current;
      const lifecycleSeq = lifecycleSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const isCurrentRequest = () =>
        lifecycleSeqRef.current === lifecycleSeq &&
        requestSeqRef.current === requestSeq &&
        !controller.signal.aborted;

      try {
        setMessage('');
        if (append) setIsLoadingMore(true);
        else setIsLoading(true);
        const fetched = await fetchChatThread(targetId, {
          limit: threadPageSize,
          cursor: cursor || undefined,
          signal: controller.signal,
        });
        if (!isCurrentRequest()) return null;
        if (
          fetched.root.roomId !== roomId ||
          fetched.root.id !== expectedRootId ||
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
        onRootUpdated?.(next.root);
        const readUpdated = await markDisplayedThreadRead(next);
        if (!isCurrentRequest()) return next;
        if (readUpdated === 'access_revoked') {
          rootIdRef.current = '';
          setThread(null);
          setMessage('スレッドを表示できません');
          return null;
        }
        if (readUpdated === 'failed') {
          setMessage('スレッドを表示しましたが既読更新に失敗しました');
        }
        return next;
      } catch (error) {
        if (!isCurrentRequest()) return null;
        console.error('Failed to load chat thread.');
        if (isUnavailableChatRequestFailure(error)) {
          rootIdRef.current = '';
          setThread(null);
          setMessage('スレッドを表示できません');
          if (!options?.suppressAccessCheck) await revalidateRoomAccess();
        } else {
          setMessage('スレッドを取得できませんでした');
          if (!append && !preserveLoaded) setThread(null);
        }
        return null;
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [
      expectedRootId,
      onRootUpdated,
      roomId,
      markDisplayedThreadRead,
      revalidateRoomAccess,
      thread,
    ],
  );

  const refreshThread = useCallback(
    async (options?: { suppressAccessCheck?: boolean }) => {
      const id = rootIdRef.current || thread?.root.id;
      return id
        ? loadThread(id, {
            preserveLoaded: true,
            ...(options?.suppressAccessCheck
              ? { suppressAccessCheck: true }
              : {}),
          })
        : null;
    },
    [loadThread, thread?.root.id],
  );

  const mutateAndRefresh = useCallback(
    async <T>(
      operation: () => Promise<T>,
      successMessage?: string,
      applyCommitted?: (current: ChatThread, result: T) => ChatThread,
      onCommitted?: (result: T) => void,
    ) => {
      if (
        !thread ||
        mutationInFlightRef.current ||
        loadMoreInFlightRef.current
      ) {
        return false;
      }
      mutationInFlightRef.current = true;
      const lifecycleSeq = lifecycleSeqRef.current;
      try {
        setIsMutating(true);
        setMessage('');
        const result = await operation();
        onCommitted?.(result);
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (applyCommitted) {
          const committed = applyCommitted(thread, result);
          setThread((current) =>
            current ? applyCommitted(current, result) : current,
          );
          onRootUpdated?.(committed.root);
        }
        const refreshed = await refreshThread();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (refreshed) {
          if (applyCommitted) {
            const safe = applyCommitted(refreshed, result);
            setThread(safe);
            onRootUpdated?.(safe.root);
          }
          if (successMessage) setMessage(successMessage);
        } else {
          setMessage(
            '操作は完了しましたが表示更新に失敗しました。再送せず再読み込みしてください',
          );
        }
        return true;
      } catch (error) {
        if (lifecycleSeqRef.current !== lifecycleSeq) return false;
        console.error('Failed to update chat thread.');
        if (isUnavailableChatRequestFailure(error)) {
          const roomReadable = await revalidateRoomAccess();
          if (lifecycleSeqRef.current !== lifecycleSeq) return false;
          if (!roomReadable) {
            rootIdRef.current = '';
            setThread(null);
            setMessage('スレッドを表示できません');
            return false;
          }
          const refreshed = await refreshThread({
            suppressAccessCheck: true,
          });
          if (lifecycleSeqRef.current !== lifecycleSeq) return false;
          if (refreshed) {
            setMessage('対象を更新できませんでした。最新表示を再取得しました');
          }
          return false;
        }
        setMessage('スレッドを更新できませんでした');
        return false;
      } finally {
        if (lifecycleSeqRef.current === lifecycleSeq) {
          mutationInFlightRef.current = false;
          setIsMutating(false);
        }
      }
    },
    [onRootUpdated, refreshThread, revalidateRoomAccess, thread],
  );

  const postReply = useCallback(
    async (payload: ReplyPayload) => {
      if (
        !thread ||
        postLifecycleRef.current !== 'idle' ||
        mutationInFlightRef.current ||
        loadMoreInFlightRef.current
      ) {
        return false;
      }
      mutationInFlightRef.current = true;
      updatePostLifecycle('in_flight');
      let finalPostLifecycle: ChatPostLifecycle = 'uncertain';
      const lifecycleSeq = lifecycleSeqRef.current;
      try {
        setIsMutating(true);
        setMessage('');
        const created = await postThreadReply(
          { rootMessageId: thread.root.id, roomId: thread.root.roomId },
          payload,
        );
        finalPostLifecycle = 'idle';
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (created.warning?.code === 'POST_WITHOUT_VIEW') {
          requestSeqRef.current += 1;
          abortRef.current?.abort();
          abortRef.current = null;
          rootIdRef.current = '';
          setThread(null);
          setMessage(created.warning.message);
          onAccessRevoked?.(thread.root.roomId, created.warning.message);
          return true;
        }
        const refreshed = await refreshThread();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        const confirmed =
          refreshed?.replies.some((reply) => reply.id === created.id) === true;
        if (refreshed) {
          setThread(refreshed);
          onRootUpdated?.(refreshed.root);
        }
        setMessage(
          confirmed
            ? '返信を投稿しました'
            : '返信は投稿されましたが表示を確認できません。再送せず再読み込みしてください',
        );
        return true;
      } catch (error) {
        if (
          isUnavailableChatRequestFailure(error) ||
          isDefiniteChatRequestFailure(error)
        ) {
          finalPostLifecycle = 'idle';
        }
        if (lifecycleSeqRef.current !== lifecycleSeq) return false;
        console.error('Failed to post chat thread reply.');
        if (isUnavailableChatRequestFailure(error)) {
          const roomReadable = await revalidateRoomAccess();
          if (lifecycleSeqRef.current !== lifecycleSeq) return false;
          if (!roomReadable) {
            rootIdRef.current = '';
            setThread(null);
            setMessage('スレッドを表示できません');
            return false;
          }
          const refreshed = await refreshThread({
            suppressAccessCheck: true,
          });
          if (lifecycleSeqRef.current !== lifecycleSeq) return false;
          if (refreshed) {
            setMessage(
              '返信対象を更新できませんでした。最新表示を再取得しました',
            );
          }
          return false;
        }
        if (isDefiniteChatRequestFailure(error)) {
          finalPostLifecycle = 'idle';
          setMessage('返信の投稿に失敗しました');
          return false;
        }
        setMessage(
          '返信結果を確認できません。重複防止のため再送せず、ページを再読み込みしてください',
        );
        return false;
      } finally {
        updatePostLifecycle(finalPostLifecycle);
        if (lifecycleSeqRef.current === lifecycleSeq) {
          mutationInFlightRef.current = false;
          setIsMutating(false);
        }
      }
    },
    [
      onAccessRevoked,
      onRootUpdated,
      refreshThread,
      revalidateRoomAccess,
      thread,
      updatePostLifecycle,
    ],
  );

  const postAckReply = useCallback(
    async (payload: AckReplyPayload) => {
      if (
        !thread ||
        postLifecycleRef.current !== 'idle' ||
        mutationInFlightRef.current ||
        loadMoreInFlightRef.current
      ) {
        return false;
      }
      mutationInFlightRef.current = true;
      updatePostLifecycle('in_flight');
      let finalPostLifecycle: ChatPostLifecycle = 'uncertain';
      const lifecycleSeq = lifecycleSeqRef.current;
      try {
        setIsMutating(true);
        setMessage('');
        const created = await postRoomAckRequest(thread.root.roomId, {
          ...payload,
          parentMessageId: thread.root.id,
        });
        finalPostLifecycle = 'idle';
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        if (created.warning?.code === 'POST_WITHOUT_VIEW') {
          requestSeqRef.current += 1;
          abortRef.current?.abort();
          abortRef.current = null;
          rootIdRef.current = '';
          setThread(null);
          setMessage(created.warning.message);
          onAccessRevoked?.(thread.root.roomId, created.warning.message);
          return true;
        }
        const refreshed = await refreshThread();
        if (lifecycleSeqRef.current !== lifecycleSeq) return true;
        const confirmed =
          refreshed?.replies.some((reply) => reply.id === created.id) === true;
        if (refreshed) {
          setThread(refreshed);
          onRootUpdated?.(refreshed.root);
        }
        setMessage(
          confirmed
            ? '確認依頼付きの返信を投稿しました'
            : '確認依頼付きの返信は投稿されましたが表示を確認できません。再送せず再読み込みしてください',
        );
        return true;
      } catch (error) {
        if (
          isUnavailableChatRequestFailure(error) ||
          isDefiniteChatRequestFailure(error)
        ) {
          finalPostLifecycle = 'idle';
        }
        if (lifecycleSeqRef.current !== lifecycleSeq) return false;
        console.error('Failed to post chat thread ack reply.');
        if (isUnavailableChatRequestFailure(error)) {
          const roomReadable = await revalidateRoomAccess();
          if (lifecycleSeqRef.current !== lifecycleSeq) return false;
          if (!roomReadable) {
            rootIdRef.current = '';
            setThread(null);
            setMessage('スレッドを表示できません');
            return false;
          }
          const refreshed = await refreshThread({
            suppressAccessCheck: true,
          });
          if (lifecycleSeqRef.current !== lifecycleSeq) return false;
          if (refreshed) {
            setMessage(
              '確認依頼対象を更新できませんでした。最新表示を再取得しました',
            );
          }
          return false;
        }
        if (isDefiniteChatRequestFailure(error)) {
          finalPostLifecycle = 'idle';
          setMessage('確認依頼付き返信の投稿に失敗しました');
          return false;
        }
        setMessage(
          '確認依頼の結果を確認できません。重複防止のため再送せず、ページを再読み込みしてください',
        );
        return false;
      } finally {
        updatePostLifecycle(finalPostLifecycle);
        if (lifecycleSeqRef.current === lifecycleSeq) {
          mutationInFlightRef.current = false;
          setIsMutating(false);
        }
      }
    },
    [
      onAccessRevoked,
      onRootUpdated,
      refreshThread,
      revalidateRoomAccess,
      thread,
      updatePostLifecycle,
    ],
  );

  const loadMore = useCallback(async () => {
    if (!thread || mutationInFlightRef.current || loadMoreInFlightRef.current) {
      return null;
    }
    loadMoreInFlightRef.current = true;
    const lifecycleSeq = lifecycleSeqRef.current;
    try {
      return await loadThread(thread.root.id, { append: true });
    } finally {
      if (lifecycleSeqRef.current === lifecycleSeq) {
        loadMoreInFlightRef.current = false;
      }
    }
  }, [loadThread, thread]);

  return {
    thread,
    isLoading,
    isLoadingMore,
    isMutating,
    submissionBlocked: postLifecycle !== 'idle',
    submissionUncertain: postLifecycle === 'uncertain',
    message,
    setMessage,
    openThread: loadThread,
    closeThread,
    loadMore,
    refreshThread,
    postReply,
    postAckReply,
    addReaction: (messageId: string, emoji: string) =>
      (() => {
        const expected =
          messageId === thread?.root.id
            ? thread.root
            : thread?.replies.find((reply) => reply.id === messageId);
        if (!expected) return Promise.resolve(false);
        return mutateAndRefresh(
          () => postMessageReaction(expected, emoji),
          undefined,
          (current, updated) =>
            replaceThreadReaction(current, messageId, updated),
        );
      })(),
    ack: (requestId: string) => {
      const target = [thread?.root, ...(thread?.replies ?? [])].find(
        (item) => item?.ackRequest?.id === requestId,
      );
      if (!target) return Promise.resolve(false);
      return mutateAndRefresh(
        () =>
          ackRequest({
            requestId,
            messageId: target.id,
            roomId: target.roomId,
          }),
        '確認しました',
        (current, updated) =>
          replaceThreadAckRequest(current, requestId, updated),
      );
    },
    revokeAck: (requestId: string) => {
      const target = [thread?.root, ...(thread?.replies ?? [])].find(
        (item) => item?.ackRequest?.id === requestId,
      );
      if (!target) return Promise.resolve(false);
      return mutateAndRefresh(
        () =>
          revokeAckRequest({
            requestId,
            messageId: target.id,
            roomId: target.roomId,
          }),
        '確認を取り消しました',
        (current, updated) =>
          replaceThreadAckRequest(current, requestId, updated),
      );
    },
    cancelAck: (requestId: string, reason?: string) => {
      const target = [thread?.root, ...(thread?.replies ?? [])].find(
        (item) => item?.ackRequest?.id === requestId,
      );
      if (!target) return Promise.resolve(false);
      return mutateAndRefresh(
        () =>
          cancelAckRequestById(
            {
              requestId,
              messageId: target.id,
              roomId: target.roomId,
            },
            reason,
          ),
        '確認依頼を撤回しました',
        (current, updated) =>
          replaceThreadAckRequest(current, requestId, updated),
      );
    },
    deleteMessage: (
      messageId: string,
      reason: 'user_retract' | 'admin_moderation',
    ) =>
      mutateAndRefresh(
        () => deleteChatMessage(messageId, reason),
        'メッセージを削除しました',
        (current) => redactDeletedMessage(current, messageId, reason),
        () => onMessageDeleted?.(roomId, messageId),
      ),
  };
}
