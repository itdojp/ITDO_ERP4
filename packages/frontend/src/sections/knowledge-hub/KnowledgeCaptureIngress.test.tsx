import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  previewKnowledgeCapture: vi.fn(),
  commitKnowledgeCapture: vi.fn(),
  reconcileKnowledgeCapture: vi.fn(),
}));
vi.mock('./knowledgeCaptureApi', () => api);

import { KnowledgeCaptureIngress } from './KnowledgeCaptureIngress';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
} from './knowledgeCaptureModel';

const draft = {
  schemaVersion: 1,
  channel: 'browser_extension',
  title: 'Synthetic page',
  url: 'https://example.invalid/',
  selectedText: 'Selected body',
  description: 'private-description-canary',
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};

function deliver(overrides = {}) {
  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_DRAFT_EVENT, {
      detail: {
        draftId: 'opaque-draft-id-1234567890',
        draft: { ...draft, ...overrides },
      },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.previewKnowledgeCapture.mockResolvedValue({
    captureId: 'capture-1',
    draft,
    selectedFields: ['title', 'url', 'selectedText'],
    omittedFields: ['description'],
    scope: 'personal',
    organizationGroupAccountIds: [],
    sourceType: 'web',
    fieldCount: 3,
    byteCount: 120,
    duplicateCandidate: { detected: false, status: null },
    requiresOrganizationConfirmation: false,
    previewToken: 'opaque-preview-token',
    expiresAt: '2026-08-14T00:10:00.000Z',
  });
  api.commitKnowledgeCapture.mockResolvedValue({
    captureId: 'capture-1',
    requestCaptureId: 'capture-1',
    itemId: 'item-1',
    snapshotId: 'snapshot-1',
    status: 'ready',
    failureCode: null,
    reused: false,
    createdAt: '2026-08-14T00:00:00.000Z',
    committedAt: '2026-08-14T00:00:01.000Z',
    failedAt: null,
  });
});

afterEach(() => cleanup());

