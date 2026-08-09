import {
  ackRequest,
  cancelAckRequestById,
  isUnavailableChatRequestFailure,
  postMessageReaction,
  revokeAckRequest,
} from './roomChatApi';
import { isAckRequest, type ChatMessage } from './roomChatModel';

type RootTimelineMutationContext = {
  currentRoomItems: ChatMessage[];
  isCurrentRoom: (roomId: string) => boolean;
  isMounted: () => boolean;
  revalidateRoomAccess: (roomId: string) => Promise<boolean>;
  setItems: (updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  setMessage: (message: string) => void;
};

export function useRoomChatRootTimelineMutations({
  currentRoomItems,
  isCurrentRoom,
  isMounted,
  revalidateRoomAccess,
  setItems,
  setMessage,
}: RootTimelineMutationContext) {
  const revalidateUnavailableMutation = async (
    error: unknown,
    targetRoomId: string,
    failureMessage: string,
  ) => {
    if (!isUnavailableChatRequestFailure(error)) return false;
    const readable = await revalidateRoomAccess(targetRoomId);
    if (readable && isMounted() && isCurrentRoom(targetRoomId)) {
      setMessage(failureMessage);
    }
    return true;
  };

  const addReaction = async (id: string, emoji: string) => {
    const expected = currentRoomItems.find((item) => item.id === id);
    if (!expected || !isCurrentRoom(expected.roomId)) return;
    try {
      const updated = await postMessageReaction(expected, emoji);
      if (!isCurrentRoom(expected.roomId)) return;
      setItems((current) =>
        current.map((item) =>
          item.id === id && item.roomId === expected.roomId
            ? { ...item, reactions: updated.reactions }
            : item,
        ),
      );
    } catch (error) {
      console.error('Failed to add reaction.');
      if (
        await revalidateUnavailableMutation(
          error,
          expected.roomId,
          'リアクションの更新に失敗しました',
        )
      ) {
        return;
      }
      if (isCurrentRoom(expected.roomId)) {
        setMessage('リアクションの更新に失敗しました');
      }
    }
  };

  const acknowledge = async (requestId: string) => {
    const target = currentRoomItems.find(
      (item) => item.ackRequest?.id === requestId,
    );
    if (!target || !isCurrentRoom(target.roomId)) return;
    try {
      const updated = await ackRequest({
        requestId,
        messageId: target.id,
        roomId: target.roomId,
      });
      if (!isCurrentRoom(target.roomId)) return;
      setItems((current) =>
        current.map((item) =>
          item.ackRequest?.id === requestId && item.roomId === target.roomId
            ? {
                ...item,
                ackRequest: isAckRequest(updated) ? updated : item.ackRequest,
              }
            : item,
        ),
      );
    } catch (error) {
      console.error('Failed to ack request.');
      if (
        await revalidateUnavailableMutation(
          error,
          target.roomId,
          'OKの送信に失敗しました',
        )
      ) {
        return;
      }
      if (isCurrentRoom(target.roomId)) {
        setMessage('OKの送信に失敗しました');
      }
    }
  };

  const revokeAck = async (requestId: string) => {
    const target = currentRoomItems.find(
      (item) => item.ackRequest?.id === requestId,
    );
    if (!target || !isCurrentRoom(target.roomId)) return;
    try {
      const updated = await revokeAckRequest({
        requestId,
        messageId: target.id,
        roomId: target.roomId,
      });
      if (!isCurrentRoom(target.roomId)) return;
      setItems((current) =>
        current.map((item) =>
          item.ackRequest?.id === requestId && item.roomId === target.roomId
            ? {
                ...item,
                ackRequest: isAckRequest(updated) ? updated : item.ackRequest,
              }
            : item,
        ),
      );
      setMessage('OKを取り消しました');
    } catch (error) {
      console.error('Failed to revoke ack.');
      if (
        await revalidateUnavailableMutation(
          error,
          target.roomId,
          'OKの取り消しに失敗しました',
        )
      ) {
        return;
      }
      if (isCurrentRoom(target.roomId)) {
        setMessage('OKの取り消しに失敗しました');
      }
    }
  };

  const cancelAckRequest = async (requestId: string, reason?: string) => {
    const target = currentRoomItems.find(
      (item) => item.ackRequest?.id === requestId,
    );
    if (!target || !isCurrentRoom(target.roomId)) return;
    try {
      const updated = await cancelAckRequestById(
        {
          requestId,
          messageId: target.id,
          roomId: target.roomId,
        },
        reason,
      );
      if (!isCurrentRoom(target.roomId)) return;
      setItems((current) =>
        current.map((item) =>
          item.ackRequest?.id === requestId && item.roomId === target.roomId
            ? {
                ...item,
                ackRequest: isAckRequest(updated) ? updated : item.ackRequest,
              }
            : item,
        ),
      );
      setMessage('確認依頼を撤回しました');
    } catch (error) {
      console.error('Failed to cancel ack request.');
      if (
        await revalidateUnavailableMutation(
          error,
          target.roomId,
          '確認依頼の撤回に失敗しました',
        )
      ) {
        return;
      }
      if (isCurrentRoom(target.roomId)) {
        setMessage('確認依頼の撤回に失敗しました');
      }
    }
  };

  return { addReaction, acknowledge, revokeAck, cancelAckRequest };
}
