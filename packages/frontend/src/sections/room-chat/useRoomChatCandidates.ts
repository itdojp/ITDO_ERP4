import { useCallback, useEffect, useState } from 'react';
import type { MentionTarget } from '../../ui';
import { fetchAckCandidates, fetchMentionCandidates } from './roomChatApi';
import type { MentionCandidates } from './roomChatModel';

export function useRoomChatMentionCandidates(roomId: string) {
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidates>(
    {},
  );

  useEffect(() => {
    if (!roomId) {
      setMentionCandidates({});
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetchMentionCandidates(roomId, controller.signal);
        if (!cancelled) {
          setMentionCandidates(res || {});
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('メンション候補の取得に失敗しました', error);
        if (!cancelled) setMentionCandidates({});
      }
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomId]);

  const fetchMentionComposerCandidates = useCallback(
    async (query: string, kind: 'user' | 'group' | 'role') => {
      const keyword = query.trim().toLowerCase();
      if (!keyword || !roomId) return [];
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
        const response = await fetchAckCandidates(roomId, query.trim());
        remoteGroups = response.groups || [];
      } catch (error) {
        console.warn('確認対象グループ候補の取得に失敗しました', error);
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
    [mentionCandidates.groups, mentionCandidates.users, roomId],
  );

  return {
    mentionCandidates,
    setMentionCandidates,
    fetchMentionComposerCandidates,
  };
}

export function useRoomChatAckCandidates(roomId: string) {
  const [ackCandidates, setAckCandidates] = useState<MentionCandidates>({});
  const [ackCandidateQuery, setAckCandidateQuery] = useState('');

  useEffect(() => {
    setAckCandidateQuery('');
    setAckCandidates({});
  }, [roomId]);

  useEffect(() => {
    const keyword = ackCandidateQuery.trim();
    if (!roomId || keyword.length < 2) {
      setAckCandidates({});
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      fetchAckCandidates(roomId, keyword, controller.signal)
        .then((res) => {
          if (!cancelled) setAckCandidates(res || {});
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.warn('確認対象候補の取得に失敗しました', error);
          if (!cancelled) setAckCandidates({});
        });
    }, 200);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [roomId, ackCandidateQuery]);

  return {
    ackCandidates,
    setAckCandidates,
    ackCandidateQuery,
    setAckCandidateQuery,
  };
}
