import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  commitKnowledgeThreadPromotion,
  createKnowledgeShareRequestKey,
  previewKnowledgeThreadPromotion,
} = vi.hoisted(() => ({
  commitKnowledgeThreadPromotion: vi.fn(),
  createKnowledgeShareRequestKey: vi.fn(() => 'memory-only-request-key'),
  previewKnowledgeThreadPromotion: vi.fn(),
}));

vi.mock('../knowledge-share/knowledgeShareApi', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../knowledge-share/knowledgeShareApi')
  >()),
  commitKnowledgeThreadPromotion,
  createKnowledgeShareRequestKey,
  previewKnowledgeThreadPromotion,
}));

import type {
  KnowledgeShareRoomCard,
  KnowledgeThreadPromotionPreview,
  KnowledgeThreadPromotionRequest,
} from '../knowledge-share/knowledgeShareModel';
import type { ChatMessage } from './roomChatModel';
import { KnowledgeThreadPromotionDialog } from './KnowledgeThreadPromotionDialog';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function message(
  id: string,
  body: string | null,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
    userId: `user-${id}`,
    body,
    createdAt: '2026-08-10T01:00:00.000Z',
    deleted: false,
    deletedAt: null,
    deletedReason: null,
    ...overrides,
  };
}

function root(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message('root-1', 'generic fallback', {
    parentMessageId: null,
    threadRootId: null,
    ...overrides,
  });
}

function knowledgeShare(): KnowledgeShareRoomCard {
  return {
    shareId: 'share-1',
    status: 'posted',
    version: 2,
    schemaVersion: 1,
    canOpenSource: false,
    card: {
      schemaVersion: 1,
      title: 'Shared title',
      sourceType: null,
      canonicalUrl: null,
      snapshot: null,
      sharerNote: null,
      labels: [],
      annotations: [],
      turns: [],
      syntheses: [],
      selectedCategories: ['title'],
      omittedCategories: [
        'source_type',
        'canonical_url',
        'snapshot_provenance',
        'snapshot_excerpt',
        'label',
        'annotation',
        'conversation_turn',
        'synthesis',
        'sharer_note',
      ],
    },
  };
}

function previewFor(
  request: KnowledgeThreadPromotionRequest,
): KnowledgeThreadPromotionPreview {
  const organization = request.destination.scope === 'organization';
  return {
    sourceThread: {
      roomName: '設計ルーム',
      roomType: 'private_group',
      replyCount: 3,
    },
    selectedMessages: request.selectedReplyMessageIds.map((id, ordinal) => ({
      ordinal,
      content: `preview:${id}`,
      createdAt: '2026-08-10T01:00:00.000Z',
      authorCategory: 'user',
    })),
    selectedMessageCount: request.selectedReplyMessageIds.length,
    omittedMessageCount: 3 - request.selectedReplyMessageIds.length,
    sharedCard: request.includeSharedCard
      ? { ...knowledgeShare().card!, shareVersion: 2 }
      : null,
    destination: {
      scope: request.destination.scope,
      organizationGroupCount:
        request.destination.organizationGroupAccountIds.length,
    },
    synthesis: request.synthesis,
    previewToken: 'memory-only-preview-token',
    expiresAt: '2026-08-10T01:10:00.000Z',
    requiresConfirmation: true,
    requiresOrganizationAudienceConfirmation: organization,
  };
}

const activeReplies = [
  message('reply-1', 'active reply one'),
  message('reply-deleted', 'deleted provider/internal secret', {
    deleted: true,
    deletedAt: '2026-08-10T01:01:00.000Z',
    deletedReason: 'user_retract',
  }),
  message('reply-2', 'active reply two'),
  message('nested', 'not a direct reply', {
    parentMessageId: 'reply-1',
    threadRootId: 'root-1',
  }),
];

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof KnowledgeThreadPromotionDialog>
  > = {},
) {
  const props: React.ComponentProps<typeof KnowledgeThreadPromotionDialog> = {
    open: true,
    roomId: 'room-1',
    root: root(),
    replies: activeReplies,
    knowledgeShare: knowledgeShare(),
    onClose: vi.fn(),
    onCommitted: vi.fn(),
    ...overrides,
  };
  return { ...render(<KnowledgeThreadPromotionDialog {...props} />), props };
}

function fillRequiredDraft() {
  fireEvent.change(screen.getByLabelText('ナレッジ化タイトル'), {
    target: { value: 'Promotion title' },
  });
  fireEvent.change(screen.getByLabelText('ナレッジ化内容'), {
    target: { value: 'Selected replies synthesis.' },
  });
  fireEvent.change(screen.getByLabelText('確信度'), {
    target: { value: '75.25' },
  });
  fireEvent.change(screen.getByLabelText('未解決の質問'), {
    target: { value: 'Question one\nQuestion two' },
  });
}

