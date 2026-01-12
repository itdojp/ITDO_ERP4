import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

export type ChatRoomOption = {
  id: string;
  type: string;
  name: string;
  projectId?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
};

type UseChatRoomsOptions = {
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
};

export const useChatRooms = ({
  selectedProjectId,
  onSelect,
}: UseChatRoomsOptions) => {
  const [rooms, setRooms] = useState<ChatRoomOption[]>([]);
  const [roomMessage, setRoomMessage] = useState('');

  const loadRooms = useCallback(async () => {
    try {
      const res = await api<{ items: ChatRoomOption[] }>('/chat-rooms');
      const items = Array.isArray(res.items) ? res.items : [];
      const projectRooms = items.filter(
        (room) =>
          room.type === 'project' &&
          typeof room.projectId === 'string' &&
          room.projectId.trim() !== '',
      );
      setRooms(projectRooms);
      setRoomMessage('');
    } catch (err) {
      console.error('Failed to load chat rooms.', err);
      setRooms([]);
      setRoomMessage('ルーム一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    loadRooms().catch(() => undefined);
  }, [loadRooms]);

  useEffect(() => {
    if (rooms.length === 0) return;
    if (rooms.some((room) => room.projectId === selectedProjectId)) {
      return;
    }
    const firstProjectId = rooms[0]?.projectId;
    if (firstProjectId) {
      onSelect(firstProjectId);
    }
  }, [rooms, selectedProjectId, onSelect]);

  return { rooms, roomMessage, loadRooms };
};
