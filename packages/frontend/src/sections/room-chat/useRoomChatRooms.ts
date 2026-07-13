import { useCallback, useMemo, useState } from 'react';
import { fetchChatRooms } from './roomChatApi';
import { filterVisibleRoomsForUser, type ChatRoom } from './roomChatModel';

export function useRoomChatRooms({
  canSeeAllMeta,
}: {
  canSeeAllMeta: boolean;
}) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomId, setRoomId] = useState('');
  const [roomMessage, setRoomMessage] = useState('');

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === roomId) || null,
    [rooms, roomId],
  );

  const loadRooms = useCallback(async () => {
    try {
      const items = await fetchChatRooms();
      const joinedRooms = filterVisibleRoomsForUser(items, canSeeAllMeta);
      setRooms(joinedRooms);
      setRoomMessage('');
      setRoomId((currentRoomId) => {
        if (!currentRoomId && joinedRooms.length) {
          return joinedRooms[0].id;
        }
        if (
          currentRoomId &&
          !joinedRooms.some((room) => room.id === currentRoomId)
        ) {
          return joinedRooms[0]?.id || '';
        }
        return currentRoomId;
      });
    } catch (err) {
      console.error('Failed to load chat rooms.', err);
      setRooms([]);
      setRoomMessage('ルーム一覧の取得に失敗しました');
    }
  }, [canSeeAllMeta]);

  const resolveProjectRoom = useCallback(
    async (projectId: string) => {
      const existingRoom = rooms.find(
        (room) => room.type === 'project' && room.projectId === projectId,
      );
      if (existingRoom) {
        setRoomId(existingRoom.id);
        setRoomMessage('');
        return true;
      }
      try {
        const items = await fetchChatRooms();
        const visibleRooms = filterVisibleRoomsForUser(items, canSeeAllMeta);
        setRooms(visibleRooms);
        const nextRoom = visibleRooms.find(
          (room) => room.type === 'project' && room.projectId === projectId,
        );
        if (nextRoom) {
          setRoomId(nextRoom.id);
          setRoomMessage('');
          return true;
        }
        setRoomMessage('指定された案件ルームが見つかりません');
      } catch (err) {
        console.error('Failed to resolve project room.', err);
        setRoomMessage('指定された案件ルームの解決に失敗しました');
      }
      return false;
    },
    [canSeeAllMeta, rooms],
  );

  return {
    rooms,
    roomId,
    setRoomId,
    roomMessage,
    setRoomMessage,
    selectedRoom,
    loadRooms,
    resolveProjectRoom,
  };
}
