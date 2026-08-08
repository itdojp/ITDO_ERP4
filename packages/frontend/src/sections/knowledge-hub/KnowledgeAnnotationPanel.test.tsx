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

const provenanceApi = vi.hoisted(() => ({
  createKnowledgeAnnotation: vi.fn(),
  deleteKnowledgeAnnotation: vi.fn(),
  getKnowledgeAnnotationCapabilities: vi.fn(),
  listKnowledgeAnnotationRevisions: vi.fn(),
  listKnowledgeAnnotations: vi.fn(),
  reviseKnowledgeAnnotation: vi.fn(),
}));

vi.mock('./knowledgeProvenanceApi', () => provenanceApi);

import { KnowledgeHubApiError } from './knowledgeHubApi';
import { KnowledgeAnnotationPanel } from './KnowledgeAnnotationPanel';
import type {
  KnowledgeAnnotation,
  KnowledgeAnnotationRevision,
} from './knowledgeProvenanceModel';

function annotation(
  overrides: Partial<KnowledgeAnnotation> = {},
): KnowledgeAnnotation {
  const id = overrides.id ?? 'annotation-1';
  const currentRevision = overrides.currentRevision ?? 1;
  const kind = overrides.kind ?? 'note';
  const origin = overrides.origin ?? 'user';
  const revision: KnowledgeAnnotationRevision = {
    id: `revision-${currentRevision}`,
    annotationId: id,
    revision: currentRevision,
    kind,
    origin,
    content: '現在の内容',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides.revision,
  };
  return {
    id,
    knowledgeItemId: 'item-1',
    scope: 'personal',
    kind,
    origin,
    currentRevision,
    deletedAt: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
    revision,
  };
}

function revision(
  revisionNumber: number,
  overrides: Partial<KnowledgeAnnotationRevision> = {},
): KnowledgeAnnotationRevision {
  return {
    id: `revision-${revisionNumber}`,
    annotationId: 'annotation-1',
    revision: revisionNumber,
    kind: 'note',
    origin: 'user',
    content: `改訂内容 ${revisionNumber}`,
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, nextCursor };
}

beforeEach(() => {
  vi.resetAllMocks();
  provenanceApi.listKnowledgeAnnotations.mockResolvedValue(page([]));
  provenanceApi.getKnowledgeAnnotationCapabilities.mockResolvedValue({
    canManageAnnotations: true,
  });
  provenanceApi.listKnowledgeAnnotationRevisions.mockResolvedValue(page([]));
});

afterEach(cleanup);

