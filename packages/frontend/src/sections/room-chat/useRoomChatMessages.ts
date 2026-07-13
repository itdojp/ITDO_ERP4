import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRoomMessages,
  fetchRoomUnreadState,
  markRoomRead,
} from './roomChatApi';
import { pageSize, type ChatMessage } from './roomChatModel';

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

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const fetchUnreadState = useCallback(async (targetRoomId: string) => {
    const unread = await fetchRoomUnreadState(targetRoomId);
    if (roomIdRef.current !== targetRoomId) return unread.unreadCount;
    setUnreadCount(unread.unreadCount);
    setHighlightSince(unread.lastReadAt ? new Date(unread.lastReadAt) : null);
    return unread.unreadCount;
  }, []);

  const markRead = useCallback(async (targetRoomId: string) => {
    try {
      await markRoomRead(targetRoomId);
    } catch (err) {
      console.warn('Failed to mark read.', err);
    }
  }, []);

  const loadMessages = useCallback(
    async (options?: LoadMessagesOptions) => {
      if (!roomId) return;
      const targetRoomId = roomId;
      const append = options?.append === true;
      const requestSeq = ++requestSeqRef.current;
      const isCurrentRequest = () =>
        requestSeqRef.current === requestSeq &&
        roomIdRef.current === targetRoomId;

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

        const fetched = await fetchRoomMessages(targetRoomId, {
          before,
          limit: pageSize,
          query: trimmedQuery,
          tag: effectiveTag,
        });
        if (!isCurrentRequest()) return;
        if (append) {
          setItems((prev) => [...prev, ...fetched]);
        } else {
          setItems(fetched);
        }
        setHasMore(fetched.length === pageSize);

        await fetchUnreadState(targetRoomId);
        await markRead(targetRoomId);
      } catch (err) {
        if (!isCurrentRequest()) return;
        console.error('Failed to load room messages.', err);
        setMessage('メッセージの取得に失敗しました');
        setHasMore(false);
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [fetchUnreadState, filterQuery, filterTag, markRead, roomId],
  );

  return {
    items,
    setItems,
    hasMore,
    setHasMore,
    isLoading,
    setIsLoading,
    isLoadingMore,
    message,
    setMessage,
    unreadCount,
    setUnreadCount,
    highlightSince,
    setHighlightSince,
    fetchUnreadState,
    markRead,
    loadMessages,
  };
}
