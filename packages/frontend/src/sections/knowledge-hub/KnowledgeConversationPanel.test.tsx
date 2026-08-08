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

const apiMocks = vi.hoisted(() => ({
  commitKnowledgeConversationImport: vi.fn(),
  listKnowledgeConversations: vi.fn(),
  listKnowledgeConversationTurns: vi.fn(),
  previewKnowledgeConversationImport: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  createKnowledgeRequestKey: vi.fn(() => 'request-key-secret'),
}));

vi.mock('./knowledgeProvenanceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./knowledgeProvenanceApi')>()),
  ...apiMocks,
}));

vi.mock('./knowledgeHubModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./knowledgeHubModel')>()),
  ...modelMocks,
}));

import { KnowledgeConversationPanel } from './KnowledgeConversationPanel';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  buildManualKnowledgeConversation,
  encodeKnowledgeImportInput,
  KNOWLEDGE_IMPORT_MAX_BYTES,
  type KnowledgeConversation,
  type KnowledgeConversationImportPreview,
  type KnowledgeConversationSourceType,
  type KnowledgeConversationTurn,
} from './knowledgeProvenanceModel';

function makeConversation(
  overrides: Partial<KnowledgeConversation> = {},
): KnowledgeConversation {
  return {
    id: 'conversation-1',
    title: '関連会話',
    sourceType: 'manual',
    provider: null,
    model: null,
    capturedAt: '2026-08-08T01:00:00.000Z',
    importedAt: '2026-08-08T01:01:00.000Z',
    version: 1,
    createdAt: '2026-08-08T01:01:00.000Z',
    updatedAt: '2026-08-08T01:01:00.000Z',
    items: [
      {
        id: 'relation-1',
        knowledgeItemId: 'item-1',
        relationType: 'primary',
        ordinal: 0,
        createdAt: '2026-08-08T01:01:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeTurn(
  overrides: Partial<KnowledgeConversationTurn> = {},
): KnowledgeConversationTurn {
  return {
    id: 'turn-1',
    conversationId: 'conversation-1',
    sequence: 1,
    role: 'user',
    origin: 'user',
    content: '利用者の発言',
    name: null,
    occurredAt: '2026-08-08T01:02:00.000Z',
    createdAt: '2026-08-08T01:02:01.000Z',
    ...overrides,
  };
}

function makePreview(
  format: KnowledgeConversationSourceType = 'manual',
): KnowledgeConversationImportPreview {
  return {
    summary: {
      format,
      title: `${format} preview`,
      provider: format === 'manual' ? null : 'openai',
      model: format === 'manual' ? null : 'gpt',
      roles: ['user'],
      origins: ['user'],
      turnCount: 1,
      linkedItemCount: 1,
    },
    warnings: [],
    rejectedFields: [],
    previewToken: 'preview-token-secret',
    expiresAt: '2026-08-08T01:10:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

type TestPage<T> = { items: T[]; nextCursor: string | null };

function page<T>(items: T[], nextCursor: string | null = null): TestPage<T> {
  return { items, nextCursor };
}

async function fillManualAndPreview() {
  fireEvent.change(screen.getByLabelText('会話タイトル'), {
    target: { value: '手動会話' },
  });
  fireEvent.change(screen.getByLabelText('ターン本文'), {
    target: { value: '本人が入力した一件目の発言' },
  });
  fireEvent.click(screen.getByRole('button', { name: '取込内容をプレビュー' }));
  return screen.findByRole('heading', { name: '取込プレビュー' });
}

function expectAssociatedError(control: HTMLElement, message: string) {
  expect(control).toHaveAttribute('aria-invalid', 'true');
  const describedBy = control.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(
    describedBy
      ?.split(/\s+/)
      .some((id) => document.getElementById(id)?.textContent === message),
  ).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listKnowledgeConversations.mockResolvedValue(page([]));
  apiMocks.listKnowledgeConversationTurns.mockResolvedValue(page([]));
  apiMocks.previewKnowledgeConversationImport.mockResolvedValue(makePreview());
  apiMocks.commitKnowledgeConversationImport.mockResolvedValue({
    conversationId: 'conversation-created',
    created: true,
    reused: false,
    turnCount: 1,
    linkedItemCount: 1,
    result: 'created',
  });
  modelMocks.createKnowledgeRequestKey.mockReturnValue('request-key-secret');
});

afterEach(() => cleanup());

describe('KnowledgeConversationPanel', () => {
  it('previews a structured manual turn before an explicit commit', async () => {
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversations).toHaveBeenCalledTimes(1),
    );

    await fillManualAndPreview();

    const manualInput = buildManualKnowledgeConversation({
      title: '手動会話',
      role: 'user',
      origin: 'user',
      content: '本人が入力した一件目の発言',
      occurredAt: null,
    });
    const envelope = {
      format: 'manual',
      inputBase64: encodeKnowledgeImportInput(manualInput),
      linkedItems: [{ itemId: 'item-1', relationType: 'primary' }],
    };
    expect(apiMocks.previewKnowledgeConversationImport).toHaveBeenCalledWith(
      envelope,
    );
    expect(modelMocks.createKnowledgeRequestKey).toHaveBeenCalledTimes(1);
    expect(apiMocks.commitKnowledgeConversationImport).not.toHaveBeenCalled();
    expect(screen.getByText('主根拠')).toBeVisible();
    expect(screen.queryByText('preview-token-secret')).not.toBeInTheDocument();
    expect(screen.queryByText('request-key-secret')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));

    await waitFor(() =>
      expect(apiMocks.commitKnowledgeConversationImport).toHaveBeenCalledWith({
        ...envelope,
        previewToken: 'preview-token-secret',
        requestKey: 'request-key-secret',
      }),
    );
    expect(
      await screen.findByText('会話を取り込みました。1ターン、1項目。'),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: '取込プレビュー' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      format: 'json' as const,
      tab: 'JSON入力',
      label: 'JSON本文',
      raw: '{"title":"JSON会話","provider":null,"model":null,"turns":[{"role":"user","origin":"user","content":"JSON本文","name":null,"occurredAt":null}]}',
    },
    {
      format: 'markdown' as const,
      tab: '限定Markdown入力',
      label: '限定Markdown本文',
      raw: '# Knowledge Conversation v1\ntitle: Markdown会話\nprovider: null\nmodel: null\n\n## Turn\nrole: user\norigin: user\nname: null\noccurredAt: null\n\nMarkdown本文',
    },
  ])(
    '$format raw text is encoded for preview and committed only after confirmation',
    async ({ format, tab, label, raw }) => {
      apiMocks.previewKnowledgeConversationImport.mockResolvedValue(
        makePreview(format),
      );
      render(<KnowledgeConversationPanel itemId="item-1" />);
      await waitFor(() =>
        expect(apiMocks.listKnowledgeConversations).toHaveBeenCalled(),
      );

      fireEvent.click(screen.getByRole('tab', { name: tab }));
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: raw },
      });
      fireEvent.click(
        screen.getByRole('button', { name: '取込内容をプレビュー' }),
      );

      await screen.findByRole('heading', { name: '取込プレビュー' });
      const envelope = {
        format,
        inputBase64: encodeKnowledgeImportInput(raw),
        linkedItems: [{ itemId: 'item-1', relationType: 'primary' }],
      };
      expect(apiMocks.previewKnowledgeConversationImport).toHaveBeenCalledWith(
        envelope,
      );
      expect(apiMocks.commitKnowledgeConversationImport).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
      await waitFor(() =>
        expect(apiMocks.commitKnowledgeConversationImport).toHaveBeenCalledWith(
          {
            ...envelope,
            previewToken: 'preview-token-secret',
            requestKey: 'request-key-secret',
          },
        ),
      );
    },
  );

  it('reports a reused result as a duplicate without a second automatic commit', async () => {
    apiMocks.commitKnowledgeConversationImport.mockResolvedValue({
      conversationId: 'conversation-existing',
      created: false,
      reused: true,
      turnCount: 4,
      linkedItemCount: 1,
      result: 'reused',
    });
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await fillManualAndPreview();

    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));

    expect(
      await screen.findByText(
        '同じ内容の既存会話を再利用しました（重複取込）。4ターン、1項目。',
      ),
    ).toBeVisible();
    expect(apiMocks.commitKnowledgeConversationImport).toHaveBeenCalledTimes(1);
  });

  it('reuses one request key only when the user explicitly retries the same preview', async () => {
    apiMocks.commitKnowledgeConversationImport
      .mockRejectedValueOnce(new KnowledgeHubApiError('network_error', null))
      .mockResolvedValueOnce({
        conversationId: 'conversation-created',
        created: true,
        reused: false,
        turnCount: 1,
        linkedItemCount: 1,
        result: 'created',
      });
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await fillManualAndPreview();

    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect(
      await screen.findByText(
        'サーバーへ接続できませんでした。通信状態を確認してください。',
      ),
    ).toBeVisible();
    expect(apiMocks.commitKnowledgeConversationImport).toHaveBeenCalledTimes(1);
    expect(modelMocks.createKnowledgeRequestKey).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '取込確定を再試行' }));

    await screen.findByText('会話を取り込みました。1ターン、1項目。');
    expect(apiMocks.commitKnowledgeConversationImport).toHaveBeenCalledTimes(2);
    const firstInput =
      apiMocks.commitKnowledgeConversationImport.mock.calls[0][0];
    const secondInput =
      apiMocks.commitKnowledgeConversationImport.mock.calls[1][0];
    expect(firstInput.requestKey).toBe('request-key-secret');
    expect(secondInput.requestKey).toBe(firstInput.requestKey);
    expect(modelMocks.createKnowledgeRequestKey).toHaveBeenCalledTimes(1);
  });

  it('lists only linked conversations and renders inert text in a labelled provenance timeline', async () => {
    const linked = {
      ...makeConversation({
        provider: 'openai',
        model: 'gpt',
      }),
      providerUrl: 'https://private-provider.invalid/conversation',
      providerKey: 'provider-key-secret',
      rawContentHash: 'raw-hash-secret',
      actorId: 'actor-id-secret',
    } as KnowledgeConversation;
    const unrelated = makeConversation({
      id: 'conversation-other',
      title: '別項目だけの会話',
      items: [
        {
          id: 'relation-other',
          knowledgeItemId: 'item-other',
          relationType: 'supporting',
          ordinal: 0,
          createdAt: '2026-08-08T01:01:00.000Z',
        },
      ],
    });
    const inertText =
      '**太字ではない本文** [取得しないlink](https://example.invalid/) <script>実行しない</script>';
    const turns = [
      makeTurn(),
      makeTurn({
        id: 'turn-2',
        sequence: 2,
        role: 'assistant',
        origin: 'ai',
        content: inertText,
      }),
      makeTurn({
        id: 'turn-3',
        sequence: 3,
        role: 'system',
        origin: 'system',
        content: 'system provenance',
        occurredAt: null,
      }),
      {
        ...makeTurn({
          id: 'turn-4',
          sequence: 4,
          role: 'tool',
          origin: 'tool',
          name: 'search',
          content: 'tool provenance',
        }),
        providerKey: 'turn-provider-key-secret',
        actorId: 'turn-actor-id-secret',
        rawContentHash: 'turn-raw-hash-secret',
      } as KnowledgeConversationTurn,
    ];
    apiMocks.listKnowledgeConversations.mockResolvedValue(
      page([unrelated, linked]),
    );
    apiMocks.listKnowledgeConversationTurns.mockResolvedValue(page(turns));
    render(<KnowledgeConversationPanel itemId="item-1" />);

    const conversationButton = await screen.findByRole('button', {
      name: /関連会話/,
    });
    expect(screen.queryByText('別項目だけの会話')).not.toBeInTheDocument();
    expect(screen.getByLabelText('relation 主根拠')).toBeVisible();
    expect(apiMocks.listKnowledgeConversationTurns).not.toHaveBeenCalled();

    fireEvent.click(conversationButton);

    const timeline = await screen.findByRole('list', {
      name: '会話タイムライン',
    });
    expect(apiMocks.listKnowledgeConversationTurns).toHaveBeenCalledWith(
      'conversation-1',
      null,
    );
    expect(within(timeline).getByLabelText('role User')).toBeVisible();
    expect(within(timeline).getByLabelText('origin 本人')).toBeVisible();
    expect(within(timeline).getByLabelText('role AI Assistant')).toBeVisible();
    expect(within(timeline).getByLabelText('origin AI')).toBeVisible();
    expect(within(timeline).getByLabelText('role System')).toBeVisible();
    expect(within(timeline).getByLabelText('origin System')).toBeVisible();
    expect(within(timeline).getByLabelText('role Tool')).toBeVisible();
    expect(within(timeline).getByLabelText('origin Tool')).toBeVisible();
    expect(within(timeline).getAllByText('発生日時')).toHaveLength(4);
    expect(within(timeline).getByText('記録なし')).toBeVisible();
    expect(within(timeline).getByText(inertText)).toBeVisible();
    expect(within(timeline).queryByRole('link')).not.toBeInTheDocument();
    for (const secret of [
      'https://private-provider.invalid/conversation',
      'provider-key-secret',
      'raw-hash-secret',
      'actor-id-secret',
      'turn-provider-key-secret',
      'turn-actor-id-secret',
      'turn-raw-hash-secret',
    ]) {
      expect(screen.queryByText(secret)).not.toBeInTheDocument();
    }
  });

  it('keeps global conversation pagination available when the first page has no item match and merges later pages without duplicates', async () => {
    const unrelated = makeConversation({
      id: 'conversation-unrelated',
      title: '別項目の会話',
      items: [
        {
          id: 'relation-unrelated',
          knowledgeItemId: 'item-other',
          relationType: 'context',
          ordinal: 0,
          createdAt: '2026-08-08T01:01:00.000Z',
        },
      ],
    });
    const firstLinked = makeConversation({
      id: 'conversation-linked-1',
      title: '二ページ目の会話',
    });
    const secondLinked = makeConversation({
      id: 'conversation-linked-2',
      title: '三ページ目の会話',
    });
    apiMocks.listKnowledgeConversations.mockImplementation(
      (cursor: string | null) => {
        if (cursor === null)
          return Promise.resolve(page([unrelated], 'page-2'));
        if (cursor === 'page-2') {
          return Promise.resolve(page([firstLinked], 'page-3'));
        }
        return Promise.resolve(page([firstLinked, secondLinked]));
      },
    );

    render(<KnowledgeConversationPanel itemId="item-1" />);

    expect(
      await screen.findByText(
        '現在読み込んだ範囲には、この項目に関連する会話がありません。',
      ),
    ).toBeVisible();
    const loadMore = screen.getByRole('button', {
      name: '関連する会話をさらに読み込む',
    });
    fireEvent.click(loadMore);

    expect(
      await screen.findByRole('button', { name: /二ページ目の会話/ }),
    ).toBeVisible();
    expect(screen.queryByText('別項目の会話')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: '関連する会話をさらに読み込む',
      }),
    );

    expect(
      await screen.findByRole('button', { name: /三ページ目の会話/ }),
    ).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: /二ページ目の会話/ }),
    ).toHaveLength(1);
    expect(apiMocks.listKnowledgeConversations.mock.calls).toEqual([
      [null],
      ['page-2'],
      ['page-3'],
    ]);
  });

  it('loads and orders all 200 conversation turns across cursor pages', async () => {
    const conversation = makeConversation();
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      makeTurn({
        id: `turn-${index + 1}`,
        sequence: index + 1,
        content: `本文 ${index + 1}`,
      }),
    );
    const secondPage = Array.from({ length: 100 }, (_, index) =>
      makeTurn({
        id: `turn-${index + 101}`,
        sequence: index + 101,
        content: `本文 ${index + 101}`,
      }),
    );
    apiMocks.listKnowledgeConversations.mockResolvedValue(page([conversation]));
    apiMocks.listKnowledgeConversationTurns.mockImplementation(
      (_conversationId: string, cursor: string | null) =>
        cursor === null
          ? Promise.resolve(page(firstPage, 'turn-page-2'))
          : Promise.resolve(page(secondPage)),
    );
    render(<KnowledgeConversationPanel itemId="item-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /関連会話/ }));
    expect(await screen.findByText('本文 100')).toBeVisible();
    expect(screen.queryByText('本文 101')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '会話ターンをさらに読み込む' }),
    );

    expect(await screen.findByText('本文 200')).toBeVisible();
    expect(
      within(
        screen.getByRole('list', { name: '会話タイムライン' }),
      ).getAllByRole('article'),
    ).toHaveLength(200);
    expect(apiMocks.listKnowledgeConversationTurns.mock.calls).toEqual([
      ['conversation-1', null],
      ['conversation-1', 'turn-page-2'],
    ]);
  });

  it('sanitizes preview expiry and raw errors without retaining an expired preview', async () => {
    apiMocks.commitKnowledgeConversationImport.mockRejectedValueOnce(
      new KnowledgeHubApiError('preview_token_expired', 409),
    );
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await fillManualAndPreview();

    fireEvent.click(screen.getByRole('button', { name: '取込を確定' }));
    expect(
      await screen.findByText(
        '取込プレビューの有効期限が切れました。もう一度プレビューしてください。',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: '取込プレビュー' }),
    ).not.toBeInTheDocument();

    apiMocks.previewKnowledgeConversationImport.mockRejectedValueOnce(
      new Error(
        'raw provider failure: https://provider.invalid/?key=do-not-display',
      ),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '取込内容をプレビュー' }),
    );

    expect(
      await screen.findByText(
        '処理を完了できませんでした。再試行してください。',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/provider\.invalid/)).not.toBeInTheDocument();
    expect(screen.queryByText(/do-not-display/)).not.toBeInTheDocument();
  });

  it.each([
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)(
    'maps %s/%s conversation list errors to the same disclosure-safe message',
    async (code, status) => {
      apiMocks.listKnowledgeConversations.mockRejectedValue(
        new KnowledgeHubApiError(code, status),
      );
      render(<KnowledgeConversationPanel itemId="item-1" />);

      expect(
        await screen.findByText(
          '対象が見つからないか、現在の権限では参照できません。',
        ),
      ).toBeVisible();
    },
  );

  it('discards a stale conversation list after the selected item changes', async () => {
    const oldRequest = deferred<TestPage<KnowledgeConversation>>();
    const newRequest = deferred<TestPage<KnowledgeConversation>>();
    apiMocks.listKnowledgeConversations
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const { rerender } = render(
      <KnowledgeConversationPanel itemId="item-old" />,
    );
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversations).toHaveBeenCalledTimes(1),
    );

    rerender(<KnowledgeConversationPanel itemId="item-new" />);
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversations).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      newRequest.resolve(
        page([
          makeConversation({
            id: 'conversation-new',
            title: '新項目の会話',
            items: [
              {
                id: 'relation-new',
                knowledgeItemId: 'item-new',
                relationType: 'primary',
                ordinal: 0,
                createdAt: '2026-08-08T01:01:00.000Z',
              },
            ],
          }),
        ]),
      );
    });
    expect(
      await screen.findByRole('button', { name: /新項目の会話/ }),
    ).toBeVisible();

    await act(async () => {
      oldRequest.resolve(
        page([
          makeConversation({
            id: 'conversation-old',
            title: '旧項目の会話',
            items: [
              {
                id: 'relation-old',
                knowledgeItemId: 'item-old',
                relationType: 'primary',
                ordinal: 0,
                createdAt: '2026-08-08T01:01:00.000Z',
              },
            ],
          }),
        ]),
      );
    });
    expect(screen.queryByText('旧項目の会話')).not.toBeInTheDocument();
    expect(screen.getByText('新項目の会話')).toBeVisible();
  });

  it('discards stale turns when another conversation is selected', async () => {
    const firstTurns = deferred<TestPage<KnowledgeConversationTurn>>();
    const secondTurns = deferred<TestPage<KnowledgeConversationTurn>>();
    const first = makeConversation({
      id: 'conversation-first',
      title: '先に選ぶ会話',
    });
    const second = makeConversation({
      id: 'conversation-second',
      title: '後から選ぶ会話',
    });
    apiMocks.listKnowledgeConversations.mockResolvedValue(
      page([first, second]),
    );
    apiMocks.listKnowledgeConversationTurns.mockImplementation(
      (conversationId: string) =>
        conversationId === 'conversation-first'
          ? firstTurns.promise
          : secondTurns.promise,
    );
    render(<KnowledgeConversationPanel itemId="item-1" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /先に選ぶ会話/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: /後から選ぶ会話/ }));

    await act(async () => {
      secondTurns.resolve(
        page([
          makeTurn({
            id: 'turn-second',
            conversationId: 'conversation-second',
            content: '新しい選択の本文',
          }),
        ]),
      );
    });
    expect(await screen.findByText('新しい選択の本文')).toBeVisible();

    await act(async () => {
      firstTurns.resolve(
        page([
          makeTurn({
            id: 'turn-first',
            conversationId: 'conversation-first',
            content: '古い応答の本文',
          }),
        ]),
      );
    });
    expect(screen.queryByText('古い応答の本文')).not.toBeInTheDocument();
    expect(screen.getByText('新しい選択の本文')).toBeVisible();
  });

  it('discards an in-flight conversation page after the selected item changes', async () => {
    const oldMore = deferred<TestPage<KnowledgeConversation>>();
    const oldConversation = makeConversation({
      id: 'conversation-old-first',
      title: '旧項目の先頭会話',
      items: [
        {
          id: 'relation-old-first',
          knowledgeItemId: 'item-old',
          relationType: 'primary',
          ordinal: 0,
          createdAt: '2026-08-08T01:01:00.000Z',
        },
      ],
    });
    const newConversation = makeConversation({
      id: 'conversation-new',
      title: '新項目の会話',
      items: [
        {
          id: 'relation-new',
          knowledgeItemId: 'item-new',
          relationType: 'primary',
          ordinal: 0,
          createdAt: '2026-08-08T01:01:00.000Z',
        },
      ],
    });
    apiMocks.listKnowledgeConversations
      .mockResolvedValueOnce(page([oldConversation], 'old-page-2'))
      .mockReturnValueOnce(oldMore.promise)
      .mockResolvedValueOnce(page([newConversation]));
    const { rerender } = render(
      <KnowledgeConversationPanel itemId="item-old" />,
    );

    await screen.findByRole('button', { name: /旧項目の先頭会話/ });
    fireEvent.click(
      screen.getByRole('button', {
        name: '関連する会話をさらに読み込む',
      }),
    );
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversations).toHaveBeenCalledTimes(2),
    );

    rerender(<KnowledgeConversationPanel itemId="item-new" />);
    expect(
      await screen.findByRole('button', { name: /新項目の会話/ }),
    ).toBeVisible();

    await act(async () => {
      oldMore.resolve(
        page([
          makeConversation({
            id: 'conversation-old-late',
            title: '遅延した旧項目の会話',
            items: [
              {
                id: 'relation-old-late',
                knowledgeItemId: 'item-old',
                relationType: 'supporting',
                ordinal: 1,
                createdAt: '2026-08-08T01:02:00.000Z',
              },
            ],
          }),
        ]),
      );
    });
    expect(screen.queryByText('遅延した旧項目の会話')).not.toBeInTheDocument();
    expect(screen.getByText('新項目の会話')).toBeVisible();
  });

  it('does not update state after unmount while a turn request is pending', async () => {
    const pendingTurns = deferred<TestPage<KnowledgeConversationTurn>>();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    apiMocks.listKnowledgeConversations.mockResolvedValue(
      page([makeConversation()]),
    );
    apiMocks.listKnowledgeConversationTurns.mockReturnValue(
      pendingTurns.promise,
    );
    const { unmount } = render(<KnowledgeConversationPanel itemId="item-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /関連会話/ }));
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversationTurns).toHaveBeenCalledTimes(1),
    );
    unmount();

    await act(async () => {
      pendingTurns.resolve(page([makeTurn({ content: 'unmounted response' })]));
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('associates manual, JSON, and Markdown validation errors with their fields', async () => {
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversations).toHaveBeenCalled(),
    );
    const previewButton = screen.getByRole('button', {
      name: '取込内容をプレビュー',
    });

    fireEvent.click(previewButton);
    expectAssociatedError(
      screen.getByLabelText('会話タイトル'),
      '会話タイトルを入力してください。',
    );

    fireEvent.change(screen.getByLabelText('会話タイトル'), {
      target: { value: 'validation test' },
    });
    fireEvent.click(previewButton);
    expectAssociatedError(
      screen.getByLabelText('ターン本文'),
      'ターン本文を入力してください。',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'JSON入力' }));
    fireEvent.click(previewButton);
    expectAssociatedError(
      screen.getByLabelText('JSON本文'),
      'JSON本文を入力してください。',
    );

    fireEvent.click(screen.getByRole('tab', { name: '限定Markdown入力' }));
    fireEvent.click(previewButton);
    expectAssociatedError(
      screen.getByLabelText('限定Markdown本文'),
      '限定Markdown本文を入力してください。',
    );
    expect(apiMocks.previewKnowledgeConversationImport).not.toHaveBeenCalled();
  });

  it('invalidates a preview when input changes and rejects oversized Markdown locally', async () => {
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await fillManualAndPreview();

    fireEvent.change(screen.getByLabelText('会話タイトル'), {
      target: { value: '変更後タイトル' },
    });
    expect(
      screen.queryByRole('heading', { name: '取込プレビュー' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '取込を確定' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '限定Markdown入力' }));
    fireEvent.change(screen.getByLabelText('限定Markdown本文'), {
      target: { value: 'a'.repeat(KNOWLEDGE_IMPORT_MAX_BYTES + 1) },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '取込内容をプレビュー' }),
    );

    expect(
      within(await screen.findByRole('alert')).getByText(
        '取込本文はUTF-8で512 KiB以内にしてください。',
      ),
    ).toBeVisible();
    expectAssociatedError(
      screen.getByLabelText('限定Markdown本文'),
      '取込本文はUTF-8で512 KiB以内にしてください。',
    );
    expect(apiMocks.previewKnowledgeConversationImport).toHaveBeenCalledTimes(
      1,
    );
  });

  it('provides labelled controls and keyboard navigation for import tabs', async () => {
    render(<KnowledgeConversationPanel itemId="item-1" />);
    await waitFor(() =>
      expect(apiMocks.listKnowledgeConversations).toHaveBeenCalled(),
    );

    const tabList = screen.getByRole('tablist', { name: '会話取込形式' });
    const manualTab = within(tabList).getByRole('tab', { name: '手動入力' });
    const jsonTab = within(tabList).getByRole('tab', { name: 'JSON入力' });
    const markdownTab = within(tabList).getByRole('tab', {
      name: '限定Markdown入力',
    });
    expect(manualTab).toHaveAttribute('aria-selected', 'true');
    expect(jsonTab).toHaveAttribute('aria-selected', 'false');
    expect(markdownTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('会話タイトル')).toBeVisible();
    expect(screen.getByLabelText('role')).toBeVisible();
    expect(screen.getByLabelText('origin')).toBeVisible();
    expect(screen.getByLabelText('発生日時（任意）')).toBeVisible();
    expect(screen.getByLabelText('ターン本文')).toBeVisible();

    manualTab.focus();
    fireEvent.keyDown(manualTab, { key: 'ArrowRight' });

    await waitFor(() =>
      expect(jsonTab).toHaveAttribute('aria-selected', 'true'),
    );
    expect(jsonTab).toHaveFocus();
    expect(screen.getByLabelText('JSON本文')).toBeVisible();

    fireEvent.keyDown(jsonTab, { key: 'End' });
    await waitFor(() =>
      expect(markdownTab).toHaveAttribute('aria-selected', 'true'),
    );
    expect(markdownTab).toHaveFocus();
    expect(screen.getByLabelText('限定Markdown本文')).toBeVisible();
  });
});