describe('KnowledgeAnnotationPanel', () => {
  it('creates an annotation with the selected kind, origin, and content', async () => {
    const created = annotation({
      kind: 'question',
      origin: 'external',
      revision: {
        id: 'revision-1',
        annotationId: 'annotation-1',
        revision: 1,
        kind: 'question',
        origin: 'external',
        content: '確認が必要です',
        createdAt: '2026-08-08T00:00:00.000Z',
      },
    });
    provenanceApi.createKnowledgeAnnotation.mockResolvedValue(created);

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    await screen.findByText('アノテーションはありません');

    fireEvent.change(screen.getByLabelText('新規アノテーションの種別'), {
      target: { value: 'question' },
    });
    fireEvent.change(screen.getByLabelText('新規アノテーションの由来'), {
      target: { value: 'external' },
    });
    fireEvent.change(screen.getByLabelText(/新規アノテーションの内容/u), {
      target: { value: '  確認が必要です  ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'アノテーションを作成' }),
    );

    await waitFor(() =>
      expect(provenanceApi.createKnowledgeAnnotation).toHaveBeenCalledWith({
        itemId: 'item-1',
        kind: 'question',
        origin: 'external',
        content: '確認が必要です',
      }),
    );
    const card = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    expect(within(card).getByText('確認が必要です')).toBeInTheDocument();
    expect(within(card).getByText('質問')).toBeInTheDocument();
    expect(within(card).getByText('外部情報')).toBeInTheDocument();
  });

  it('starts revision from current values and revises content, kind, and origin', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([annotation()]),
    );
    const revised = annotation({
      currentRevision: 2,
      kind: 'hypothesis',
      origin: 'ai',
      updatedAt: '2026-08-08T01:00:00.000Z',
      revision: {
        id: 'revision-2',
        annotationId: 'annotation-1',
        revision: 2,
        kind: 'hypothesis',
        origin: 'ai',
        content: '改訂した内容',
        createdAt: '2026-08-08T01:00:00.000Z',
      },
    });
    const revisionRequest = deferred<KnowledgeAnnotation>();
    provenanceApi.reviseKnowledgeAnnotation.mockReturnValue(
      revisionRequest.promise,
    );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    const card = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    fireEvent.click(within(card).getByRole('button', { name: '改訂' }));

    expect(screen.getByLabelText('改訂後の種別')).toHaveValue('note');
    expect(screen.getByLabelText('改訂後の由来')).toHaveValue('user');
    expect(screen.getByLabelText(/改訂後の内容/u)).toHaveValue('現在の内容');

    fireEvent.change(screen.getByLabelText('改訂後の種別'), {
      target: { value: 'hypothesis' },
    });
    fireEvent.change(screen.getByLabelText('改訂後の由来'), {
      target: { value: 'ai' },
    });
    fireEvent.change(screen.getByLabelText(/改訂後の内容/u), {
      target: { value: '改訂した内容' },
    });
    fireEvent.submit(
      screen.getByRole('form', { name: 'アノテーション 1 を改訂' }),
    );

    await waitFor(() =>
      expect(provenanceApi.reviseKnowledgeAnnotation).toHaveBeenCalledWith({
        itemId: 'item-1',
        annotationId: 'annotation-1',
        expectedRevision: 1,
        kind: 'hypothesis',
        origin: 'ai',
        content: '改訂した内容',
      }),
    );
    await act(async () => {
      revisionRequest.resolve(revised);
      await revisionRequest.promise;
    });
    expect(screen.getByText('改訂した内容')).toBeInTheDocument();
    expect(within(card).getByText('仮説')).toBeInTheDocument();
    expect(within(card).getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('現在の改訂: 2')).toBeInTheDocument();
  });

  it('shows readable revision history without raw annotation or actor IDs', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([annotation()]),
    );
    provenanceApi.listKnowledgeAnnotationRevisions.mockResolvedValue(
      page([
        {
          id: 'database-revision-id',
          annotationId: 'annotation-1',
          revision: 1,
          kind: 'quote',
          origin: 'external',
          content: '過去の引用内容',
          createdAt: '2026-08-07T00:00:00.000Z',
        },
      ]),
    );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    const card = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    fireEvent.click(within(card).getByRole('button', { name: '改訂履歴' }));

    const history = await screen.findByRole('region', {
      name: 'アノテーションの改訂履歴',
    });
    expect(within(history).getByText('過去の引用内容')).toBeInTheDocument();
    expect(within(history).getByText('引用')).toBeInTheDocument();
    expect(within(history).getByText('外部情報')).toBeInTheDocument();
    expect(history).not.toHaveTextContent('database-revision-id');
    expect(history).not.toHaveTextContent('annotation-1');
    expect(provenanceApi.listKnowledgeAnnotationRevisions).toHaveBeenCalledWith(
      {
        itemId: 'item-1',
        annotationId: 'annotation-1',
        cursor: null,
      },
    );
  });

  it('loads annotation pages by cursor and merges duplicate rows without changing order', async () => {
    provenanceApi.listKnowledgeAnnotations
      .mockResolvedValueOnce(page([annotation()], 'annotation-cursor-2'))
      .mockResolvedValueOnce(
        page([
          annotation({
            revision: revision(1, { content: '重複行の最新内容' }),
          }),
          annotation({
            id: 'annotation-2',
            revision: revision(1, {
              id: 'revision-annotation-2',
              annotationId: 'annotation-2',
              content: '2ページ目の内容',
            }),
          }),
        ]),
      );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    await screen.findByText('現在の内容');

    const list = screen.getByLabelText('アノテーション一覧');
    fireEvent.click(
      within(list).getByRole('button', { name: 'さらに読み込む' }),
    );

    expect(await screen.findByText('2ページ目の内容')).toBeInTheDocument();
    expect(screen.getByText('重複行の最新内容')).toBeInTheDocument();
    expect(screen.queryByText('現在の内容')).not.toBeInTheDocument();
    expect(within(list).getAllByRole('article')).toHaveLength(2);
    expect(provenanceApi.listKnowledgeAnnotations).toHaveBeenNthCalledWith(
      1,
      'item-1',
      { cursor: null, includeDeleted: true },
    );
    expect(provenanceApi.listKnowledgeAnnotations).toHaveBeenNthCalledWith(
      2,
      'item-1',
      { cursor: 'annotation-cursor-2', includeDeleted: true },
    );
    expect(
      within(list).queryByRole('button', { name: 'さらに読み込む' }),
    ).not.toBeInTheDocument();
  });

  it('loads revision pages by cursor and merges duplicate revisions once', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([annotation()]),
    );
    provenanceApi.listKnowledgeAnnotationRevisions
      .mockResolvedValueOnce(
        page([revision(2, { content: '改訂2の初期内容' })], 'history-cursor-2'),
      )
      .mockResolvedValueOnce(
        page([
          revision(2, { content: '改訂2の最新内容' }),
          revision(1, { content: '改訂1の内容' }),
        ]),
      );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    const annotationCard = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    fireEvent.click(
      within(annotationCard).getByRole('button', { name: '改訂履歴' }),
    );

    const history = await screen.findByRole('region', {
      name: 'アノテーションの改訂履歴',
    });
    fireEvent.click(
      within(history).getByRole('button', { name: 'さらに読み込む' }),
    );

    expect(await within(history).findByText('改訂1の内容')).toBeInTheDocument();
    expect(within(history).getByText('改訂2の最新内容')).toBeInTheDocument();
    expect(
      within(history).queryByText('改訂2の初期内容'),
    ).not.toBeInTheDocument();
    expect(
      within(history).getAllByRole('article', { name: /改訂/u }),
    ).toHaveLength(2);
    expect(
      provenanceApi.listKnowledgeAnnotationRevisions,
    ).toHaveBeenNthCalledWith(2, {
      itemId: 'item-1',
      annotationId: 'annotation-1',
      cursor: 'history-cursor-2',
    });
  });

  it('preserves loaded annotations and the cursor when a later page fails', async () => {
    const rawError = new KnowledgeHubApiError('unknown_error', 500);
    rawError.message = 'secret row annotation-1';
    provenanceApi.listKnowledgeAnnotations
      .mockResolvedValueOnce(page([annotation()], 'annotation-cursor-2'))
      .mockRejectedValueOnce(rawError)
      .mockResolvedValueOnce(
        page([
          annotation({
            id: 'annotation-2',
            revision: revision(1, {
              id: 'revision-annotation-2',
              annotationId: 'annotation-2',
              content: '再試行で取得した内容',
            }),
          }),
        ]),
      );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    await screen.findByText('現在の内容');
    const list = screen.getByLabelText('アノテーション一覧');
    fireEvent.click(
      within(list).getByRole('button', { name: 'さらに読み込む' }),
    );

    expect(
      await within(list).findByText(
        '処理を完了できませんでした。再試行してください。',
      ),
    ).toBeInTheDocument();
    expect(within(list).getByText('現在の内容')).toBeInTheDocument();
    expect(within(list).queryByText(/secret row/u)).not.toBeInTheDocument();

    fireEvent.click(
      within(list).getByRole('button', { name: 'さらに読み込む' }),
    );
    expect(
      await within(list).findByText('再試行で取得した内容'),
    ).toBeInTheDocument();
    expect(provenanceApi.listKnowledgeAnnotations).toHaveBeenNthCalledWith(
      3,
      'item-1',
      { cursor: 'annotation-cursor-2', includeDeleted: true },
    );
  });

  it('ignores a stale cursor response after reloading the first page', async () => {
    const stalePage = deferred<{
      items: KnowledgeAnnotation[];
      nextCursor: string | null;
    }>();
    provenanceApi.listKnowledgeAnnotations
      .mockResolvedValueOnce(page([annotation()], 'annotation-cursor-2'))
      .mockReturnValueOnce(stalePage.promise)
      .mockResolvedValueOnce(
        page([
          annotation({
            id: 'annotation-reloaded',
            revision: revision(1, {
              id: 'revision-reloaded',
              annotationId: 'annotation-reloaded',
              content: '再読込後の内容',
            }),
          }),
        ]),
      );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    await screen.findByText('現在の内容');
    fireEvent.click(
      within(screen.getByLabelText('アノテーション一覧')).getByRole('button', {
        name: 'さらに読み込む',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    expect(await screen.findByText('再読込後の内容')).toBeInTheDocument();
    await act(async () => {
      stalePage.resolve(
        page([
          annotation({
            id: 'annotation-stale-page',
            revision: revision(1, {
              id: 'revision-stale-page',
              annotationId: 'annotation-stale-page',
              content: '破棄される古いページ',
            }),
          }),
        ]),
      );
      await stalePage.promise;
    });

    expect(screen.queryByText('破棄される古いページ')).not.toBeInTheDocument();
    expect(screen.getByText('再読込後の内容')).toBeInTheDocument();
    expect(provenanceApi.listKnowledgeAnnotations).toHaveBeenNthCalledWith(
      3,
      'item-1',
      { cursor: null, includeDeleted: true },
    );
  });

  it('keeps logically deleted content readable and disables mutation controls', async () => {
    const deleted = annotation({ deletedAt: '2026-08-08T02:00:00.000Z' });
    provenanceApi.listKnowledgeAnnotations
      .mockResolvedValueOnce(page([annotation()], 'obsolete-cursor'))
      .mockResolvedValue(page([deleted]));
    provenanceApi.deleteKnowledgeAnnotation.mockResolvedValue(deleted);
    provenanceApi.listKnowledgeAnnotationRevisions.mockResolvedValue(
      page([revision(1, { content: '削除後も参照できる履歴' })]),
    );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    const card = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    fireEvent.click(within(card).getByRole('button', { name: '削除' }));

    await waitFor(() =>
      expect(provenanceApi.deleteKnowledgeAnnotation).toHaveBeenCalledWith({
        itemId: 'item-1',
        annotationId: 'annotation-1',
        expectedRevision: 1,
      }),
    );
    expect(await within(card).findByText('状態: 削除済み')).toBeInTheDocument();
    expect(within(card).getByText('現在の内容')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '改訂' })).toBeDisabled();
    expect(
      within(card).getByRole('button', { name: '削除済み' }),
    ).toBeDisabled();
    expect(
      within(card).getByRole('button', { name: '改訂履歴' }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));
    const reloadedCard = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    expect(
      within(reloadedCard).getByText('状態: 削除済み'),
    ).toBeInTheDocument();
    expect(within(reloadedCard).getByText('現在の内容')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'さらに読み込む' }),
    ).not.toBeInTheDocument();
    expect(provenanceApi.listKnowledgeAnnotations).toHaveBeenLastCalledWith(
      'item-1',
      { cursor: null, includeDeleted: true },
    );

    fireEvent.click(
      within(reloadedCard).getByRole('button', { name: '改訂履歴' }),
    );
    expect(
      await screen.findByText('削除後も参照できる履歴'),
    ).toBeInTheDocument();
    expect(
      within(reloadedCard).getByRole('button', { name: '改訂' }),
    ).toBeDisabled();
    expect(
      within(reloadedCard).getByRole('button', { name: '削除済み' }),
    ).toBeDisabled();
  });

  it('renders semantic kind, origin, and personal/organization scope labels', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([annotation({ kind: 'todo', origin: 'tool' })]),
    );
    const first = render(
      <KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />,
    );

    const personalCard = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    expect(
      screen.getByText('対象スコープ: personal（個人）'),
    ).toBeInTheDocument();
    expect(within(personalCard).getByText('TODO')).toBeInTheDocument();
    expect(within(personalCard).getByText('Tool')).toBeInTheDocument();
    expect(
      within(personalCard).getByText('personal（個人）'),
    ).toBeInTheDocument();

    first.unmount();
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([
        annotation({
          id: 'annotation-organization',
          knowledgeItemId: 'item-organization',
          scope: 'organization',
          kind: 'quote',
          origin: 'external',
        }),
      ]),
    );
    render(
      <KnowledgeAnnotationPanel
        itemId="item-organization"
        itemScope="organization"
      />,
    );

    const organizationCard = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    expect(
      screen.getByText('対象スコープ: organization（組織）'),
    ).toBeInTheDocument();
    expect(within(organizationCard).getByText('引用')).toBeInTheDocument();
    expect(within(organizationCard).getByText('外部情報')).toBeInTheDocument();
    expect(
      within(organizationCard).getByText('organization（組織）'),
    ).toBeInTheDocument();
  });

  it('renders organization non-owners as read-only from the server capability', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([
        annotation({
          scope: 'organization',
          revision: revision(1, { content: '共有された本人意見' }),
        }),
      ]),
    );
    provenanceApi.getKnowledgeAnnotationCapabilities.mockResolvedValue({
      canManageAnnotations: false,
    });

    render(
      <KnowledgeAnnotationPanel itemId="item-1" itemScope="organization" />,
    );

    expect(await screen.findByText('共有された本人意見')).toBeInTheDocument();
    expect(
      screen.getByText(/このKnowledge itemのアノテーションは閲覧のみ/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('form', { name: 'アノテーションを作成' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改訂' })).toBeNull();
    expect(screen.queryByRole('button', { name: '削除' })).toBeNull();
    expect(
      screen.getByRole('button', { name: '改訂履歴' }),
    ).toBeInTheDocument();
  });

  it('fails closed to read-only when the capability endpoint is unavailable', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([annotation()]),
    );
    provenanceApi.getKnowledgeAnnotationCapabilities.mockRejectedValue(
      new KnowledgeHubApiError('not_found', 404),
    );

    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);

    expect(await screen.findByText('現在の内容')).toBeInTheDocument();
    expect(
      screen.getByText(/このKnowledge itemのアノテーションは閲覧のみ/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('form', { name: 'アノテーションを作成' }),
    ).not.toBeInTheDocument();
  });

  it('does not let a stale list response overwrite a different item', async () => {
    const stale = deferred<{
      items: KnowledgeAnnotation[];
      nextCursor: string | null;
    }>();
    provenanceApi.listKnowledgeAnnotations
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(
        page([
          annotation({
            id: 'annotation-new-item',
            knowledgeItemId: 'item-2',
            revision: {
              id: 'revision-new-item',
              annotationId: 'annotation-new-item',
              revision: 1,
              kind: 'note',
              origin: 'user',
              content: '新しい項目の内容',
              createdAt: '2026-08-08T00:00:00.000Z',
            },
          }),
        ]),
      );

    const view = render(
      <KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />,
    );
    await waitFor(() =>
      expect(provenanceApi.listKnowledgeAnnotations).toHaveBeenCalledWith(
        'item-1',
        { cursor: null, includeDeleted: true },
      ),
    );
    view.rerender(
      <KnowledgeAnnotationPanel itemId="item-2" itemScope="organization" />,
    );

    expect(await screen.findByText('新しい項目の内容')).toBeInTheDocument();
    await act(async () => {
      stale.resolve(
        page([
          annotation({
            revision: {
              id: 'revision-stale',
              annotationId: 'annotation-1',
              revision: 1,
              kind: 'note',
              origin: 'user',
              content: '古い項目の内容',
              createdAt: '2026-08-08T00:00:00.000Z',
            },
          }),
        ]),
      );
      await stale.promise;
    });

    expect(screen.queryByText('古い項目の内容')).not.toBeInTheDocument();
    expect(screen.getByText('新しい項目の内容')).toBeInTheDocument();
    expect(
      screen.getByText('対象スコープ: organization（組織）'),
    ).toBeInTheDocument();
  });

  it('shows only the sanitized KnowledgeHub message for a 404', async () => {
    const error = new KnowledgeHubApiError('not_found', 404);
    error.message = 'actor-secret database row annotation-1';
    provenanceApi.listKnowledgeAnnotations.mockRejectedValue(error);

    render(
      <KnowledgeAnnotationPanel itemId="hidden-item" itemScope="personal" />,
    );

    expect(
      await screen.findByText(
        '対象が見つからないか、現在の権限では参照できません。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/actor-secret/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/database row/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/annotation-1/u)).not.toBeInTheDocument();
  });

  it('uses native labels and forms and associates validation errors with content', async () => {
    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    await screen.findByText('アノテーションはありません');

    const form = screen.getByRole('form', { name: 'アノテーションを作成' });
    const kind = screen.getByLabelText('新規アノテーションの種別');
    const origin = screen.getByLabelText('新規アノテーションの由来');
    const content = screen.getByLabelText(/新規アノテーションの内容/u);
    const submit = screen.getByRole('button', { name: 'アノテーションを作成' });

    expect(kind.tagName).toBe('SELECT');
    expect(origin.tagName).toBe('SELECT');
    expect(content.tagName).toBe('TEXTAREA');
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.closest('form')).toBe(form);

    fireEvent.submit(form);

    expect(content).toHaveAttribute('aria-invalid', 'true');
    expect(content).toHaveAccessibleDescription('内容を入力してください。');
    expect(provenanceApi.createKnowledgeAnnotation).not.toHaveBeenCalled();
  });

  it('associates revision validation errors with the edited content field', async () => {
    provenanceApi.listKnowledgeAnnotations.mockResolvedValue(
      page([annotation()]),
    );
    render(<KnowledgeAnnotationPanel itemId="item-1" itemScope="personal" />);
    const card = await screen.findByRole('article', {
      name: 'アノテーション 1',
    });
    fireEvent.click(within(card).getByRole('button', { name: '改訂' }));

    const form = screen.getByRole('form', {
      name: 'アノテーション 1 を改訂',
    });
    const content = screen.getByLabelText(/改訂後の内容/u);
    fireEvent.change(content, { target: { value: '   ' } });
    fireEvent.submit(form);

    expect(content).toHaveAttribute('aria-invalid', 'true');
    expect(content).toHaveAccessibleDescription('内容を入力してください。');
    expect(provenanceApi.reviseKnowledgeAnnotation).not.toHaveBeenCalled();
  });
});
