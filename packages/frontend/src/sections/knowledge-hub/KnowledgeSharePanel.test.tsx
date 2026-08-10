import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  commitKnowledgeShare: vi.fn(),
  createKnowledgeShareRequestKey: vi.fn(),
  fetchChatRooms: vi.fn(),
  getKnowledgeSynthesis: vi.fn(),
  listKnowledgeAnnotations: vi.fn(),
  listKnowledgeConversations: vi.fn(),
  listKnowledgeConversationTurns: vi.fn(),
  listKnowledgeShareLabelAssignments: vi.fn(),
  listKnowledgeSyntheses: vi.fn(),
  previewKnowledgeShare: vi.fn(),
  reconcileKnowledgeShare: vi.fn(),
  revokeKnowledgeShare: vi.fn(),
}));

vi.mock('../knowledge-share/knowledgeShareApi', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../knowledge-share/knowledgeShareApi')
  >()),
  commitKnowledgeShare: apiMocks.commitKnowledgeShare,
  createKnowledgeShareRequestKey: apiMocks.createKnowledgeShareRequestKey,
  listKnowledgeShareLabelAssignments:
    apiMocks.listKnowledgeShareLabelAssignments,
  previewKnowledgeShare: apiMocks.previewKnowledgeShare,
  reconcileKnowledgeShare: apiMocks.reconcileKnowledgeShare,
  revokeKnowledgeShare: apiMocks.revokeKnowledgeShare,
}));

vi.mock('../room-chat/roomChatApi', () => ({
  fetchChatRooms: apiMocks.fetchChatRooms,
}));

vi.mock('./knowledgeProvenanceApi', () => ({
  getKnowledgeSynthesis: apiMocks.getKnowledgeSynthesis,
  listKnowledgeAnnotations: apiMocks.listKnowledgeAnnotations,
  listKnowledgeConversations: apiMocks.listKnowledgeConversations,
  listKnowledgeConversationTurns: apiMocks.listKnowledgeConversationTurns,
  listKnowledgeSyntheses: apiMocks.listKnowledgeSyntheses,
}));

import { KnowledgeSharePanel } from './KnowledgeSharePanel';
import type { KnowledgeSnapshot } from './knowledgeHubModel';

const timestamp = '2026-08-10T01:00:00.000Z';

