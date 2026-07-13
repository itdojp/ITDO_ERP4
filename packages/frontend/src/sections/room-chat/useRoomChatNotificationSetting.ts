import { useCallback, useState } from 'react';
import {
  toIsoFromLocalInput,
  toLocalDateTimeValue,
} from '../../utils/datetime';
import {
  fetchRoomNotificationSetting,
  patchRoomNotificationSetting,
  type NotificationSetting,
} from './roomChatApi';

export function useRoomChatNotificationSetting({ roomId }: { roomId: string }) {
  const [notificationSetting, setNotificationSetting] =
    useState<NotificationSetting | null>(null);
  const [notificationSettingMessage, setNotificationSettingMessage] =
    useState('');
  const [isNotificationSettingLoading, setIsNotificationSettingLoading] =
    useState(false);
  const [muteUntilInput, setMuteUntilInput] = useState('');

  const clearNotificationSetting = useCallback(() => {
    setNotificationSetting(null);
    setNotificationSettingMessage('');
    setMuteUntilInput('');
  }, []);

  const loadNotificationSetting = useCallback(async (targetRoomId: string) => {
    setIsNotificationSettingLoading(true);
    setNotificationSettingMessage('');
    try {
      const nextSetting = await fetchRoomNotificationSetting(targetRoomId);
      setNotificationSetting(nextSetting);
      setMuteUntilInput(toLocalDateTimeValue(nextSetting.muteUntil));
    } catch (err) {
      console.error('Failed to load notification settings.', err);
      setNotificationSettingMessage('通知設定の取得に失敗しました');
      setNotificationSetting(null);
      setMuteUntilInput('');
    } finally {
      setIsNotificationSettingLoading(false);
    }
  }, []);

  const saveNotificationSetting = useCallback(async () => {
    if (!roomId || !notificationSetting) return;
    setIsNotificationSettingLoading(true);
    setNotificationSettingMessage('');
    const muteUntil = toIsoFromLocalInput(muteUntilInput);
    if (muteUntilInput && !muteUntil) {
      setNotificationSettingMessage('ミュート期限の形式が不正です');
      setIsNotificationSettingLoading(false);
      return;
    }
    try {
      const nextSetting = await patchRoomNotificationSetting(roomId, {
        notifyAllPosts: notificationSetting.notifyAllPosts,
        notifyMentions: notificationSetting.notifyMentions,
        muteUntil,
      });
      setNotificationSetting(nextSetting);
      setMuteUntilInput(toLocalDateTimeValue(nextSetting.muteUntil));
      setNotificationSettingMessage('通知設定を保存しました');
    } catch (err) {
      console.error('Failed to save notification settings.', err);
      setNotificationSettingMessage('通知設定の保存に失敗しました');
    } finally {
      setIsNotificationSettingLoading(false);
    }
  }, [muteUntilInput, notificationSetting, roomId]);

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
