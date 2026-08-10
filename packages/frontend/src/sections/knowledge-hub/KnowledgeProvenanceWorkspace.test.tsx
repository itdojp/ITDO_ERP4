import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./KnowledgeAnnotationPanel', () => ({
  KnowledgeAnnotationPanel: () => <div>annotation panel</div>,
}));
vi.mock('./KnowledgeConversationPanel', () => ({
  KnowledgeConversationPanel: () => (
    <div>
      conversation panel
      <input aria-label="conversation draft" />
    </div>
  ),
}));
vi.mock('./KnowledgeSynthesisPanel', () => ({
  KnowledgeSynthesisPanel: () => <div>synthesis panel</div>,
}));
vi.mock('./KnowledgeSharePanel', () => ({
  KnowledgeSharePanel: (props: {
    itemId: string;
    itemLabel: string;
    itemScope: string;
    snapshots: Array<{ id: string }>;
    onCommitBusyChange?: (busy: boolean) => void;
  }) => (
    <div>
      share panel / {props.itemId} / {props.itemLabel} / {props.itemScope} /{' '}
      {props.snapshots.map((snapshot) => snapshot.id).join(',')}
      <button type="button" onClick={() => props.onCommitBusyChange?.(true)}>
        共有確定を開始
      </button>
      <button type="button" onClick={() => props.onCommitBusyChange?.(false)}>
        共有確定を完了
      </button>
    </div>
  ),
}));

import { KnowledgeProvenanceWorkspace } from './KnowledgeProvenanceWorkspace';

afterEach(cleanup);

describe('KnowledgeProvenanceWorkspace', () => {
  it('separates the four provenance/share workflows with accessible keyboard tabs', () => {
    render(
      <KnowledgeProvenanceWorkspace
        itemId="item-1"
        itemLabel="検証Knowledge"
        itemScope="personal"
        snapshots={[
          {
            id: 'snapshot-1',
            knowledgeItemId: 'item-1',
            version: 1,
            status: 'ready',
            captureMethod: 'text',
            sourceUrl: null,
            originalName: 'snapshot.txt',
            contentType: 'text/plain',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
            failureCode: null,
            capturedAt: '2026-08-10T01:00:00.000Z',
            capturedBy: 'user-1',
            readyAt: '2026-08-10T01:00:00.000Z',
            failedAt: null,
            createdAt: '2026-08-10T01:00:00.000Z',
            updatedAt: '2026-08-10T01:00:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByText('個人scope', { exact: false })).toBeVisible();
    expect(screen.getByText('annotation panel')).toBeVisible();
    expect(screen.queryByText('conversation panel')).not.toBeInTheDocument();
    expect(screen.queryByText('synthesis panel')).not.toBeInTheDocument();

    const annotationTab = screen.getByRole('tab', { name: '本人annotation' });
    fireEvent.keyDown(annotationTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '会話・取込' })).toHaveFocus();
    expect(screen.getByText('conversation panel')).toBeVisible();
    const conversationDraft = screen.getByLabelText('conversation draft');
    fireEvent.change(conversationDraft, { target: { value: 'draft value' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Synthesis・結論' }));
    expect(screen.getByText('synthesis panel')).toBeVisible();
    expect(screen.getByText('conversation panel')).not.toBeVisible();
    expect(screen.getByLabelText('conversation draft')).toHaveValue(
      'draft value',
    );

    fireEvent.click(screen.getByRole('tab', { name: '会話・取込' }));
    expect(screen.getByLabelText('conversation draft')).toBeVisible();
    expect(screen.getByLabelText('conversation draft')).toHaveValue(
      'draft value',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Chatへ共有' }));
    expect(
      screen.getByText(
        'share panel / item-1 / 検証Knowledge / personal / snapshot-1',
      ),
    ).toBeVisible();
    expect(screen.getByText('conversation panel')).not.toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: '本人annotation' }));
    expect(
      screen.queryByText(
        'share panel / item-1 / 検証Knowledge / personal / snapshot-1',
      ),
    ).not.toBeInTheDocument();
  });

  it('labels organization scope without exposing identifiers', () => {
    render(
      <KnowledgeProvenanceWorkspace
        itemId="sensitive-item-id"
        itemLabel="組織ナレッジ"
        itemScope="organization"
        snapshots={[]}
      />,
    );
    expect(screen.getByText('組織scope', { exact: false })).toBeVisible();
    expect(document.body).not.toHaveTextContent('sensitive-item-id');
  });

  it('keeps the share panel mounted and locks other tabs during a non-abortable commit', () => {
    const onShareCommitBusyChange = vi.fn();
    render(
      <KnowledgeProvenanceWorkspace
        itemId="item-1"
        itemLabel="確定中Knowledge"
        itemScope="personal"
        snapshots={[]}
        onShareCommitBusyChange={onShareCommitBusyChange}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Chatへ共有' }));
    fireEvent.click(screen.getByRole('button', { name: '共有確定を開始' }));

    expect(onShareCommitBusyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('tab', { name: '本人annotation' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: '会話・取込' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Synthesis・結論' })).toBeDisabled();
    expect(screen.getByText(/確定結果を保持するため/)).toBeVisible();
    expect(screen.getByText(/share panel \/ item-1/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '共有確定を完了' }));
    expect(onShareCommitBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('tab', { name: '本人annotation' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: '本人annotation' }));
    expect(screen.queryByText(/share panel \/ item-1/)).toBeNull();
  });
});