function snapshot(
  overrides: Partial<KnowledgeSnapshot> = {},
): KnowledgeSnapshot {
  return {
    id: 'snapshot-ready',
    knowledgeItemId: 'item-1',
    version: 3,
    status: 'ready',
    captureMethod: 'text',
    sourceUrl: null,
    originalName: 'ready.txt',
    contentType: 'text/plain',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    failureCode: null,
    capturedAt: timestamp,
    capturedBy: 'user-1',
    readyAt: timestamp,
    failedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function titleOnlyCard(title = '共有対象タイトル') {
  return {
    schemaVersion: 1 as const,
    title,
    sourceType: null,
    canonicalUrl: null,
    snapshot: null,
    sharerNote: null,
    labels: [],
    annotations: [],
    turns: [],
    syntheses: [],
    selectedCategories: ['title'] as const,
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
    ] as const,
  };
}

function previewPayload(title = '共有対象タイトル') {
  return {
    card: titleOnlyCard(title),
    destinationRoom: { name: '設計ルーム', type: 'private_group' },
    previewToken: 'opaque-preview-token',
    expiresAt: '2026-08-10T01:10:00.000Z',
    requiresConfirmation: true as const,
  };
}

function status(
  value: 'pending' | 'posted' | 'failed' | 'revoked',
  overrides: Record<string, unknown> = {},
) {
  return {
    shareId: 'share-1',
    status: value,
    version: value === 'revoked' ? 3 : 2,
    chatMessageId: value === 'posted' ? 'message-1' : null,
    failureCode: value === 'failed' ? 'post_rejected' : null,
    createdAt: timestamp,
    postedAt: value === 'posted' ? '2026-08-10T01:01:00.000Z' : null,
    failedAt: value === 'failed' ? '2026-08-10T01:01:00.000Z' : null,
    revokedAt: value === 'revoked' ? '2026-08-10T01:02:00.000Z' : null,
    ...overrides,
  };
}

function commit(
  value: 'pending' | 'posted' | 'failed' = 'posted',
  overrides: Record<string, unknown> = {},
) {
  return {
    ...status(value),
    created: true,
    reused: false,
    resultUnknown: value === 'pending',
    ...overrides,
  };
}

function annotation(itemId = 'item-1') {
  return {
    id: `annotation-${itemId}`,
    knowledgeItemId: itemId,
    scope: 'personal' as const,
    kind: 'quote' as const,
    origin: 'external' as const,
    currentRevision: 2,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: {
      id: `annotation-revision-${itemId}`,
      annotationId: `annotation-${itemId}`,
      revision: 2,
      kind: 'quote' as const,
      origin: 'external' as const,
      content: `${itemId} annotation content`,
      createdAt: timestamp,
    },
  };
}

function synthesisDetail(itemId = 'item-1', synthesisId = 'synthesis-1') {
  return {
    synthesis: {
      id: synthesisId,
      scope: 'personal' as const,
      title: `${itemId} synthesis`,
      currentVersion: 4,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    currentVersion: {
      id: `${synthesisId}-version-4`,
      synthesisId,
      version: 4,
      content: `${itemId} synthesis content`,
      unresolvedQuestions: [],
      confidenceBasisPoints: 8000,
      createdAt: timestamp,
      sources: [
        {
          id: `${synthesisId}-source`,
          kind: 'item' as const,
          sourceId: itemId,
          relationType: 'primary' as const,
          ordinal: 0,
          accessible: true,
          createdAt: timestamp,
        },
      ],
    },
  };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof KnowledgeSharePanel>> = {},
) {
  return render(
    <KnowledgeSharePanel
      itemId="item-1"
      itemLabel="設計Knowledge"
      itemScope="personal"
      snapshots={[
        snapshot(),
        snapshot({
          id: 'snapshot-pending',
          version: 4,
          status: 'pending',
          originalName: 'pending.txt',
          sha256: null,
          readyAt: null,
        }),
        snapshot({
          id: 'snapshot-other-item',
          knowledgeItemId: 'item-other',
          originalName: 'other-item.txt',
        }),
      ]}
      {...props}
    />,
  );
}

async function waitForCandidates() {
  await screen.findByRole('checkbox', { name: /Architecture/ });
}

async function previewAndConfirm() {
  await waitForCandidates();
  fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
    target: { value: 'room-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: '共有内容をプレビュー' }));
  await screen.findByRole('heading', { name: '共有内容の最終確認' });
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: '上記の共有先と共有内容が完全に一致することを確認しました',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: '確認した内容をChatへ共有' }),
  );
}

