import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRoomMessages,
  fetchRoomUnreadState,
  isUnavailableChatRequestFailure,
  markRoomRead,
} from './roomChatApi';
import {
  newestVisibleMessageBoundary,
  pageSize,
  type ChatMessage,
} from './roomChatModel';

export type LoadMessagesOptions = {
  append?: boolean;
  before?: string;
  query?: string;
  tag?: string;
  failureMessage?: string;
  onCurrentFailure?: () => void;
  skipReadState?: boolean;
  suppressAccessCheck?: boolean;
};

export function useRoomChatMessages({
  roomId,
  filterQuery,
  filterTag,
  onAccessUnavailable,
}: {
  roomId: string;
  filterQuery: string;
  filterTag: string;
  onAccessUnavailable?: (roomId: string) => Promise<boolean>;
}) {
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [message, setMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [highlightSince, setHighlightSince] = useState<Date | null>(null);
  const roomIdRef = useRef(roomId);
  const itemsRef = useRef(items);
  const requestSeqRef = useRef(0);
  const unreadRequestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      unreadRequestSeqRef.current += 1;
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
    };
  }, []);

  const fetchUnreadState = useCallback(
    async (
      targetRoomId: string,
      options?: { preserveHighlight?: boolean; signal?: AbortSignal },
    ) => {
      const requestSeq = ++unreadRequestSeqRef.current;
      const unread = await fetchRoomUnreadState(targetRoomId, options?.signal);
      if (
        options?.signal?.aborted ||
        roomIdRef.current !== targetRoomId ||
        unreadRequestSeqRef.current !== requestSeq
      )
        return;
      setUnreadCount(unread.unreadCount);
      if (!options?.preserveHighlight) {
        setHighlightSince(
          unread.lastReadAt ? new Date(unread.lastReadAt) : null,
        );
      }
    },
    [],
  );

  const markRead = useCallback(
    async (targetRoomId: string, messages: ChatMessage[]) => {
      const boundary = newestVisibleMessageBoundary(messages);
      if (!boundary) return true;
      try {
        await markRoomRead(targetRoomId, boundary);
        return true;
      } catch (error) {
        if (isUnavailableChatRequestFailure(error)) {
          try {
            return (await onAccessUnavailable?.(targetRoomId)) === true;
          } catch {
            return false;
          }
        }
        console.warn('Failed to mark read.');
        return true;
      }
    },
    [onAccessUnavailable],
  );

  const purgeRoomState = useCallback(
    (targetRoomId: string, safeMessage: string) => {
      if (roomIdRef.current !== targetRoomId) return false;
      requestSeqRef.current += 1;
      unreadRequestSeqRef.current += 1;
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
      itemsRef.current = [];
      setItems([]);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      setUnreadCount(0);
      setHighlightSince(null);
      setMessage(safeMessage);
      return true;
    },
    [],
  );

  const loadMessages = useCallback(
    async (options?: LoadMessagesOptions) => {
      if (!roomId) return false;
      const targetRoomId = roomId;
      if (roomIdRef.current !== targetRoomId) return false;
      const append = options?.append === true;
      const requestSeq = ++requestSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const isCurrentRequest = () =>
        requestSeqRef.current === requestSeq &&
        roomIdRef.current === targetRoomId &&
        !controller.signal.aborted;

      try {
        if (append) {
          setIsLoadingMore(true);
        } else {
          setIsLoading(true);
          setItems([]);
        }
        setMessage('');

        const before =
          options?.before !== undefined
            ? options.before
            : append && itemsRef.current.length
              ? itemsRef.current[itemsRef.current.length - 1]?.createdAt
              : '';
        const effectiveTag =
          options?.tag !== undefined ? options.tag : filterTag;
        const effectiveQuery =
          options?.query !== undefined ? options.query : filterQuery;
        const trimmedQuery = effectiveQuery.trim();
        if (trimmedQuery && trimmedQuery.length < 2) {
          if (isCurrentRequest()) {
            setMessage('検索語は2文字以上で入力してください');
            setHasMore(false);
          }
          return false;
        }

        const fetched = await fetchRoomMessages(
          targetRoomId,
          {
            before,
            limit: pageSize,
            query: trimmedQuery,
            tag: effectiveTag,
          },
          controller.signal,
        );
        if (!isCurrentRequest()) return false;
        if (append) {
          setItems((prev) => [...prev, ...fetched]);
        } else {
          setItems(fetched);
        }
        setHasMore(fetched.length === pageSize);

        if (!append && !options?.skipReadState) {
          await fetchUnreadState(targetRoomId, { signal: controller.signal });
          if (!isCurrentRequest()) return false;
          const readAccessValid = await markRead(targetRoomId, fetched);
          if (!readAccessValid) {
            purgeRoomState(
              targetRoomId,
              'ルームを表示できません。権限を確認して再読み込みしてください。',
            );
            return false;
          }
          if (!isCurrentRequest()) return false;
          await fetchUnreadState(targetRoomId, {
            preserveHighlight: true,
            signal: controller.signal,
          });
        }
        return isCurrentRequest();
      } catch (error) {
        if (controller.signal.aborted || !isCurrentRequest()) return false;
        if (
          isUnavailableChatRequestFailure(error) &&
          !options?.suppressAccessCheck
        ) {
          let readable = false;
          try {
            readable = (await onAccessUnavailable?.(targetRoomId)) === true;
          } catch {
            readable = false;
          }
          if (!readable && isCurrentRequest()) {
            if (
              purgeRoomState(
                targetRoomId,
                options?.failureMessage ??
                  'ルームを表示できません。権限を確認して再読み込みしてください。',
              )
            ) {
              options?.onCurrentFailure?.();
            }
          }
          return false;
        }
        console.error('Failed to load room messages.');
        if (options?.failureMessage) {
          if (purgeRoomState(targetRoomId, options.failureMessage)) {
            options.onCurrentFailure?.();
          }
        } else {
          setMessage('メッセージの取得に失敗しました');
          setHasMore(false);
        }
        return false;
      } finally {
        if (
          requestSeqRef.current === requestSeq &&
          roomIdRef.current === targetRoomId &&
          !controller.signal.aborted
        ) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [
      fetchUnreadState,
      filterQuery,
      filterTag,
      markRead,
      onAccessUnavailable,
      purgeRoomState,
      roomId,
    ],
  );

  return {
    items,
    setItems,
    hasMore,
    isLoading,
    isLoadingMore,
    message,
    setMessage,
    unreadCount,
    highlightSince,
    refreshUnreadState: fetchUnreadState,
    loadMessages,
    purgeRoomState,
  };
}
