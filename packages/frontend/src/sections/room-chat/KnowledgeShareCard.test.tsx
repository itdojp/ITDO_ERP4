import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateToOpen, openKnowledgeShareSource } = vi.hoisted(() => ({
  navigateToOpen: vi.fn(),
  openKnowledgeShareSource: vi.fn(),
}));

vi.mock('../../utils/deepLink', () => ({ navigateToOpen }));
vi.mock('../knowledge-share/knowledgeShareApi', () => ({
  openKnowledgeShareSource,
}));

import type { KnowledgeShareRoomCard } from '../knowledge-share/knowledgeShareModel';
import { KnowledgeShareCard } from './KnowledgeShareCard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function postedCard(): KnowledgeShareRoomCard {
  return {
    shareId: 'share-secret-id',
    status: 'posted',
    version: 3,
    schemaVersion: 1,
    canOpenSource: true,
    card: {
      schemaVersion: 1,
      title: '選択されたタイトル',
      sourceType: 'web',
      canonicalUrl: 'https://example.com/safe-path',
      snapshot: {
        version: 4,
        sha256: 'a'.repeat(64),
        excerpt: '選択された抜粋',
      },
      sharerNote: '共有者のメモ',
      labels: [{ displayName: '設計' }],
      annotations: [
        {
          revision: 2,
          kind: 'quote',
          origin: 'user',
          content: '選択された注釈',
        },
      ],
      turns: [
        {
          role: 'assistant',
          origin: 'ai',
          content: '選択されたターン',
          name: null,
          occurredAt: '2026-08-10T01:00:00.000Z',
        },
      ],
      syntheses: [
        {
          version: 1,
          title: '統合タイトル',
          content: '統合内容',
          confidenceBasisPoints: 7500,
          unresolvedQuestions: ['未解決事項'],
        },
      ],
      selectedCategories: [
        'title',
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
      omittedCategories: [],
    },
  };
}

