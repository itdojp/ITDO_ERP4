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

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../../api', () => ({ api }));
vi.mock('../../ui', () => ({
  MentionComposer: ({
    body,
    onBodyChange,
    onSubmit,
    onCancel,
    placeholder,
    groupPlaceholder,
    submitLabel,
    cancelLabel,
    groups,
    onGroupsChange,
    attachments,
    disabled,
  }: {
    body: string;
    onBodyChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    placeholder: string;
    groupPlaceholder: string;
    submitLabel: string;
    cancelLabel: string;
    groups: { id: string; kind: 'group'; label: string }[];
    onGroupsChange: (
      value: { id: string; kind: 'group'; label: string }[],
    ) => void;
    attachments?: unknown[];
    disabled?: boolean;
  }) => (
    <div>
      <textarea
        aria-label={placeholder}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        disabled={disabled}
      />
      <input
        role="combobox"
        aria-label={groupPlaceholder}
        aria-expanded="true"
        disabled={disabled}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onGroupsChange([
            ...groups,
            { id: 'group-1', kind: 'group', label: 'Group 1' },
          ])
        }
      >
        合成グループを追加
      </button>
      {attachments !== undefined && (
        <button type="button" aria-label="ファイルを追加">
          ファイルを追加
        </button>
      )}
      <button type="button" onClick={onSubmit} disabled={disabled}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} disabled={disabled}>
        {cancelLabel}
      </button>
    </div>
  ),
}));

import { ChatThreadPanel } from './ChatThreadPanel';

function message(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'alice',
    body: `${id} body`,
    tags: [],
    reactions: {},
    mentions: null,
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt: '2026-08-09T00:00:00.000Z',
    deletedAt: null,
    deletedReason: null,
    providerUrl: 'https://internal.invalid',
    rawError: 'hidden',
    ...extra,
  };
}

function thread(input?: { deletedRoot?: boolean; deletedReply?: boolean }) {
  const root = message('root-1', {
    ...(input?.deletedRoot
      ? {
          body: null,
          deletedAt: '2026-08-09T00:03:00.000Z',
          deletedReason: 'user_retract',
        }
      : {}),
  });
  const reply = message('reply-1', {
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
    userId: 'demo-user',
    createdAt: '2026-08-09T00:01:00.000Z',
    ackRequest: {
      id: 'ack-1',
      messageId: 'reply-1',
      roomId: 'room-1',
      requiredUserIds: ['demo-user'],
      dueAt: null,
      canceledAt: null,
      canceledBy: null,
      acks: [],
    },
    ...(input?.deletedReply
      ? {
          body: null,
          deletedAt: '2026-08-09T00:02:00.000Z',
          deletedReason: 'user_retract',
        }
      : {}),
  });
  return {
    root,
    replies: [reply],
    replyCount: 1,
    lastReplyAt: '2026-08-09T00:01:00.000Z',
    nextCursor: null,
    providerKey: 'hidden',
  };
}

function renderPanel(overrides?: {
  onClose?: () => void;
  onRootUpdated?: () => void;
  onReadUpdated?: () => void;
  onAccessRevoked?: (roomId: string, message: string) => void;
}) {
  return render(
    <ChatThreadPanel
      messageId="reply-1"
      roomId="room-1"
      expectedRootId="root-1"
      currentUserId="demo-user"
      roles={['member']}
      renderMessageBody={(value) => <span>{value}</span>}
      onClose={overrides?.onClose ?? vi.fn()}
      onRootUpdated={overrides?.onRootUpdated ?? vi.fn()}
      onReadUpdated={overrides?.onReadUpdated ?? vi.fn()}
      onAccessRevoked={overrides?.onAccessRevoked ?? vi.fn()}
    />,
  );
}

const definiteRetryCases: Array<{
  mode: 'standard' | 'ack';
  submitLabel: string;
  message: string;
  postPath: string;
  prepare: () => void;
}> = [
  {
    mode: 'standard',
    submitLabel: '返信',
    message: '返信の投稿に失敗しました',
    postPath: '/chat-messages/root-1/replies',
    prepare: (): void => {},
  },
  {
    mode: 'ack',
    submitLabel: '確認依頼として返信',
    message: '確認依頼付き返信の投稿に失敗しました',
    postPath: '/chat-rooms/room-1/ack-requests',
    prepare: (): void => {
      fireEvent.click(
        screen.getByRole('checkbox', { name: '確認依頼として返信' }),
      );
      fireEvent.change(
        screen.getByLabelText(/確認対象ユーザーID（カンマ区切り）/),
        {
          target: { value: 'demo-user' },
        },
      );
    },
  },
];

