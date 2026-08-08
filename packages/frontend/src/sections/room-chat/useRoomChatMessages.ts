import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRoomMessages,
  fetchRoomUnreadState,
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
};

export function useRoomChatMessages({
  roomId,
  filterQuery,
  filterTag,
}: {
  roomId: string;
  filterQuery: string;
  filterTag: string;
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
      const unread = await fetchRoomUnreadState(targetRoomId, options?.signal);
      if (options?.signal?.aborted || roomIdRef.current !== targetRoomId)
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
      if (!boundary) return;
      try {
        await markRoomRead(targetRoomId, boundary);
      } catch {
        console.warn('Failed to mark read.');
      }
    },
    [],
  );

  const loadMessages = useCallback(
    async (options?: LoadMessagesOptions) => {
      if (!roomId) return;
      const targetRoomId = roomId;
      if (roomIdRef.current !== targetRoomId) return;
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
          return;
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
        if (!isCurrentRequest()) return;
        if (append) {
          setItems((prev) => [...prev, ...fetched]);
        } else {
          setItems(fetched);
        }
        setHasMore(fetched.length === pageSize);

        if (!append) {
          await fetchUnreadState(targetRoomId, { signal: controller.signal });
          if (!isCurrentRequest()) return;
          await markRead(targetRoomId, fetched);
          if (!isCurrentRequest()) return;
          await fetchUnreadState(targetRoomId, {
            preserveHighlight: true,
            signal: controller.signal,
          });
        }
      } catch {
        if (controller.signal.aborted || !isCurrentRequest()) return;
        console.error('Failed to load room messages.');
        setMessage('メッセージの取得に失敗しました');
        setHasMore(false);
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
    [fetchUnreadState, filterQuery, filterTag, markRead, roomId],
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
  };
}
