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

const api = vi.hoisted(() => ({
  previewKnowledgeCapture: vi.fn(),
  commitKnowledgeCapture: vi.fn(),
  reconcileKnowledgeCapture: vi.fn(),
}));
vi.mock('./knowledgeCaptureApi', () => api);
const authGuard = vi.hoisted(() => ({
  revalidateCurrentAuthActor: vi.fn(),
}));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, ...authGuard };
});
const localQueue = vi.hoisted(() => ({
  markShareTargetDraftPending: vi.fn(),
  markShareTargetDraftStaged: vi.fn(),
  publishShareTargetLifecycle: vi.fn(),
}));
vi.mock('../../utils/shareTargetQueue', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/shareTargetQueue')>();
  return { ...actual, ...localQueue };
});

import { KnowledgeCaptureIngress } from './KnowledgeCaptureIngress';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import { knowledgeHubErrorMessage } from './knowledgeHubModel';
import {
  KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT,
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_PURGE_EVENT,
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
        requestKey: 'opaque-request-key-123456789',
        actorKey: 'header:synthetic-user',
        lifecycle: 'staged',
        pendingIntent: null,
        draft: { ...draft, ...overrides },
      },
    }),
  );
}

beforeEach(() => {
  api.previewKnowledgeCapture.mockReset();
  api.commitKnowledgeCapture.mockReset();
  api.reconcileKnowledgeCapture.mockReset();
  authGuard.revalidateCurrentAuthActor.mockReset().mockResolvedValue(true);
  localQueue.markShareTargetDraftPending
    .mockReset()
    .mockResolvedValue(undefined);
  localQueue.markShareTargetDraftStaged
    .mockReset()
    .mockResolvedValue(undefined);
  localQueue.publishShareTargetLifecycle.mockReset();
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

it('hides an existing handoff while the canonical actor is being revalidated', async () => {
  render(<KnowledgeCaptureIngress />);
  deliver();
  expect(
    await screen.findByRole('textbox', { name: '選択テキスト' }),
  ).toHaveValue('Selected body');

  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT, {
      detail: {
        schemaVersion: 1,
        draftId: 'opaque-draft-id-1234567890',
        checking: true,
      },
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'ブラウザー共有の確認' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('Selected body')).not.toBeInTheDocument();

  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT, {
      detail: {
        schemaVersion: 1,
        draftId: 'opaque-draft-id-1234567890',
        checking: false,
      },
    }),
  );
  expect(
    await screen.findByRole('textbox', { name: '選択テキスト' }),
  ).toHaveValue('Selected body');
});

it('purges the draft, preview, and request intent when authentication is lost', async () => {
  render(<KnowledgeCaptureIngress />);
  deliver();
  expect(
    await screen.findByRole('textbox', { name: '選択テキスト' }),
  ).toHaveValue('Selected body');
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(api.previewKnowledgeCapture).toHaveBeenCalled());
  await screen.findByRole('heading', { name: 'Exact preview' });

  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_PURGE_EVENT, {
      detail: {
        schemaVersion: 1,
        draftId: 'opaque-draft-id-1234567890',
      },
    }),
  );

  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'ブラウザー共有の確認' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('Selected body')).not.toBeInTheDocument();
});

it('discards a preview response when the canonical actor changes during the request', async () => {
  authGuard.revalidateCurrentAuthActor
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  render(<KnowledgeCaptureIngress />);
  deliver();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

  await waitFor(() =>
    expect(authGuard.revalidateCurrentAuthActor).toHaveBeenCalledTimes(2),
  );
  expect(api.previewKnowledgeCapture).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole('heading', { name: 'Exact preview' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).not.toBeInTheDocument();
});

it('revalidates the canonical actor before commit and never fixes local pending state for a different session', async () => {
  render(<KnowledgeCaptureIngress />);
  deliver();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  await screen.findByRole('heading', { name: 'Exact preview' });
  authGuard.revalidateCurrentAuthActor.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
  fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));

  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'ブラウザー共有の確認' }),
    ).not.toBeInTheDocument(),
  );
  expect(localQueue.markShareTargetDraftPending).not.toHaveBeenCalled();
  expect(api.commitKnowledgeCapture).not.toHaveBeenCalled();
});

it('compensates a completed local pending write when an auth purge wins the race', async () => {
  let resolvePending: () => void = () => undefined;
  localQueue.markShareTargetDraftPending.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolvePending = resolve;
      }),
  );
  render(<KnowledgeCaptureIngress />);
  deliver();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  await screen.findByRole('heading', { name: 'Exact preview' });
  fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
  fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));
  await waitFor(() =>
    expect(localQueue.markShareTargetDraftPending).toHaveBeenCalledOnce(),
  );

  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_PURGE_EVENT, {
      detail: {
        schemaVersion: 1,
        draftId: 'opaque-draft-id-1234567890',
      },
    }),
  );
  await act(async () => resolvePending());

  await waitFor(() =>
    expect(localQueue.markShareTargetDraftStaged).toHaveBeenCalledWith(
      'opaque-draft-id-1234567890',
      'header:synthetic-user',
    ),
  );
  expect(localQueue.publishShareTargetLifecycle).toHaveBeenLastCalledWith(
    'opaque-draft-id-1234567890',
    'staged',
  );
  expect(api.commitKnowledgeCapture).not.toHaveBeenCalled();
});