beforeEach(() => {
  apiMocks.fetchChatRooms.mockResolvedValue([
    {
      id: 'room-1',
      name: '設計ルーム',
      type: 'private_group',
      allowExternalUsers: false,
    },
    {
      id: 'room-external',
      name: '外部連携ルーム',
      type: 'project',
      allowExternalUsers: true,
    },
  ]);
  apiMocks.listKnowledgeShareLabelAssignments.mockResolvedValue([
    {
      assignmentId: 'assignment-1',
      displayName: 'Architecture',
      scope: 'organization',
      labelVersion: 5,
    },
  ]);
  apiMocks.listKnowledgeAnnotations.mockResolvedValue({
    items: [annotation(), annotation('item-other')],
    nextCursor: 'not-loaded-by-this-bounded-slice',
  });
  apiMocks.listKnowledgeConversations.mockResolvedValue({
    items: [
      {
        id: 'conversation-1',
        title: '設計会話',
        sourceType: 'manual',
        provider: null,
        model: null,
        capturedAt: timestamp,
        importedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [
          {
            id: 'conversation-item-1',
            knowledgeItemId: 'item-1',
            relationType: 'primary',
            ordinal: 0,
            createdAt: timestamp,
          },
        ],
      },
      {
        id: 'conversation-other',
        title: 'other item conversation',
        sourceType: 'manual',
        provider: null,
        model: null,
        capturedAt: timestamp,
        importedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [
          {
            id: 'conversation-item-other',
            knowledgeItemId: 'item-other',
            relationType: 'primary',
            ordinal: 0,
            createdAt: timestamp,
          },
        ],
      },
    ],
    nextCursor: null,
  });
  apiMocks.listKnowledgeConversationTurns.mockResolvedValue({
    items: [
      {
        id: 'turn-1',
        conversationId: 'conversation-1',
        sequence: 1,
        role: 'assistant',
        origin: 'ai',
        content: 'AIが生成した選択候補',
        name: null,
        occurredAt: timestamp,
        createdAt: timestamp,
      },
      {
        id: 'turn-wrong-conversation',
        conversationId: 'conversation-other',
        sequence: 2,
        role: 'user',
        origin: 'user',
        content: 'wrong conversation secret',
        name: null,
        occurredAt: timestamp,
        createdAt: timestamp,
      },
    ],
    nextCursor: null,
  });
  apiMocks.listKnowledgeSyntheses.mockResolvedValue({
    items: [
      synthesisDetail().synthesis,
      synthesisDetail('item-other', 'synthesis-other').synthesis,
    ],
    nextCursor: null,
  });
  apiMocks.getKnowledgeSynthesis.mockImplementation((synthesisId: string) =>
    Promise.resolve(
      synthesisId === 'synthesis-1'
        ? synthesisDetail()
        : synthesisDetail('item-other', 'synthesis-other'),
    ),
  );
  apiMocks.previewKnowledgeShare.mockResolvedValue(previewPayload());
  apiMocks.createKnowledgeShareRequestKey.mockReturnValue('request-key-secret');
  apiMocks.commitKnowledgeShare.mockResolvedValue(commit());
  apiMocks.reconcileKnowledgeShare.mockResolvedValue(status('posted'));
  apiMocks.revokeKnowledgeShare.mockResolvedValue(status('revoked'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KnowledgeSharePanel', () => {
  it('uses safe defaults and loads only bounded current-item exact candidates', async () => {
    const { container } = renderPanel();
    await waitForCandidates();

    expect(screen.getByRole('checkbox', { name: 'タイトル' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'ソース種別' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '安全化URL' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: 'snapshot provenance（version・SHA-256）',
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'snapshot抜粋' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Architecture/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: /引用 \/ 外部情報 \/ revision 2/,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /設計会話 \/ AI Assistant \/ AI/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /item-1 synthesis \/ version 4/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '共有者メモを含める' }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('共有するready snapshot')).toHaveValue('');
    expect(screen.getByRole('option', { name: /ready\.txt/ })).toBeVisible();
    expect(
      screen.queryByRole('option', { name: /pending\.txt|other-item\.txt/ }),
    ).not.toBeInTheDocument();

    expect(screen.getByText(/item-1 annotation content/)).toBeVisible();
    expect(screen.getByText(/AI Assistant \/ AI/)).toBeVisible();
    expect(screen.getByText(/item-1 synthesis content/)).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /item-other annotation|other item conversation|wrong conversation secret|item-other synthesis content/,
    );
    expect(screen.getByRole('group', { name: '基本項目' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'conversation turn' }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('.knowledge-share-panel-responsive-grid'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('.knowledge-share-panel-mobile'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /すべて|一括/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'annotation候補をさらに読み込む',
      }),
    ).toBeVisible();
    expect(apiMocks.listKnowledgeConversationTurns).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchChatRooms).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(apiMocks.listKnowledgeAnnotations).toHaveBeenCalledWith('item-1', {
      signal: expect.any(AbortSignal),
    });
    expect(apiMocks.listKnowledgeConversations).toHaveBeenCalledWith({
      knowledgeItemId: 'item-1',
      signal: expect.any(AbortSignal),
    });
    expect(apiMocks.listKnowledgeSyntheses).toHaveBeenCalledWith(
      null,
      expect.any(AbortSignal),
    );
    expect(apiMocks.listKnowledgeConversationTurns).toHaveBeenCalledWith(
      'conversation-1',
      null,
      expect.any(AbortSignal),
    );

    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-external' },
    });
    expect(screen.getByText(/外部参加者を許可しています/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-1' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'ソース種別' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '安全化URL' }));
    fireEvent.change(screen.getByLabelText('共有するready snapshot'), {
      target: { value: 'snapshot-ready' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'snapshot provenance（version・SHA-256）',
      }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'snapshot抜粋' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Architecture/ }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /引用 \/ 外部情報 \/ revision 2/,
      }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /設計会話 \/ AI Assistant \/ AI/ }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /item-1 synthesis \/ version 4/ }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: '共有者メモを含める' }),
    );
    fireEvent.change(screen.getByLabelText('共有者メモ本文'), {
      target: { value: '選択した内容だけを共有します。' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '共有内容をプレビュー' }),
    );

    await waitFor(() =>
      expect(apiMocks.previewKnowledgeShare).toHaveBeenCalledTimes(1),
    );
    expect(apiMocks.previewKnowledgeShare).toHaveBeenCalledWith(
      {
        itemId: 'item-1',
        destinationRoomId: 'room-1',
        selection: {
          includeTitle: true,
          includeSourceType: true,
          includeCanonicalUrl: true,
          snapshot: {
            snapshotId: 'snapshot-ready',
            includeProvenance: true,
            includeExcerpt: true,
          },
          labelAssignmentIds: ['assignment-1'],
          annotations: [{ annotationId: 'annotation-item-1', revision: 2 }],
          conversationTurnIds: ['turn-1'],
          syntheses: [{ synthesisId: 'synthesis-1', version: 4 }],
          sharerNote: '選択した内容だけを共有します。',
        },
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('requires exact preview confirmation and performs only one commit click', async () => {
    renderPanel();
    await waitForCandidates();
    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '共有内容をプレビュー' }),
    );

    expect(
      await screen.findByRole('heading', { name: '共有内容の最終確認' }),
    ).toBeVisible();
    expect(screen.getByText('共有対象タイトル')).toBeVisible();
    expect(screen.getByText('設計ルーム')).toBeVisible();
    expect(screen.getByText('preview有効期限')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: '省略するカテゴリ' }),
    ).toBeVisible();
    expect(
      screen.getByRole('list', { name: '共有されない項目' }),
    ).toHaveTextContent('snapshotの抜粋');
    const commitButton = screen.getByRole('button', {
      name: '確認した内容をChatへ共有',
    });
    expect(commitButton).toBeDisabled();
    expect(apiMocks.commitKnowledgeShare).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '上記の共有先と共有内容が完全に一致することを確認しました',
      }),
    );
    fireEvent.click(commitButton);
    fireEvent.click(commitButton);

    expect(
      await screen.findByRole('heading', { name: '投稿済み' }),
    ).toBeVisible();
    expect(screen.getByText('共有を新規作成しました。')).toBeVisible();
    expect(apiMocks.commitKnowledgeShare).toHaveBeenCalledTimes(1);
    expect(apiMocks.commitKnowledgeShare).toHaveBeenCalledWith({
      itemId: 'item-1',
      destinationRoomId: 'room-1',
      selection: {
        includeTitle: true,
        includeSourceType: false,
        includeCanonicalUrl: false,
        snapshot: null,
        labelAssignmentIds: [],
        annotations: [],
        conversationTurnIds: [],
        syntheses: [],
        sharerNote: null,
      },
      previewToken: 'opaque-preview-token',
      requestKey: 'request-key-secret',
    });
    expect(document.body).not.toHaveTextContent(
      /opaque-preview-token|request-key-secret/,
    );
  });

  it('offers explicit read-only pending reconcile and explicit revoke', async () => {
    apiMocks.commitKnowledgeShare.mockResolvedValue(commit('pending'));
    renderPanel();
    await previewAndConfirm();

    expect(
      await screen.findByRole('heading', { name: '投稿確認中' }),
    ).toBeVisible();
    expect(screen.getByText(/自動再送せず/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: '既存投稿を読取専用で照合' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: '共有を取り消す' }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole('button', { name: '既存投稿を読取専用で照合' }),
    );
    expect(
      await screen.findByRole('heading', { name: '投稿済み' }),
    ).toBeVisible();
    expect(apiMocks.reconcileKnowledgeShare).toHaveBeenCalledWith(
      'share-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(screen.getByRole('button', { name: '共有を取り消す' }));
    expect(
      await screen.findByRole('heading', { name: '取消済み' }),
    ).toBeVisible();
    expect(apiMocks.revokeKnowledgeShare).toHaveBeenCalledWith(
      'share-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      screen.queryByRole('button', { name: '共有を取り消す' }),
    ).not.toBeInTheDocument();
  });

  it('shows duplicate reuse without exposing the share identifier', async () => {
    apiMocks.commitKnowledgeShare.mockResolvedValue(
      commit('posted', {
        created: false,
        reused: true,
        shareId: 'sensitive-share-id',
      }),
    );
    renderPanel();
    await previewAndConfirm();

    expect(
      await screen.findByText('同一操作の既存共有を再利用しました。'),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent('sensitive-share-id');
  });

  it('shows a sanitized failed status without retrying the commit', async () => {
    apiMocks.commitKnowledgeShare.mockResolvedValue(commit('failed'));
    renderPanel();
    await previewAndConfirm();

    expect(
      await screen.findByRole('heading', { name: '投稿失敗' }),
    ).toBeVisible();
    expect(screen.getByText(/自動再投稿は行いません/)).toBeVisible();
    expect(apiMocks.commitKnowledgeShare).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('post_rejected');
  });

  it('drops a stale preview response after the room draft changes', async () => {
    let resolvePreview!: (value: ReturnType<typeof previewPayload>) => void;
    apiMocks.previewKnowledgeShare.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderPanel();
    await waitForCandidates();
    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '共有内容をプレビュー' }),
    );
    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-external' },
    });

    await act(async () => {
      resolvePreview(previewPayload('stale preview secret'));
      await Promise.resolve();
    });

    expect(document.body).not.toHaveTextContent('stale preview secret');
    expect(
      screen.queryByRole('checkbox', {
        name: '上記の共有先と共有内容が完全に一致することを確認しました',
      }),
    ).not.toBeInTheDocument();
    expect(apiMocks.createKnowledgeShareRequestKey).not.toHaveBeenCalled();
  });

  it('sanitizes backend errors and never renders internal preview fields', async () => {
    apiMocks.previewKnowledgeShare.mockResolvedValueOnce({
      ...previewPayload(),
      providerKey: 'internal-provider-value',
      internal: 'internal-field-value',
      requestKey: 'backend-request-key-value',
    });
    renderPanel();
    await waitForCandidates();
    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '共有内容をプレビュー' }),
    );
    await screen.findByRole('heading', { name: '共有内容の最終確認' });
    expect(document.body).not.toHaveTextContent(
      /internal-provider-value|internal-field-value|backend-request-key-value|opaque-preview-token|request-key-secret/,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'ソース種別' }));
    apiMocks.previewKnowledgeShare.mockRejectedValueOnce(
      new Error(
        'raw backend error: providerKey=provider-secret requestKey=request-secret internal=stack',
      ),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '共有内容をプレビュー' }),
    );
    expect(
      await screen.findByText(
        '共有処理を完了できませんでした。内容と現在の権限を確認してください。',
      ),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /raw backend error|provider-secret|request-secret|internal=stack/,
    );
  });

  it('purges sensitive preview and candidates when scope or item switches', async () => {
    apiMocks.previewKnowledgeShare.mockResolvedValueOnce(
      previewPayload('item-1 sensitive preview'),
    );
    const { rerender } = renderPanel();
    await waitForCandidates();
    fireEvent.change(screen.getByLabelText('共有先Chatルーム'), {
      target: { value: 'room-1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '共有内容をプレビュー' }),
    );
    expect(await screen.findByText('item-1 sensitive preview')).toBeVisible();
    const firstLabelSignal = apiMocks.listKnowledgeShareLabelAssignments.mock
      .calls[0]?.[1]?.signal as AbortSignal;

    rerender(
      <KnowledgeSharePanel
        itemId="item-1"
        itemLabel="組織Knowledge"
        itemScope="organization"
        snapshots={[]}
      />,
    );

    expect(document.body).not.toHaveTextContent('item-1 sensitive preview');
    expect(document.body).not.toHaveTextContent('item-1 annotation content');
    expect(screen.getByText(/組織Knowledge/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'タイトル' })).toBeChecked();
    expect(screen.getByLabelText('共有先Chatルーム')).toHaveValue('');
    expect(firstLabelSignal.aborted).toBe(true);
    await waitFor(() =>
      expect(apiMocks.listKnowledgeShareLabelAssignments).toHaveBeenCalledTimes(
        2,
      ),
    );
    const organizationLabelSignal = apiMocks.listKnowledgeShareLabelAssignments
      .mock.calls[1]?.[1]?.signal as AbortSignal;

    rerender(
      <KnowledgeSharePanel
        itemId="item-2"
        itemLabel="切替後Knowledge"
        itemScope="personal"
        snapshots={[]}
      />,
    );

    expect(document.body).not.toHaveTextContent('item-1 sensitive preview');
    expect(document.body).not.toHaveTextContent('item-1 annotation content');
    expect(screen.getByText(/切替後Knowledge/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'タイトル' })).toBeChecked();
    expect(screen.getByLabelText('共有先Chatルーム')).toHaveValue('');
    expect(organizationLabelSignal.aborted).toBe(true);
    await waitFor(() =>
      expect(apiMocks.listKnowledgeShareLabelAssignments).toHaveBeenCalledWith(
        'item-2',
        { signal: expect.any(AbortSignal) },
      ),
    );
  });
});
