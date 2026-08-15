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

const {
  getAuthState,
  isBffAuthMode,
  refreshAuthStateFromServer,
  subscribeAuthSessionChanges,
  getBrowserCaptureDraft,
  markBrowserCaptureDraftCleanupPending,
  publishBrowserCaptureLifecycle,
  removeBrowserCaptureDraft,
  subscribeBrowserCaptureLifecycle,
} = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  isBffAuthMode: vi.fn(),
  refreshAuthStateFromServer: vi.fn(),
  subscribeAuthSessionChanges: vi.fn(),
  getBrowserCaptureDraft: vi.fn(),
  markBrowserCaptureDraftCleanupPending: vi.fn(),
  publishBrowserCaptureLifecycle: vi.fn(),
  removeBrowserCaptureDraft: vi.fn(),
  subscribeBrowserCaptureLifecycle: vi.fn(),
}));

vi.mock('../../api', () => ({
  AUTH_STORAGE_KEY: 'erp4_auth',
  getAuthState,
  isBffAuthMode,
  refreshAuthStateFromServer,
  subscribeAuthSessionChanges,
}));
vi.mock('../../utils/browserCaptureBridge', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/browserCaptureBridge')>();
  return {
    ...actual,
    getBrowserCaptureDraft,
    markBrowserCaptureDraftCleanupPending,
    publishBrowserCaptureLifecycle,
    removeBrowserCaptureDraft,
    subscribeBrowserCaptureLifecycle,
  };
});
vi.mock('../../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}));

import { BrowserCaptureBridgeError } from '../../utils/browserCaptureBridge';
import {
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_PURGE_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
} from './knowledgeCaptureModel';
import { BrowserCaptureLanding } from './BrowserCaptureLanding';

const draftId = '0123456789abcdef0123456789abcdef';
const requestKey = 'r'.repeat(32);
const actorKey = 'header:synthetic-user';
const draft = {
  schemaVersion: 1 as const,
  channel: 'browser_extension' as const,
  title: 'Synthetic title',
  url: 'https://example.invalid/article',
  selectedText: 'SYNTHETIC-SELECTED-CONTENT',
  description: null,
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};

const currentRecord = () => ({
  schemaVersion: 1 as const,
  id: draftId,
  requestKey,
  lifecycle: 'staged' as const,
  pendingIntent: null,
  draft,
  createdAt: new Date(Date.now()).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

const cleanupRecord = () => ({
  schemaVersion: 1 as const,
  id: draftId,
  lifecycle: 'cleanup_pending' as const,
  createdAt: new Date(Date.now()).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

let lifecycleListener:
  | ((message: {
      schemaVersion: 1;
      draftId: string;
      lifecycle: 'staged' | 'pending' | 'cleanup_pending' | 'terminal';
    }) => void)
  | null = null;

describe('BrowserCaptureLanding', () => {
  beforeEach(() => {
    getAuthState.mockReset().mockReturnValue(null);
    isBffAuthMode.mockReset().mockReturnValue(false);
    refreshAuthStateFromServer.mockReset().mockResolvedValue(null);
    subscribeAuthSessionChanges.mockReset().mockReturnValue(() => undefined);
    getBrowserCaptureDraft.mockReset();
    markBrowserCaptureDraftCleanupPending
      .mockReset()
      .mockResolvedValue(undefined);
    publishBrowserCaptureLifecycle.mockReset();
    removeBrowserCaptureDraft.mockReset().mockResolvedValue(undefined);
    lifecycleListener = null;
    subscribeBrowserCaptureLifecycle
      .mockReset()
      .mockImplementation((listener) => {
        lifecycleListener = listener;
        return () => {
          lifecycleListener = null;
        };
      });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
  });

  it('does not ask the extension for content before server-verified authentication', async () => {
    const activateKnowledgeHub = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );

    await screen.findByText(/ERP4で認証後/);
    expect(getBrowserCaptureDraft).not.toHaveBeenCalled();
    expect(activateKnowledgeHub).not.toHaveBeenCalled();
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
  });

  it('claims and hands off an allowlisted draft only after Knowledge Hub is ready', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    const activateKnowledgeHub = vi.fn(() => true);
    const received: unknown[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);

    const view = render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady={false}
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(activateKnowledgeHub).toHaveBeenCalled());
    expect(getBrowserCaptureDraft).not.toHaveBeenCalled();

    view.rerender(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(received).toHaveLength(1));
    expect(getBrowserCaptureDraft).toHaveBeenCalledWith(
      draftId,
      actorKey,
      expect.any(AbortSignal),
    );
    expect(received[0]).toEqual({
      draftId,
      requestKey,
      actorKey,
      lifecycle: 'staged',
      pendingIntent: null,
      draft,
    });
    window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);
  });

  it('purges the page then deletes the extension draft after a terminal result', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    const clearLanding = vi.fn();
    const purged: unknown[] = [];
    const purgeListener = (event: Event) =>
      purged.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purgeListener);
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(getBrowserCaptureDraft).toHaveBeenCalled());

    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'committed' },
      }),
    );
    await waitFor(() =>
      expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledWith(
        draftId,
        actorKey,
      ),
    );
    await waitFor(() =>
      expect(removeBrowserCaptureDraft).toHaveBeenCalledWith(draftId, actorKey),
    );
    expect(purged.length).toBeGreaterThan(0);
    expect(publishBrowserCaptureLifecycle).toHaveBeenCalledWith(
      draftId,
      'cleanup_pending',
    );
    expect(publishBrowserCaptureLifecycle).toHaveBeenCalledWith(
      draftId,
      'terminal',
    );
    expect(
      publishBrowserCaptureLifecycle.mock.invocationCallOrder[0],
    ).toBeLessThan(
      markBrowserCaptureDraftCleanupPending.mock.invocationCallOrder[0],
    );
    expect(clearLanding).toHaveBeenCalledOnce();
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purgeListener);
  });

  it('retains the claimed actor only for terminal cleanup after auth loss', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await screen.findByText(/Knowledge Hubで送信field/);

    fireEvent(window, new Event('offline'));
    expect(await screen.findByText(/ERP4で認証後/)).toBeVisible();
    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'committed' },
      }),
    );

    await waitFor(() =>
      expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledWith(
        draftId,
        actorKey,
      ),
    );
    await waitFor(() =>
      expect(removeBrowserCaptureDraft).toHaveBeenCalledWith(draftId, actorKey),
    );
    expect(clearLanding).toHaveBeenCalledOnce();
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
    expect(publishBrowserCaptureLifecycle).toHaveBeenCalledWith(
      draftId,
      'terminal',
    );
  });

  it('uses the claimed actor for deterministic expiry cleanup after auth loss', async () => {
    vi.useFakeTimers();
    try {
      const now = Date.parse('2026-08-14T00:00:00.000Z');
      vi.setSystemTime(now);
      getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
      refreshAuthStateFromServer.mockResolvedValue({
        userId: 'synthetic-user',
        roles: [],
        verifiedActorKey: actorKey,
      });
      getBrowserCaptureDraft.mockResolvedValue({
        ...currentRecord(),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 1_000).toISOString(),
      });
      render(
        <BrowserCaptureLanding
          draftId={draftId}
          knowledgeHubReady
          activateKnowledgeHub={() => true}
          clearLanding={vi.fn()}
        />,
      );

      await act(async () => {
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(getBrowserCaptureDraft).toHaveBeenCalledWith(
        draftId,
        actorKey,
        expect.any(AbortSignal),
      );
      fireEvent(window, new Event('offline'));
      await act(async () => {
        vi.advanceTimersByTime(1_001);
        await Promise.resolve();
      });

      expect(removeBrowserCaptureDraft).toHaveBeenCalledWith(draftId, actorKey);
      expect(publishBrowserCaptureLifecycle).toHaveBeenCalledWith(
        draftId,
        'cleanup_pending',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('purges content but preserves a content-free terminal failure result', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(getBrowserCaptureDraft).toHaveBeenCalled());

    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'failed' },
      }),
    );

    expect(
      await screen.findByText(/保存に失敗しました。browser session内/),
    ).toBeVisible();
    expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledWith(
      draftId,
      actorKey,
    );
    expect(removeBrowserCaptureDraft).toHaveBeenCalledWith(draftId, actorKey);
    expect(clearLanding).not.toHaveBeenCalled();
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
    fireEvent(window, new Event('erp4:auth-updated'));
    expect(
      await screen.findByText(/保存に失敗しました。browser session内/),
    ).toBeVisible();
  });

  it('does not claim session content was erased when tombstone persistence fails', async () => {
    window.history.replaceState(null, '', `/?browserCapture=${draftId}`);
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    markBrowserCaptureDraftCleanupPending
      .mockRejectedValueOnce(
        new BrowserCaptureBridgeError('storage_unavailable'),
      )
      .mockResolvedValueOnce(undefined);
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await screen.findByText(/Knowledge Hubで送信field/);

    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'committed' },
      }),
    );
    const retry = await screen.findByRole('button', {
      name: 'browser session内draftの本文消去を再試行',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /content-free化は確認できていない/u,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /本文はbrowser session内でも消去済み/u,
    );
    expect(removeBrowserCaptureDraft).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain('browserCapture');
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();

    fireEvent(window, new Event('erp4:auth-updated'));
    await waitFor(() =>
      expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByRole('button', {
        name: 'browser session内draftの本文消去を再試行',
      }),
    ).toBeVisible();
    expect(screen.queryByText(/物理削除だけを再試行/u)).not.toBeInTheDocument();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledTimes(2),
    );
    expect(removeBrowserCaptureDraft).toHaveBeenCalledOnce();
    expect(clearLanding).toHaveBeenCalledOnce();
  });

  it('retries only idempotent cleanup after a lost delete response', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    removeBrowserCaptureDraft
      .mockRejectedValueOnce(new Error('synthetic response loss'))
      .mockResolvedValueOnce(undefined);
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(getBrowserCaptureDraft).toHaveBeenCalled());

    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'committed' },
      }),
    );
    await screen.findByRole('button', {
      name: 'content-free下書きの物理削除を再試行',
    });
    expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledTimes(1);
    expect(clearLanding).not.toHaveBeenCalled();
    const authCallsBeforeRevalidation =
      refreshAuthStateFromServer.mock.calls.length;
    fireEvent(window, new Event('erp4:auth-updated'));
    await waitFor(() =>
      expect(refreshAuthStateFromServer.mock.calls.length).toBeGreaterThan(
        authCallsBeforeRevalidation,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('認証状態を確認しています。'),
      ).not.toBeInTheDocument(),
    );
    expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1);
    const cleanupRetry = screen.getByRole('button', {
      name: 'content-free下書きの物理削除を再試行',
    });
    expect(cleanupRetry).toBeVisible();
    fireEvent.click(cleanupRetry);
    await waitFor(() =>
      expect(removeBrowserCaptureDraft).toHaveBeenCalledTimes(2),
    );
    expect(clearLanding).toHaveBeenCalledOnce();
    expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledTimes(1);
  });

  it('keeps delete-only cleanup available after terminal deletion fails and auth is lost', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    removeBrowserCaptureDraft
      .mockRejectedValueOnce(new Error('synthetic physical delete failure'))
      .mockResolvedValueOnce(undefined);
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await screen.findByText(/Knowledge Hubで送信field/);

    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'committed' },
      }),
    );
    await screen.findByRole('button', {
      name: 'content-free下書きの物理削除を再試行',
    });

    fireEvent(window, new Event('offline'));
    const retry = await screen.findByRole('button', {
      name: 'content-free下書きの物理削除を再試行',
    });
    expect(removeBrowserCaptureDraft).toHaveBeenCalledTimes(1);
    expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);

    await waitFor(() =>
      expect(removeBrowserCaptureDraft).toHaveBeenCalledTimes(2),
    );
    expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledTimes(1);
    expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1);
    expect(clearLanding).toHaveBeenCalledOnce();
  });

  it('rehydrates a content-free tombstone as delete-only cleanup after remount', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValueOnce(currentRecord());
    removeBrowserCaptureDraft
      .mockRejectedValueOnce(new Error('synthetic physical delete failure'))
      .mockResolvedValueOnce(undefined);
    const draftEvents: unknown[] = [];
    const draftListener = (event: Event) =>
      draftEvents.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, draftListener);

    const first = render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(draftEvents).toHaveLength(1));
    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'committed' },
      }),
    );
    await screen.findByRole('button', {
      name: 'content-free下書きの物理削除を再試行',
    });
    first.unmount();

    getBrowserCaptureDraft.mockResolvedValueOnce(cleanupRecord());
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    const cleanupRetry = await screen.findByRole('button', {
      name: 'content-free下書きの物理削除を再試行',
    });
    expect(draftEvents).toHaveLength(1);
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
    expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledTimes(1);

    fireEvent.click(cleanupRetry);
    await waitFor(() => expect(clearLanding).toHaveBeenCalledOnce());
    expect(removeBrowserCaptureDraft).toHaveBeenCalledTimes(2);
    expect(markBrowserCaptureDraftCleanupPending).toHaveBeenCalledTimes(1);
    window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, draftListener);
  });

  it('purges a stale second tab when another tab reaches a terminal cleanup', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    const clearLanding = vi.fn();
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(getBrowserCaptureDraft).toHaveBeenCalled());

    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'cleanup_pending',
      }),
    );
    expect(clearLanding).toHaveBeenCalledOnce();
  });

  it('purges and detaches a stale second tab before tombstone persistence is confirmed', async () => {
    window.history.replaceState(null, '', `/?browserCapture=${draftId}`);
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    markBrowserCaptureDraftCleanupPending
      .mockRejectedValueOnce(
        new BrowserCaptureBridgeError('storage_unavailable'),
      )
      .mockResolvedValueOnce(undefined);
    const clearLanding = vi.fn();
    const purged: unknown[] = [];
    const purgeListener = (event: Event) =>
      purged.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purgeListener);
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await screen.findByText(/Knowledge Hubで送信field/u);

    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'terminal',
      }),
    );

    const firstRetry = await screen.findByRole('button', {
      name: 'browser session内draftの本文消去を再試行',
    });
    expect(window.location.search).not.toContain('browserCapture');
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
    expect(purged.length).toBeGreaterThan(0);
    expect(clearLanding).not.toHaveBeenCalled();
    expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(firstRetry);
    expect(
      await screen.findByRole('button', {
        name: 'browser session内draftの本文消去を再試行',
      }),
    ).toBeVisible();
    expect(removeBrowserCaptureDraft).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'browser session内draftの本文消去を再試行',
      }),
    );
    await waitFor(() =>
      expect(removeBrowserCaptureDraft).toHaveBeenCalledOnce(),
    );
    expect(clearLanding).toHaveBeenCalledOnce();
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purgeListener);
  });

  it('reloads the exact extension record after another tab changes lifecycle', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft.mockResolvedValue(currentRecord());
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1),
    );

    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'pending',
      }),
    );
    await waitFor(() =>
      expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(2),
    );
  });

  it('requires explicit retry when the extension is unavailable', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    getBrowserCaptureDraft
      .mockRejectedValueOnce(
        new BrowserCaptureBridgeError('extension_unavailable'),
      )
      .mockResolvedValueOnce(currentRecord());
    render(
      <BrowserCaptureLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );

    const retry = await screen.findByRole('button', {
      name: '拡張機能へ再接続',
    });
    expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1);
    const authCallsBeforeRevalidation =
      refreshAuthStateFromServer.mock.calls.length;
    fireEvent(window, new Event('erp4:auth-updated'));
    await waitFor(() =>
      expect(refreshAuthStateFromServer.mock.calls.length).toBeGreaterThan(
        authCallsBeforeRevalidation,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('認証状態を確認しています。'),
      ).not.toBeInTheDocument(),
    );
    expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(1);
    const explicitRetry = screen.getByRole('button', {
      name: '拡張機能へ再接続',
    });
    expect(explicitRetry).toBeVisible();
    fireEvent.click(explicitRetry);
    await waitFor(() =>
      expect(getBrowserCaptureDraft).toHaveBeenCalledTimes(2),
    );
  });
});