it('compensates a completed local pending write after unmount and never calls commit', async () => {
  let resolvePending: () => void = () => undefined;
  localQueue.markShareTargetDraftPending.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolvePending = resolve;
      }),
  );
  const view = render(<KnowledgeCaptureIngress />);
  deliver();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  await screen.findByRole('heading', { name: 'Exact preview' });
  fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
  fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));
  await waitFor(() =>
    expect(localQueue.markShareTargetDraftPending).toHaveBeenCalledOnce(),
  );

  view.unmount();
  await act(async () => resolvePending());

  await waitFor(() =>
    expect(localQueue.markShareTargetDraftStaged).toHaveBeenCalledWith(
      'opaque-draft-id-1234567890',
      'header:synthetic-user',
    ),
  );
  expect(localQueue.publishShareTargetLifecycle).toHaveBeenLastCalledWith(
    'opaque-draft-id-1234567890',
    'staged',
  );
  expect(api.commitKnowledgeCapture).not.toHaveBeenCalled();
});

describe('KnowledgeCaptureIngress', () => {
  it('rehydrates a pending local intent for reconcile without permitting a second commit', async () => {
    render(<KnowledgeCaptureIngress />);
    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_DRAFT_EVENT, {
        detail: {
          draftId: 'opaque-draft-id-1234567890',
          requestKey: 'opaque-request-key-123456789',
          actorKey: 'bff:canonical-account-id',
          lifecycle: 'pending',
          pendingIntent: {
            selectedFields: ['title', 'selectedText'],
            scope: 'personal',
            organizationGroupAccountIds: [],
            sourceType: 'web',
          },
          draft,
        },
      }),
    );

    const previewButton = await screen.findByRole('button', {
      name: 'Preview',
    });
    expect(screen.getByRole('textbox', { name: 'URL' })).toBeDisabled();
    fireEvent.click(previewButton);
    expect(
      await screen.findByText(/結果不明のcaptureを保持しています/),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: '明示確定して保存' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '保存結果を再照合' }),
    ).toBeEnabled();
    expect(api.commitKnowledgeCapture).not.toHaveBeenCalled();
  });

  it('revalidates the canonical actor before read-only reconcile', async () => {
    render(<KnowledgeCaptureIngress />);
    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_DRAFT_EVENT, {
        detail: {
          draftId: 'opaque-draft-id-1234567890',
          requestKey: 'opaque-request-key-123456789',
          actorKey: 'bff:canonical-account-id',
          lifecycle: 'pending',
          pendingIntent: {
            selectedFields: ['title', 'selectedText'],
            scope: 'personal',
            organizationGroupAccountIds: [],
            sourceType: 'web',
          },
          draft,
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByText(/結果不明のcaptureを保持しています/);
    authGuard.revalidateCurrentAuthActor.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '保存結果を再照合' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'ブラウザー共有の確認' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.reconcileKnowledgeCapture).not.toHaveBeenCalled();
  });

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
    expect(api.previewKnowledgeCapture.mock.calls[0][0].requestKey).toBe(
      'opaque-request-key-123456789',
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
    expect(localQueue.markShareTargetDraftPending).toHaveBeenCalledWith(
      'opaque-draft-id-1234567890',
      'header:synthetic-user',
      {
        selectedFields: ['title', 'url', 'selectedText'],
        scope: 'personal',
        organizationGroupAccountIds: [],
        sourceType: 'web',
      },
      draft,
    );
    expect(api.commitKnowledgeCapture.mock.calls[0][0].requestKey).toBe(
      'opaque-request-key-123456789',
    );
    expect(onCommitted).toHaveBeenCalledWith('item-1');
    expect(await screen.findByText('保存しました。')).toBeVisible();
  });

  it('shows every selected normalized value in the exact preview', async () => {
    api.previewKnowledgeCapture.mockResolvedValueOnce({
      captureId: 'capture-1',
      draft: {
        ...draft,
        title: 'Normalized title',
        description: 'normalized-private-description',
      },
      selectedFields: ['title', 'url', 'selectedText', 'description'],
      omittedFields: ['author', 'publishedAt'],
      scope: 'personal',
      organizationGroupAccountIds: [],
      sourceType: 'web',
      fieldCount: 4,
      byteCount: 150,
      duplicateCandidate: { detected: false, status: null },
      requiresOrganizationConfirmation: false,
      previewToken: 'opaque-preview-token',
      expiresAt: '2026-08-14T00:10:00.000Z',
    });
    render(<KnowledgeCaptureIngress />);
    deliver();
    fireEvent.click(await screen.findByRole('checkbox', { name: '説明' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    expect(screen.getByText('Normalized title')).toBeVisible();
    expect(screen.getByText('normalized-private-description')).toBeVisible();
    expect(screen.getByText(/保存しないfield: 著者、公開日時/)).toBeVisible();
  });

  it('acquires the parent navigation lock synchronously before commit I/O', async () => {
    let resolveCommit!: (value: unknown) => void;
    let resolveRefresh!: () => void;
    api.commitKnowledgeCapture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const onCommitBusyChange = vi.fn();
    const onCommitted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    render(
      <KnowledgeCaptureIngress
        onCommitted={onCommitted}
        onCommitBusyChange={onCommitBusyChange}
      />,
    );
    deliver();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));
    expect(onCommitBusyChange).toHaveBeenLastCalledWith(true);
    await waitFor(() =>
      expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1),
    );
    resolveCommit({
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
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith('item-1'));
    expect(onCommitBusyChange).toHaveBeenLastCalledWith(true);
    resolveRefresh();
    await waitFor(() =>
      expect(onCommitBusyChange).toHaveBeenLastCalledWith(false),
    );
  });

  it('rejects incoming drafts and mutations while another Knowledge mutation owns the lock', async () => {
    const { rerender } = render(
      <KnowledgeCaptureIngress mutationBlocked={true} />,
    );
    deliver();
    expect(
      screen.queryByRole('heading', { name: 'ブラウザー共有の確認' }),
    ).not.toBeInTheDocument();

    rerender(<KnowledgeCaptureIngress mutationBlocked={false} />);
    deliver();
    expect(
      await screen.findByRole('heading', { name: 'ブラウザー共有の確認' }),
    ).toBeVisible();
    rerender(<KnowledgeCaptureIngress mutationBlocked={true} />);
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(api.previewKnowledgeCapture).not.toHaveBeenCalled();
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
          requestKey: 'opaque-request-key-123456789',
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

  it('emits a terminal failed result so a pending local draft can be tombstoned', async () => {
    api.commitKnowledgeCapture.mockResolvedValueOnce({
      captureId: 'capture-1',
      requestCaptureId: 'capture-1',
      itemId: 'item-1',
      snapshotId: 'snapshot-1',
      status: 'failed',
      failureCode: 'snapshot_failed',
      reused: false,
      createdAt: '2026-08-14T00:00:00.000Z',
      committedAt: null,
      failedAt: '2026-08-14T00:00:01.000Z',
    });
    const onCommitBusyChange = vi.fn();
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

    expect(await screen.findByText(/保存に失敗しました/)).toBeVisible();
    expect(events).toContainEqual({
      schemaVersion: 1,
      draftId: 'opaque-draft-id-1234567890',
      outcome: 'failed',
    });
    expect(
      screen.queryByRole('button', { name: '保存結果を再照合' }),
    ).not.toBeInTheDocument();
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
          requestKey: 'opaque-request-key-123456789',
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

  it('keeps a not-found response as result-unknown because it can occur after artifact I/O', async () => {
    const onCommitBusyChange = vi.fn();
    api.commitKnowledgeCapture.mockRejectedValueOnce(
      new KnowledgeHubApiError('not_found', 404),
    );
    render(<KnowledgeCaptureIngress onCommitBusyChange={onCommitBusyChange} />);
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
    expect(onCommitBusyChange).toHaveBeenLastCalledWith(true);

    deliver({ title: 'A second handoff must not replace the locked intent' });
    expect(screen.getByDisplayValue('Synthetic page')).toBeDisabled();
    expect(
      screen.queryByDisplayValue(
        'A second handoff must not replace the locked intent',
      ),
    ).not.toBeInTheDocument();
    expect(api.commitKnowledgeCapture).toHaveBeenCalledTimes(1);
  });

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

  it('releases the intent lock after a transaction conflict before dispatch', async () => {
    const onCommitBusyChange = vi.fn();
    api.commitKnowledgeCapture.mockRejectedValueOnce(
      new KnowledgeHubApiError(
        'capture_transaction_conflict_pre_dispatch',
        409,
      ),
    );
    render(<KnowledgeCaptureIngress onCommitBusyChange={onCommitBusyChange} />);
    deliver();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'このexact previewを保存します',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));

    expect(
      await screen.findByText(
        knowledgeHubErrorMessage('capture_transaction_conflict_pre_dispatch'),
      ),
    ).toBeInTheDocument();
    expect(onCommitBusyChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  });
});
