import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChatRoom = {
  id: string;
  type: string;
  name: string;
  allowExternalIntegrations?: boolean | null;
  isMember?: boolean | null;
  isOfficial?: boolean | null;
  projectCode?: string | null;
  projectName?: string | null;
};

type ChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  body: string;
  createdAt: string;
};

type ChatSearchItem = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  room: ChatRoom;
};

const { api, apiResponse, getAuthState } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  getAuthState: vi.fn(),
}));

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined;

vi.mock('../api', () => ({
  api,
  apiResponse,
  getAuthState,
}));

const { copyToClipboard } = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('../utils/clipboard', () => ({
  copyToClipboard,
}));

vi.mock('../ui', () => ({
  AttachmentField: () => null,
  Combobox: ({
    placeholder,
    value,
    onChange,
    inputProps,
  }: {
    placeholder?: string;
    value?: string;
    onChange?: (value: string) => void;
    inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  }) => (
    <input
      {...inputProps}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  MentionComposer: ({
    body,
    onBodyChange,
    placeholder,
    submitLabel,
    cancelLabel,
    onSubmit,
    onCancel,
    disabled,
  }: {
    body: string;
    onBodyChange?: (value: string) => void;
    placeholder?: string;
    submitLabel: string;
    cancelLabel: string;
    onSubmit?: () => void;
    onCancel?: () => void;
    disabled?: boolean;
  }) => (
    <div>
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        value={body}
        onChange={(event) => onBodyChange?.(event.target.value)}
        disabled={disabled}
      />
      <button type="button" onClick={onSubmit} disabled={disabled}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} disabled={disabled}>
        {cancelLabel}
      </button>
    </div>
  ),
  UndoToast: () => null,
}));

import { RoomChat } from './RoomChat';

function makeRoom(overrides: Partial<ChatRoom>): ChatRoom {
  return {
    id: 'room-1',
    type: 'project',
    name: 'room-1',
    allowExternalIntegrations: false,
    isMember: true,
    isOfficial: false,
    projectCode: 'PRJ-1',
    projectName: 'Alpha',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    roomId: 'room-1',
    userId: 'alice',
    body: 'initial message',
    createdAt: '2026-03-28T00:00:00.000Z',
    ...overrides,
  };
}

function makeSearchItem(overrides: Partial<ChatSearchItem>): ChatSearchItem {
  return {
    id: 'search-1',
    userId: 'alice',
    body: 'search result',
    createdAt: '2026-03-28T00:00:00.000Z',
    room: makeRoom({ id: 'room-1' }),
    ...overrides,
  };
}

