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
  claimShareTargetDraft,
  markShareTargetDraftCleanupPending,
  publishShareTargetLifecycle,
  removeShareTargetDraft,
  subscribeShareTargetLifecycle,
} = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  isBffAuthMode: vi.fn(),
  refreshAuthStateFromServer: vi.fn(),
  subscribeAuthSessionChanges: vi.fn(),
  claimShareTargetDraft: vi.fn(),
  markShareTargetDraftCleanupPending: vi.fn(),
  publishShareTargetLifecycle: vi.fn(),
  removeShareTargetDraft: vi.fn(),
  subscribeShareTargetLifecycle: vi.fn(),
}));

vi.mock('../../api', () => ({
  AUTH_STORAGE_KEY: 'erp4_auth',
  getAuthState,
  isBffAuthMode,
  refreshAuthStateFromServer,
  subscribeAuthSessionChanges,
}));
vi.mock('../../utils/shareTargetQueue', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/shareTargetQueue')>();
  return {
    ...actual,
    claimShareTargetDraft,
    markShareTargetDraftCleanupPending,
    publishShareTargetLifecycle,
    removeShareTargetDraft,
    subscribeShareTargetLifecycle,
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

import {
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_PURGE_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
} from './knowledgeCaptureModel';
import { ShareTargetLanding } from './ShareTargetLanding';

const draftId = '0123456789abcdef0123456789abcdef';
const requestKey = 'abcdef0123456789abcdef0123456789';
const draft = {
  schemaVersion: 1 as const,
  channel: 'pwa_share_target' as const,
  title: 'Synthetic title',
  url: 'https://example.invalid/article',
  selectedText: 'PRIVATE-INCOMING-CONTENT',
  description: null,
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};
const currentRecord = () => ({
  id: draftId,
  requestKey,
  lifecycle: 'staged' as const,
  pendingIntent: null,
  draft,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const navigatorPrototype = Object.getPrototypeOf(navigator) as Navigator;
const originalOnlineDescriptor = Object.getOwnPropertyDescriptor(
  navigatorPrototype,
  'onLine',
);
let lifecycleListener:
  | ((message: {
      schemaVersion: 1;
      draftId: string;
      lifecycle: 'staged' | 'pending' | 'cleanup_pending';
    }) => void)
  | null = null;
let authSessionChangeListener: (() => void) | null = null;

function verifiedAuth(userId = 'synthetic-user', actorKey?: string) {
  return {
    userId,
    roles: [] as string[],
    verifiedActorKey: actorKey ?? `header:${userId}`,
  };
}

describe('ShareTargetLanding', () => {
  beforeEach(() => {
    getAuthState.mockReset().mockReturnValue(null);
    isBffAuthMode.mockReset().mockReturnValue(false);
    refreshAuthStateFromServer.mockReset().mockResolvedValue(null);
    claimShareTargetDraft.mockReset();
    markShareTargetDraftCleanupPending.mockReset().mockResolvedValue(undefined);
    publishShareTargetLifecycle.mockReset();
    removeShareTargetDraft.mockReset().mockResolvedValue(undefined);
    subscribeAuthSessionChanges.mockReset();
    subscribeShareTargetLifecycle.mockReset().mockReturnValue(() => undefined);
    lifecycleListener = null;
    authSessionChangeListener = null;
    subscribeAuthSessionChanges.mockImplementation((listener) => {
      authSessionChangeListener = listener;
      return () => undefined;
    });
    subscribeShareTargetLifecycle.mockImplementation((listener) => {
      lifecycleListener = listener;
      return () => undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOnlineDescriptor) {
      Object.defineProperty(
        navigatorPrototype,
        'onLine',
        originalOnlineDescriptor,
      );
    } else {
      Reflect.deleteProperty(
        navigatorPrototype as Navigator & { onLine?: unknown },
        'onLine',
      );
    }
    cleanup();
  });

  it('keeps the payload hidden and unread while unauthenticated', async () => {
    const activateKnowledgeHub = vi.fn();
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );

    await screen.findByText(/ログイン後に内容を確認できます/);
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
    expect(claimShareTargetDraft).not.toHaveBeenCalled();
    expect(activateKnowledgeHub).not.toHaveBeenCalled();
  });

  it('loads once after authentication and hands off only when Knowledge Hub is ready', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      ...verifiedAuth(),
      roles: ['member'],
    });
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    const activateKnowledgeHub = vi.fn(() => true);
    const events: unknown[] = [];
    const listener = (event: Event) =>
      events.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);

    const view = render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady={false}
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(activateKnowledgeHub).toHaveBeenCalledTimes(1));
    expect(claimShareTargetDraft).not.toHaveBeenCalled();

    view.rerender(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(claimShareTargetDraft).toHaveBeenCalledWith(
        draftId,
        'header:synthetic-user',
      ),
    );
    expect(events).toEqual([
      {
        draftId,
        requestKey,
        actorKey: 'header:synthetic-user',
        lifecycle: 'staged',
        pendingIntent: null,
        draft,
      },
    ]);

    view.rerender(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );
    expect(claimShareTargetDraft).toHaveBeenCalledTimes(1);
    window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);
  });

  it('resumes on auth-updated without reading the draft before login', async () => {
    getAuthState
      .mockReturnValueOnce(null)
      .mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue({
      ...verifiedAuth(),
      roles: ['member'],
    });
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    const activateKnowledgeHub = vi.fn(() => true);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={activateKnowledgeHub}
        clearLanding={vi.fn()}
      />,
    );
    await screen.findByText(/ログイン後に内容を確認できます/);
    expect(claimShareTargetDraft).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event('erp4:auth-updated')));
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledTimes(1));
    expect(activateKnowledgeHub).toHaveBeenCalled();
  });

  it.each(['committed', 'discarded'] as const)(
    'removes and clears the draft after %s',
    async (outcome) => {
      getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
      refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
      claimShareTargetDraft.mockResolvedValue(currentRecord());
      const clearLanding = vi.fn();
      render(
        <ShareTargetLanding
          draftId={draftId}
          knowledgeHubReady
          activateKnowledgeHub={() => true}
          clearLanding={clearLanding}
        />,
      );
      await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalled());

      act(() =>
        window.dispatchEvent(
          new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
            detail: { schemaVersion: 1, draftId, outcome },
          }),
        ),
      );
      await waitFor(() =>
        expect(removeShareTargetDraft).toHaveBeenCalledWith(
          draftId,
          'header:synthetic-user',
        ),
      );
      expect(markShareTargetDraftCleanupPending).toHaveBeenCalledWith(
        draftId,
        'header:synthetic-user',
        outcome === 'committed',
      );
      expect(
        markShareTargetDraftCleanupPending.mock.invocationCallOrder[0],
      ).toBeLessThan(publishShareTargetLifecycle.mock.invocationCallOrder[0]);
      expect(
        publishShareTargetLifecycle.mock.invocationCallOrder[0],
      ).toBeLessThan(removeShareTargetDraft.mock.invocationCallOrder[0]);
      expect(clearLanding).toHaveBeenCalledTimes(1);
    },
  );

  it('does not react to another draft or an unrecognized result state', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalled());

    fireEvent(
      window,
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: { schemaVersion: 1, draftId, outcome: 'pending' },
      }),
    );
    fireEvent(
      window,
      new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
        detail: {
          schemaVersion: 1,
          draftId: 'f'.repeat(32),
          outcome: 'committed',
        },
      }),
    );
    expect(removeShareTargetDraft).not.toHaveBeenCalled();
  });

  it('does not read a stale local auth session unless the server confirms it', async () => {
    getAuthState.mockReturnValue({ userId: 'stale-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(null);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/ログイン後に内容を確認できます/),
      ).toBeInTheDocument(),
    );
    expect(claimShareTargetDraft).not.toHaveBeenCalled();
    expect(refreshAuthStateFromServer).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchEvent: false,
        allowCachedFallback: false,
        persistState: false,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects a header-mode server actor that differs from the local candidate', async () => {
    getAuthState.mockReturnValue({ userId: 'candidate-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(
      verifiedAuth('different-user'),
    );
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );

    await screen.findByText(/ログイン後に内容を確認できます/);
    expect(claimShareTargetDraft).not.toHaveBeenCalled();
  });

  it('accepts a server-confirmed BFF session without local auth storage', async () => {
    isBffAuthMode.mockReturnValue(true);
    refreshAuthStateFromServer.mockResolvedValue(
      verifiedAuth('legacy-shared-id', 'bff:canonical-account-a'),
    );
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(claimShareTargetDraft).toHaveBeenCalledWith(
        draftId,
        'bff:canonical-account-a',
      ),
    );
  });

  it('purges a handed-off payload when authentication is lost', async () => {
    getAuthState
      .mockReturnValueOnce({ userId: 'synthetic-user', roles: [] })
      .mockReturnValue(null);
    refreshAuthStateFromServer
      .mockResolvedValueOnce(verifiedAuth())
      .mockResolvedValue(null);
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    const purges: unknown[] = [];
    const listener = (event: Event) =>
      purges.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());

    act(() => window.dispatchEvent(new Event('erp4:auth-updated')));
    await waitFor(() =>
      expect(
        screen.getByText(/ログイン後に内容を確認できます/),
      ).toBeInTheDocument(),
    );
    expect(purges).toContainEqual({ schemaVersion: 1, draftId });
    expect(removeShareTargetDraft).not.toHaveBeenCalled();
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
  });

  it('purges a handed-off payload after a cross-tab logout storage event', async () => {
    getAuthState
      .mockReturnValueOnce({ userId: 'synthetic-user', roles: [] })
      .mockReturnValue(null);
    refreshAuthStateFromServer
      .mockResolvedValueOnce(verifiedAuth())
      .mockResolvedValue(null);
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    const purges: unknown[] = [];
    const listener = (event: Event) =>
      purges.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());

    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'erp4_auth',
          oldValue: '{"userId":"synthetic-user"}',
          newValue: null,
        }),
      ),
    );

    await screen.findByText(/ログイン後に内容を確認できます/);
    expect(purges).toContainEqual({ schemaVersion: 1, draftId });
    expect(removeShareTargetDraft).not.toHaveBeenCalled();
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
  });

  it('purges immediately when another tab changes the canonical BFF actor without changing legacy auth storage', async () => {
    isBffAuthMode.mockReturnValue(true);
    getAuthState.mockReturnValue({ userId: 'legacy-shared-id', roles: [] });
    refreshAuthStateFromServer
      .mockResolvedValueOnce(
        verifiedAuth('legacy-shared-id', 'bff:canonical-account-a'),
      )
      .mockResolvedValueOnce(
        verifiedAuth('legacy-shared-id', 'bff:canonical-account-b'),
      );
    claimShareTargetDraft.mockImplementation(
      async (_draftId: string, actorKey: string) =>
        actorKey === 'bff:canonical-account-a' ? currentRecord() : null,
    );
    const handoffs: unknown[] = [];
    const purges: unknown[] = [];
    const handoffListener = (event: Event) =>
      handoffs.push((event as CustomEvent).detail);
    const purgeListener = (event: Event) =>
      purges.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, handoffListener);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purgeListener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());
    expect(handoffs).toHaveLength(1);

    act(() => authSessionChangeListener?.());

    await waitFor(() =>
      expect(claimShareTargetDraft).toHaveBeenLastCalledWith(
        draftId,
        'bff:canonical-account-b',
      ),
    );
    expect(await screen.findByText(/見つかりません/)).toBeVisible();
    expect(purges).toContainEqual({ schemaVersion: 1, draftId });
    expect(handoffs).toHaveLength(1);
    window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, handoffListener);
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purgeListener);
  });

  it('revalidates the server session and resumes explicitly when connectivity returns', async () => {
    const navigatorPrototype = Object.getPrototypeOf(navigator) as Navigator;
    const original = Object.getOwnPropertyDescriptor(
      navigatorPrototype,
      'onLine',
    );
    Object.defineProperty(navigatorPrototype, 'onLine', {
      configurable: true,
      value: false,
    });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    getAuthState
      .mockReturnValueOnce(null)
      .mockReturnValue({ userId: 'synthetic-user', roles: [] });
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await screen.findByText(/ログイン後に内容を確認できます/);

    Object.defineProperty(navigatorPrototype, 'onLine', {
      configurable: true,
      value: true,
    });
    act(() => window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());
    expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(1);
    if (original) {
      Object.defineProperty(navigatorPrototype, 'onLine', original);
    } else {
      Reflect.deleteProperty(
        navigatorPrototype as Navigator & { onLine?: unknown },
        'onLine',
      );
    }
  });

  it('coalesces auth events and performs one fresh verification after the in-flight result', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    let resolveVerification: (value: null) => void = () => undefined;
    refreshAuthStateFromServer.mockReturnValue(
      new Promise((resolve) => {
        resolveVerification = resolve;
      }),
    );
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );

    act(() => {
      window.dispatchEvent(new Event('erp4:auth-updated'));
      window.dispatchEvent(new Event('online'));
    });
    expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(1);
    await act(async () => resolveVerification(null));
    await waitFor(() =>
      expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(2),
    );
    await screen.findByText(/ログイン後に内容を確認できます/);
    expect(claimShareTargetDraft).not.toHaveBeenCalled();
  });

  it('keeps auth verification authoritative when a remote lifecycle update arrives in flight', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    let resolveRevalidation: (
      value: ReturnType<typeof verifiedAuth>,
    ) => void = () => undefined;
    refreshAuthStateFromServer
      .mockResolvedValueOnce(verifiedAuth())
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRevalidation = resolve;
        }),
      );
    claimShareTargetDraft
      .mockResolvedValueOnce(currentRecord())
      .mockResolvedValueOnce({ ...currentRecord(), lifecycle: 'pending' });
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() =>
      expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(2),
    );
    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'pending',
      }),
    );
    await act(async () => resolveRevalidation(verifiedAuth()));

    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/保存結果を確認中です/)).toBeVisible();
  });

  it('does not redispatch the previous actor draft when the canonical BFF actor changes in flight', async () => {
    isBffAuthMode.mockReturnValue(true);
    getAuthState.mockReturnValue({ userId: 'legacy-user', roles: [] });
    let resolveRevalidation: (
      value: ReturnType<typeof verifiedAuth>,
    ) => void = () => undefined;
    refreshAuthStateFromServer
      .mockResolvedValueOnce(verifiedAuth('legacy-user', 'bff:account-a'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRevalidation = resolve;
        }),
      );
    claimShareTargetDraft.mockImplementation(
      async (_draftId: string, actorKey: string) =>
        actorKey === 'bff:account-a' ? currentRecord() : null,
    );
    const handoffs: unknown[] = [];
    const listener = (event: Event) =>
      handoffs.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());
    expect(handoffs).toHaveLength(1);

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() =>
      expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(2),
    );
    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'pending',
      }),
    );
    await act(async () =>
      resolveRevalidation(verifiedAuth('legacy-user', 'bff:account-b')),
    );

    await waitFor(() =>
      expect(claimShareTargetDraft).toHaveBeenLastCalledWith(
        draftId,
        'bff:account-b',
      ),
    );
    expect(await screen.findByText(/見つかりません/)).toBeVisible();
    expect(handoffs).toHaveLength(1);
    window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);
  });

  it('reloads exact remote staged/pending state and purges terminal lifecycle messages', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    claimShareTargetDraft
      .mockResolvedValueOnce(currentRecord())
      .mockResolvedValueOnce({
        ...currentRecord(),
        lifecycle: 'pending',
        pendingIntent: {
          selectedFields: ['title', 'selectedText'],
          scope: 'personal',
          organizationGroupAccountIds: [],
          sourceType: 'web',
        },
        draft: { ...draft, title: 'Exact pending title' },
      })
      .mockResolvedValueOnce({
        ...currentRecord(),
        draft: { ...draft, title: 'Exact restored title' },
      });
    const clearLanding = vi.fn();
    const purges: unknown[] = [];
    const listener = (event: Event) =>
      purges.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());

    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'pending',
      }),
    );
    expect(await screen.findByText(/保存結果を確認中です/)).toBeInTheDocument();
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledTimes(2));
    expect(purges).toContainEqual({ schemaVersion: 1, draftId });

    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'staged',
      }),
    );
    expect(
      await screen.findByText(
        /Knowledge Hubで送信fieldと保存先を確認してください/,
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledTimes(3));

    act(() =>
      lifecycleListener?.({
        schemaVersion: 1,
        draftId,
        lifecycle: 'cleanup_pending',
      }),
    );
    expect(clearLanding).toHaveBeenCalledOnce();
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
  });

  it('purges the handoff and disables preview at the absolute draft expiry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    claimShareTargetDraft.mockResolvedValue({
      ...currentRecord(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    const purges: unknown[] = [];
    const listener = (event: Event) =>
      purges.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByText(/Knowledge Hubで送信fieldと保存先を確認してください/),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(
      screen.getByText(/期限切れ、破棄済み、または見つかりません/),
    ).toBeVisible();
    expect(purges).toContainEqual({ schemaVersion: 1, draftId });
    expect(removeShareTargetDraft).toHaveBeenCalledWith(
      draftId,
      'header:synthetic-user',
    );
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
  });

  it('tombstones a terminal failed result and keeps the opaque URL for cleanup retry', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    removeShareTargetDraft.mockRejectedValueOnce(new Error('storage'));
    const clearLanding = vi.fn();
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());

    const purges: unknown[] = [];
    const listener = (event: Event) =>
      purges.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
    const purgeCountBeforeResult = purges.length;
    act(() =>
      window.dispatchEvent(
        new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
          detail: { schemaVersion: 1, draftId, outcome: 'failed' },
        }),
      ),
    );
    const retry = await screen.findByRole('button', {
      name: '端末内下書きの削除を再試行',
    });
    expect(clearLanding).not.toHaveBeenCalled();
    expect(purges.length).toBeGreaterThan(purgeCountBeforeResult);
    expect(markShareTargetDraftCleanupPending).toHaveBeenCalledWith(
      draftId,
      'header:synthetic-user',
      true,
    );

    removeShareTargetDraft.mockResolvedValueOnce(undefined);
    fireEvent.click(retry);
    expect(
      await screen.findByText(/端末内の共有下書きは消去済みです/),
    ).toBeVisible();
    expect(clearLanding).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() =>
      expect(refreshAuthStateFromServer).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText(/端末内の共有下書きは消去済みです/)).toBeVisible();
    expect(claimShareTargetDraft).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(clearLanding).toHaveBeenCalledOnce();
    window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, listener);
  });

  it('retries a failed tombstone write before attempting physical deletion', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    claimShareTargetDraft.mockResolvedValue(currentRecord());
    markShareTargetDraftCleanupPending.mockRejectedValueOnce(
      new Error('storage'),
    );
    const clearLanding = vi.fn();
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    await waitFor(() => expect(claimShareTargetDraft).toHaveBeenCalledOnce());

    act(() =>
      window.dispatchEvent(
        new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
          detail: { schemaVersion: 1, draftId, outcome: 'failed' },
        }),
      ),
    );
    const retry = await screen.findByRole('button', {
      name: '端末内下書きの削除を再試行',
    });
    expect(markShareTargetDraftCleanupPending).toHaveBeenCalledOnce();
    expect(publishShareTargetLifecycle).not.toHaveBeenCalled();
    expect(removeShareTargetDraft).not.toHaveBeenCalled();
    expect(clearLanding).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(markShareTargetDraftCleanupPending).toHaveBeenCalledTimes(2),
    );
    expect(markShareTargetDraftCleanupPending).toHaveBeenNthCalledWith(
      2,
      draftId,
      'header:synthetic-user',
      true,
    );
    await waitFor(() => expect(removeShareTargetDraft).toHaveBeenCalledOnce());
    expect(
      markShareTargetDraftCleanupPending.mock.invocationCallOrder[1],
    ).toBeLessThan(publishShareTargetLifecycle.mock.invocationCallOrder[0]);
    expect(
      publishShareTargetLifecycle.mock.invocationCallOrder[0],
    ).toBeLessThan(removeShareTargetDraft.mock.invocationCallOrder[0]);
    expect(
      await screen.findByText(/端末内の共有下書きは消去済みです/),
    ).toBeVisible();
  });

  it('reloads a cleanup tombstone without restoring capture content', async () => {
    getAuthState.mockReturnValue({ userId: 'synthetic-user', roles: [] });
    refreshAuthStateFromServer.mockResolvedValue(verifiedAuth());
    claimShareTargetDraft.mockResolvedValue({
      ...currentRecord(),
      requestKey: null,
      draft: null,
      lifecycle: 'cleanup_pending',
    });
    const events: unknown[] = [];
    const listener = (event: Event) =>
      events.push((event as CustomEvent).detail);
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={vi.fn()}
      />,
    );

    expect(await screen.findByText(/本文を消去済みです/)).toBeInTheDocument();
    expect(events).toEqual([]);
    expect(screen.queryByText(draft.selectedText)).not.toBeInTheDocument();
    window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, listener);
  });

  it('discards without rendering the payload and reports offline no-auto-send', async () => {
    const navigatorPrototype = Object.getPrototypeOf(navigator) as Navigator;
    const original = Object.getOwnPropertyDescriptor(
      navigatorPrototype,
      'onLine',
    );
    Object.defineProperty(navigatorPrototype, 'onLine', {
      configurable: true,
      value: false,
    });
    const clearLanding = vi.fn();
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady={false}
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );
    expect(screen.getByText(/自動送信されません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '共有下書きを破棄' }));
    await waitFor(() => expect(clearLanding).toHaveBeenCalled());
    expect(removeShareTargetDraft).toHaveBeenCalledWith(draftId);
    expect(removeShareTargetDraft.mock.invocationCallOrder[0]).toBeLessThan(
      publishShareTargetLifecycle.mock.invocationCallOrder[0],
    );
    expect(claimShareTargetDraft).not.toHaveBeenCalled();
    if (original) {
      Object.defineProperty(navigatorPrototype, 'onLine', original);
    } else {
      Reflect.deleteProperty(
        navigatorPrototype as Navigator & { onLine?: unknown },
        'onLine',
      );
    }
  });

  it('does not broadcast an unauthenticated discard when another tab wins the actor claim', async () => {
    removeShareTargetDraft
      .mockRejectedValueOnce(new Error('share_target_actor_mismatch'))
      .mockResolvedValueOnce(undefined);
    const clearLanding = vi.fn();
    render(
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady={false}
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />,
    );

    await screen.findByText(/ログイン後に内容を確認できます/);
    fireEvent.click(screen.getByRole('button', { name: '共有下書きを破棄' }));

    const retry = await screen.findByRole('button', {
      name: '端末内下書きの削除を再試行',
    });
    expect(removeShareTargetDraft).toHaveBeenNthCalledWith(1, draftId);
    expect(publishShareTargetLifecycle).not.toHaveBeenCalled();
    expect(clearLanding).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(removeShareTargetDraft).toHaveBeenNthCalledWith(2, draftId),
    );
    expect(publishShareTargetLifecycle).toHaveBeenCalledWith(
      draftId,
      'cleanup_pending',
    );
    expect(clearLanding).toHaveBeenCalledOnce();
  });
});
