import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { LoadMessagesOptions } from './useRoomChatMessages';

type RevalidationHandler = (roomId: string) => Promise<boolean>;

export function useRoomChatAccessRevalidation(input: {
  currentRoomIdRef: { current: string };
  handlerRef: { current: RevalidationHandler | null };
  clearGlobalSearch: () => void;
  clearRoomBoundThreadState: (roomId: string) => void;
  loadMessages: (options?: LoadMessagesOptions) => Promise<boolean>;
  setFilterQuery: Dispatch<SetStateAction<string>>;
  setFilterTag: Dispatch<SetStateAction<string>>;
}) {
  const {
    currentRoomIdRef,
    handlerRef,
    clearGlobalSearch,
    clearRoomBoundThreadState,
    loadMessages,
    setFilterQuery,
    setFilterTag,
  } = input;
  const revalidateRoomAccess = useCallback(
    async (targetRoomId: string) => {
      if (currentRoomIdRef.current !== targetRoomId) return false;
      clearGlobalSearch();
      setFilterQuery('');
      setFilterTag('');
      return loadMessages({
        query: '',
        tag: '',
        skipReadState: true,
        failureMessage:
          'ルームを表示できません。権限を確認して再読み込みしてください。',
        onCurrentFailure: () => clearRoomBoundThreadState(targetRoomId),
      });
    },
    [
      clearGlobalSearch,
      clearRoomBoundThreadState,
      currentRoomIdRef,
      loadMessages,
      setFilterQuery,
      setFilterTag,
    ],
  );

  useEffect(() => {
    handlerRef.current = revalidateRoomAccess;
    return () => {
      if (handlerRef.current === revalidateRoomAccess) {
        handlerRef.current = null;
      }
    };
  }, [handlerRef, revalidateRoomAccess]);

  return revalidateRoomAccess;
}
