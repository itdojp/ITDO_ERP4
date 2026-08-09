import { useCallback, useEffect, useRef, useState } from 'react';
import type { MentionTarget } from '../../ui';
import {
  fetchAckCandidates,
  fetchMentionCandidates,
  isUnavailableChatRequestFailure,
} from './roomChatApi';
import type { MentionCandidates } from './roomChatModel';

export function useRoomChatMentionCandidates(
  roomId: string,
  onAccessUnavailable?: (roomId: string) => Promise<boolean>,
) {
  const [mentionState, setMentionState] = useState<{
    roomId: string;
    value: MentionCandidates;
  }>({ roomId: '', value: {} });
  const roomIdRef = useRef(roomId);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mentionCandidates =
    mentionState.roomId === roomId ? mentionState.value : {};

  const clearMentionCandidates = useCallback(() => {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setMentionState({ roomId: '', value: {} });
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    clearMentionCandidates();
    if (!roomId) {
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const run = async () => {
      try {
        const res = await fetchMentionCandidates(roomId, controller.signal);
        if (
          !controller.signal.aborted &&
          requestSeqRef.current === requestSeq &&
          roomIdRef.current === roomId
        ) {
          setMentionState({ roomId, value: res || {} });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnavailableChatRequestFailure(error)) {
          let readable = false;
          try {
            readable = (await onAccessUnavailable?.(roomId)) === true;
          } catch {
            // The parent access boundary owns the sanitized user-facing state.
          }
          if (
            controller.signal.aborted ||
            requestSeqRef.current !== requestSeq ||
            roomIdRef.current !== roomId
          ) {
            return;
          }
          if (!readable) {
            clearMentionCandidates();
            return;
          }
        }
        console.warn('メンション候補の取得に失敗しました');
        if (
          requestSeqRef.current === requestSeq &&
          roomIdRef.current === roomId
        ) {
          setMentionState({ roomId, value: {} });
        }
      }
    };
    run().catch(() => undefined);
    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [clearMentionCandidates, onAccessUnavailable, roomId]);

  const fetchMentionComposerCandidates = useCallback(
    async (query: string, kind: 'user' | 'group' | 'role') => {
      const keyword = query.trim().toLowerCase();
      if (!keyword || !roomId) return [];
      const targetRoomId = roomId;
      const requestSeq = requestSeqRef.current;
      if (kind === 'role') {
        return [];
      }
      if (kind === 'user') {
        return (mentionCandidates.users || [])
          .filter((user) => {
            const userId = user.userId.trim();
            const displayName = user.displayName ? user.displayName.trim() : '';
            return (
              userId.toLowerCase().includes(keyword) ||
              displayName.toLowerCase().includes(keyword)
            );
          })
          .slice(0, 50)
          .map<MentionTarget>((user) => ({
            id: user.userId,
            kind: 'user',
            label: user.displayName
              ? `${user.displayName} (${user.userId})`
              : user.userId,
          }));
      }
      if (keyword.length < 2) {
        return [];
      }

      const localGroups = (mentionCandidates.groups || []).map((group) => ({
        groupId: group.groupId,
        displayName: group.displayName ? group.displayName.trim() : '',
      }));
      let remoteGroups: { groupId: string; displayName?: string | null }[] = [];
      try {
        const response = await fetchAckCandidates(targetRoomId, query.trim());
        if (
          requestSeqRef.current !== requestSeq ||
          roomIdRef.current !== targetRoomId
        ) {
          return [];
        }
        remoteGroups = response.groups || [];
      } catch (error) {
        if (isUnavailableChatRequestFailure(error)) {
          let readable = false;
          try {
            readable = (await onAccessUnavailable?.(targetRoomId)) === true;
          } catch {
            // The parent access boundary owns the sanitized user-facing state.
          }
          if (
            requestSeqRef.current !== requestSeq ||
            roomIdRef.current !== targetRoomId
          ) {
            return [];
          }
          if (!readable) clearMentionCandidates();
          return [];
        }
        console.warn('確認対象グループ候補の取得に失敗しました');
      }
      if (
        requestSeqRef.current !== requestSeq ||
        roomIdRef.current !== targetRoomId
      ) {
        return [];
      }
      const merged = new Map<string, string>();
      [...localGroups, ...remoteGroups].forEach((group) => {
        const key = group.groupId?.trim();
        if (!key) return;
        const label =
          group.displayName && group.displayName.trim().length > 0
            ? group.displayName.trim()
            : key;
        if (!merged.has(key)) {
          merged.set(key, label);
        }
      });
      return Array.from(merged.entries())
        .filter(([groupId, label]) => {
          return (
            groupId.toLowerCase().includes(keyword) ||
            label.toLowerCase().includes(keyword)
          );
        })
        .slice(0, 20)
        .map<MentionTarget>(([groupId, label]) => ({
          id: groupId,
          kind: 'group',
          label: label === groupId ? groupId : `${label} (${groupId})`,
        }));
    },
    [
      clearMentionCandidates,
      mentionCandidates.groups,
      mentionCandidates.users,
      onAccessUnavailable,
      roomId,
    ],
  );

  return {
    mentionCandidates,
    fetchMentionComposerCandidates,
    clearMentionCandidates,
  };
}

export function useRoomChatAckCandidates(
  roomId: string,
  onAccessUnavailable?: (roomId: string) => Promise<boolean>,
) {
  const [ackState, setAckState] = useState<{
    roomId: string;
    value: MentionCandidates;
  }>({ roomId: '', value: {} });
  const [ackCandidateQuery, setAckCandidateQuery] = useState('');
  const roomIdRef = useRef(roomId);
  const requestSeqRef = useRef(0);
  const ackCandidates = ackState.roomId === roomId ? ackState.value : {};

  const clearAckCandidates = useCallback(() => {
    requestSeqRef.current += 1;
    setAckCandidateQuery('');
    setAckState({ roomId: '', value: {} });
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    clearAckCandidates();
  }, [clearAckCandidates, roomId]);

  useEffect(() => {
    const keyword = ackCandidateQuery.trim();
    if (!roomId || keyword.length < 2) {
      setAckState({ roomId: '', value: {} });
      return;
    }
    const requestSeq = ++requestSeqRef.current;
    const targetRoomId = roomId;
    let cancelled = false;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      fetchAckCandidates(targetRoomId, keyword, controller.signal)
        .then((res) => {
          if (
            !cancelled &&
            requestSeqRef.current === requestSeq &&
            roomIdRef.current === targetRoomId
          ) {
            setAckState({ roomId: targetRoomId, value: res || {} });
          }
        })
        .catch(async (error) => {
          if (controller.signal.aborted) return;
          if (isUnavailableChatRequestFailure(error)) {
            let readable = false;
            try {
              readable = (await onAccessUnavailable?.(targetRoomId)) === true;
            } catch {
              // The parent access boundary owns the sanitized user-facing state.
            }
            if (
              cancelled ||
              controller.signal.aborted ||
              requestSeqRef.current !== requestSeq ||
              roomIdRef.current !== targetRoomId
            ) {
              return;
            }
            if (!readable) {
              clearAckCandidates();
              return;
            }
          }
          console.warn('確認対象候補の取得に失敗しました');
          if (
            !cancelled &&
            requestSeqRef.current === requestSeq &&
            roomIdRef.current === targetRoomId
          ) {
            setAckState({ roomId: targetRoomId, value: {} });
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [ackCandidateQuery, clearAckCandidates, onAccessUnavailable, roomId]);

  return {
    ackCandidates,
    ackCandidateQuery,
    setAckCandidateQuery,
    clearAckCandidates,
  };
}