function installApiMock(options: {
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;
  unreadByRoom?: Record<
    string,
    { unreadCount?: number; lastReadAt?: string | null }
  >;
  notificationSettingsByRoom?: Record<
    string,
    {
      notifyAllPosts?: boolean;
      notifyMentions?: boolean;
      muteUntil?: string | null;
    }
  >;
  mentionCandidatesByRoom?: Record<string, unknown>;
  failOnSearch?: string[];
  searchResultsByQuery?: Record<string, ChatMessage[]>;
  failOnGlobalSearch?: string[];
  globalSearchResultsByQuery?: Record<string, ChatSearchItem[]>;
  failOnExternalSummary?: string[];
  notificationSettingPatchBodies?: Array<{
    roomId: string;
    body: {
      notifyAllPosts?: boolean;
      notifyMentions?: boolean;
      muteUntil?: string | null;
    };
  }>;
  notificationSettingsSaveResponseByRoom?: Record<
    string,
    {
      notifyAllPosts?: boolean;
      notifyMentions?: boolean;
      muteUntil?: string | null;
    }
  >;
  failOnNotificationSave?: string[];
}) {
  const failOnSearch = new Set(options.failOnSearch ?? []);
  const failOnGlobalSearch = new Set(options.failOnGlobalSearch ?? []);
  const failOnExternalSummary = new Set(options.failOnExternalSummary ?? []);
  const failOnNotificationSave = new Set(options.failOnNotificationSave ?? []);

  vi.mocked(api).mockImplementation(
    async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.pathname === '/chat-rooms' && method === 'GET') {
        return { items: options.rooms } as never;
      }

      if (url.pathname === '/chat-messages/search' && method === 'GET') {
        const query = url.searchParams.get('q') ?? '';
        const before = url.searchParams.get('before') ?? '';
        if (failOnGlobalSearch.has(`${query}|${before}`)) {
          throw new Error(`global search failed for query: ${query}`);
        }
        return {
          items:
            options.globalSearchResultsByQuery?.[`${query}|${before}`] ?? [],
        } as never;
      }

      const roomMatch = url.pathname.match(
        /^\/chat-rooms\/([^/]+)\/(notification-setting|messages|mention-candidates|unread|read|ai-summary)$/,
      );
      if (roomMatch) {
        const [, roomId, resource] = roomMatch;
        if (resource === 'notification-setting' && method === 'GET') {
          return (options.notificationSettingsByRoom?.[roomId] ?? {
            notifyAllPosts: true,
            notifyMentions: true,
            muteUntil: null,
          }) as never;
        }
        if (resource === 'notification-setting' && method === 'PATCH') {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            notifyAllPosts?: boolean;
            notifyMentions?: boolean;
            muteUntil?: string | null;
          };
          options.notificationSettingPatchBodies?.push({ roomId, body });
          if (failOnNotificationSave.has(roomId)) {
            throw new Error(`notification save failed for room: ${roomId}`);
          }
          return (options.notificationSettingsSaveResponseByRoom?.[roomId] ??
            body) as never;
        }
        if (resource === 'mention-candidates' && method === 'GET') {
          return (options.mentionCandidatesByRoom?.[roomId] ?? {}) as never;
        }
        if (resource === 'unread' && method === 'GET') {
          return (options.unreadByRoom?.[roomId] ?? {
            unreadCount: 0,
            lastReadAt: null,
          }) as never;
        }
        if (resource === 'read' && method === 'POST') {
          return {} as never;
        }
        if (resource === 'messages' && method === 'GET') {
          const query = url.searchParams.get('q') ?? '';
          if (failOnSearch.has(query)) {
            throw new Error(`messages failed for query: ${query}`);
          }
          const searchKey = `${roomId}|${query}`;
          const items =
            options.searchResultsByQuery?.[searchKey] ??
            options.messagesByRoom[roomId] ??
            [];
          return { items } as never;
        }
        if (resource === 'ai-summary' && method === 'POST') {
          if (failOnExternalSummary.has(roomId)) {
            throw new Error(`external summary failed for room: ${roomId}`);
          }
          return {
            summary: 'external summary',
            provider: 'stub',
            model: 'stub-model',
          } as never;
        }
      }

      throw new Error(`Unhandled api path: ${path}`);
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthState).mockReturnValue({
    userId: 'demo-user',
    roles: ['member'],
    groupIds: ['general_affairs'],
  });
  vi.mocked(apiResponse).mockReset();
  consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  consoleWarnSpy = vi
    .spyOn(console, 'warn')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  consoleErrorSpy?.mockRestore();
  consoleWarnSpy?.mockRestore();
});

