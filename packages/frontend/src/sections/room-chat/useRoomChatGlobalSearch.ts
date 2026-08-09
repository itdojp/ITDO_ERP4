import { useCallback, useEffect, useRef, useState } from 'react';
import { searchChatMessages } from './roomChatApi';
import { pageSize, type ChatSearchItem } from './roomChatModel';

type SearchBoundary = { before: string; beforeId: string } | null;

export function useRoomChatGlobalSearch() {
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalItems, setGlobalItems] = useState<ChatSearchItem[]>([]);
  const [globalHasMore, setGlobalHasMore] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalLoading, setGlobalLoading] = useState(false);
  const boundaryRef = useRef<SearchBoundary>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
    };
  }, []);

  const updateGlobalQuery = useCallback((value: string) => {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    boundaryRef.current = null;
    setGlobalQuery(value);
    setGlobalItems([]);
    setGlobalHasMore(false);
    setGlobalMessage('');
    setGlobalLoading(false);
  }, []);

  const loadGlobalSearch = useCallback(
    async (options?: { append?: boolean }) => {
      const append = options?.append === true;
      const trimmed = globalQuery.trim();
      if (trimmed.length < 2) {
        setGlobalMessage('検索語は2文字以上で入力してください');
        return;
      }
      if (append && !boundaryRef.current) return;

      const requestSeq = ++requestSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const querySnapshot = trimmed;
      try {
        setGlobalLoading(true);
        setGlobalMessage('');
        const boundary = append ? boundaryRef.current : null;
        const fetched = await searchChatMessages({
          query: querySnapshot,
          before: boundary?.before,
          beforeId: boundary?.beforeId,
          limit: pageSize,
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          requestSeqRef.current !== requestSeq ||
          globalQuery.trim() !== querySnapshot
        ) {
          return;
        }
        setGlobalItems((prev) =>
          append ? [...prev, ...fetched.items] : fetched.items,
        );
        boundaryRef.current =
          fetched.nextBefore && fetched.nextBeforeId
            ? {
                before: fetched.nextBefore,
                beforeId: fetched.nextBeforeId,
              }
            : null;
        setGlobalHasMore(
          fetched.items.length === pageSize && boundaryRef.current !== null,
        );
      } catch {
        if (controller.signal.aborted) return;
        console.error('Failed to search chat messages.');
        setGlobalMessage('検索に失敗しました');
        if (!append) {
          boundaryRef.current = null;
          setGlobalItems([]);
        }
        setGlobalHasMore(false);
      } finally {
        if (
          requestSeqRef.current === requestSeq &&
          !controller.signal.aborted
        ) {
          setGlobalLoading(false);
        }
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [globalQuery],
  );

  const clearGlobalSearch = useCallback(() => {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    boundaryRef.current = null;
    setGlobalItems([]);
    setGlobalHasMore(false);
    setGlobalMessage('');
    setGlobalLoading(false);
  }, []);

  return {
    globalQuery,
    setGlobalQuery: updateGlobalQuery,
    globalItems,
    globalHasMore,
    globalMessage,
    globalLoading,
    loadGlobalSearch,
    clearGlobalSearch,
  };
}
