import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type React from 'react';
import { expect, it, vi } from 'vitest';
import type { RoomChatProps } from '../sections/RoomChat';
import type {
  ChatMessageTestValue,
  ChatRoomTestValue,
  ChatSearchItemTestValue,
  RoomChatApiMockOptions,
} from './roomChatTestTypes';

type TestContext = {
  RoomChat: React.ComponentType<RoomChatProps>;
  api: ReturnType<typeof vi.fn>;
  installApiMock: (options: RoomChatApiMockOptions) => void;
  makeRoom: (overrides: Partial<ChatRoomTestValue>) => ChatRoomTestValue;
  makeMessage: (
    overrides: Partial<ChatMessageTestValue>,
  ) => ChatMessageTestValue;
  makeSearchItem: (
    overrides: Partial<ChatSearchItemTestValue>,
  ) => ChatSearchItemTestValue;
};

export function registerRoomChatSearchAndSettingsTests({
  RoomChat,
  api,
  installApiMock,
  makeRoom,
  makeMessage,
  makeSearchItem,
}: TestContext) {
  it('applies message search filters and validates short queries', async () => {
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: {
        'room-1': [
          makeMessage({
            id: 'message-1',
            roomId: 'room-1',
            body: 'alpha message',
            userId: 'alice',
          }),
          makeMessage({
            id: 'message-2',
            roomId: 'room-1',
            body: 'beta message',
            userId: 'bob',
          }),
        ],
      },
      searchResultsByQuery: {
        'room-1|beta': [
          makeMessage({
            id: 'message-2',
            roomId: 'room-1',
            body: 'beta message',
            userId: 'bob',
          }),
        ],
      },
    });

    render(<RoomChat />);

    expect(await screen.findByText('alpha message')).toBeInTheDocument();
    expect(screen.getByText('beta message')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('検索（本文）'), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    expect(
      await screen.findByText('検索語は2文字以上で入力してください'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('検索（本文）'), {
      target: { value: 'beta' },
    });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));

    expect(await screen.findByText('beta message')).toBeInTheDocument();
    expect(screen.queryByText('alpha message')).not.toBeInTheDocument();
  });

  it('shows a failure message when message loading fails', async () => {
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: {
        'room-1': [
          makeMessage({
            id: 'message-1',
            roomId: 'room-1',
            body: 'alpha message',
            userId: 'alice',
          }),
        ],
      },
      failOnSearch: ['fail'],
    });

    render(<RoomChat />);

    expect(await screen.findByText('alpha message')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('検索（本文）'), {
      target: { value: 'fail' },
    });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));

    expect(
      await screen.findByText('メッセージの取得に失敗しました'),
    ).toBeInTheDocument();
  });

  it('saves notification settings and keeps local changes on save failure', async () => {
    const notificationSettingPatchBodies: Array<{
      roomId: string;
      body: {
        notifyAllPosts?: boolean;
        notifyMentions?: boolean;
        muteUntil?: string | null;
      };
    }> = [];

    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: {
        'room-1': [],
      },
      notificationSettingsByRoom: {
        'room-1': {
          notifyAllPosts: false,
          notifyMentions: true,
          muteUntil: '2026-03-28T01:00:00.000Z',
        },
      },
      notificationSettingPatchBodies,
      failOnNotificationSave: ['room-1'],
    });

    render(<RoomChat />);

    const notifyAllPosts = await screen.findByRole('checkbox', {
      name: '全投稿通知',
    });
    const notifyMentions = screen.getByRole('checkbox', {
      name: 'メンション通知',
    });
    const muteUntil = screen.getByLabelText('ミュート期限（任意）');

    expect(notifyAllPosts).not.toBeChecked();
    expect(notifyMentions).toBeChecked();
    expect(muteUntil).not.toHaveValue('');

    fireEvent.click(notifyAllPosts);
    fireEvent.click(notifyMentions);
    fireEvent.click(screen.getByRole('button', { name: '解除' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(
      await screen.findByText('通知設定の保存に失敗しました'),
    ).toBeInTheDocument();
    expect(notificationSettingPatchBodies).toEqual([
      {
        roomId: 'room-1',
        body: {
          notifyAllPosts: true,
          notifyMentions: false,
          muteUntil: null,
        },
      },
    ]);
    expect(notifyAllPosts).toBeChecked();
    expect(notifyMentions).not.toBeChecked();
    expect(muteUntil).toHaveValue('');
  });

  it('loads more global search results, opens a result, and clears prior results on failure', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      makeSearchItem({
        id: `search-${index + 1}`,
        body: `beta result ${index + 1}`,
        createdAt: `2026-03-28T00:${String(49 - index).padStart(2, '0')}:00.000Z`,
        room: makeRoom({
          id: 'room-1',
          projectCode: 'PRJ-1',
          projectName: 'Alpha',
        }),
      }),
    );
    const secondPageItem = makeSearchItem({
      id: 'search-51',
      body: 'beta page2 result',
      createdAt: '2026-03-27T23:59:00.000Z',
      room: makeRoom({
        id: 'room-2',
        type: 'dm',
        name: 'dm:demo-user:partner-user',
        allowExternalIntegrations: false,
      }),
    });

    installApiMock({
      rooms: [
        makeRoom({
          id: 'room-1',
          projectCode: 'PRJ-1',
          projectName: 'Alpha',
        }),
        makeRoom({
          id: 'room-2',
          type: 'dm',
          name: 'dm:demo-user:partner-user',
          allowExternalIntegrations: false,
        }),
      ],
      messagesByRoom: {
        'room-1': [
          makeMessage({
            id: 'message-1',
            roomId: 'room-1',
            body: 'room-1 first message',
            userId: 'alice',
          }),
        ],
        'room-2': [
          makeMessage({
            id: 'message-2',
            roomId: 'room-2',
            body: 'room-2 first message',
            userId: 'bob',
          }),
        ],
      },
      globalSearchResultsByQuery: {
        'beta|': firstPage,
        [`beta|${firstPage[firstPage.length - 1]?.createdAt ?? ''}`]: [
          secondPageItem,
        ],
      },
      failOnGlobalSearch: ['error|'],
      threadsByMessageId: {
        'search-51': {
          root: makeMessage({
            id: 'search-51',
            roomId: 'room-2',
            body: 'beta page2 result',
            userId: 'alice',
          }),
          replies: [
            makeMessage({
              id: 'reply-51',
              roomId: 'room-2',
              parentMessageId: 'search-51',
              threadRootId: 'search-51',
              body: 'search result thread reply',
              userId: 'bob',
              createdAt: '2026-03-28T00:01:00.000Z',
            }),
          ],
          replyCount: 1,
          lastReplyAt: '2026-03-28T00:01:00.000Z',
          nextCursor: null,
        },
      },
    });

    render(<RoomChat />);

    expect(await screen.findByText('room-1 first message')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
      target: { value: 'beta' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText('beta result 1')).toBeInTheDocument();
    expect(await screen.findByText('beta result 50')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'さらに読み込む' }),
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));

    const secondPageCard = await screen.findByText('beta page2 result');
    let secondPageContainer: HTMLElement | null = secondPageCard.parentElement;
    while (
      secondPageContainer &&
      !within(secondPageContainer).queryByRole('button', {
        name: 'スレッドを開く',
      })
    ) {
      secondPageContainer = secondPageContainer.parentElement;
    }
    if (!secondPageContainer) {
      throw new Error('search result container not found');
    }
    fireEvent.click(
      within(secondPageContainer).getByRole('button', {
        name: 'スレッドを開く',
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'ルーム' })).toHaveValue(
        'room-2',
      );
    });
    expect(await screen.findByText('room-2 first message')).toBeInTheDocument();
    expect(
      await screen.findByRole('dialog', { name: 'スレッド' }),
    ).toBeInTheDocument();
    expect(screen.getByText('search result thread reply')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'スレッドを閉じる' }));

    fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
      target: { value: 'error' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText('検索に失敗しました')).toBeInTheDocument();
    expect(screen.queryByText('beta result 1')).not.toBeInTheDocument();
    expect(screen.queryByText('beta page2 result')).not.toBeInTheDocument();
  });
}