describe('KnowledgeCaptureIngress', () => {
  it('does not mutate on receipt and requires preview plus explicit confirmation', async () => {
    const onCommitted = vi.fn();
    render(<KnowledgeCaptureIngress onCommitted={onCommitted} />);
    deliver({ unknownMetadata: 'must-not-render' });

    expect(
      await screen.findByRole('heading', { name: 'ブラウザー共有の確認' }),
    ).toBeVisible();
    expect(api.previewKnowledgeCapture).not.toHaveBeenCalled();
    expect(api.commitKnowledgeCapture).not.toHaveBeenCalled();
    expect(screen.queryByText('must-not-render')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '保存scope' })).toHaveValue(
      'personal',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(api.previewKnowledgeCapture).toHaveBeenCalledTimes(1),
    );
    expect(api.previewKnowledgeCapture.mock.calls[0][0].selectedFields).toEqual(
      ['title', 'url', 'selectedText'],
    );
    expect(
      api.previewKnowledgeCapture.mock.calls[0][0].selectedFields,
    ).not.toContain('description');
    expect(
      await screen.findByRole('heading', { name: 'Exact preview' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: '明示確定して保存' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));
    await waitFor(() =>
      expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1),
    );
    expect(api.commitKnowledgeCapture.mock.calls[0][0].requestKey).toBe(
      'opaque-draft-id-1234567890',
    );
    expect(onCommitted).toHaveBeenCalledWith('item-1');
    expect(await screen.findByText('保存しました。')).toBeVisible();
  });

  it('requires a second organization audience confirmation', async () => {
    render(<KnowledgeCaptureIngress />);
    deliver();
    fireEvent.change(
      await screen.findByRole('combobox', { name: '保存scope' }),
      {
        target: { value: 'organization' },
      },
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: '共有先グループアカウントID' }),
      {
        target: { value: 'group-1' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));
    expect(
      await screen.findByText(
        '組織の共有範囲へ保存することを追加確認してください。',
      ),
    ).toBeVisible();
    expect(api.commitKnowledgeCapture).not.toHaveBeenCalled();
  });

  it('keeps an unknown result pending and reconciles without replaying commit', async () => {
    const onCommitBusyChange = vi.fn();
    api.commitKnowledgeCapture.mockResolvedValueOnce({
      captureId: 'capture-1',
      requestCaptureId: 'capture-1',
      itemId: 'item-1',
      snapshotId: 'snapshot-1',
      status: 'pending',
      failureCode: null,
      reused: false,
      createdAt: '2026-08-14T00:00:00.000Z',
      committedAt: null,
      failedAt: null,
    });
    api.reconcileKnowledgeCapture.mockResolvedValueOnce({
      captureId: 'capture-1',
      requestCaptureId: 'capture-1',
      itemId: 'item-1',
      snapshotId: 'snapshot-1',
      status: 'ready',
      failureCode: null,
      reused: false,
      createdAt: '2026-08-14T00:00:00.000Z',
      committedAt: '2026-08-14T00:00:02.000Z',
      failedAt: null,
    });
    const events: unknown[] = [];
    const listener = (event: Event) =>
      events.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, listener);
    render(<KnowledgeCaptureIngress onCommitBusyChange={onCommitBusyChange} />);
    deliver();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));
    expect(await screen.findByText(/保存結果を確認中/)).toBeVisible();
    expect(onCommitBusyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '保存結果を再照合' }));
    await waitFor(() =>
      expect(api.reconcileKnowledgeCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          preview: expect.objectContaining({ captureId: 'capture-1' }),
          requestKey: 'opaque-draft-id-1234567890',
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      schemaVersion: 1,
      draftId: 'opaque-draft-id-1234567890',
      outcome: 'committed',
    });
    await waitFor(() =>
      expect(onCommitBusyChange).toHaveBeenLastCalledWith(false),
    );
    window.removeEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, listener);
  });

  it('treats a transport failure as result-unknown and reconciles by preview capture ID', async () => {
    api.commitKnowledgeCapture.mockRejectedValueOnce(
      new TypeError('synthetic network failure with private detail'),
    );
    api.reconcileKnowledgeCapture.mockResolvedValueOnce({
      captureId: 'capture-1',
      requestCaptureId: 'capture-1',
      itemId: 'item-1',
      snapshotId: 'snapshot-1',
      status: 'ready',
      failureCode: null,
      reused: true,
      createdAt: '2026-08-14T00:00:00.000Z',
      committedAt: '2026-08-14T00:00:02.000Z',
      failedAt: null,
    });
    render(<KnowledgeCaptureIngress />);
    deliver();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));

    expect(await screen.findByText(/保存結果が不明/)).toBeVisible();
    expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
    expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '保存結果を再照合' }));
    await waitFor(() =>
      expect(api.reconcileKnowledgeCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          preview: expect.objectContaining({ captureId: 'capture-1' }),
          requestKey: 'opaque-draft-id-1234567890',
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('既存の保存結果を表示しています。'),
    ).toBeVisible();
  });

  it.each([
    ['HTTP 502', new KnowledgeHubApiError('unknown_error', 502)],
    [
      'invalid success response',
      new KnowledgeHubApiError('invalid_response', 200),
    ],
  ])(
    'keeps %s as result-unknown instead of releasing the handoff',
    async (_label, failure) => {
      api.commitKnowledgeCapture.mockRejectedValueOnce(failure);
      render(<KnowledgeCaptureIngress />);
      deliver();
      fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
      await screen.findByRole('heading', { name: 'Exact preview' });
      fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
      fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));

      expect(await screen.findByText(/保存結果が不明/)).toBeVisible();
      expect(
        screen.getByRole('button', { name: '保存結果を再照合' }),
      ).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
      expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1);
    },
  );

  it('treats a server rejection as definite and requires a fresh preview', async () => {
    api.commitKnowledgeCapture.mockRejectedValueOnce(
      new KnowledgeHubApiError('preview_token_expired', 409),
    );
    render(<KnowledgeCaptureIngress />);
    deliver();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));

    await waitFor(() => expect(api.commitKnowledgeCapture).toHaveBeenCalled());
    expect(screen.queryByText(/保存結果が不明/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Exact preview' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: '明示確定して保存' }),
    ).toBeDisabled();
  });
});
