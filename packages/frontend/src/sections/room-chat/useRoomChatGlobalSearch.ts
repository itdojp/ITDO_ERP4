import { useCallback, useEffect, useRef, useState } from 'react';
import { searchChatMessages } from './roomChatApi';
import { pageSize, type ChatSearchItem } from './roomChatModel';

export function useRoomChatGlobalSearch() {
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalItems, setGlobalItems] = useState<ChatSearchItem[]>([]);
  const [globalHasMore, setGlobalHasMore] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalLoading, setGlobalLoading] = useState(false);
  const itemsRef = useRef(globalItems);

  useEffect(() => {
    itemsRef.current = globalItems;
  }, [globalItems]);

  const loadGlobalSearch = useCallback(
    async (options?: { append?: boolean }) => {
      const append = options?.append === true;
      const trimmed = globalQuery.trim();
      if (trimmed.length < 2) {
        setGlobalMessage('検索語は2文字以上で入力してください');
        return;
      }
      try {
        setGlobalLoading(true);
        setGlobalMessage('');
        const before =
          append && itemsRef.current.length
            ? itemsRef.current[itemsRef.current.length - 1]?.createdAt
            : '';
        const fetched = await searchChatMessages({
          query: trimmed,
          before,
          limit: pageSize,
        });
        setGlobalItems((prev) => (append ? [...prev, ...fetched] : fetched));
        setGlobalHasMore(fetched.length === pageSize);
      } catch (err) {
        console.error('Failed to search chat messages.', err);
        setGlobalMessage('検索に失敗しました');
        if (!append) setGlobalItems([]);
        setGlobalHasMore(false);
      } finally {
        setGlobalLoading(false);
      }
    },
    [globalQuery],
  );

  const clearGlobalSearch = useCallback(() => {
    setGlobalItems([]);
    setGlobalHasMore(false);
    setGlobalMessage('');
  }, []);

  return {
    globalQuery,
    setGlobalQuery,
    globalItems,
    globalHasMore,
    globalMessage,
    globalLoading,
    loadGlobalSearch,
    clearGlobalSearch,
  };
}
