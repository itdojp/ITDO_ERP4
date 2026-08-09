import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isUnavailableChatRequestFailure,
  previewRoomAckTargets,
  type AckPreview,
} from './roomChatApi';

export function useRoomChatAckPreview(input: {
  roomId: string;
  requiredUserIds: string[];
  requiredGroupIds: string[];
  requiredRoles: string[];
  onAccessUnavailable: (roomId: string) => Promise<boolean>;
}) {
  const {
    roomId,
    requiredUserIds,
    requiredGroupIds,
    requiredRoles,
    onAccessUnavailable,
  } = input;
  const [preview, setPreview] = useState<AckPreview | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const roomIdRef = useRef(roomId);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const targetKey = JSON.stringify([
    requiredUserIds,
    requiredGroupIds,
    requiredRoles,
  ]);

  const clearPreview = useCallback((targetRoomId?: string) => {
    if (targetRoomId && roomIdRef.current !== targetRoomId) return false;
    requestSeqRef.current += 1;
    setPreview(null);
    setMessage('');
    setIsLoading(false);
    return true;
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    clearPreview();
  }, [clearPreview, roomId, targetKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
    };
  }, []);

  const previewTargets = useCallback(async () => {
    if (!roomId) return false;
    const targetRoomId = roomId;
    const requestSeq = ++requestSeqRef.current;
    const isCurrentRequest = () =>
      mountedRef.current &&
      roomIdRef.current === targetRoomId &&
      requestSeqRef.current === requestSeq;
    setIsLoading(true);
    setPreview(null);
    setMessage('');
    if (
      requiredUserIds.length === 0 &&
      requiredGroupIds.length === 0 &&
      requiredRoles.length === 0
    ) {
      if (isCurrentRequest()) {
        setIsLoading(false);
        setMessage('確認対象を入力してください');
      }
      return false;
    }
    try {
      const result = await previewRoomAckTargets(targetRoomId, {
        requiredUserIds,
        requiredGroupIds,
        requiredRoles,
      });
      if (!isCurrentRequest()) return false;
      setPreview(result);
      return true;
    } catch (error) {
      console.error('確認対象の展開に失敗しました');
      let readable = true;
      if (isUnavailableChatRequestFailure(error)) {
        try {
          readable = await onAccessUnavailable(targetRoomId);
        } catch {
          readable = false;
        }
      }
      if (readable && isCurrentRequest()) {
        setMessage('確認対象の展開に失敗しました');
      }
      return false;
    } finally {
      if (isCurrentRequest()) setIsLoading(false);
    }
  }, [
    onAccessUnavailable,
    requiredGroupIds,
    requiredRoles,
    requiredUserIds,
    roomId,
  ]);

  return {
    ackPreview: preview,
    ackPreviewMessage: message,
    ackPreviewLoading: isLoading,
    previewAckTargets: previewTargets,
    clearAckPreview: clearPreview,
  };
}
