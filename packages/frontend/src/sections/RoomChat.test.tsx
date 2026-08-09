import {
  act,
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
  messageType?: 'text';
  parentMessageId?: string | null;
  threadRootId?: string | null;
  userId: string;
  body: string;
  createdAt: string;
};

type ChatSearchItem = {
  id: string;
  roomId: string;
  messageType?: 'text';
  parentMessageId?: string | null;
  threadRootId?: string | null;
  userId: string;
  body: string;
  createdAt: string;
  room: ChatRoom;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
    onAddFiles,
    disabled,
  }: {
    body: string;
    onBodyChange?: (value: string) => void;
    placeholder?: string;
    submitLabel: string;
    cancelLabel: string;
    onSubmit?: () => void;
    onCancel?: () => void;
    onAddFiles?: (files: File[]) => void;
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
      <input
        aria-label="添付ファイル"
        type="file"
        disabled={disabled}
        onChange={(event) =>
          onAddFiles?.(event.target.files ? Array.from(event.target.files) : [])
        }
      />
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
  const room = overrides.room ?? makeRoom({ id: 'room-1' });
  return {
    id: 'search-1',
    roomId: room.id,
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'alice',
    body: 'search result',
    createdAt: '2026-03-28T00:00:00.000Z',
    room,
    ...overrides,
  };
}