describe('RoomChat', () => {
  it('loads the first room on mount and switches to another room', async () => {
    installApiMock({
      rooms: [
        makeRoom({
          id: 'room-1',
          projectCode: 'PRJ-1',
          projectName: 'Alpha',
          allowExternalIntegrations: true,
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
      unreadByRoom: {
        'room-1': { unreadCount: 2, lastReadAt: '2026-03-27T00:00:00.000Z' },
        'room-2': { unreadCount: 0, lastReadAt: '2026-03-28T00:00:00.000Z' },
      },
    });

    render(<RoomChat />);

    expect(await screen.findByText('room-1 first message')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: '表示範囲' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Unread 2')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '外部要約' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ルーム' })).toHaveValue(
      'room-1',
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'ルーム' }), {
      target: { value: 'room-2' },
    });

    expect(await screen.findByText('room-2 first message')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '外部要約' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText('room-1 first message')).not.toBeInTheDocument();
  });

  it('shows validation errors before posting or creating an ack request', async () => {
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: {
        'room-1': [],
      },
    });

    render(<RoomChat />);

    const roomSelect = screen.getByRole('combobox', { name: 'ルーム' });
    fireEvent.change(roomSelect, { target: { value: 'room-1' } });
    await waitFor(() => {
      expect(roomSelect).toHaveValue('room-1');
    });
    expect(screen.getByText('メッセージなし')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(
      await screen.findByText('本文を入力してください'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
      target: { value: '確認依頼本文' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認依頼' }));
    expect(
      await screen.findByText(
        '確認対象（ユーザID/グループ/ロール）を入力してください',
      ),
    ).toBeInTheDocument();
  });

  it('hides the general-affairs scope switch when the user is not authorized', async () => {
    vi.mocked(getAuthState).mockReturnValue({
      userId: 'demo-user',
      roles: ['member'],
      groupIds: ['sales'],
    });
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: {
        'room-1': [makeMessage({ id: 'message-1', roomId: 'room-1' })],
      },
    });

    render(<RoomChat />);

    expect(await screen.findByText('initial message')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: '表示範囲' }),
    ).not.toBeInTheDocument();
  });

  it('filters the room list to general-affairs private groups', async () => {
    installApiMock({
      rooms: [
        makeRoom({
          id: 'room-1',
          type: 'project',
          projectCode: 'PRJ-1',
          projectName: 'Alpha',
        }),
        makeRoom({
          id: 'pga_1',
          type: 'private_group',
          isOfficial: true,
          name: 'pga_1',
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
            body: 'project room message',
          }),
        ],
        pga_1: [
          makeMessage({
            id: 'message-2',
            roomId: 'pga_1',
            body: 'general affairs room message',
          }),
        ],
      },
    });

    render(<RoomChat />);

    const roomSelect = screen.getByRole('combobox', { name: 'ルーム' });
    fireEvent.change(roomSelect, { target: { value: 'room-1' } });
    expect(await screen.findByText('project room message')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '表示範囲' })).toHaveValue(
      'all',
    );

    fireEvent.change(screen.getByRole('combobox', { name: '表示範囲' }), {
      target: { value: 'ga_personal' },
    });

    const filteredRoomSelect = screen.getByRole('combobox', { name: 'ルーム' });
    expect(
      screen.queryByText('project: PRJ-1 / Alpha'),
    ).not.toBeInTheDocument();
    fireEvent.change(filteredRoomSelect, { target: { value: 'pga_1' } });

    expect(
      await screen.findByText('general affairs room message'),
    ).toBeInTheDocument();
    expect(screen.queryByText('project room message')).not.toBeInTheDocument();
    expect(filteredRoomSelect).toHaveValue('pga_1');
    expect(
      screen.queryByText('project: PRJ-1 / Alpha'),
    ).not.toBeInTheDocument();
  });

  it('copies room links and reports external summary failure', async () => {
    installApiMock({
      rooms: [
        makeRoom({
          id: 'room-1',
          projectCode: 'PRJ-1',
          projectName: 'Alpha',
          allowExternalIntegrations: true,
        }),
      ],
      messagesByRoom: {
        'room-1': [
          makeMessage({
            id: 'message-1',
            roomId: 'room-1',
            body: 'copy target',
            userId: 'alice',
          }),
        ],
      },
      failOnExternalSummary: ['room-1'],
    });
    vi.mocked(copyToClipboard)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RoomChat />);

    const roomSelect = screen.getByRole('combobox', { name: 'ルーム' });
    fireEvent.change(roomSelect, { target: { value: 'room-1' } });
    expect(await screen.findByText('copy target')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '発言リンクURLをコピー' }),
    );
    expect(
      await screen.findByText('リンクURLをコピーしました'),
    ).toBeInTheDocument();
    expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith(
      '/#/open?kind=chat_message&id=message-1',
    );

    fireEvent.click(
      screen.getByRole('button', { name: '発言リンクMarkdownをコピー' }),
    );
    expect(await screen.findByText('コピーに失敗しました')).toBeInTheDocument();
    expect(vi.mocked(copyToClipboard)).toHaveBeenLastCalledWith(
      expect.stringContaining('#/open?kind=chat_message&id=message-1'),
    );

    fireEvent.click(screen.getByRole('button', { name: '外部要約' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(
      await screen.findByText('外部要約の生成に失敗しました'),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

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
    });

    render(<RoomChat />);

    expect(await screen.findByText('room-1 first message')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
      target: { value: 'beta' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText('beta result 1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'さらに読み込む' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));

    const secondPageCard = await screen.findByText('beta page2 result');
    let secondPageContainer: HTMLElement | null = secondPageCard.parentElement;
    while (
      secondPageContainer &&
      !within(secondPageContainer).queryByRole('button', { name: '開く' })
    ) {
      secondPageContainer = secondPageContainer.parentElement;
    }
    if (!secondPageContainer) {
      throw new Error('search result container not found');
    }
    fireEvent.click(
      within(secondPageContainer).getByRole('button', { name: '開く' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'ルーム' })).toHaveValue(
        'room-2',
      );
    });
    expect(await screen.findByText('room-2 first message')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
      target: { value: 'error' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText('検索に失敗しました')).toBeInTheDocument();
    expect(screen.queryByText('beta result 1')).not.toBeInTheDocument();
    expect(screen.queryByText('beta page2 result')).not.toBeInTheDocument();
  });
});