describe('ChatThreadPanel', () => {
  beforeEach(() => {
    api.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders an accessible responsive thread and posts a reply through the thread API', async () => {
    const initial = thread();
    const createdReply = message('reply-2', {
      parentMessageId: 'root-1',
      threadRootId: 'root-1',
      userId: 'demo-user',
      body: 'new synthetic reply',
      createdAt: '2026-08-09T00:02:00.000Z',
    });
    const refreshedFirstPage = {
      ...thread(),
      replies: [...thread().replies, createdReply],
      replyCount: 2,
      lastReplyAt: '2026-08-09T00:02:00.000Z',
    };
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname === '/chat-messages/reply-1/thread') return initial;
      if (url.pathname === '/chat-messages/root-1/thread') {
        return refreshedFirstPage;
      }
      if (
        url.pathname === '/chat-messages/root-1/replies' &&
        init?.method === 'POST'
      ) {
        return createdReply;
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();

    const dialog = await screen.findByRole('dialog', { name: 'スレッド' });
    expect(dialog).toHaveStyle({ width: '100vw', maxWidth: '620px' });
    expect(
      screen.getByRole('button', { name: 'スレッドを閉じる' }),
    ).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(
      screen.getByRole('button', { name: 'スレッドを閉じる' }),
    ).not.toHaveFocus();
    expect(within(dialog).getByText('root-1 body')).toBeInTheDocument();
    expect(within(dialog).getByText('reply-1 body')).toBeInTheDocument();
    expect(within(dialog).queryByText('https://internal.invalid')).toBeNull();
    expect(within(dialog).queryByText('hidden')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
      target: { value: 'new synthetic reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信' }));

    expect(await screen.findByText('new synthetic reply')).toBeInTheDocument();
    const replyPost = api.mock.calls.find(
      ([path]) => String(path) === '/chat-messages/root-1/replies',
    );
    expect(JSON.parse(String(replyPost?.[1]?.body))).toEqual({
      body: 'new synthetic reply',
      tags: [],
    });
    const readCalls = api.mock.calls.filter(
      ([path]) => String(path) === '/chat-rooms/room-1/read',
    );
    expect(
      JSON.parse(String(readCalls[readCalls.length - 1]?.[1]?.body)),
    ).toEqual({
      through: '2026-08-09T00:02:00.000Z',
      throughMessageId: 'reply-2',
    });
  });

  it('keeps the read boundary before the newest timestamp while another reply page exists', async () => {
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        return { ...thread(), nextCursor: 'page-2' };
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    await screen.findByText('reply-1 body');
    await waitFor(() =>
      expect(
        api.mock.calls.some(([path]) =>
          String(path).endsWith('/chat-rooms/room-1/read'),
        ),
      ).toBe(true),
    );
    const read = api.mock.calls.find(([path]) =>
      String(path).endsWith('/chat-rooms/room-1/read'),
    );
    expect(JSON.parse(String(read?.[1]?.body))).toEqual({
      through: '2026-08-09T00:00:00.000Z',
      throughMessageId: 'root-1',
    });
  });

  it('supports reply reaction, ack, and logical delete without exposing deleted content', async () => {
    let current = thread();
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return current;
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (url.pathname === '/chat-messages/reply-1/reactions') {
        return message('reply-1', {
          parentMessageId: 'root-1',
          threadRootId: 'root-1',
          reactions: { '👍': 1 },
        });
      }
      if (url.pathname === '/chat-ack-requests/ack-1/ack') {
        return {
          id: 'ack-1',
          messageId: 'reply-1',
          roomId: 'room-1',
          requiredUserIds: ['demo-user'],
          dueAt: null,
          canceledAt: null,
          canceledBy: null,
          acks: [
            {
              id: 'ack-row-1',
              requestId: 'ack-1',
              userId: 'demo-user',
              ackedAt: '2026-08-09T00:02:00.000Z',
            },
          ],
        };
      }
      if (
        url.pathname === '/chat-messages/reply-1' &&
        init?.method === 'DELETE'
      ) {
        current = thread({ deletedReply: true });
        return {};
      }
      throw new Error(`Unhandled api path: ${path}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel();
    const replyCard = await waitFor(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-thread-message-id="reply-1"]',
      );
      expect(card).not.toBeNull();
      return card as HTMLElement;
    });

    fireEvent.click(
      within(replyCard).getByRole('button', { name: 'replyへ👍リアクション' }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/chat-messages/reply-1/reactions',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(
        within(
          document.querySelector<HTMLElement>(
            '[data-thread-message-id="reply-1"]',
          ) as HTMLElement,
        ).getByRole('button', { name: 'replyへ👍リアクション' }),
      ).toHaveTextContent('1'),
    );

    fireEvent.click(
      within(
        document.querySelector<HTMLElement>(
          '[data-thread-message-id="reply-1"]',
        ) as HTMLElement,
      ).getByRole('button', { name: 'OK' }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/chat-ack-requests/ack-1/ack', {
        method: 'POST',
      }),
    );
    expect(await screen.findByText('確認しました')).toBeInTheDocument();

    fireEvent.click(
      within(
        document.querySelector<HTMLElement>(
          '[data-thread-message-id="reply-1"]',
        ) as HTMLElement,
      ).getByRole('button', { name: '返信を削除' }),
    );
    expect(
      await screen.findByRole('status', { name: '削除済みの返信' }),
    ).toHaveTextContent('この返信は削除されています。');
    expect(screen.queryByText('reply-1 body')).toBeNull();
    const deleteCall = api.mock.calls.find(
      ([path, init]) =>
        String(path) === '/chat-messages/reply-1' && init?.method === 'DELETE',
    );
    expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({
      reason: 'user_retract',
    });
  });

  it('shows a deleted-root placeholder, disables reply creation, and closes with Escape', async () => {
    const onClose = vi.fn();
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread'))
        return thread({ deletedRoot: true });
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel({ onClose });
    expect(
      await screen.findByRole('status', { name: '削除済みの親メッセージ' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('削除済みの親メッセージには返信できません。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '返信を入力' })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel open when a nested combobox consumes Escape', async () => {
    const onClose = vi.fn();
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return thread();
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel({ onClose });
    await screen.findByText('reply-1 body');
    fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
      target: { value: 'preserved reply draft' },
    });
    fireEvent.keyDown(
      screen.getByRole('combobox', { name: '確認対象グループ' }),
      { key: 'Escape' },
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'スレッド' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '返信を入力' })).toHaveValue(
      'preserved reply draft',
    );
  });

  it('posts selected acknowledgement groups and does not expose an attachment control', async () => {
    const created = message('reply-group', {
      parentMessageId: 'root-1',
      threadRootId: 'root-1',
      userId: 'demo-user',
      body: 'group acknowledgement',
      createdAt: '2026-08-09T00:02:00.000Z',
      ackRequest: {
        id: 'ack-group',
        messageId: 'reply-group',
        roomId: 'room-1',
        requiredUserIds: [],
        dueAt: null,
        canceledAt: null,
        canceledBy: null,
        acks: [],
      },
    });
    const refreshed = {
      ...thread(),
      replies: [...thread().replies, created],
      replyCount: 2,
      lastReplyAt: '2026-08-09T00:02:00.000Z',
    };
    let threadReads = 0;
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        threadReads += 1;
        return threadReads === 1 ? thread() : refreshed;
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-rooms/room-1/ack-requests' &&
        init?.method === 'POST'
      ) {
        return created;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    await screen.findByText('reply-1 body');
    expect(screen.queryByRole('button', { name: /ファイル/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '合成グループを追加' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: '確認依頼として返信' }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
      target: { value: 'group acknowledgement' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認依頼として返信' }));

    await screen.findByText('確認依頼付きの返信を投稿しました');
    const post = api.mock.calls.find(
      ([path, init]) =>
        String(path) === '/chat-rooms/room-1/ack-requests' &&
        init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual(
      expect.objectContaining({ requiredGroupIds: ['group-1'] }),
    );
  });

  it('requires at least one acknowledgement recipient before posting a thread ack reply', async () => {
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return thread();
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    await screen.findByText('reply-1 body');
    fireEvent.click(
      screen.getByRole('checkbox', { name: '確認依頼として返信' }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
      target: { value: 'ack body' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認依頼として返信' }));

    expect(
      await screen.findByText(
        '確認対象（ユーザID/グループ）を入力してください',
      ),
    ).toBeInTheDocument();
    expect(
      api.mock.calls.some(
        ([path, init]) =>
          String(path) === '/chat-rooms/room-1/ack-requests' &&
          init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it.each([
    { mode: 'standard' as const, label: '返信' },
    { mode: 'ack' as const, label: '確認依頼として返信' },
  ])(
    'keeps a concurrently deleted reply redacted after $mode post refresh',
    async ({ mode, label }) => {
      const created = message('reply-race', {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
        userId: 'demo-user',
        body: 'must remain redacted',
        createdAt: '2026-08-09T00:02:00.000Z',
        ...(mode === 'ack'
          ? {
              ackRequest: {
                id: 'ack-race',
                messageId: 'reply-race',
                roomId: 'room-1',
                requiredUserIds: ['demo-user'],
                dueAt: null,
                canceledAt: null,
                canceledBy: null,
                acks: [],
              },
            }
          : {}),
      });
      const initial = thread();
      const refreshed = {
        ...thread(),
        replies: [
          ...thread().replies,
          message('reply-race', {
            parentMessageId: 'root-1',
            threadRootId: 'root-1',
            userId: 'demo-user',
            body: null,
            createdAt: '2026-08-09T00:02:00.000Z',
            deletedAt: '2026-08-09T00:03:00.000Z',
            deletedReason: 'admin_moderation',
          }),
        ],
        replyCount: 2,
        lastReplyAt: '2026-08-09T00:02:00.000Z',
      };
      api.mockImplementation(async (path: string, init?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
        if (url.pathname === '/chat-messages/reply-1/thread') return initial;
        if (url.pathname === '/chat-messages/root-1/thread') return refreshed;
        if (url.pathname === '/chat-rooms/room-1/read') return {};
        if (
          mode === 'standard' &&
          url.pathname === '/chat-messages/root-1/replies' &&
          init?.method === 'POST'
        ) {
          return created;
        }
        if (
          mode === 'ack' &&
          url.pathname === '/chat-rooms/room-1/ack-requests' &&
          init?.method === 'POST'
        ) {
          return created;
        }
        throw new Error(`Unhandled api path: ${path}`);
      });

      renderPanel();
      await screen.findByText('reply-1 body');
      if (mode === 'ack') {
        fireEvent.click(
          screen.getByRole('checkbox', { name: '確認依頼として返信' }),
        );
        fireEvent.change(screen.getByLabelText(/確認対象ユーザーID/), {
          target: { value: 'demo-user' },
        });
      }
      fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
        target: { value: 'must remain redacted' },
      });
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(
        await screen.findByRole('status', { name: '削除済みの返信' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('must remain redacted')).toBeNull();
    },
  );

  it('prevents closing during a committed root deletion and redacts the parent timeline', async () => {
    const onClose = vi.fn();
    const onRootUpdated = vi.fn();
    let resolveDelete: (() => void) | null = null;
    const ownedThread = (deletedRoot = false) => {
      const value = thread({ deletedRoot });
      return { ...value, root: { ...value.root, userId: 'demo-user' } };
    };
    let current = ownedThread();
    const pendingDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return current;
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/root-1' &&
        init?.method === 'DELETE'
      ) {
        await pendingDelete;
        current = ownedThread(true);
        return {};
      }
      throw new Error(`Unhandled api path: ${path}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel({ onClose, onRootUpdated });
    await screen.findByText('root-1 body');
    const rootCard = document.querySelector<HTMLElement>(
      '[data-thread-message-id="root-1"]',
    );
    expect(rootCard).not.toBeNull();
    fireEvent.click(
      within(rootCard as HTMLElement).getByRole('button', {
        name: '親メッセージを削除',
      }),
    );
    const closeButton = screen.getByRole('button', {
      name: 'スレッドを閉じる',
    });
    await waitFor(() => expect(closeButton).toBeDisabled());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(
      screen.getByRole('dialog').parentElement as HTMLElement,
    );
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveDelete?.();
      await pendingDelete;
    });
    expect(
      await screen.findByRole('status', { name: '削除済みの親メッセージ' }),
    ).toBeInTheDocument();
    expect(onRootUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'root-1', deleted: true, body: null }),
    );
    await waitFor(() => expect(closeButton).toBeEnabled());
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves loaded reply pages when a mutation refreshes the first page', async () => {
    const firstReply = message('reply-1', {
      parentMessageId: 'root-1',
      threadRootId: 'root-1',
      createdAt: '2026-08-09T00:01:00.000Z',
    });
    const secondReply = message('reply-2', {
      parentMessageId: 'root-1',
      threadRootId: 'root-1',
      createdAt: '2026-08-09T00:02:00.000Z',
    });
    let firstPageReads = 0;
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread') && url.searchParams.has('cursor')) {
        return {
          root: message('root-1'),
          replies: [secondReply],
          replyCount: 2,
          lastReplyAt: secondReply.createdAt,
          nextCursor: null,
        };
      }
      if (url.pathname.endsWith('/thread')) {
        firstPageReads += 1;
        return {
          root: message('root-1'),
          replies: [
            firstPageReads > 1
              ? { ...firstReply, reactions: { '👍': 1 } }
              : firstReply,
          ],
          replyCount: 2,
          lastReplyAt: secondReply.createdAt,
          nextCursor: 'page-2',
        };
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/reply-2/reactions' &&
        init?.method === 'POST'
      ) {
        return { ...secondReply, reactions: { '👍': 1 } };
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    await screen.findByText('reply-1 body');
    fireEvent.click(
      screen.getByRole('button', { name: '返信をさらに読み込む' }),
    );
    expect(await screen.findByText('reply-2 body')).toBeInTheDocument();

    const secondReplyCard = document.querySelector<HTMLElement>(
      '[data-thread-message-id="reply-2"]',
    );
    expect(secondReplyCard).not.toBeNull();
    fireEvent.click(
      within(secondReplyCard as HTMLElement).getByRole('button', {
        name: 'replyへ👍リアクション',
      }),
    );

    await waitFor(() =>
      expect(
        within(secondReplyCard as HTMLElement).getByRole('button', {
          name: 'replyへ👍リアクション',
        }),
      ).toHaveTextContent('1'),
    );
    expect(screen.getByText('reply-2 body')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '返信をさらに読み込む' }),
    ).toBeNull();
  });

  it('does not start reply pagination while a mutation is in flight', async () => {
    let resolveReaction: ((value: Record<string, unknown>) => void) | undefined;
    const pendingReaction = new Promise<Record<string, unknown>>((resolve) => {
      resolveReaction = resolve;
    });
    const initial = { ...thread(), nextCursor: 'page-2' };
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return initial;
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/reply-1/reactions' &&
        init?.method === 'POST'
      ) {
        return pendingReaction;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    const reactionButton = await screen.findByRole('button', {
      name: 'replyへ👍リアクション',
    });
    fireEvent.click(reactionButton);
    const loadMoreButton = screen.getByRole('button', {
      name: '返信をさらに読み込む',
    });
    await waitFor(() => expect(loadMoreButton).toBeDisabled());
    fireEvent.click(loadMoreButton);
    expect(
      api.mock.calls.filter(([path]) =>
        new URL(String(path), 'http://localhost').searchParams.has('cursor'),
      ),
    ).toHaveLength(0);

    await act(async () => {
      resolveReaction?.(
        message('reply-1', {
          parentMessageId: 'root-1',
          threadRootId: 'root-1',
          reactions: { '👍': 1 },
        }),
      );
      await pendingReaction;
    });
    await waitFor(() => expect(loadMoreButton).toBeEnabled());
  });

  it('does not start a mutation while reply pagination is in flight', async () => {
    let resolvePage: ((value: ReturnType<typeof thread>) => void) | undefined;
    const pendingPage = new Promise<ReturnType<typeof thread>>((resolve) => {
      resolvePage = resolve;
    });
    const initial = { ...thread(), nextCursor: 'page-2' };
    api.mockImplementation((path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') {
        return Promise.resolve({});
      }
      if (url.pathname.endsWith('/thread') && url.searchParams.has('cursor')) {
        return pendingPage;
      }
      if (url.pathname.endsWith('/thread')) return Promise.resolve(initial);
      if (url.pathname === '/chat-rooms/room-1/read') {
        return Promise.resolve({});
      }
      if (
        url.pathname === '/chat-messages/reply-1/reactions' &&
        init?.method === 'POST'
      ) {
        throw new Error('mutation must not start during pagination');
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    const reactionButton = await screen.findByRole('button', {
      name: 'replyへ👍リアクション',
    });
    fireEvent.click(
      screen.getByRole('button', { name: '返信をさらに読み込む' }),
    );
    await waitFor(() => expect(reactionButton).toBeDisabled());
    fireEvent.click(reactionButton);
    expect(
      api.mock.calls.filter(
        ([path]) => String(path) === '/chat-messages/reply-1/reactions',
      ),
    ).toHaveLength(0);

    await act(async () => {
      resolvePage?.({ ...thread(), replies: [], nextCursor: null });
      await pendingPage;
    });
    await waitFor(() => expect(reactionButton).toBeEnabled());
  });

  it('does not render an unconfirmed POST body and warns without raw error details when refresh fails', async () => {
    const createdReply = message('reply-2', {
      parentMessageId: 'root-1',
      threadRootId: 'root-1',
      userId: 'demo-user',
      body: 'committed reply',
      createdAt: '2026-08-09T00:02:00.000Z',
    });
    let threadReads = 0;
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        threadReads += 1;
        if (threadReads > 1) {
          throw new Error('providerKey=secret raw backend stack');
        }
        return thread();
      }
      if (
        url.pathname === '/chat-messages/root-1/replies' &&
        init?.method === 'POST'
      ) {
        return createdReply;
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    await screen.findByText('reply-1 body');
    fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
      target: { value: 'committed reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信' }));

    expect(
      document.querySelector('[data-thread-message-id="reply-2"]'),
    ).toBeNull();
    expect(screen.getByText('reply-1 body')).toBeInTheDocument();
    expect(
      await screen.findByText(
        '返信は投稿されましたが表示を確認できません。再送せず再読み込みしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '返信を入力' })).toHaveValue('');
    expect(consoleError).toHaveBeenCalledWith('Failed to load chat thread.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
      /providerKey|secret|backend stack/,
    );
  });

  it.each([
    { mode: 'standard' as const, label: '返信' },
    { mode: 'ack' as const, label: '確認依頼として返信' },
  ])(
    'does not render an unconfirmed $mode POST body when a 51st reply is outside the refreshed first page',
    async ({ mode, label }) => {
      const oldReplies = Array.from({ length: 50 }, (_, index) =>
        message(`old-reply-${index}`, {
          parentMessageId: 'root-1',
          threadRootId: 'root-1',
          body: `old reply ${index}`,
          createdAt: `2026-08-08T23:${String(index).padStart(2, '0')}:00.000Z`,
        }),
      );
      const initial = {
        ...thread(),
        replies: oldReplies,
        replyCount: 50,
        lastReplyAt: '2026-08-08T23:49:00.000Z',
        nextCursor: 'page-2',
      };
      const created = message('page-boundary-reply', {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
        userId: 'demo-user',
        body: 'unconfirmed page boundary body',
        createdAt: '2026-08-09T00:02:00.000Z',
        ...(mode === 'ack'
          ? {
              ackRequest: {
                id: 'ack-page-boundary',
                messageId: 'page-boundary-reply',
                roomId: 'room-1',
                requiredUserIds: ['demo-user'],
                dueAt: null,
                canceledAt: null,
                canceledBy: null,
                acks: [],
              },
            }
          : {}),
      });
      let threadReads = 0;
      api.mockImplementation(async (path: string, init?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
        if (url.pathname.endsWith('/thread')) {
          threadReads += 1;
          return threadReads === 1
            ? initial
            : {
                ...initial,
                replyCount: 51,
                lastReplyAt: '2026-08-09T00:02:00.000Z',
              };
        }
        if (url.pathname === '/chat-rooms/room-1/read') return {};
        if (
          mode === 'standard' &&
          url.pathname === '/chat-messages/root-1/replies' &&
          init?.method === 'POST'
        ) {
          return created;
        }
        if (
          mode === 'ack' &&
          url.pathname === '/chat-rooms/room-1/ack-requests' &&
          init?.method === 'POST'
        ) {
          return created;
        }
        throw new Error(`Unhandled api path: ${path}`);
      });

      renderPanel();
      await screen.findByText('old reply 0');
      if (mode === 'ack') {
        fireEvent.click(
          screen.getByRole('checkbox', { name: '確認依頼として返信' }),
        );
        fireEvent.change(screen.getByLabelText(/確認対象ユーザーID/), {
          target: { value: 'demo-user' },
        });
      }
      fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
        target: { value: 'unconfirmed page boundary body' },
      });
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(
        await screen.findByText(
          mode === 'ack'
            ? '確認依頼付きの返信は投稿されましたが表示を確認できません。再送せず再読み込みしてください'
            : '返信は投稿されましたが表示を確認できません。再送せず再読み込みしてください',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('unconfirmed page boundary body')).toBeNull();
      expect(screen.getByRole('textbox', { name: '返信を入力' })).toHaveValue(
        '',
      );
    },
  );

  it.each([
    { mode: 'standard' as const, label: '返信' },
    { mode: 'ack' as const, label: '確認依頼として返信' },
  ])(
    'purges thread content after a $mode POST_WITHOUT_VIEW response',
    async ({ mode, label }) => {
      const onAccessRevoked = vi.fn();
      const created = message('revoked-reply', {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
        userId: 'demo-user',
        body: 'must be purged after access loss',
        createdAt: '2026-08-09T00:02:00.000Z',
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message: 'raw backend warning must not be displayed',
          providerKey: 'hidden',
        },
        ...(mode === 'ack'
          ? {
              ackRequest: {
                id: 'ack-revoked',
                messageId: 'revoked-reply',
                roomId: 'room-1',
                requiredUserIds: ['demo-user'],
                dueAt: null,
                canceledAt: null,
                canceledBy: null,
                acks: [],
              },
            }
          : {}),
      });
      let threadReads = 0;
      api.mockImplementation(async (path: string, init?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
        if (url.pathname.endsWith('/thread')) {
          threadReads += 1;
          return thread();
        }
        if (url.pathname === '/chat-rooms/room-1/read') return {};
        if (
          mode === 'standard' &&
          url.pathname === '/chat-messages/root-1/replies' &&
          init?.method === 'POST'
        ) {
          return created;
        }
        if (
          mode === 'ack' &&
          url.pathname === '/chat-rooms/room-1/ack-requests' &&
          init?.method === 'POST'
        ) {
          return created;
        }
        throw new Error(`Unhandled api path: ${path}`);
      });

      renderPanel({ onAccessRevoked });
      await screen.findByText('root-1 body');
      if (mode === 'ack') {
        fireEvent.click(
          screen.getByRole('checkbox', { name: '確認依頼として返信' }),
        );
        fireEvent.change(screen.getByLabelText(/確認対象ユーザーID/), {
          target: { value: 'demo-user' },
        });
      }
      fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
        target: { value: 'must be purged after access loss' },
      });
      fireEvent.click(screen.getByRole('button', { name: label }));

      const safeMessage =
        '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。';
      expect(await screen.findByText(safeMessage)).toBeInTheDocument();
      expect(screen.queryByText('root-1 body')).toBeNull();
      expect(screen.queryByText('reply-1 body')).toBeNull();
      expect(screen.queryByText('must be purged after access loss')).toBeNull();
      expect(screen.queryByText(/raw backend warning|providerKey/)).toBeNull();
      expect(onAccessRevoked).toHaveBeenCalledWith('room-1', safeMessage);
      expect(threadReads).toBe(1);
    },
  );

  it('rejects a thread response from a different room before marking it read', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        const mismatched = thread();
        return {
          ...mismatched,
          root: { ...mismatched.root, roomId: 'room-2' },
          replies: mismatched.replies.map((reply) => ({
            ...reply,
            roomId: 'room-2',
          })),
        };
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();

    expect(
      await screen.findByText('スレッドを取得できませんでした'),
    ).toBeInTheDocument();
    expect(screen.queryByText('root-1 body')).toBeNull();
    expect(
      api.mock.calls.some(
        ([path]) => String(path) === '/chat-rooms/room-2/read',
      ),
    ).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('Failed to load chat thread.');
  });

  it('rejects a different root in the expected room before marking it read', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        const mismatched = thread();
        return {
          ...mismatched,
          root: { ...mismatched.root, id: 'root-2' },
          replies: mismatched.replies.map((reply) => ({
            ...reply,
            parentMessageId: 'root-2',
            threadRootId: 'root-2',
          })),
        };
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();

    expect(
      await screen.findByText('スレッドを取得できませんでした'),
    ).toBeInTheDocument();
    expect(screen.queryByText('root-1 body')).toBeNull();
    expect(
      api.mock.calls.some(
        ([path]) => String(path) === '/chat-rooms/room-1/read',
      ),
    ).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('Failed to load chat thread.');
  });

  it('propagates a committed root deletion when the refresh fails', async () => {
    const onRootUpdated = vi.fn();
    let threadReads = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        threadReads += 1;
        if (threadReads > 1) throw new Error('raw refresh details');
        const initial = thread();
        return {
          ...initial,
          root: { ...initial.root, userId: 'demo-user' },
        };
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/root-1' &&
        init?.method === 'DELETE'
      ) {
        return {};
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel({ onRootUpdated });
    const rootCard = await waitFor(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-thread-message-id="root-1"]',
      );
      expect(card).not.toBeNull();
      return card as HTMLElement;
    });
    onRootUpdated.mockClear();
    fireEvent.click(
      within(rootCard).getByRole('button', { name: '親メッセージを削除' }),
    );

    expect(
      await screen.findByRole('status', { name: '削除済みの親メッセージ' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('root-1 body')).toBeNull();
    expect(onRootUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'root-1', deleted: true, body: null }),
    );
    expect(
      screen.getByText(
        '操作は完了しましたが表示更新に失敗しました。再送せず再読み込みしてください',
      ),
    ).toBeInTheDocument();
  });

  it('does not refresh or mark read after an in-flight mutation is unmounted', async () => {
    let resolveReaction: ((value: Record<string, unknown>) => void) | null =
      null;
    const reaction = new Promise<Record<string, unknown>>((resolve) => {
      resolveReaction = resolve;
    });
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return thread();
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/reply-1/reactions' &&
        init?.method === 'POST'
      ) {
        return reaction;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    const rendered = renderPanel();
    const replyCard = await waitFor(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-thread-message-id="reply-1"]',
      );
      expect(card).not.toBeNull();
      return card as HTMLElement;
    });
    const initialThreadReads = api.mock.calls.filter(([path]) =>
      String(path).includes('/thread'),
    ).length;
    const initialReadWrites = api.mock.calls.filter(
      ([path]) => String(path) === '/chat-rooms/room-1/read',
    ).length;

    fireEvent.click(
      within(replyCard).getByRole('button', {
        name: 'replyへ👍リアクション',
      }),
    );
    rendered.unmount();
    await act(async () => {
      resolveReaction?.(
        message('reply-1', {
          parentMessageId: 'root-1',
          threadRootId: 'root-1',
          reactions: { '👍': 1 },
        }),
      );
      await reaction;
    });

    expect(
      api.mock.calls.filter(([path]) => String(path).includes('/thread')),
    ).toHaveLength(initialThreadReads);
    expect(
      api.mock.calls.filter(
        ([path]) => String(path) === '/chat-rooms/room-1/read',
      ),
    ).toHaveLength(initialReadWrites);
  });

  it('aborts and invalidates an in-flight thread load on unmount', async () => {
    let resolveThread: ((value: ReturnType<typeof thread>) => void) | null =
      null;
    let signal: AbortSignal | undefined;
    const pending = new Promise<ReturnType<typeof thread>>((resolve) => {
      resolveThread = resolve;
    });
    api.mockImplementation((path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') {
        return Promise.resolve({});
      }
      if (url.pathname.endsWith('/thread')) {
        signal = init?.signal ?? undefined;
        return pending;
      }
      throw new Error(`Unexpected post-unmount request: ${path}`);
    });

    const rendered = renderPanel();
    await waitFor(() => expect(signal).toBeDefined());
    rendered.unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      resolveThread?.(thread());
      await pending;
    });
    expect(
      api.mock.calls.some(
        ([path]) => String(path) === '/chat-rooms/room-1/read',
      ),
    ).toBe(false);
  });

  it('does not merge a reply response whose room or root identity is inconsistent', async () => {
    const mismatchedReply = message('reply-2', {
      roomId: 'room-2',
      parentMessageId: 'other-root',
      threadRootId: 'other-root',
      userId: 'demo-user',
      body: 'must not be rendered',
      createdAt: '2026-08-09T00:02:00.000Z',
    });
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) return thread();
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/root-1/replies' &&
        init?.method === 'POST'
      ) {
        return mismatchedReply;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    await screen.findByText('reply-1 body');
    fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
      target: { value: 'must not be rendered' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信' }));

    expect(
      await screen.findByText(
        '返信結果を確認できません。重複防止のため再送せず、パネルを閉じて再読み込みしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返信' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '返信を入力' })).toHaveValue(
      'must not be rendered',
    );
    fireEvent.click(screen.getByRole('button', { name: '返信' }));
    expect(
      api.mock.calls.filter(
        ([path, init]) =>
          String(path) === '/chat-messages/root-1/replies' &&
          init?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-thread-message-id="reply-2"]'),
    ).toBeNull();
    expect(
      api.mock.calls.some(
        ([path]) => String(path) === '/chat-rooms/room-2/read',
      ),
    ).toBe(false);
  });

  it('purges loaded thread content when an unavailable mutation is confirmed by refresh', async () => {
    let threadReads = 0;
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
      if (url.pathname.endsWith('/thread')) {
        threadReads += 1;
        if (threadReads === 1) return thread();
        throw new Error(`Request failed: ${path} (404) NOT_FOUND`);
      }
      if (url.pathname === '/chat-rooms/room-1/read') return {};
      if (
        url.pathname === '/chat-messages/reply-1/reactions' &&
        init?.method === 'POST'
      ) {
        throw new Error(`Request failed: ${path} (404) NOT_FOUND`);
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderPanel();
    const replyCard = await waitFor(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-thread-message-id="reply-1"]',
      );
      expect(card).not.toBeNull();
      return card as HTMLElement;
    });
    expect(screen.getByText('root-1 body')).toBeInTheDocument();
    expect(screen.getByText('reply-1 body')).toBeInTheDocument();

    fireEvent.click(
      within(replyCard).getByRole('button', {
        name: 'replyへ👍リアクション',
      }),
    );

    expect(
      await screen.findByText('スレッドを表示できません'),
    ).toBeInTheDocument();
    expect(screen.queryByText('root-1 body')).toBeNull();
    expect(screen.queryByText('reply-1 body')).toBeNull();
    expect(threadReads).toBe(2);
  });

  it.each(definiteRetryCases)(
    'keeps retry enabled after a definite $mode POST rejection',
    async ({ submitLabel, message, postPath, prepare }) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      api.mockImplementation(async (path: string, init?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/chat-rooms/room-1/mention-candidates') return {};
        if (url.pathname.endsWith('/thread')) return thread();
        if (url.pathname === '/chat-rooms/room-1/read') return {};
        if (url.pathname === postPath && init?.method === 'POST') {
          throw new Error(`Request failed: ${postPath} (400) INVALID_INPUT`);
        }
        throw new Error(`Unhandled api path: ${path}`);
      });

      renderPanel();
      await screen.findByText('reply-1 body');
      prepare();
      fireEvent.change(screen.getByRole('textbox', { name: '返信を入力' }), {
        target: { value: 'retryable draft' },
      });
      const submit = screen.getByRole('button', { name: submitLabel });
      fireEvent.click(submit);

      expect(await screen.findByText(message)).toBeInTheDocument();
      await waitFor(() => expect(submit).toBeEnabled());
      expect(screen.getByRole('textbox', { name: '返信を入力' })).toHaveValue(
        'retryable draft',
      );
      fireEvent.click(submit);
      expect(
        api.mock.calls.filter(
          ([path, init]) =>
            String(path) === postPath && init?.method === 'POST',
        ),
      ).toHaveLength(2);
      expect(screen.queryByText(/重複防止のため再送せず/)).toBeNull();
      expect(consoleError).toHaveBeenCalled();
    },
  );
});
