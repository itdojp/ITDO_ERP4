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

import { KnowledgeProvenanceWorkspace } from './KnowledgeProvenanceWorkspace';

afterEach(cleanup);

describe('KnowledgeProvenanceWorkspace', () => {
  it('separates the three provenance workflows with accessible keyboard tabs', () => {
    render(
      <KnowledgeProvenanceWorkspace
        itemId="item-1"
        itemLabel="検証Knowledge"
        itemScope="personal"
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
  });

  it('labels organization scope without exposing identifiers', () => {
    render(
      <KnowledgeProvenanceWorkspace
        itemId="sensitive-item-id"
        itemLabel="組織ナレッジ"
        itemScope="organization"
      />,
    );
    expect(screen.getByText('組織scope', { exact: false })).toBeVisible();
    expect(document.body).not.toHaveTextContent('sensitive-item-id');
  });
});