function installApiMock(options: {
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;
  messageReadResultsByRoom?: Record<string, Array<ChatMessage[] | Error>>;
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
  postedMessages?: Array<{
    roomId: string;
    body: unknown;
  }>;
  postMessageResponse?: ChatMessage & {
    warning?: { code?: string; message?: string };
  };
  postMessageResults?: Array<
    (ChatMessage & { warning?: { code?: string; message?: string } }) | Error
  >;
  postAckResponse?: ChatMessage & {
    warning?: { code?: string; message?: string };
  };
  postAckResults?: Array<
    (ChatMessage & { warning?: { code?: string; message?: string } }) | Error
  >;
  failMessageRefreshAfterPost?: boolean;
  failAttachmentUpload?: boolean;
  postMessagePromise?: Promise<
    ChatMessage & { warning?: { code?: string; message?: string } }
  >;
  threadsByMessageId?: Record<
    string,
    {
      root: ChatMessage;
      replies: ChatMessage[];
      replyCount: number;
      lastReplyAt: string | null;
      nextCursor: string | null;
    }
  >;
  threadResultsByMessageId?: Record<
    string,
    Array<
      | {
          root: ChatMessage;
          replies: ChatMessage[];
          replyCount: number;
          lastReplyAt: string | null;
          nextCursor: string | null;
        }
      | Error
    >
  >;
  threadReplyResponse?: ChatMessage & {
    warning?: { code?: string; message?: string };
  };
}) {
  const failOnSearch = new Set(options.failOnSearch ?? []);
  const failOnGlobalSearch = new Set(options.failOnGlobalSearch ?? []);
  const failOnExternalSummary = new Set(options.failOnExternalSummary ?? []);
  const failOnNotificationSave = new Set(options.failOnNotificationSave ?? []);
  let rootPostCompleted = false;

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
        const items =
          options.globalSearchResultsByQuery?.[`${query}|${before}`] ?? [];
        const last = items.length === 50 ? items[items.length - 1] : undefined;
        return {
          items,
          nextBefore: last?.createdAt ?? null,
          nextBeforeId: last?.id ?? null,
        } as never;
      }

      const threadMatch = url.pathname.match(
        /^\/chat-messages\/([^/]+)\/thread$/,
      );
      if (threadMatch && method === 'GET') {
        const queued =
          options.threadResultsByMessageId?.[threadMatch[1]]?.shift();
        if (queued instanceof Error) throw queued;
        const thread = queued ?? options.threadsByMessageId?.[threadMatch[1]];
        if (!thread) throw new Error('thread not found');
        return thread as never;
      }

      const threadReplyMatch = url.pathname.match(
        /^\/chat-messages\/([^/]+)\/replies$/,
      );
      if (threadReplyMatch && method === 'POST') {
        if (!options.threadReplyResponse) {
          throw new Error('thread reply response not found');
        }
        return options.threadReplyResponse as never;
      }

      if (
        /^\/chat-messages\/[^/]+\/attachments$/.test(url.pathname) &&
        method === 'POST'
      ) {
        if (options.failAttachmentUpload) {
          throw new Error('attachment transport failure');
        }
        return {} as never;
      }

      const roomMatch = url.pathname.match(
        /^\/chat-rooms\/([^/]+)\/(notification-setting|messages|ack-requests|mention-candidates|unread|read|ai-summary)$/,
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
          const queued = options.messageReadResultsByRoom?.[roomId]?.shift();
          if (queued instanceof Error) throw queued;
          if (queued) return { items: queued } as never;
          if (rootPostCompleted && options.failMessageRefreshAfterPost) {
            throw new Error('message refresh failed after post');
          }
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
        if (resource === 'messages' && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as unknown;
          options.postedMessages?.push({ roomId, body });
          if (options.postMessagePromise) {
            const result = await options.postMessagePromise;
            rootPostCompleted = true;
            return result as never;
          }
          const queued = options.postMessageResults?.shift();
          if (queued instanceof Error) throw queued;
          rootPostCompleted = true;
          return (queued ??
            options.postMessageResponse ??
            makeMessage({
              id: 'posted-message',
              roomId,
              body:
                body && typeof body === 'object' && 'body' in body
                  ? String((body as { body?: unknown }).body)
                  : 'posted',
            })) as never;
        }
        if (resource === 'ack-requests' && method === 'POST') {
          const queued = options.postAckResults?.shift();
          if (queued instanceof Error) throw queued;
          rootPostCompleted = true;
          return (queued ??
            options.postAckResponse ??
            makeMessage({
              id: 'posted-ack-request',
              roomId,
              body: 'posted ack request',
            })) as never;
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
  it('renders workflow guidance, chat summary, and room operation panel', async () => {
    installApiMock({
      rooms: [
        makeRoom({
          id: 'room-1',
          projectCode: 'PRJ-1',
          projectName: 'Alpha',
        }),
      ],
      messagesByRoom: {
        'room-1': [
          makeMessage({
            id: 'message-1',
            roomId: 'room-1',
            body: 'workflow message',
            userId: 'alice',
          }),
        ],
      },
      unreadByRoom: {
        'room-1': { unreadCount: 1, lastReadAt: '2026-03-27T00:00:00.000Z' },
      },
    });

    render(<RoomChat />);

    expect(
      screen.getByRole('heading', {
        name: 'チャット（全社/部門/private_group/DM）',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('チャット運用サマリー')).toBeInTheDocument();
    expect(screen.getByText('選択中ルーム')).toBeInTheDocument();
    expect(screen.getByText('未読')).toBeInTheDocument();
    expect(screen.getByText('確認対象')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'ルーム選択と要約' }),
    ).toBeInTheDocument();

    expect(await screen.findByText('workflow message')).toBeInTheDocument();
    expect(screen.getByText('Unread 1')).toBeInTheDocument();
  });

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

  it('keeps legacy root deep-link events on the timeline loading flow', async () => {
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: {
        'room-1': [],
      },
    });

    render(<RoomChat />);
    expect(await screen.findByText('メッセージなし')).toBeInTheDocument();
    vi.mocked(api).mockClear();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('erp4_open_chat_message', {
          detail: {
            messageId: 'root-deep-link',
            roomId: 'room-1',
            createdAt: '2026-03-28T02:00:00.000Z',
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        vi.mocked(api).mock.calls.some(([path]) => {
          const value = String(path);
          return (
            value.startsWith('/chat-rooms/room-1/messages?') &&
            new URL(value, 'http://localhost').searchParams.get('before') ===
              '2026-03-28T02:00:00.001Z'
          );
        }),
      ).toBe(true);
    });
    expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
  });

  it('opens reply deep links directly as their validated thread target', async () => {
    installApiMock({
      rooms: [
        makeRoom({ id: 'room-1' }),
        makeRoom({ id: 'room-2', name: 'room-2' }),
      ],
      messagesByRoom: {
        'room-1': [
          makeMessage({
            id: 'message-1',
            roomId: 'room-1',
            body: 'initial room message',
          }),
        ],
        'room-2': [
          makeMessage({
            id: 'reply-root',
            roomId: 'room-2',
            body: 'reply root timeline message',
          }),
        ],
      },
      threadsByMessageId: {
        'reply-deep-link': {
          root: makeMessage({
            id: 'reply-root',
            roomId: 'room-2',
            body: 'reply thread root',
            parentMessageId: null,
            threadRootId: null,
          }),
          replies: [
            makeMessage({
              id: 'reply-deep-link',
              roomId: 'room-2',
              body: 'direct reply deep-link target',
              parentMessageId: 'reply-root',
              threadRootId: 'reply-root',
              createdAt: '2026-03-28T02:01:00.000Z',
            }),
          ],
          replyCount: 1,
          lastReplyAt: '2026-03-28T02:01:00.000Z',
          nextCursor: null,
        },
      },
    });

    render(<RoomChat />);
    expect(await screen.findByText('initial room message')).toBeInTheDocument();
    vi.mocked(api).mockClear();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('erp4_open_chat_message', {
          detail: {
            messageId: 'reply-deep-link',
            roomId: 'room-2',
            createdAt: '2026-03-28T02:01:00.000Z',
            parentMessageId: 'reply-root',
            threadRootId: 'reply-root',
          },
        }),
      );
    });

    expect(
      await screen.findByRole('dialog', { name: 'スレッド' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('direct reply deep-link target'),
    ).toBeInTheDocument();
    expect(screen.queryByText('initial room message')).toBeNull();
    const displayedMessagesMetric = screen
      .getByText('表示メッセージ')
      .closest('dl');
    if (!displayedMessagesMetric) {
      throw new Error('displayed messages metric not found');
    }
    expect(
      within(displayedMessagesMetric).getByText('0件'),
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path]) =>
            String(path) === '/chat-messages/reply-deep-link/thread?limit=50',
        ),
    ).toBe(true);
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path]) =>
            String(path).startsWith('/chat-rooms/room-2/messages?') &&
            new URL(String(path), 'http://localhost').searchParams.has(
              'before',
            ),
        ),
    ).toBe(false);
  });

  it('closes an existing cross-room thread before opening a root deep link', async () => {
    const roomOneRoot = makeMessage({
      id: 'room-1-root',
      roomId: 'room-1',
      body: 'old room thread root',
    });
    const roomTwoRoot = makeMessage({
      id: 'room-2-root',
      roomId: 'room-2',
      body: 'root deep-link destination',
      createdAt: '2026-03-28T03:00:00.000Z',
    });
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })],
      messagesByRoom: {
        'room-1': [roomOneRoot],
        'room-2': [roomTwoRoot],
      },
      threadsByMessageId: {
        'room-1-root': {
          root: roomOneRoot,
          replies: [],
          replyCount: 0,
          lastReplyAt: null,
          nextCursor: null,
        },
      },
    });

    render(<RoomChat />);
    expect(await screen.findByText('old room thread root')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^スレッドを開く/ }));
    expect(
      await screen.findByRole('dialog', { name: 'スレッド' }),
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('erp4_open_chat_message', {
          detail: {
            messageId: 'room-2-root',
            roomId: 'room-2',
            createdAt: '2026-03-28T03:00:00.000Z',
            parentMessageId: null,
            threadRootId: null,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
    });
    expect(
      await screen.findByText('root deep-link destination'),
    ).toBeInTheDocument();
    expect(screen.queryByText('old room thread root')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'ルーム' })).toHaveValue(
      'room-2',
    );
  });

  it.each(['select', 'room-event'] as const)(
    'closes an old thread before changing rooms through $mode',
    async (mode) => {
      const roomOneRoot = makeMessage({
        id: 'room-switch-root',
        roomId: 'room-1',
        body: 'room switch old thread body',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })],
        messagesByRoom: {
          'room-1': [roomOneRoot],
          'room-2': [
            makeMessage({
              id: 'room-2-message',
              roomId: 'room-2',
              body: 'room switch destination body',
            }),
          ],
        },
        threadsByMessageId: {
          'room-switch-root': {
            root: roomOneRoot,
            replies: [],
            replyCount: 0,
            lastReplyAt: null,
            nextCursor: null,
          },
        },
      });

      render(<RoomChat />);
      expect(
        await screen.findByText('room switch old thread body'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^スレッドを開く/ }));
      expect(
        await screen.findByRole('dialog', { name: 'スレッド' }),
      ).toBeInTheDocument();
      vi.mocked(api).mockClear();

      if (mode === 'select') {
        fireEvent.change(screen.getByRole('combobox', { name: 'ルーム' }), {
          target: { value: 'room-2' },
        });
      } else {
        act(() => {
          window.dispatchEvent(
            new CustomEvent('erp4_open_room_chat', {
              detail: { roomId: 'room-2' },
            }),
          );
        });
      }

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
      });
      expect(
        await screen.findByText('room switch destination body'),
      ).toBeInTheDocument();
      expect(screen.queryByText('room switch old thread body')).toBeNull();
      expect(
        vi
          .mocked(api)
          .mock.calls.some(
            ([path, init]) =>
              String(path) === '/chat-messages/room-switch-root/replies' &&
              init?.method === 'POST',
          ),
      ).toBe(false);
    },
  );

  it('purges the current timeline and keeps the thread panel open after access is revoked', async () => {
    const sanitizedWarning =
      '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。';
    const root = makeMessage({
      id: 'access-root',
      roomId: 'room-1',
      body: 'access revocation timeline item',
      parentMessageId: null,
      threadRootId: null,
    });
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [root] },
      threadsByMessageId: {
        'access-root': {
          root,
          replies: [],
          replyCount: 0,
          lastReplyAt: null,
          nextCursor: null,
        },
      },
      threadReplyResponse: {
        ...makeMessage({
          id: 'access-reply',
          roomId: 'room-1',
          body: 'committed reply',
          parentMessageId: 'access-root',
          threadRootId: 'access-root',
        }),
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message: 'raw backend detail must not be shown',
        },
      },
    });

    render(<RoomChat />);
    expect(
      await screen.findByText('access revocation timeline item'),
    ).toBeInTheDocument();
    const displayedMessagesMetric = screen
      .getByText('表示メッセージ')
      .closest('dl');
    if (!displayedMessagesMetric) {
      throw new Error('displayed messages metric not found');
    }
    expect(
      within(displayedMessagesMetric).getByText('1件'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^スレッドを開く/ }));
    expect(
      await screen.findByRole('dialog', { name: 'スレッド' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('返信を入力'), {
      target: { value: 'reply that revokes access' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信' }));

    await waitFor(() => {
      expect(
        within(displayedMessagesMetric).getByText('0件'),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByText(sanitizedWarning).length).toBeGreaterThan(0);
    expect(
      screen.queryByText('raw backend detail must not be shown'),
    ).toBeNull();
    expect(
      screen.getByRole('dialog', { name: 'スレッド' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['room-readable', true],
    ['room-unavailable', false],
  ] as const)(
    'revalidates and minimizes room/search state after a thread 404: %s',
    async (_mode, roomReadable) => {
      const staleRoot = makeMessage({
        id: 'stale-thread-root',
        roomId: 'room-1',
        body: 'stale room timeline body',
      });
      const latestRoot = makeMessage({
        id: 'latest-readable-root',
        roomId: 'room-1',
        body: 'latest readable room body',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [] },
        messageReadResultsByRoom: {
          'room-1': [
            [staleRoot],
            roomReadable
              ? [latestRoot]
              : new Error(
                  'Request failed: /chat-rooms/room-1/messages (404) hidden',
                ),
          ],
        },
        globalSearchResultsByQuery: {
          'stale|': [
            makeSearchItem({
              id: 'stale-search-result',
              roomId: 'room-1',
              body: 'stale global search excerpt',
            }),
          ],
        },
        threadResultsByMessageId: {
          'stale-thread-root': [
            new Error(
              'Request failed: /chat-messages/stale-thread-root/thread (404) hidden',
            ),
          ],
        },
      });

      render(<RoomChat />);
      expect(
        await screen.findByText('stale room timeline body'),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
        target: { value: 'stale' },
      });
      fireEvent.click(screen.getByRole('button', { name: '検索' }));
      expect(
        await screen.findByText('stale global search excerpt'),
      ).toBeInTheDocument();

      const timelineCard = document.getElementById(
        'chat-message-stale-thread-root',
      );
      if (!timelineCard) throw new Error('timeline card not found');
      fireEvent.click(
        within(timelineCard).getByRole('button', {
          name: /^スレッドを開く/,
        }),
      );

      expect(
        await screen.findByText('スレッドを表示できません'),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByText('stale room timeline body')).toBeNull();
        expect(screen.queryByText('stale global search excerpt')).toBeNull();
      });
      if (roomReadable) {
        expect(
          await screen.findByText('latest readable room body'),
        ).toBeInTheDocument();
        expect(
          screen.queryByText(/ルームを表示できません。権限を確認/),
        ).toBeNull();
      } else {
        expect(
          await screen.findByText(
            'ルームを表示できません。権限を確認して再読み込みしてください。',
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/hidden/)).toBeNull();
      }
    },
  );

  it.each([
    ['message', '送信'],
    ['ack', '確認依頼'],
  ] as const)(
    'purges the room and stops follow-up reads after a root %s returns POST_WITHOUT_VIEW',
    async (mode, buttonName) => {
      const sanitizedWarning =
        '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。';
      const response = {
        ...makeMessage({
          id: `revoked-root-${mode}`,
          roomId: 'room-1',
          body: 'committed but inaccessible root',
        }),
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message: 'raw backend detail must not be shown',
        },
      };
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: {
          'room-1': [
            makeMessage({
              id: 'visible-before-revocation',
              roomId: 'room-1',
              body: 'visible before root post',
            }),
          ],
        },
        unreadByRoom: {
          'room-1': {
            unreadCount: 2,
            lastReadAt: '2026-03-27T00:00:00.000Z',
          },
        },
        ...(mode === 'message'
          ? { postMessageResponse: response }
          : { postAckResponse: response }),
      });

      render(<RoomChat />);
      expect(
        await screen.findByText('visible before root post'),
      ).toBeInTheDocument();
      const displayedMessagesMetric = screen
        .getByText('表示メッセージ')
        .closest('dl');
      if (!displayedMessagesMetric) {
        throw new Error('displayed messages metric not found');
      }
      vi.mocked(api).mockClear();

      fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
        target: { value: 'root post that revokes access' },
      });
      if (mode === 'ack') {
        fireEvent.change(screen.getByLabelText('確認対象(requiredUserIds)'), {
          target: { value: 'synthetic-user' },
        });
      }
      fireEvent.click(screen.getByRole('button', { name: buttonName }));

      await waitFor(() => {
        expect(
          within(displayedMessagesMetric).getByText('0件'),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText('visible before root post')).toBeNull();
      expect(screen.getAllByText(sanitizedWarning).length).toBeGreaterThan(0);
      expect(
        screen.queryByText('raw backend detail must not be shown'),
      ).toBeNull();
      const callsAfterPost = vi.mocked(api).mock.calls.map(([path, init]) => ({
        path: String(path),
        method: (init?.method ?? 'GET').toUpperCase(),
      }));
      expect(callsAfterPost).toEqual([
        {
          path:
            mode === 'message'
              ? '/chat-rooms/room-1/messages'
              : '/chat-rooms/room-1/ack-requests',
          method: 'POST',
        },
      ]);
    },
  );

  it.each([
    ['message', '送信', '/chat-rooms/room-1/messages'],
    ['ack', '確認依頼', '/chat-rooms/room-1/ack-requests'],
  ] as const)(
    'locks root %s resubmission when the non-idempotent POST result is uncertain',
    async (mode, buttonName, postPath) => {
      const uncertain = new Error(
        `Request failed: ${postPath} (503) providerKey=must-not-leak`,
      );
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })],
        messagesByRoom: { 'room-1': [], 'room-2': [] },
        ...(mode === 'message'
          ? { postMessageResults: [uncertain] }
          : { postAckResults: [uncertain] }),
      });

      render(<RoomChat />);
      expect(await screen.findByText('メッセージなし')).toBeInTheDocument();
      fireEvent.change(await screen.findByPlaceholderText('Markdownで入力'), {
        target: { value: 'uncertain root draft' },
      });
      if (mode === 'ack') {
        fireEvent.change(screen.getByLabelText('確認対象(requiredUserIds)'), {
          target: { value: 'synthetic-user' },
        });
      }
      const submit = screen.getByRole('button', { name: buttonName });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      const warning = await screen.findByText(
        '投稿結果を確認できません。重複防止のため再送せず、ページを再読み込みしてください',
      );
      expect(warning).toHaveAttribute('role', 'status');
      expect(warning).toHaveAttribute('aria-live', 'polite');
      expect(submit).toBeDisabled();
      const roomSelect = screen.getByRole('combobox', { name: 'ルーム' });
      expect(roomSelect).toBeDisabled();
      expect(screen.getByPlaceholderText('Markdownで入力')).toHaveValue(
        'uncertain root draft',
      );
      expect(screen.queryByText(/providerKey|must-not-leak/)).toBeNull();
      act(() => {
        window.dispatchEvent(
          new CustomEvent('erp4_open_room_chat', {
            detail: { roomId: 'room-2' },
          }),
        );
      });
      expect(roomSelect).toHaveValue('room-1');
      expect(roomSelect).toBeDisabled();
      fireEvent.click(submit);
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(
            ([path, init]) =>
              String(path) === postPath && init?.method === 'POST',
          ),
      ).toHaveLength(1);
    },
  );

  it.each([
    ['message', '送信', '/chat-rooms/room-1/messages'],
    ['ack', '確認依頼', '/chat-rooms/room-1/ack-requests'],
  ] as const)(
    'keeps the root %s draft retryable after a definite 4xx rejection',
    async (mode, buttonName, postPath) => {
      const rejected = new Error(
        `Request failed: ${postPath} (400) INVALID_INPUT`,
      );
      const accepted = makeMessage({
        id: `accepted-root-${mode}`,
        roomId: 'room-1',
        body: 'retryable root draft',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [accepted] },
        ...(mode === 'message'
          ? { postMessageResults: [rejected, accepted] }
          : { postAckResults: [rejected, accepted] }),
      });

      render(<RoomChat />);
      await screen.findByText('retryable root draft');
      fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
        target: { value: 'retryable root draft' },
      });
      if (mode === 'ack') {
        fireEvent.change(screen.getByLabelText('確認対象(requiredUserIds)'), {
          target: { value: 'synthetic-user' },
        });
      }
      const submit = screen.getByRole('button', { name: buttonName });
      fireEvent.click(submit);

      expect(
        await screen.findByText(
          mode === 'ack'
            ? '確認依頼の投稿に失敗しました'
            : '投稿に失敗しました',
        ),
      ).toBeInTheDocument();
      await waitFor(() => expect(submit).toBeEnabled());
      expect(screen.getByPlaceholderText('Markdownで入力')).toHaveValue(
        'retryable root draft',
      );

      fireEvent.click(submit);
      await waitFor(() =>
        expect(screen.getByPlaceholderText('Markdownで入力')).toHaveValue(''),
      );
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(
            ([path, init]) =>
              String(path) === postPath && init?.method === 'POST',
          ),
      ).toHaveLength(2);
    },
  );

  it.each([
    ['post-only-denial', true],
    ['room-access-loss', false],
  ] as const)(
    'revalidates room read access after a root POST 403: %s',
    async (_mode, roomReadable) => {
      const visible = makeMessage({
        id: 'root-before-post-denial',
        roomId: 'room-1',
        body: 'readable before post denial',
      });
      const refreshed = makeMessage({
        id: 'root-after-post-denial',
        roomId: 'room-1',
        body: 'readable after post denial',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [] },
        messageReadResultsByRoom: {
          'room-1': [
            [visible],
            roomReadable
              ? [refreshed]
              : new Error(
                  'Request failed: /chat-rooms/room-1/messages (404) private-detail',
                ),
          ],
        },
        postMessageResults: [
          new Error(
            'Request failed: /chat-rooms/room-1/messages (403) private-detail',
          ),
        ],
      });

      render(<RoomChat />);
      expect(
        await screen.findByText('readable before post denial'),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
        target: { value: 'denied root draft' },
      });
      fireEvent.click(screen.getByRole('button', { name: '送信' }));

      await waitFor(() => {
        expect(screen.queryByText('readable before post denial')).toBeNull();
      });
      if (roomReadable) {
        expect(
          await screen.findByText('readable after post denial'),
        ).toBeInTheDocument();
        expect(await screen.findByText('投稿に失敗しました')).toHaveAttribute(
          'role',
          'status',
        );
      } else {
        expect(
          await screen.findByText(
            'ルームを表示できません。権限を確認して再読み込みしてください。',
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText('readable after post denial')).toBeNull();
      }
      expect(screen.queryByText(/private-detail/)).toBeNull();
      expect(screen.getByPlaceholderText('Markdownで入力')).toHaveValue(
        'denied root draft',
      );
    },
  );

  it('reports a committed root post separately when the follow-up refresh fails', async () => {
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [] },
      postMessageResponse: makeMessage({
        id: 'committed-before-refresh-failure',
        roomId: 'room-1',
        body: 'committed root body',
      }),
      failMessageRefreshAfterPost: true,
    });

    render(<RoomChat />);
    expect(await screen.findByText('メッセージなし')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
      target: { value: 'committed root body' },
    });
    const submit = screen.getByRole('button', { name: '送信' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(
      await screen.findByText(
        '投稿は完了しましたが表示を更新できません。再送せず、再読み込みしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Markdownで入力')).toHaveValue('');
    expect(screen.queryByText('投稿に失敗しました')).toBeNull();
  });

  it('clears the committed root draft and warns without resending when attachment upload is uncertain', async () => {
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [] },
      postMessageResponse: makeMessage({
        id: 'committed-before-attachment-failure',
        roomId: 'room-1',
        body: 'root with uncertain attachment',
      }),
      failAttachmentUpload: true,
    });

    render(<RoomChat />);
    expect(await screen.findByText('メッセージなし')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
      target: { value: 'root with uncertain attachment' },
    });
    const fileInput = screen.getByLabelText('添付ファイル');
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' }),
        ],
      },
    });
    const submit = screen.getByRole('button', { name: '送信' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(
      await screen.findByText(
        'メッセージは投稿されましたが添付結果を確認できません。メッセージを再送せず、再読み込みしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Markdownで入力')).toHaveValue('');
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(
          ([path, init]) =>
            String(path) === '/chat-rooms/room-1/messages' &&
            init?.method === 'POST',
        ),
    ).toHaveLength(1);
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '送信' })).not.toBeDisabled();
    });
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

  it('prevents duplicate message submission while the first post is in flight', async () => {
    const post = deferred<
      ChatMessage & { warning?: { code?: string; message?: string } }
    >();
    const postedMessages: Array<{ roomId: string; body: unknown }> = [];

    installApiMock({
      rooms: [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })],
      messagesByRoom: {
        'room-1': [],
        'room-2': [],
      },
      postedMessages,
      postMessagePromise: post.promise,
    });

    render(<RoomChat />);

    const roomSelect = screen.getByRole('combobox', { name: 'ルーム' });
    fireEvent.change(roomSelect, { target: { value: 'room-1' } });
    await waitFor(() => {
      expect(roomSelect).toHaveValue('room-1');
    });

    fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
      target: { value: 'duplicate guard' },
    });
    const submit = screen.getByRole('button', { name: '送信' });
    await waitFor(() => {
      expect(submit).not.toBeDisabled();
    });

    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(postedMessages).toHaveLength(1));
    expect(roomSelect).toBeDisabled();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('erp4_open_room_chat', {
          detail: { roomId: 'room-2' },
        }),
      );
    });
    expect(roomSelect).toHaveValue('room-1');
    expect(postedMessages[0]).toEqual({
      roomId: 'room-1',
      body: {
        body: 'duplicate guard',
      },
    });

    await act(async () => {
      post.resolve(
        makeMessage({
          id: 'posted-message',
          roomId: 'room-1',
          body: 'duplicate guard',
        }),
      );
      await post.promise;
    });
    await waitFor(() => expect(roomSelect).toBeEnabled());
    expect(roomSelect).toHaveValue('room-1');
  });

  it('does not display an unknown success warning or its backend-owned details', async () => {
    const postedMessages: Array<{ roomId: string; body: unknown }> = [];
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [] },
      postedMessages,
      postMessageResponse: {
        ...makeMessage({
          id: 'posted-warning',
          roomId: 'room-1',
          body: 'warning fixture',
        }),
        warning: {
          code: 'UNKNOWN_INTERNAL_WARNING',
          message: 'providerKey=secret https://internal.invalid',
        },
      },
    });

    render(<RoomChat />);
    const roomSelect = screen.getByRole('combobox', { name: 'ルーム' });
    fireEvent.change(roomSelect, {
      target: { value: 'room-1' },
    });
    await waitFor(() => expect(roomSelect).toHaveValue('room-1'));
    fireEvent.change(await screen.findByPlaceholderText('Markdownで入力'), {
      target: { value: 'warning fixture' },
    });
    const submit = screen.getByRole('button', { name: '送信' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(postedMessages).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '送信' })).toBeEnabled(),
    );
    expect(
      screen.queryByText(/providerKey|internal\.invalid|secret/),
    ).toBeNull();
    expect(screen.queryByText('UNKNOWN_INTERNAL_WARNING')).toBeNull();
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

    try {
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
      expect(
        await screen.findByText('コピーに失敗しました'),
      ).toBeInTheDocument();
      expect(vi.mocked(copyToClipboard)).toHaveBeenLastCalledWith(
        expect.stringContaining('#/open?kind=chat_message&id=message-1'),
      );

      fireEvent.click(screen.getByRole('button', { name: '外部要約' }));
      expect(confirmSpy).toHaveBeenCalled();
      expect(
        await screen.findByText('外部要約の生成に失敗しました'),
      ).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
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
});
