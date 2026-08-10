import { useCallback, useEffect, useRef, useState } from 'react';

export type RootPostLifecycle = 'idle' | 'in_flight' | 'uncertain';

export type RoomChatProps = {
  rootPostLifecycle?: RootPostLifecycle;
  onRootPostLifecycleChange?: (lifecycle: RootPostLifecycle) => void;
  knowledgeCommitBusy?: boolean;
  onKnowledgeCommitBusyChange?: (busy: boolean) => void;
};

export function useRoomChatMutationLifecycle(options: RoomChatProps) {
  const {
    rootPostLifecycle: controlledRootPostLifecycle,
    onRootPostLifecycleChange,
    knowledgeCommitBusy: controlledKnowledgeCommitBusy,
    onKnowledgeCommitBusyChange,
  } = options;
  const mountedRef = useRef(true);
  const [localRootPostLifecycle, setLocalRootPostLifecycle] =
    useState<RootPostLifecycle>('idle');
  const rootPostLifecycle =
    controlledRootPostLifecycle ?? localRootPostLifecycle;
  const rootPostLifecycleRef = useRef(rootPostLifecycle);
  const [localKnowledgeCommitBusy, setLocalKnowledgeCommitBusy] =
    useState(false);
  const knowledgeCommitBusy =
    controlledKnowledgeCommitBusy ?? localKnowledgeCommitBusy;
  const knowledgeCommitBusyRef = useRef(knowledgeCommitBusy);
  const roomNavigationBlocked =
    rootPostLifecycle !== 'idle' || knowledgeCommitBusy;
  const roomNavigationBlockedRef = useRef(roomNavigationBlocked);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rootPostLifecycleRef.current = rootPostLifecycle;
    knowledgeCommitBusyRef.current = knowledgeCommitBusy;
    roomNavigationBlockedRef.current = roomNavigationBlocked;
  }, [knowledgeCommitBusy, roomNavigationBlocked, rootPostLifecycle]);

  const updateRootPostLifecycle = useCallback(
    (next: RootPostLifecycle) => {
      rootPostLifecycleRef.current = next;
      roomNavigationBlockedRef.current =
        next !== 'idle' || knowledgeCommitBusyRef.current;
      if (onRootPostLifecycleChange) {
        onRootPostLifecycleChange(next);
      } else if (mountedRef.current) {
        setLocalRootPostLifecycle(next);
      }
    },
    [onRootPostLifecycleChange],
  );

  const updateKnowledgeCommitBusy = useCallback(
    (busy: boolean) => {
      knowledgeCommitBusyRef.current = busy;
      roomNavigationBlockedRef.current =
        rootPostLifecycleRef.current !== 'idle' || busy;
      if (onKnowledgeCommitBusyChange) {
        onKnowledgeCommitBusyChange(busy);
      } else if (mountedRef.current) {
        setLocalKnowledgeCommitBusy(busy);
      }
    },
    [onKnowledgeCommitBusyChange],
  );

  return {
    knowledgeCommitBusy,
    knowledgeCommitBusyRef,
    roomNavigationBlocked,
    roomNavigationBlockedRef,
    rootPostLifecycle,
    rootPostLifecycleRef,
    updateKnowledgeCommitBusy,
    updateRootPostLifecycle,
  };
}
