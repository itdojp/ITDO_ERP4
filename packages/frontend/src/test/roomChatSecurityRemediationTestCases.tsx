import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { expect, it, vi } from 'vitest';
import type { RoomChatProps, RootPostLifecycle } from '../sections/RoomChat';
import type {
  ChatMessageTestValue,
  ChatRoomTestValue,
  ChatSearchItemTestValue,
  DeferredTestValue,
  RoomChatApiMockOptions,
} from './roomChatTestTypes';

function deferred<T>(): DeferredTestValue<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

type TestContext = {
  RoomChat: React.ComponentType<RoomChatProps>;
  api: ReturnType<typeof vi.fn>;
  apiResponse: ReturnType<typeof vi.fn>;
  installApiMock: (options: RoomChatApiMockOptions) => void;
  makeRoom: (overrides: Partial<ChatRoomTestValue>) => ChatRoomTestValue;
  makeMessage: (
    overrides: Partial<ChatMessageTestValue>,
  ) => ChatMessageTestValue;
  makeSearchItem: (
    overrides: Partial<ChatSearchItemTestValue>,
  ) => ChatSearchItemTestValue;
};

export function registerRoomChatSecurityRemediationTests({
  RoomChat,
  api,
  apiResponse,
  installApiMock,
  makeRoom,
  makeMessage,
  makeSearchItem,
}: TestContext) {
  it.each([
    { mode: 'reply', status: 400 },
    { mode: 'ack reply', status: 404 },
  ] as const)(
    'returns the App-session lifecycle to idle when an in-flight $mode is rejected after section unmount',
    async ({ mode, status }) => {
      const pending = deferred<ChatMessageTestValue>();
      const postPath =
        mode === 'reply'
          ? '/chat-messages/unmounted-thread-root/replies'
          : '/chat-rooms/room-1/ack-requests';
      const root = makeMessage({
        id: 'unmounted-thread-root',
        roomId: 'room-1',
        body: 'unmounted lifecycle root',
        parentMessageId: null,
        threadRootId: null,
      });
      const accepted = makeMessage({
        id: `accepted-${mode.replace(' ', '-')}`,
        roomId: 'room-1',
        body: 'accepted after explicit rejection',
        parentMessageId: root.id,
        threadRootId: root.id,
      });
      const initialThread = {
        root,
        replies: [],
        replyCount: 0,
        lastReplyAt: null,
        nextCursor: null,
      };
      const refreshedThread = {
        root: { ...root, replyCount: 1, lastReplyAt: accepted.createdAt },
        replies: [accepted],
        replyCount: 1,
        lastReplyAt: accepted.createdAt,
        nextCursor: null,
      };
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [root] },
        threadResultsByMessageId: {
          [root.id]: [initialThread, initialThread, refreshedThread],
        },
        ...(mode === 'reply'
          ? { threadReplyResults: [pending.promise, accepted] }
          : { postAckResults: [pending.promise, accepted] }),
      });

      function Harness() {
        const [mounted, setMounted] = React.useState(true);
        const [lifecycle, setLifecycle] =
          React.useState<RootPostLifecycle>('idle');
        return (
          <>
            <button type="button" onClick={() => setMounted((value) => !value)}>
              toggle room chat
            </button>
            <span>{`chat lifecycle:${lifecycle}`}</span>
            {mounted && (
              <RoomChat
                rootPostLifecycle={lifecycle}
                onRootPostLifecycleChange={setLifecycle}
              />
            )}
          </>
        );
      }

      render(<Harness />);
      expect(await screen.findByText(root.body)).toBeInTheDocument();
      const openThread = () => {
        const rootCard = document.getElementById(`chat-message-${root.id}`);
        expect(rootCard).not.toBeNull();
        fireEvent.click(
          within(rootCard as HTMLElement).getByRole('button', {
            name: /^スレッドを開く/,
          }),
        );
      };
      const prepareAndSubmit = async () => {
        fireEvent.change(await screen.findByPlaceholderText('返信を入力'), {
          target: { value: 'explicitly rejected reply' },
        });
        if (mode === 'ack reply') {
          fireEvent.click(
            screen.getByRole('checkbox', { name: '確認依頼として返信' }),
          );
          fireEvent.change(screen.getByLabelText(/確認対象ユーザーID/), {
            target: { value: 'demo-user' },
          });
        }
        fireEvent.click(
          screen.getByRole('button', {
            name: mode === 'reply' ? '返信' : '確認依頼として返信',
          }),
        );
      };

      openThread();
      await prepareAndSubmit();
      expect(
        await screen.findByText('chat lifecycle:in_flight'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'toggle room chat' }));
      await act(async () => {
        pending.reject(
          new Error(`Request failed: explicit rejection (${status}) hidden`),
        );
        await pending.promise.catch(() => undefined);
      });
      expect(
        await screen.findByText('chat lifecycle:idle'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'toggle room chat' }));
      expect(await screen.findByText(root.body)).toBeInTheDocument();
      openThread();
      await prepareAndSubmit();
      expect(
        await screen.findByText('accepted after explicit rejection'),
      ).toBeInTheDocument();
      expect(screen.getByText('chat lifecycle:idle')).toBeInTheDocument();
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(
            ([path, init]) =>
              String(path) === postPath && init?.method === 'POST',
          ),
      ).toHaveLength(2);
      expect(screen.queryByText('hidden')).toBeNull();
    },
  );

  it.each([
    { mode: 'reply', closeMethod: 'button' },
    { mode: 'reply', closeMethod: 'escape' },
    { mode: 'reply', closeMethod: 'backdrop' },
    { mode: 'ack reply', closeMethod: 'button' },
  ] as const)(
    'keeps an uncertain $mode POST locked across $closeMethod close and section remount',
    async ({ mode, closeMethod }) => {
      const postPath =
        mode === 'reply'
          ? '/chat-messages/uncertain-thread-root/replies'
          : '/chat-rooms/room-1/ack-requests';
      const root = makeMessage({
        id: 'uncertain-thread-root',
        roomId: 'room-1',
        body: 'uncertain thread root',
        parentMessageId: null,
        threadRootId: null,
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [root] },
        threadsByMessageId: {
          'uncertain-thread-root': {
            root,
            replies: [],
            replyCount: 0,
            lastReplyAt: null,
            nextCursor: null,
          },
        },
        rootMutationErrors: {
          [postPath]: new Error(
            'Request failed: reply outcome unavailable (503) private-detail',
          ),
        },
      });

      function Harness() {
        const [mounted, setMounted] = React.useState(true);
        const [lifecycle, setLifecycle] =
          React.useState<RootPostLifecycle>('idle');
        return (
          <>
            <button type="button" onClick={() => setMounted((value) => !value)}>
              toggle room chat
            </button>
            <span>{`chat lifecycle:${lifecycle}`}</span>
            {mounted && (
              <RoomChat
                rootPostLifecycle={lifecycle}
                onRootPostLifecycleChange={setLifecycle}
              />
            )}
          </>
        );
      }

      render(<Harness />);
      expect(
        await screen.findByText('uncertain thread root'),
      ).toBeInTheDocument();
      const rootCard = document.getElementById(`chat-message-${root.id}`);
      expect(rootCard).not.toBeNull();
      fireEvent.click(
        within(rootCard as HTMLElement).getByRole('button', {
          name: /^スレッドを開く/,
        }),
      );
      fireEvent.change(await screen.findByPlaceholderText('返信を入力'), {
        target: { value: 'uncertain reply draft' },
      });
      if (mode === 'ack reply') {
        fireEvent.click(
          screen.getByRole('checkbox', { name: '確認依頼として返信' }),
        );
        fireEvent.change(screen.getByLabelText(/確認対象ユーザーID/), {
          target: { value: 'demo-user' },
        });
      }
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'reply' ? '返信' : '確認依頼として返信',
        }),
      );

      expect(
        await screen.findByText('chat lifecycle:uncertain'),
      ).toBeInTheDocument();
      expect(
        (
          await screen.findAllByText(
            /重複防止のため再送せず、ページを再読み込み/,
          )
        ).length,
      ).toBeGreaterThanOrEqual(2);

      const dialog = screen.getByRole('dialog', { name: 'スレッド' });
      if (closeMethod === 'button') {
        fireEvent.click(
          screen.getByRole('button', { name: 'スレッドを閉じる' }),
        );
      } else if (closeMethod === 'escape') {
        fireEvent.keyDown(window, { key: 'Escape' });
      } else {
        fireEvent.mouseDown(dialog.parentElement as HTMLElement);
      }
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull(),
      );

      fireEvent.click(screen.getByRole('button', { name: /^スレッドを開く/ }));
      expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'toggle room chat' }));
      expect(screen.queryByText('uncertain thread root')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'toggle room chat' }));
      expect(
        await screen.findByText('uncertain thread root'),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Markdownで入力')).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /^スレッドを開く/ }));
      expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
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
    ['room-readable', true],
    ['room-unavailable', false],
  ] as const)(
    'revalidates room ACL after a failed thread mutation even when thread refresh succeeds: %s',
    async (_mode, roomReadable) => {
      const root = makeMessage({
        id: 'access-sensitive-root',
        roomId: 'room-1',
        body: 'thread mutation root before revalidation',
        parentMessageId: null,
        threadRootId: null,
      });
      const reply = makeMessage({
        id: 'access-sensitive-reply',
        roomId: 'room-1',
        body: 'thread mutation reply before revalidation',
        parentMessageId: root.id,
        threadRootId: root.id,
      });
      const thread = {
        root,
        replies: [reply],
        replyCount: 1,
        lastReplyAt: reply.createdAt,
        nextCursor: null,
      };
      const latest = makeMessage({
        id: 'access-sensitive-latest',
        roomId: 'room-1',
        body: 'thread mutation room still readable',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [] },
        messageReadResultsByRoom: {
          'room-1': [
            [root],
            roomReadable
              ? [latest]
              : new Error('Request failed: room unavailable (404) hidden'),
          ],
        },
        threadResultsByMessageId: {
          [root.id]: [thread, thread],
        },
        globalSearchResultsByQuery: {
          'stale|': [makeSearchItem({ body: 'stale mutation search excerpt' })],
        },
        rootMutationErrors: {
          [`/chat-messages/${reply.id}/reactions`]: new Error(
            'Request failed: thread mutation unavailable (404) private-detail',
          ),
        },
      });

      render(<RoomChat />);
      expect(
        await screen.findByText('thread mutation root before revalidation'),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
        target: { value: 'stale' },
      });
      fireEvent.click(screen.getByRole('button', { name: '検索' }));
      expect(
        await screen.findByText('stale mutation search excerpt'),
      ).toBeInTheDocument();
      const rootCard = document.getElementById(`chat-message-${root.id}`);
      expect(rootCard).not.toBeNull();
      fireEvent.click(
        within(rootCard as HTMLElement).getByRole('button', {
          name: /^スレッドを開く/,
        }),
      );
      const replyCard = await waitFor(() => {
        const card = document.querySelector<HTMLElement>(
          `[data-thread-message-id="${reply.id}"]`,
        );
        expect(card).not.toBeNull();
        return card as HTMLElement;
      });
      fireEvent.click(
        within(replyCard).getByRole('button', {
          name: 'replyへ👍リアクション',
        }),
      );

      await waitFor(() =>
        expect(screen.queryByText('stale mutation search excerpt')).toBeNull(),
      );
      if (roomReadable) {
        expect(
          await screen.findByText('thread mutation room still readable'),
        ).toBeInTheDocument();
      } else {
        expect(
          await screen.findByText(
            'ルームを表示できません。権限を確認して再読み込みしてください。',
          ),
        ).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
      }
      expect(screen.queryByText(/private-detail|hidden/)).toBeNull();
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(
            ([path, init]) =>
              String(path).startsWith('/chat-rooms/room-1/messages?') &&
              (init?.method ?? 'GET') === 'GET',
          ).length,
      ).toBeGreaterThanOrEqual(2);
    },
  );

  it('keeps thread mutations locked until room revalidation fails closed', async () => {
    const roomRevalidation = deferred<ChatMessageTestValue[]>();
    const root = makeMessage({
      id: 'deferred-access-root',
      roomId: 'room-1',
      body: 'deferred access root',
      parentMessageId: null,
      threadRootId: null,
    });
    const reply = makeMessage({
      id: 'deferred-access-reply',
      roomId: 'room-1',
      body: 'deferred access reply',
      parentMessageId: root.id,
      threadRootId: root.id,
    });
    const thread = {
      root,
      replies: [reply],
      replyCount: 1,
      lastReplyAt: reply.createdAt,
      nextCursor: null,
    };
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [] },
      messageReadResultsByRoom: {
        'room-1': [[root], roomRevalidation.promise],
      },
      readMutationResultsByRoom: { 'room-1': [{}, {}] },
      threadResultsByMessageId: { [root.id]: [thread, thread] },
      globalSearchResultsByQuery: {
        'stale|': [makeSearchItem({ body: 'stale deferred search excerpt' })],
      },
      rootMutationErrors: {
        [`/chat-messages/${reply.id}/reactions`]: new Error(
          'Request failed: mutation unavailable (404) hidden',
        ),
      },
    });

    render(<RoomChat />);
    expect(await screen.findByText(root.body)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
      target: { value: 'stale' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    expect(
      await screen.findByText('stale deferred search excerpt'),
    ).toBeInTheDocument();
    const rootCard = document.getElementById(`chat-message-${root.id}`);
    expect(rootCard).not.toBeNull();
    fireEvent.click(
      within(rootCard as HTMLElement).getByRole('button', {
        name: /^スレッドを開く/,
      }),
    );
    const reaction = await waitFor(() => {
      const replyCard = document.querySelector<HTMLElement>(
        `[data-thread-message-id="${reply.id}"]`,
      );
      expect(replyCard).not.toBeNull();
      return within(replyCard as HTMLElement).getByRole('button', {
        name: 'replyへ👍リアクション',
      });
    });
    fireEvent.click(reaction);

    await waitFor(() => expect(reaction).toBeDisabled());
    expect(screen.queryByText('stale deferred search excerpt')).toBeNull();
    fireEvent.click(reaction);
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(
          ([path, init]) =>
            String(path) === `/chat-messages/${reply.id}/reactions` &&
            init?.method === 'POST',
        ),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) =>
          new URL(String(path), 'http://localhost').pathname.endsWith(
            '/thread',
          ),
        ),
    ).toHaveLength(1);

    await act(async () => {
      roomRevalidation.reject(
        new Error('Request failed: room revalidation (404) hidden'),
      );
      await roomRevalidation.promise.catch(() => undefined);
    });
    expect(
      await screen.findByText(
        'ルームを表示できません。権限を確認して再読み込みしてください。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
    expect(screen.queryByText(root.body)).toBeNull();
    expect(screen.queryByText(/hidden/)).toBeNull();
  });

  it('purges room state when the root timeline read mutation detects lost access', async () => {
    const root = makeMessage({
      id: 'root-read-access-root',
      roomId: 'room-1',
      body: 'root read access body',
    });
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [] },
      messageReadResultsByRoom: {
        'room-1': [
          [root],
          new Error('Request failed: room read revalidation (404) hidden'),
        ],
      },
      readMutationResultsByRoom: {
        'room-1': [new Error('Request failed: mark read (404) private-detail')],
      },
    });

    render(<RoomChat />);
    expect(
      await screen.findByText(
        'ルームを表示できません。権限を確認して再読み込みしてください。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(root.body)).toBeNull();
    expect(screen.queryByText(/private-detail|hidden/)).toBeNull();
  });

  it('purges thread, timeline, and search when thread read mutation detects lost access', async () => {
    const root = makeMessage({
      id: 'thread-read-access-root',
      roomId: 'room-1',
      body: 'thread read access root',
      parentMessageId: null,
      threadRootId: null,
    });
    const reply = makeMessage({
      id: 'thread-read-access-reply',
      roomId: 'room-1',
      body: 'thread read access reply',
      createdAt: '2026-03-28T00:01:00.000Z',
      parentMessageId: root.id,
      threadRootId: root.id,
    });
    installApiMock({
      rooms: [makeRoom({ id: 'room-1' })],
      messagesByRoom: { 'room-1': [] },
      messageReadResultsByRoom: {
        'room-1': [
          [root],
          new Error('Request failed: thread read revalidation (404) hidden'),
        ],
      },
      readMutationResultsByRoom: {
        'room-1': [
          {},
          new Error('Request failed: thread mark read (404) private-detail'),
        ],
      },
      threadsByMessageId: {
        [root.id]: {
          root,
          replies: [reply],
          replyCount: 1,
          lastReplyAt: reply.createdAt,
          nextCursor: null,
        },
      },
      globalSearchResultsByQuery: {
        'stale|': [makeSearchItem({ body: 'stale read-state search excerpt' })],
      },
    });

    render(<RoomChat />);
    expect(await screen.findByText(root.body)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
      target: { value: 'stale' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    expect(
      await screen.findByText('stale read-state search excerpt'),
    ).toBeInTheDocument();
    const rootCard = document.getElementById(`chat-message-${root.id}`);
    expect(rootCard).not.toBeNull();
    fireEvent.click(
      within(rootCard as HTMLElement).getByRole('button', {
        name: /^スレッドを開く/,
      }),
    );

    expect(
      await screen.findByText(
        'ルームを表示できません。権限を確認して再読み込みしてください。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'スレッド' })).toBeNull();
    expect(screen.queryByText(root.body)).toBeNull();
    expect(screen.queryByText('stale read-state search excerpt')).toBeNull();
    expect(screen.queryByText(/private-detail|hidden/)).toBeNull();
  });

  it.each([
    { status: 403, roomReadable: true },
    { status: 404, roomReadable: false },
  ])(
    'revalidates room state after attachment download $status (roomReadable=$roomReadable)',
    async ({ status, roomReadable }) => {
      const attached = makeMessage({
        id: 'attachment-root',
        roomId: 'room-1',
        body: 'attachment root before revalidation',
        attachments: [
          {
            id: 'attachment-1',
            originalName: 'synthetic.txt',
            mimeType: 'text/plain',
            sizeBytes: 12,
            createdAt: '2026-08-09T00:00:00.000Z',
          },
        ],
      });
      const latest = makeMessage({
        id: 'attachment-latest',
        roomId: 'room-1',
        body: 'attachment room still readable',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [] },
        messageReadResultsByRoom: {
          'room-1': [
            [attached],
            roomReadable
              ? [latest]
              : new Error('Request failed: room unavailable (404) hidden'),
          ],
        },
        globalSearchResultsByQuery: {
          'stale|': [
            makeSearchItem({ body: 'stale attachment search excerpt' }),
          ],
        },
      });
      vi.mocked(apiResponse).mockResolvedValueOnce(
        new Response('providerKey=must-not-be-read', { status }),
      );

      render(<RoomChat />);
      expect(
        await screen.findByText('attachment root before revalidation'),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
        target: { value: 'stale' },
      });
      fireEvent.click(screen.getByRole('button', { name: '検索' }));
      expect(
        await screen.findByText('stale attachment search excerpt'),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', {
          name: '添付をダウンロード:synthetic.txt',
        }),
      );

      await waitFor(() =>
        expect(
          screen.queryByText('stale attachment search excerpt'),
        ).toBeNull(),
      );
      if (roomReadable) {
        expect(
          await screen.findByText('attachment room still readable'),
        ).toBeInTheDocument();
        expect(
          await screen.findByText('添付のダウンロードに失敗しました'),
        ).toBeInTheDocument();
      } else {
        expect(
          await screen.findByText(
            'ルームを表示できません。権限を確認して再読み込みしてください。',
          ),
        ).toBeInTheDocument();
      }
      expect(
        screen.queryByText(/providerKey|must-not-be-read|hidden/),
      ).toBeNull();
    },
  );

  it.each([
    { status: 403, roomReadable: true },
    { status: 404, roomReadable: false },
  ])(
    'revalidates room state after attachment upload $status (roomReadable=$roomReadable)',
    async ({ status, roomReadable }) => {
      const initial = makeMessage({
        id: 'upload-root',
        roomId: 'room-1',
        body: 'upload room before revalidation',
      });
      const latest = makeMessage({
        id: 'upload-latest',
        roomId: 'room-1',
        body: 'upload room still readable',
      });
      installApiMock({
        rooms: [makeRoom({ id: 'room-1' })],
        messagesByRoom: { 'room-1': [] },
        messageReadResultsByRoom: {
          'room-1': [
            [initial],
            roomReadable
              ? [latest]
              : new Error('Request failed: room unavailable (404) hidden'),
          ],
        },
        globalSearchResultsByQuery: {
          'stale|': [makeSearchItem({ body: 'stale upload search excerpt' })],
        },
        rootMutationErrors: {
          '/chat-messages/posted-message/attachments': new Error(
            `Request failed: attachment unavailable (${status}) private-detail`,
          ),
        },
      });

      render(<RoomChat />);
      expect(
        await screen.findByText('upload room before revalidation'),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('横断検索（本文）'), {
        target: { value: 'stale' },
      });
      fireEvent.click(screen.getByRole('button', { name: '検索' }));
      expect(
        await screen.findByText('stale upload search excerpt'),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('Markdownで入力'), {
        target: { value: 'root with access-sensitive attachment' },
      });
      fireEvent.change(screen.getByLabelText('添付ファイル'), {
        target: {
          files: [
            new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' }),
          ],
        },
      });
      fireEvent.click(screen.getByRole('button', { name: '送信' }));

      await waitFor(() =>
        expect(screen.queryByText('stale upload search excerpt')).toBeNull(),
      );
      if (roomReadable) {
        expect(
          await screen.findByText('upload room still readable'),
        ).toBeInTheDocument();
      } else {
        expect(
          await screen.findByText(
            'ルームを表示できません。権限を確認して再読み込みしてください。',
          ),
        ).toBeInTheDocument();
      }
      expect(
        await screen.findByText(
          'メッセージは投稿されましたが添付結果を確認できません。メッセージを再送せず、再読み込みしてください',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/private-detail|hidden/)).toBeNull();
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(
            ([path, init]) =>
              String(path) === '/chat-rooms/room-1/messages' &&
              init?.method === 'POST',
          ),
      ).toHaveLength(1);
    },
  );
}
