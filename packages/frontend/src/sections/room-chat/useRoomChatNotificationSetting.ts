import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  toIsoFromLocalInput,
  toLocalDateTimeValue,
} from '../../utils/datetime';
import {
  fetchRoomNotificationSetting,
  isUnavailableChatRequestFailure,
  patchRoomNotificationSetting,
  type NotificationSetting,
} from './roomChatApi';

type RoomBoundSetting = {
  roomId: string;
  value: NotificationSetting | null;
};

export function useRoomChatNotificationSetting({
  roomId,
  onAccessUnavailable,
}: {
  roomId: string;
  onAccessUnavailable?: (roomId: string) => Promise<boolean>;
}) {
  const [roomBoundSetting, setRoomBoundSetting] = useState<RoomBoundSetting>({
    roomId: '',
    value: null,
  });
  const [notificationSettingMessage, setNotificationSettingMessage] =
    useState('');
  const [isNotificationSettingLoading, setIsNotificationSettingLoading] =
    useState(false);
  const [muteUntilInput, setMuteUntilInput] = useState('');
  const roomIdRef = useRef(roomId);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
    };
  }, []);

  const notificationSetting =
    roomBoundSetting.roomId === roomId ? roomBoundSetting.value : null;

  const setNotificationSetting = useCallback<
    Dispatch<SetStateAction<NotificationSetting | null>>
  >(
    (next) => {
      setRoomBoundSetting((current) => {
        const currentValue = current.roomId === roomId ? current.value : null;
        return {
          roomId,
          value: typeof next === 'function' ? next(currentValue) : next,
        };
      });
    },
    [roomId],
  );

  const clearNotificationSetting = useCallback((targetRoomId?: string) => {
    if (targetRoomId && roomIdRef.current !== targetRoomId) return false;
    requestSeqRef.current += 1;
    setRoomBoundSetting({ roomId: '', value: null });
    setNotificationSettingMessage('');
    setMuteUntilInput('');
    setIsNotificationSettingLoading(false);
    return true;
  }, []);

  const loadNotificationSetting = useCallback(
    async (targetRoomId: string) => {
      const requestSeq = ++requestSeqRef.current;
      setIsNotificationSettingLoading(true);
      setNotificationSettingMessage('');
      try {
        const nextSetting = await fetchRoomNotificationSetting(targetRoomId);
        if (
          !mountedRef.current ||
          roomIdRef.current !== targetRoomId ||
          requestSeqRef.current !== requestSeq
        ) {
          return false;
        }
        setRoomBoundSetting({ roomId: targetRoomId, value: nextSetting });
        setMuteUntilInput(toLocalDateTimeValue(nextSetting.muteUntil));
        return true;
      } catch (error) {
        if (
          !mountedRef.current ||
          roomIdRef.current !== targetRoomId ||
          requestSeqRef.current !== requestSeq
        ) {
          return false;
        }
        if (isUnavailableChatRequestFailure(error)) {
          let readable = false;
          try {
            readable = (await onAccessUnavailable?.(targetRoomId)) === true;
          } catch {
            // The parent access boundary owns the sanitized user-facing state.
          }
          if (
            !mountedRef.current ||
            roomIdRef.current !== targetRoomId ||
            requestSeqRef.current !== requestSeq
          ) {
            return false;
          }
          if (!readable) {
            clearNotificationSetting(targetRoomId);
            return false;
          }
        }
        if (
          !mountedRef.current ||
          roomIdRef.current !== targetRoomId ||
          requestSeqRef.current !== requestSeq
        ) {
          return false;
        }
        console.error('Failed to load notification settings.');
        setNotificationSettingMessage('通知設定の取得に失敗しました');
        setRoomBoundSetting({ roomId: '', value: null });
        setMuteUntilInput('');
        return false;
      } finally {
        if (
          mountedRef.current &&
          roomIdRef.current === targetRoomId &&
          requestSeqRef.current === requestSeq
        ) {
          setIsNotificationSettingLoading(false);
        }
      }
    },
    [clearNotificationSetting, onAccessUnavailable],
  );

  const saveNotificationSetting = useCallback(async () => {
    if (!roomId || !notificationSetting) return false;
    const targetRoomId = roomId;
    const requestSeq = ++requestSeqRef.current;
    setIsNotificationSettingLoading(true);
    setNotificationSettingMessage('');
    const muteUntil = toIsoFromLocalInput(muteUntilInput);
    if (muteUntilInput && !muteUntil) {
      setNotificationSettingMessage('ミュート期限の形式が不正です');
      setIsNotificationSettingLoading(false);
      return false;
    }
    try {
      const nextSetting = await patchRoomNotificationSetting(targetRoomId, {
        notifyAllPosts: notificationSetting.notifyAllPosts,
        notifyMentions: notificationSetting.notifyMentions,
        muteUntil,
      });
      if (
        !mountedRef.current ||
        roomIdRef.current !== targetRoomId ||
        requestSeqRef.current !== requestSeq
      ) {
        return false;
      }
      setRoomBoundSetting({ roomId: targetRoomId, value: nextSetting });
      setMuteUntilInput(toLocalDateTimeValue(nextSetting.muteUntil));
      setNotificationSettingMessage('通知設定を保存しました');
      return true;
    } catch (error) {
      if (
        !mountedRef.current ||
        roomIdRef.current !== targetRoomId ||
        requestSeqRef.current !== requestSeq
      ) {
        return false;
      }
      if (isUnavailableChatRequestFailure(error)) {
        let readable = false;
        try {
          readable = (await onAccessUnavailable?.(targetRoomId)) === true;
        } catch {
          // The parent access boundary owns the sanitized user-facing state.
        }
        if (
          !mountedRef.current ||
          roomIdRef.current !== targetRoomId ||
          requestSeqRef.current !== requestSeq
        ) {
          return false;
        }
        if (!readable) {
          clearNotificationSetting(targetRoomId);
          return false;
        }
      }
      if (
        !mountedRef.current ||
        roomIdRef.current !== targetRoomId ||
        requestSeqRef.current !== requestSeq
      ) {
        return false;
      }
      console.error('Failed to save notification settings.');
      setNotificationSettingMessage('通知設定の保存に失敗しました');
      return false;
    } finally {
      if (
        mountedRef.current &&
        roomIdRef.current === targetRoomId &&
        requestSeqRef.current === requestSeq
      ) {
        setIsNotificationSettingLoading(false);
      }
    }
  }, [
    clearNotificationSetting,
    muteUntilInput,
    notificationSetting,
    onAccessUnavailable,
    roomId,
  ]);

  const applyMutePreset = useCallback((minutes: number | null) => {
    if (!minutes) {
      setMuteUntilInput('');
      return;
    }
    const now = new Date();
    const next = new Date(now.getTime() + minutes * 60 * 1000);
    setMuteUntilInput(toLocalDateTimeValue(next.toISOString()));
  }, []);

  return {
    notificationSetting,
    setNotificationSetting,
    notificationSettingMessage,
    setNotificationSettingMessage,
    isNotificationSettingLoading,
    muteUntilInput,
    setMuteUntilInput,
    clearNotificationSetting,
    loadNotificationSetting,
    saveNotificationSetting,
    applyMutePreset,
  };
}
