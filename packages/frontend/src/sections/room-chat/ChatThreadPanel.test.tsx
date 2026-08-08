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
    submitLabel,
    cancelLabel,
    disabled,
  }: {
    body: string;
    onBodyChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    placeholder: string;
    submitLabel: string;
    cancelLabel: string;
    disabled?: boolean;
  }) => (
    <div>
      <textarea
        aria-label={placeholder}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
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
    />,
  );
}

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
        return { id: 'ack-1' };
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

    fireEvent.click(within(replyCard).getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/chat-ack-requests/ack-1/ack', {
        method: 'POST',
      }),
    );

    fireEvent.click(
      within(replyCard).getByRole('button', { name: '返信を削除' }),
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

  it('keeps the thread and warns without raw error details when post-refresh fails', async () => {
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

    expect(await screen.findByText('committed reply')).toBeInTheDocument();
    expect(screen.getByText('reply-1 body')).toBeInTheDocument();
    expect(
      screen.getByText(
        '返信は投稿されましたが表示更新に失敗しました。再送せず再読み込みしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '返信を入力' })).toHaveValue('');
    expect(consoleError).toHaveBeenCalledWith('Failed to load chat thread.');
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
      /providerKey|secret|backend stack/,
    );
  });

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
        '投稿結果を確認できません。再送せず再読み込みしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('must not be rendered')).toBeNull();
    expect(
      api.mock.calls.some(
        ([path]) => String(path) === '/chat-rooms/room-2/read',
      ),
    ).toBe(false);
  });
});
