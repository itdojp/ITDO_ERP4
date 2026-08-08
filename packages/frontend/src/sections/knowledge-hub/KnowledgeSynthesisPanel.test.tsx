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

const apiMocks = vi.hoisted(() => ({
  appendKnowledgeSynthesisVersion: vi.fn(),
  createKnowledgeSynthesis: vi.fn(),
  getKnowledgeSynthesis: vi.fn(),
  listKnowledgeSyntheses: vi.fn(),
  listKnowledgeSynthesisVersions: vi.fn(),
}));

vi.mock('./knowledgeProvenanceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./knowledgeProvenanceApi')>()),
  ...apiMocks,
}));

import { KnowledgeSynthesisPanel } from './KnowledgeSynthesisPanel';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import type {
  KnowledgeSynthesis,
  KnowledgeSynthesisDetail,
  KnowledgeSynthesisSource,
  KnowledgeSynthesisVersion,
} from './knowledgeProvenanceModel';

function makeSynthesis(
  overrides: Partial<KnowledgeSynthesis> = {},
): KnowledgeSynthesis {
  return {
    id: 'synthesis-db-id-1',
    scope: 'personal',
    title: '市場動向の統合知',
    currentVersion: 1,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeSource(
  overrides: Partial<KnowledgeSynthesisSource> = {},
): KnowledgeSynthesisSource {
  return {
    id: 'source-link-db-id-1',
    kind: 'item',
    sourceId: 'source-db-id-1',
    relationType: 'primary',
    ordinal: 0,
    accessible: true,
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeVersion(
  overrides: Partial<KnowledgeSynthesisVersion> = {},
): KnowledgeSynthesisVersion {
  return {
    id: 'version-db-id-1',
    synthesisId: 'synthesis-db-id-1',
    version: 1,
    content: '現時点の結論',
    unresolvedQuestions: ['追加調査は必要か'],
    confidenceBasisPoints: 8250,
    createdAt: '2026-08-08T00:00:00.000Z',
    sources: [makeSource()],
    ...overrides,
  };
}

function makeDetail(
  synthesisOverrides: Partial<KnowledgeSynthesis> = {},
  versionOverrides: Partial<KnowledgeSynthesisVersion> = {},
): KnowledgeSynthesisDetail {
  const synthesis = makeSynthesis(synthesisOverrides);
  return {
    synthesis,
    currentVersion: makeVersion({
      synthesisId: synthesis.id,
      version: synthesis.currentVersion,
      ...versionOverrides,
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, nextCursor };
}

async function waitForInitialList() {
  await waitFor(() =>
    expect(apiMocks.listKnowledgeSyntheses).toHaveBeenCalledTimes(1),
  );
}

function fillCreateForm(
  input: {
    title?: string;
    content?: string;
    confidence?: string;
    questions?: string;
  } = {},
) {
  fireEvent.change(screen.getByLabelText('タイトル'), {
    target: { value: input.title ?? '新しい統合知' },
  });
  fireEvent.change(screen.getByLabelText('本文'), {
    target: { value: input.content ?? '統合した本文' },
  });
  fireEvent.change(screen.getByLabelText('確信度（%）'), {
    target: { value: input.confidence ?? '87.65' },
  });
  fireEvent.change(screen.getByLabelText('未解決の質問'), {
    target: { value: input.questions ?? '質問A\n\n 質問B ' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const detail = makeDetail();
  apiMocks.listKnowledgeSyntheses.mockResolvedValue(page([]));
  apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail);
  apiMocks.listKnowledgeSynthesisVersions.mockResolvedValue(
    page([detail.currentVersion]),
  );
  apiMocks.createKnowledgeSynthesis.mockResolvedValue(detail);
  apiMocks.appendKnowledgeSynthesisVersion.mockResolvedValue(detail);
});

afterEach(() => cleanup());

describe('KnowledgeSynthesisPanel', () => {
  it('creates a synthesis in the selected item scope with the item as primary source', async () => {
    const created = makeDetail(
      { title: '新しい統合知' },
      {
        content: '統合した本文',
        confidenceBasisPoints: 8765,
        unresolvedQuestions: ['質問A', '質問B'],
      },
    );
    apiMocks.createKnowledgeSynthesis.mockResolvedValue(created);
    render(
      <KnowledgeSynthesisPanel
        itemId="selected-item-secret"
        itemScope="personal"
      />,
    );
    await waitForInitialList();

    expect(screen.getByText(/作成scope:/).parentElement).toHaveTextContent(
      'personal（個人）',
    );
    expect(screen.getByText(/scopeに固定され、変更できません/)).toBeVisible();
    fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));

    await waitFor(() =>
      expect(apiMocks.createKnowledgeSynthesis).toHaveBeenCalledWith({
        scope: 'personal',
        title: '新しい統合知',
        content: '統合した本文',
        confidenceBasisPoints: 8765,
        unresolvedQuestions: ['質問A', '質問B'],
        sources: [
          {
            kind: 'item',
            sourceId: 'selected-item-secret',
            relationType: 'primary',
          },
        ],
      }),
    );
    expect(
      await screen.findByText('統合知 version 1 を作成しました。'),
    ).toBeVisible();
    expect(screen.getAllByText('87.65%')[0]).toBeVisible();
    expect(screen.queryByText('selected-item-secret')).not.toBeInTheDocument();
    expect(screen.queryByText('synthesis-db-id-1')).not.toBeInTheDocument();
  });

  it('maps confidence percent to basis points and limits newline-delimited questions to 50', async () => {
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);
    await waitForInitialList();
    fillCreateForm({
      confidence: '12.34',
      questions: Array.from(
        { length: 51 },
        (_, index) => `質問${index + 1}`,
      ).join('\n'),
    });
    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));

    expect(
      await screen.findByText(
        '未解決の質問は1行1件、50件以内で入力してください。',
      ),
    ).toBeVisible();
    expect(apiMocks.createKnowledgeSynthesis).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('未解決の質問'), {
      target: { value: '  質問1  \n\n質問2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));

    await waitFor(() =>
      expect(apiMocks.createKnowledgeSynthesis).toHaveBeenCalledWith(
        expect.objectContaining({
          confidenceBasisPoints: 1234,
          unresolvedQuestions: ['質問1', '質問2'],
        }),
      ),
    );
  });

  it('shows organization scope explicitly and fixes creation to that scope', async () => {
    const organizationDetail = makeDetail({
      scope: 'organization',
      title: '組織向け統合知',
    });
    apiMocks.createKnowledgeSynthesis.mockResolvedValue(organizationDetail);
    render(
      <KnowledgeSynthesisPanel
        itemId="organization-item"
        itemScope="organization"
      />,
    );
    await waitForInitialList();

    expect(screen.getByText(/作成scope:/).parentElement).toHaveTextContent(
      'organization（組織）',
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fillCreateForm({ title: '組織向け統合知' });
    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));

    await waitFor(() =>
      expect(apiMocks.createKnowledgeSynthesis).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'organization' }),
      ),
    );
    expect(
      (await screen.findAllByText('organization（組織）'))[0],
    ).toBeVisible();
  });

  it('loads the global synthesis list page by page and removes duplicate rows', async () => {
    const synthesisA = makeSynthesis({ id: 'synthesis-a', title: '統合知A' });
    const synthesisB = makeSynthesis({ id: 'synthesis-b', title: '統合知B' });
    apiMocks.listKnowledgeSyntheses
      .mockResolvedValueOnce(page([synthesisA], 'list-cursor-2'))
      .mockResolvedValueOnce(page([synthesisA, synthesisB]));

    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    expect(
      await screen.findByText(/現在参照できる統合知を横断表示します/),
    ).toBeVisible();
    expect(
      await screen.findByRole('button', { name: /統合知A.*version 1/ }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: '統合知をさらに読み込む' }),
    );

    expect(
      await screen.findByRole('button', { name: /統合知B.*version 1/ }),
    ).toBeVisible();
    const list = screen.getByRole('list', { name: '統合知一覧' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(apiMocks.listKnowledgeSyntheses).toHaveBeenNthCalledWith(1, null);
    expect(apiMocks.listKnowledgeSyntheses).toHaveBeenNthCalledWith(
      2,
      'list-cursor-2',
    );
    expect(
      screen.queryByRole('button', { name: '統合知をさらに読み込む' }),
    ).not.toBeInTheDocument();
  });

  it('selects detail and renders accessible and inaccessible provenance without IDs or actor metadata', async () => {
    const synthesis = makeSynthesis();
    const accessibleSource = makeSource({
      id: 'accessible-link-secret',
      sourceId: 'accessible-source-secret',
      kind: 'conversation_turn',
      relationType: 'supporting',
    });
    const inaccessibleSource = makeSource({
      id: null,
      sourceId: 'redacted-source-secret',
      kind: 'annotation_revision',
      relationType: 'contradicting',
      accessible: false,
      createdAt: null,
    });
    const version = {
      ...makeVersion({ sources: [accessibleSource, inaccessibleSource] }),
      actorUserId: 'actor-db-id-secret',
    } as KnowledgeSynthesisVersion;
    const detail = { synthesis, currentVersion: version };
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(page([synthesis]));
    apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail);
    apiMocks.listKnowledgeSynthesisVersions.mockResolvedValue(page([version]));
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    const selectButton = await screen.findByRole('button', {
      name: /市場動向の統合知.*personal（個人）.*version 1/,
    });
    fireEvent.click(selectButton);

    const currentProvenance = await screen.findByRole('list', {
      name: '現在の版の根拠',
    });
    expect(currentProvenance).toHaveTextContent('会話ターン');
    expect(currentProvenance).toHaveTextContent('補強');
    expect(currentProvenance).toHaveTextContent(
      '参照不可の根拠（詳細は非表示）',
    );
    expect(currentProvenance).toHaveTextContent('反証');
    expect(currentProvenance).not.toHaveTextContent('注釈の版');
    for (const secret of [
      'synthesis-db-id-1',
      'version-db-id-1',
      'accessible-link-secret',
      'accessible-source-secret',
      'redacted-source-secret',
      'actor-db-id-secret',
    ]) {
      expect(screen.queryByText(secret)).not.toBeInTheDocument();
    }
  });

  it('keeps an unrelated same-scope synthesis read-only without exposing item identifiers', async () => {
    const synthesis = makeSynthesis();
    const detail = makeDetail(
      {},
      {
        sources: [makeSource({ sourceId: 'different-item-secret' })],
      },
    );
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(page([synthesis]));
    apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail);
    apiMocks.listKnowledgeSynthesisVersions.mockResolvedValue(
      page([detail.currentVersion]),
    );
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /市場動向の統合知/ }),
    );

    expect(
      await screen.findByText(
        'この統合知は選択中のKnowledgeItemとの関連または現在の根拠を確認できないため、閲覧のみ可能です。',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '新しいversionを追加' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('different-item-secret')).not.toBeInTheDocument();
    expect(screen.queryByText('item-1')).not.toBeInTheDocument();
    expect(apiMocks.appendKnowledgeSynthesisVersion).not.toHaveBeenCalled();
  });

  it('keeps a related synthesis read-only when an existing source is inaccessible', async () => {
    const synthesis = makeSynthesis();
    const detail = makeDetail(
      {},
      {
        sources: [
          makeSource({ sourceId: 'item-1' }),
          makeSource({
            id: null,
            kind: 'conversation',
            sourceId: null,
            relationType: 'supporting',
            ordinal: 1,
            accessible: false,
            createdAt: null,
          }),
        ],
      },
    );
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(page([synthesis]));
    apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail);
    apiMocks.listKnowledgeSynthesisVersions.mockResolvedValue(
      page([detail.currentVersion]),
    );
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /市場動向の統合知/ }),
    );

    expect(
      await screen.findByText(
        'この統合知は選択中のKnowledgeItemとの関連または現在の根拠を確認できないため、閲覧のみ可能です。',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '新しいversionを追加' }),
    ).not.toBeInTheDocument();
  });

  it('appends a version and refreshes version history', async () => {
    const version1 = makeVersion({
      sources: [
        makeSource({ sourceId: 'item-1' }),
        makeSource({
          id: 'supporting-source-link',
          kind: 'conversation',
          sourceId: 'conversation-source',
          relationType: 'supporting',
          ordinal: 1,
        }),
      ],
    });
    const detail1 = makeDetail({}, version1);
    const version2 = makeVersion({
      id: 'version-db-id-2',
      version: 2,
      content: '更新後の結論',
      unresolvedQuestions: ['残課題'],
      confidenceBasisPoints: 9010,
      sources: [makeSource({ sourceId: 'item-1' })],
    });
    const detail2 = makeDetail({ currentVersion: 2 }, version2);
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(
      page([detail1.synthesis]),
    );
    apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail1);
    apiMocks.listKnowledgeSynthesisVersions
      .mockResolvedValueOnce(page([version1]))
      .mockResolvedValueOnce(page([version2, version1]));
    apiMocks.appendKnowledgeSynthesisVersion.mockResolvedValue(detail2);
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /市場動向の統合知/ }),
    );
    await screen.findByLabelText('追加する本文');
    fireEvent.change(screen.getByLabelText('追加する本文'), {
      target: { value: '更新後の結論' },
    });
    fireEvent.change(screen.getByLabelText('追加版の確信度（%）'), {
      target: { value: '90.1' },
    });
    fireEvent.change(screen.getByLabelText('追加版の未解決の質問'), {
      target: { value: '残課題' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '新しいversionを追加' }),
    );

    await waitFor(() =>
      expect(apiMocks.appendKnowledgeSynthesisVersion).toHaveBeenCalledWith({
        synthesisId: 'synthesis-db-id-1',
        expectedVersion: 1,
        content: '更新後の結論',
        confidenceBasisPoints: 9010,
        unresolvedQuestions: ['残課題'],
        sources: [
          {
            kind: 'item',
            sourceId: 'item-1',
            relationType: 'primary',
          },
          {
            kind: 'conversation',
            sourceId: 'conversation-source',
            relationType: 'supporting',
          },
        ],
      }),
    );
    expect(await screen.findByText('version 2 を追加しました。')).toBeVisible();
    const history = screen
      .getByRole('heading', { name: 'version履歴' })
      .closest('section');
    expect(history).not.toBeNull();
    expect(
      within(history as HTMLElement).getByRole('article', {
        name: 'version 2',
      }),
    ).toHaveTextContent('更新後の結論');
    expect(
      within(history as HTMLElement).getByRole('article', {
        name: 'version 1',
      }),
    ).toHaveTextContent('現時点の結論');
    expect(apiMocks.listKnowledgeSynthesisVersions).toHaveBeenCalledTimes(2);
  });

  it('loads version history page by page and deduplicates overlapping versions', async () => {
    const version2 = makeVersion({
      id: 'version-db-id-2',
      version: 2,
      content: '新しい結論',
      sources: [makeSource({ sourceId: 'item-1' })],
    });
    const version1 = makeVersion({
      sources: [makeSource({ sourceId: 'item-1' })],
    });
    const detail = makeDetail({ currentVersion: 2 }, version2);
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(page([detail.synthesis]));
    apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail);
    apiMocks.listKnowledgeSynthesisVersions
      .mockResolvedValueOnce(page([version2], 'version-cursor-2'))
      .mockResolvedValueOnce(page([version2, version1]));
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /市場動向の統合知.*version 2/,
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'version履歴をさらに読み込む',
      }),
    );

    const history = screen
      .getByRole('heading', { name: 'version履歴' })
      .closest('section');
    expect(history).not.toBeNull();
    await waitFor(() =>
      expect(
        within(history as HTMLElement).getAllByRole('article'),
      ).toHaveLength(2),
    );
    expect(
      within(history as HTMLElement).getByRole('article', {
        name: 'version 2',
      }),
    ).toHaveTextContent('新しい結論');
    expect(
      within(history as HTMLElement).getByRole('article', {
        name: 'version 1',
      }),
    ).toHaveTextContent('現時点の結論');
    expect(apiMocks.listKnowledgeSynthesisVersions).toHaveBeenNthCalledWith(
      1,
      detail.synthesis.id,
    );
    expect(apiMocks.listKnowledgeSynthesisVersions).toHaveBeenNthCalledWith(
      2,
      detail.synthesis.id,
      'version-cursor-2',
    );
  });

  it('ignores a stale detail response after selecting another synthesis', async () => {
    const synthesisA = makeSynthesis({ id: 'synthesis-a', title: '統合知A' });
    const synthesisB = makeSynthesis({ id: 'synthesis-b', title: '統合知B' });
    const detailA = makeDetail(
      { id: 'synthesis-a', title: '統合知A' },
      { synthesisId: 'synthesis-a', content: '古い選択の本文' },
    );
    const detailB = makeDetail(
      { id: 'synthesis-b', title: '統合知B' },
      { synthesisId: 'synthesis-b', content: '新しい選択の本文' },
    );
    const pendingA = deferred<KnowledgeSynthesisDetail>();
    const pendingB = deferred<KnowledgeSynthesisDetail>();
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(
      page([synthesisA, synthesisB]),
    );
    apiMocks.getKnowledgeSynthesis.mockImplementation((synthesisId: string) =>
      synthesisId === 'synthesis-a' ? pendingA.promise : pendingB.promise,
    );
    apiMocks.listKnowledgeSynthesisVersions.mockImplementation(
      (synthesisId: string) =>
        Promise.resolve(
          page(
            synthesisId === 'synthesis-a'
              ? [detailA.currentVersion]
              : [detailB.currentVersion],
          ),
        ),
    );
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /統合知A.*version 1/ }),
    );
    await waitFor(() =>
      expect(apiMocks.getKnowledgeSynthesis).toHaveBeenCalledWith(
        'synthesis-a',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /統合知B.*version 1/ }));
    await waitFor(() =>
      expect(apiMocks.getKnowledgeSynthesis).toHaveBeenCalledWith(
        'synthesis-b',
      ),
    );

    pendingB.resolve(detailB);
    expect((await screen.findAllByText('新しい選択の本文'))[0]).toBeVisible();
    pendingA.resolve(detailA);
    await waitFor(() =>
      expect(screen.queryByText('古い選択の本文')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: '統合知B' })).toBeVisible();
  });

  it('does not render the previous item context while switching items', async () => {
    const oldSynthesis = makeSynthesis({ title: '旧項目だけの統合知' });
    const nextList = deferred<{
      items: KnowledgeSynthesis[];
      nextCursor: string | null;
    }>();
    apiMocks.listKnowledgeSyntheses
      .mockResolvedValueOnce(page([oldSynthesis]))
      .mockReturnValueOnce(nextList.promise);
    const view = render(
      <KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />,
    );

    expect(
      await screen.findByRole('button', { name: /旧項目だけの統合知/ }),
    ).toBeVisible();
    view.rerender(
      <KnowledgeSynthesisPanel itemId="item-2" itemScope="personal" />,
    );

    expect(screen.queryByText('旧項目だけの統合知')).not.toBeInTheDocument();
    nextList.resolve(page([]));
    await waitFor(() =>
      expect(apiMocks.listKnowledgeSyntheses).toHaveBeenCalledTimes(2),
    );
  });

  it('ignores a pending global-list page after the item context changes', async () => {
    const firstPage = makeSynthesis({ id: 'synthesis-old', title: '旧一覧' });
    const stalePage = makeSynthesis({
      id: 'synthesis-stale',
      title: '別contextへ漏れてはいけない統合知',
    });
    const pendingPage = deferred<{
      items: KnowledgeSynthesis[];
      nextCursor: string | null;
    }>();
    apiMocks.listKnowledgeSyntheses
      .mockResolvedValueOnce(page([firstPage], 'stale-cursor'))
      .mockReturnValueOnce(pendingPage.promise)
      .mockResolvedValueOnce(page([]));
    const view = render(
      <KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />,
    );

    await screen.findByRole('button', { name: /旧一覧/ });
    fireEvent.click(
      screen.getByRole('button', { name: '統合知をさらに読み込む' }),
    );
    await waitFor(() =>
      expect(apiMocks.listKnowledgeSyntheses).toHaveBeenCalledTimes(2),
    );

    view.rerender(
      <KnowledgeSynthesisPanel itemId="item-2" itemScope="personal" />,
    );
    await waitFor(() =>
      expect(apiMocks.listKnowledgeSyntheses).toHaveBeenCalledTimes(3),
    );
    pendingPage.resolve(page([stalePage]));

    await waitFor(() =>
      expect(
        screen.queryByText('別contextへ漏れてはいけない統合知'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('旧一覧')).not.toBeInTheDocument();
  });

  it.each([
    {
      label: '404',
      error: new KnowledgeHubApiError('not_found', 404),
      expected: '対象が見つからないか、現在の権限では参照できません。',
      secret: '',
    },
    {
      label: 'raw error',
      error: new Error('SQL actor_id=user-db-secret source_id=raw-secret'),
      expected: '処理を完了できませんでした。再試行してください。',
      secret: 'user-db-secret',
    },
  ])('sanitizes $label failures', async ({ error, expected, secret }) => {
    apiMocks.listKnowledgeSyntheses.mockRejectedValue(error);
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    expect(await screen.findByText(expected)).toBeVisible();
    if (secret) {
      expect(screen.queryByText(new RegExp(secret))).not.toBeInTheDocument();
    }
  });

  it('uses keyboard-native, programmatically labelled form controls', async () => {
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);
    await waitForInitialList();

    const title = screen.getByRole('textbox', { name: 'タイトル' });
    const content = screen.getByRole('textbox', { name: '本文' });
    const confidence = screen.getByRole('spinbutton', {
      name: '確信度（%）',
    });
    const questions = screen.getByRole('textbox', {
      name: '未解決の質問',
    });
    const submit = screen.getByRole('button', { name: '統合知を作成' });

    expect(title.tagName).toBe('INPUT');
    expect(content.tagName).toBe('TEXTAREA');
    expect(confidence).toHaveAttribute('type', 'number');
    expect(confidence).toHaveAttribute('min', '0');
    expect(confidence).toHaveAttribute('max', '100');
    expect(questions.tagName).toBe('TEXTAREA');
    expect(submit).toHaveAttribute('type', 'submit');

    title.focus();
    expect(title).toHaveFocus();
    content.focus();
    expect(content).toHaveFocus();
    confidence.focus();
    expect(confidence).toHaveFocus();
    questions.focus();
    expect(questions).toHaveFocus();
  });

  it('associates create validation errors with the invalid fields', async () => {
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);
    await waitForInitialList();

    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));
    const title = screen.getByRole('textbox', { name: 'タイトル' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-describedby');
    expect(screen.getByText('タイトルを入力してください。')).toBeVisible();

    fireEvent.change(title, { target: { value: '検証対象' } });
    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));
    const content = screen.getByRole('textbox', { name: '本文' });
    expect(title).not.toHaveAttribute('aria-invalid', 'true');
    expect(content).toHaveAttribute('aria-invalid', 'true');
    expect(content).toHaveAttribute('aria-describedby');
    expect(screen.getByText('本文を入力してください。')).toBeVisible();

    fireEvent.change(content, { target: { value: '本文' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '確信度（%）' }), {
      target: { value: '101' },
    });
    fireEvent.click(screen.getByRole('button', { name: '統合知を作成' }));
    const confidence = screen.getByRole('spinbutton', {
      name: '確信度（%）',
    });
    expect(confidence).toHaveAttribute('aria-invalid', 'true');
    expect(confidence).toHaveAttribute('aria-describedby');
    expect(
      screen.getByText('確信度は0以上100以下の数値で入力してください。'),
    ).toBeVisible();
    expect(apiMocks.createKnowledgeSynthesis).not.toHaveBeenCalled();
  });

  it('associates append validation errors with fields for a related synthesis', async () => {
    const detail = makeDetail(
      {},
      {
        sources: [makeSource({ sourceId: 'item-1' })],
      },
    );
    apiMocks.listKnowledgeSyntheses.mockResolvedValue(page([detail.synthesis]));
    apiMocks.getKnowledgeSynthesis.mockResolvedValue(detail);
    apiMocks.listKnowledgeSynthesisVersions.mockResolvedValue(
      page([detail.currentVersion]),
    );
    render(<KnowledgeSynthesisPanel itemId="item-1" itemScope="personal" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /市場動向の統合知/ }),
    );
    const submit = await screen.findByRole('button', {
      name: '新しいversionを追加',
    });
    fireEvent.click(submit);
    const content = screen.getByRole('textbox', { name: '追加する本文' });
    expect(content).toHaveAttribute('aria-invalid', 'true');
    expect(content).toHaveAttribute('aria-describedby');
    expect(screen.getByText('本文を入力してください。')).toBeVisible();

    fireEvent.change(content, { target: { value: '追加本文' } });
    fireEvent.change(
      screen.getByRole('spinbutton', { name: '追加版の確信度（%）' }),
      { target: { value: '-1' } },
    );
    fireEvent.click(submit);
    const confidence = screen.getByRole('spinbutton', {
      name: '追加版の確信度（%）',
    });
    expect(confidence).toHaveAttribute('aria-invalid', 'true');
    expect(confidence).toHaveAttribute('aria-describedby');
    expect(
      screen.getByText('確信度は0以上100以下の数値で入力してください。'),
    ).toBeVisible();
    expect(apiMocks.appendKnowledgeSynthesisVersion).not.toHaveBeenCalled();
  });
});