describe('KnowledgeShareCard', () => {
  beforeEach(() => {
    navigateToOpen.mockReset();
    openKnowledgeShareSource.mockReset();
  });

  afterEach(() => cleanup());

  it('renders selected values with semantic labels without envelope identifiers', () => {
    const knowledgeShare = postedCard();
    render(<KnowledgeShareCard knowledgeShare={knowledgeShare} />);

    const article = screen.getByRole('article', {
      name: '共有されたナレッジ',
    });
    expect(
      within(article).getAllByText('タイトル', { selector: 'dt' }),
    ).toHaveLength(2);
    expect(within(article).getByText('選択されたタイトル')).toBeVisible();
    expect(within(article).getByText('情報源の種類')).toBeVisible();
    expect(within(article).getByText('共有URL')).toBeVisible();
    expect(within(article).getByText('選択された抜粋')).toBeVisible();
    expect(within(article).getByText('選択された注釈')).toBeVisible();
    expect(within(article).getByText('引用')).toBeVisible();
    expect(within(article).getByText('利用者')).toBeVisible();
    expect(within(article).getByText('選択されたターン')).toBeVisible();
    expect(within(article).getByText('アシスタント')).toBeVisible();
    expect(within(article).getByText('AI')).toBeVisible();
    expect(within(article).getByText('統合内容')).toBeVisible();
    expect(within(article).getByText('75.00%')).toBeVisible();
    expect(article).not.toHaveTextContent('share-secret-id');
  });

  it('shows the share timestamp only when the caller supplies it and drops internal extras', () => {
    const knowledgeShare = {
      ...postedCard(),
      providerKey: 'provider-secret',
      internalSourceId: 'internal-source-secret',
      card: {
        ...postedCard().card,
        sourceKnowledgeItemId: 'source-item-secret',
      },
    } as unknown as KnowledgeShareRoomCard;
    const { container, rerender } = render(
      <KnowledgeShareCard knowledgeShare={knowledgeShare} />,
    );

    expect(screen.queryByText(/共有日時/)).toBeNull();
    expect(container.innerHTML).not.toMatch(
      /share-secret-id|provider-secret|internal-source-secret|source-item-secret/,
    );

    rerender(
      <KnowledgeShareCard
        knowledgeShare={knowledgeShare}
        sharedAt="2026-08-10T01:02:00.000Z"
      />,
    );
    expect(screen.getByText(/共有日時/)).toBeVisible();
  });

  it('guards rendering with selected categories even for a malformed typed value', () => {
    const knowledgeShare = postedCard();
    knowledgeShare.card = {
      ...knowledgeShare.card!,
      sourceType: 'web',
      canonicalUrl: 'https://private.invalid/not-selected',
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
    };

    render(<KnowledgeShareCard knowledgeShare={knowledgeShare} />);

    expect(screen.getByText('選択されたタイトル')).toBeVisible();
    expect(
      screen.queryByText('https://private.invalid/not-selected'),
    ).toBeNull();
    expect(screen.queryByText('選択された抜粋')).toBeNull();
    expect(screen.queryByText('選択された注釈')).toBeNull();
  });

  it('renders a content-free revoked placeholder', () => {
    const maliciousValue = {
      ...postedCard(),
      status: 'revoked',
      canOpenSource: false,
      card: {
        ...postedCard().card,
        title: '取り消し後に見えてはいけない内容',
      },
    } as unknown as KnowledgeShareRoomCard;

    render(<KnowledgeShareCard knowledgeShare={maliciousValue} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'このナレッジ共有は取り消されました',
    );
    expect(screen.queryByText('取り消し後に見えてはいけない内容')).toBeNull();
    expect(
      screen.queryByRole('button', { name: '元のナレッジを開く' }),
    ).toBeNull();
  });

  it('resolves the source through the API before navigating to a knowledge item', async () => {
    openKnowledgeShareSource.mockResolvedValueOnce({
      knowledgeItemId: 'knowledge-item-1',
    });
    render(<KnowledgeShareCard knowledgeShare={postedCard()} />);

    fireEvent.click(screen.getByRole('button', { name: '元のナレッジを開く' }));

    await waitFor(() =>
      expect(navigateToOpen).toHaveBeenCalledWith({
        kind: 'knowledge_item',
        id: 'knowledge-item-1',
      }),
    );
    expect(openKnowledgeShareSource).toHaveBeenCalledWith('share-secret-id', {
      signal: expect.any(AbortSignal),
    });
  });

  it('shows only a sanitized source-open failure', async () => {
    openKnowledgeShareSource.mockRejectedValueOnce(
      new Error('raw token and private provider URL'),
    );
    render(<KnowledgeShareCard knowledgeShare={postedCard()} />);

    fireEvent.click(screen.getByRole('button', { name: '元のナレッジを開く' }));

    expect(
      await screen.findByText(
        '元のナレッジを開けませんでした。権限を確認してください。',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/raw token|private provider URL/)).toBeNull();
    expect(navigateToOpen).not.toHaveBeenCalled();
  });

  it('aborts a source-open response after current source access is removed', async () => {
    const pending = deferred<{ knowledgeItemId: string }>();
    let signal: AbortSignal | undefined;
    openKnowledgeShareSource.mockImplementationOnce(
      (_shareId: string, options: { signal?: AbortSignal }) => {
        signal = options.signal;
        return pending.promise;
      },
    );
    const knowledgeShare = postedCard();
    const view = render(<KnowledgeShareCard knowledgeShare={knowledgeShare} />);
    fireEvent.click(screen.getByRole('button', { name: '元のナレッジを開く' }));

    view.rerender(
      <KnowledgeShareCard
        knowledgeShare={{ ...knowledgeShare, canOpenSource: false }}
      />,
    );
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ knowledgeItemId: 'stale-item' });
      await pending.promise;
    });

    expect(navigateToOpen).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '元のナレッジを開く' }),
    ).toBeNull();
  });
});
