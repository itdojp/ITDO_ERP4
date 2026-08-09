import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isUnavailableChatRequestFailure,
  summarizeRoomMessages,
  summarizeRoomMessagesWithExternalAi,
} from './roomChatApi';

type SummaryResult = {
  roomId: string;
  text: string;
  provider: string;
  model: string;
};

const emptySummary: SummaryResult = {
  roomId: '',
  text: '',
  provider: '',
  model: '',
};

export function useRoomChatSummary(input: {
  roomId: string;
  allowExternalIntegrations: boolean;
  setMessage: (message: string) => void;
  onAccessUnavailable: (roomId: string) => Promise<boolean>;
}) {
  const { roomId, allowExternalIntegrations, setMessage, onAccessUnavailable } =
    input;
  const [result, setResult] = useState<SummaryResult>(emptySummary);
  const [loadingMode, setLoadingMode] = useState<'local' | 'external' | null>(
    null,
  );
  const roomIdRef = useRef(roomId);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    roomIdRef.current = roomId;
    requestSeqRef.current += 1;
    setResult(emptySummary);
    setLoadingMode(null);
  }, [roomId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
    };
  }, []);

  const clearSummary = useCallback((targetRoomId?: string) => {
    if (targetRoomId && roomIdRef.current !== targetRoomId) return false;
    requestSeqRef.current += 1;
    setResult(emptySummary);
    setLoadingMode(null);
    return true;
  }, []);

  const handleFailure = useCallback(
    async (
      error: unknown,
      targetRoomId: string,
      requestSeq: number,
      failureMessage: string,
    ) => {
      let readable = true;
      if (isUnavailableChatRequestFailure(error)) {
        try {
          readable = await onAccessUnavailable(targetRoomId);
        } catch {
          readable = false;
        }
      }
      if (
        readable &&
        mountedRef.current &&
        roomIdRef.current === targetRoomId &&
        requestSeqRef.current === requestSeq
      ) {
        setMessage(failureMessage);
      }
    },
    [onAccessUnavailable, setMessage],
  );

  const summarize = useCallback(async () => {
    if (!roomId) return false;
    const targetRoomId = roomId;
    const requestSeq = ++requestSeqRef.current;
    setResult(emptySummary);
    setLoadingMode('local');
    setMessage('');
    try {
      const text = await summarizeRoomMessages(targetRoomId);
      if (
        !mountedRef.current ||
        roomIdRef.current !== targetRoomId ||
        requestSeqRef.current !== requestSeq
      ) {
        return false;
      }
      setResult({ roomId: targetRoomId, text, provider: '', model: '' });
      return true;
    } catch (error) {
      console.error('Failed to summarize room messages.');
      await handleFailure(
        error,
        targetRoomId,
        requestSeq,
        '要約の生成に失敗しました',
      );
      return false;
    } finally {
      if (
        mountedRef.current &&
        roomIdRef.current === targetRoomId &&
        requestSeqRef.current === requestSeq
      ) {
        setLoadingMode(null);
      }
    }
  }, [handleFailure, roomId, setMessage]);

  const summarizeExternal = useCallback(async () => {
    if (!roomId || !allowExternalIntegrations) return false;
    const ok = window.confirm(
      [
        '外部LLMへ送信して要約します（本文のみ。添付は送信しません）。',
        '送信範囲: 直近120件 / 過去7日間',
        '続行しますか？',
      ].join('\n'),
    );
    if (!ok) return false;

    const targetRoomId = roomId;
    const requestSeq = ++requestSeqRef.current;
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    setResult(emptySummary);
    setLoadingMode('external');
    setMessage('');
    try {
      const response = await summarizeRoomMessagesWithExternalAi(targetRoomId, {
        since: since.toISOString(),
        until: now.toISOString(),
      });
      if (
        !mountedRef.current ||
        roomIdRef.current !== targetRoomId ||
        requestSeqRef.current !== requestSeq
      ) {
        return false;
      }
      setResult({
        roomId: targetRoomId,
        text: response.summary,
        provider: response.provider,
        model: response.model,
      });
      return true;
    } catch (error) {
      console.error('Failed to generate external summary.');
      await handleFailure(
        error,
        targetRoomId,
        requestSeq,
        '外部要約の生成に失敗しました',
      );
      return false;
    } finally {
      if (
        mountedRef.current &&
        roomIdRef.current === targetRoomId &&
        requestSeqRef.current === requestSeq
      ) {
        setLoadingMode(null);
      }
    }
  }, [allowExternalIntegrations, handleFailure, roomId, setMessage]);

  const visibleResult = result.roomId === roomId ? result : emptySummary;
  return {
    summary: visibleResult.text,
    summaryProvider: visibleResult.provider,
    summaryModel: visibleResult.model,
    isSummarizing: loadingMode === 'local',
    isSummarizingExternal: loadingMode === 'external',
    summarize,
    summarizeExternal,
    clearSummary,
  };
}