describe('KnowledgeThreadPromotionDialog', () => {
  beforeEach(() => {
    commitKnowledgeThreadPromotion.mockReset();
    createKnowledgeShareRequestKey.mockReset();
    createKnowledgeShareRequestKey.mockReturnValue('memory-only-request-key');
    previewKnowledgeThreadPromotion.mockReset();
  });

  afterEach(() => cleanup());

  it('starts unselected, excludes inactive replies, and previews explicit order', async () => {
    previewKnowledgeThreadPromotion.mockImplementation(
      ({ request }: { request: KnowledgeThreadPromotionRequest }) =>
        Promise.resolve(previewFor(request)),
    );
    renderDialog();

    const first = screen.getByRole('checkbox', { name: '返信 1を選択' });
    const second = screen.getByRole('checkbox', { name: '返信 2を選択' });
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    expect(screen.queryByText('not a direct reply')).toBeNull();
    expect(screen.queryByText('deleted provider/internal secret')).toBeNull();
    expect(screen.getByRole('radio', { name: /personal/ })).toBeChecked();

    fireEvent.click(second);
    fireEvent.click(first);
    fireEvent.click(
      screen.getByRole('button', { name: '返信 1を保存順で上へ移動' }),
    );
    fillRequiredDraft();
    fireEvent.click(
      screen.getByRole('checkbox', { name: '共有カードの選択内容も含める' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );

    await screen.findByRole('heading', { name: 'ナレッジ化プレビュー' });
    const request = previewKnowledgeThreadPromotion.mock.calls[0]?.[0].request;
    expect(request).toEqual({
      selectedReplyMessageIds: ['reply-1', 'reply-2'],
      includeSharedCard: true,
      destination: { scope: 'personal', organizationGroupAccountIds: [] },
      synthesis: {
        title: 'Promotion title',
        content: 'Selected replies synthesis.',
        confidenceBasisPoints: 7525,
        unresolvedQuestions: ['Question one', 'Question two'],
      },
    });
    expect(previewKnowledgeThreadPromotion.mock.calls[0]?.[1]).toEqual({
      signal: expect.any(AbortSignal),
    });
    expect(
      previewKnowledgeThreadPromotion.mock.calls[0]?.[0].expectedReplies,
    ).toEqual([
      {
        messageId: 'reply-1',
        content: activeReplies[0]?.body,
        createdAt: activeReplies[0]?.createdAt,
      },
      {
        messageId: 'reply-2',
        content: activeReplies[2]?.body,
        createdAt: activeReplies[2]?.createdAt,
      },
    ]);
    expect(screen.queryByText('memory-only-preview-token')).toBeNull();
    expect(screen.queryByText('memory-only-request-key')).toBeNull();
    expect(screen.getByText('Shared title')).toBeVisible();
  });

  it('rejects preview while no reply is selected', () => {
    renderDialog();
    fillRequiredDraft();
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '返信を1件以上選択してください。',
    );
    expect(previewKnowledgeThreadPromotion).not.toHaveBeenCalled();
  });

  it('requires organization grants and an additional explicit confirmation', async () => {
    previewKnowledgeThreadPromotion.mockImplementation(
      ({ request }: { request: KnowledgeThreadPromotionRequest }) =>
        Promise.resolve(previewFor(request)),
    );
    commitKnowledgeThreadPromotion.mockResolvedValueOnce({
      promotionId: 'private-promotion-id',
      synthesisId: 'private-synthesis-id',
      synthesisVersionId: 'private-version-id',
      synthesisVersion: 1,
      scope: 'organization',
      selectedMessageCount: 1,
      includesSharedCard: false,
      createdAt: '2026-08-10T01:00:00.000Z',
      created: false,
      reused: true,
    });
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: '返信 1を選択' }));
    fillRequiredDraft();
    fireEvent.click(screen.getByRole('radio', { name: /organization/ }));
    fireEvent.change(screen.getByLabelText('組織共有グループID'), {
      target: { value: 'group-b, group-a' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );

    const confirmation = await screen.findByRole('checkbox', {
      name: '指定した組織グループへ追加共有されることを確認しました',
    });
    const commit = screen.getByRole('button', { name: 'ナレッジ化を確定' });
    expect(commit).toBeDisabled();
    fireEvent.click(confirmation);
    expect(commit).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '選択・省略・保存内容を確認しました',
      }),
    );
    expect(commit).toBeEnabled();
    fireEvent.click(commit);

    await waitFor(() =>
      expect(commitKnowledgeThreadPromotion).toHaveBeenCalledTimes(1),
    );
    expect(commitKnowledgeThreadPromotion).toHaveBeenCalledWith({
      rootMessageId: 'root-1',
      request: expect.objectContaining({
        destination: {
          scope: 'organization',
          organizationGroupAccountIds: ['group-a', 'group-b'],
        },
      }),
      previewToken: 'memory-only-preview-token',
      requestKey: 'memory-only-request-key',
      organizationAudienceConfirmed: true,
    });
    expect(
      await screen.findByText('同一内容の既存ナレッジ統合を再利用しました。'),
    ).toBeVisible();
    expect(screen.queryByText('private-promotion-id')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'ナレッジ化結果と来歴' }),
    ).toBeVisible();
    expect(screen.getByText('既存結果を再利用')).toBeVisible();
    expect(props.onCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ reused: true }),
    );
  });

  it('aborts and discards a stale preview when the draft changes', async () => {
    const pending = deferred<KnowledgeThreadPromotionPreview>();
    let signal: AbortSignal | undefined;
    previewKnowledgeThreadPromotion.mockImplementation(
      (
        { request }: { request: KnowledgeThreadPromotionRequest },
        options: { signal?: AbortSignal },
      ) => {
        signal = options.signal;
        void request;
        return pending.promise;
      },
    );
    renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: '返信 1を選択' }));
    fillRequiredDraft();
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );
    await waitFor(() => expect(signal).toBeDefined());

    fireEvent.change(screen.getByLabelText('ナレッジ化タイトル'), {
      target: { value: 'Changed title' },
    });
    expect(signal?.aborted).toBe(true);
    pending.resolve(
      previewFor({
        selectedReplyMessageIds: ['reply-1'],
        includeSharedCard: false,
        destination: { scope: 'personal', organizationGroupAccountIds: [] },
        synthesis: {
          title: 'Promotion title',
          content: 'Selected replies synthesis.',
          confidenceBasisPoints: 7525,
          unresolvedQuestions: ['Question one', 'Question two'],
        },
      }),
    );
    await pending.promise;
    expect(
      screen.queryByRole('heading', { name: 'ナレッジ化プレビュー' }),
    ).toBeNull();
  });

  it('purges preview, request key, and selection on a room/root switch', async () => {
    previewKnowledgeThreadPromotion.mockImplementation(
      ({ request }: { request: KnowledgeThreadPromotionRequest }) =>
        Promise.resolve(previewFor(request)),
    );
    const view = renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: '返信 1を選択' }));
    fillRequiredDraft();
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );
    await screen.findByRole('heading', { name: 'ナレッジ化プレビュー' });

    view.rerender(
      <KnowledgeThreadPromotionDialog
        {...view.props}
        roomId="room-2"
        root={root({ id: 'root-2', roomId: 'room-2' })}
        replies={[]}
      />,
    );

    expect(
      screen.queryByRole('heading', { name: 'ナレッジ化プレビュー' }),
    ).toBeNull();
    expect(screen.queryByText('memory-only-preview-token')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      '選択できる返信はありません',
    );
  });

  it('invalidates in-memory preview state when the posted card changes', async () => {
    previewKnowledgeThreadPromotion.mockImplementation(
      ({ request }: { request: KnowledgeThreadPromotionRequest }) =>
        Promise.resolve(previewFor(request)),
    );
    const view = renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: '返信 1を選択' }));
    fillRequiredDraft();
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );
    await screen.findByRole('heading', { name: 'ナレッジ化プレビュー' });
    const changedShare = knowledgeShare();
    changedShare.card = {
      ...changedShare.card!,
      title: 'Changed immutable card',
    };

    view.rerender(
      <KnowledgeThreadPromotionDialog
        {...view.props}
        knowledgeShare={changedShare}
      />,
    );

    expect(
      screen.queryByRole('heading', { name: 'ナレッジ化プレビュー' }),
    ).toBeNull();
    expect(
      screen.getByRole('checkbox', { name: '返信 1を選択' }),
    ).not.toBeChecked();
    expect(document.body).not.toHaveTextContent('memory-only-preview-token');
  });

  it('does not automatically retry a failed commit and hides raw errors', async () => {
    previewKnowledgeThreadPromotion.mockImplementation(
      ({ request }: { request: KnowledgeThreadPromotionRequest }) =>
        Promise.resolve(previewFor(request)),
    );
    commitKnowledgeThreadPromotion.mockRejectedValueOnce(
      new Error(
        'raw provider token, internal URL, request key, and database stack',
      ),
    );
    renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: '返信 1を選択' }));
    fillRequiredDraft();
    fireEvent.click(
      screen.getByRole('button', { name: 'ナレッジ化内容をプレビュー' }),
    );
    const previewSection = (
      await screen.findByRole('heading', { name: 'ナレッジ化プレビュー' })
    ).closest('section') as HTMLElement;
    fireEvent.click(
      within(previewSection).getByRole('checkbox', {
        name: '選択・省略・保存内容を確認しました',
      }),
    );
    fireEvent.click(
      within(previewSection).getByRole('button', { name: 'ナレッジ化を確定' }),
    );

    expect(
      await screen.findByText(
        'ナレッジ化の処理に失敗しました。入力と権限を確認してください。',
      ),
    ).toBeVisible();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(commitKnowledgeThreadPromotion).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/raw provider|internal URL|database stack/),
    ).toBeNull();
    expect(
      within(previewSection).getByRole('button', {
        name: '同じ操作識別子で確定を再実行',
      }),
    ).toBeDisabled();
  });

  it('provides modal focus, mobile width, and Escape close behavior', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const { props } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'スレッドをナレッジ化' });

    expect(dialog).toHaveStyle({ width: '100vw', maxWidth: '720px' });
    expect(
      screen.getByRole('button', { name: 'ナレッジ化ダイアログを閉じる' }),
    ).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});
