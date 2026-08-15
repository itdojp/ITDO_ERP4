import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  AUTH_STORAGE_KEY,
  getAuthState,
  isBffAuthMode,
  refreshAuthStateFromServer,
  subscribeAuthSessionChanges,
} from '../../api';
import { Alert, Button, Card } from '../../ui';
import {
  armBrowserCaptureTerminalFence,
  BrowserCaptureBridgeError,
  getBrowserCaptureDraft,
  hasBrowserCaptureTerminalFence,
  isBrowserCaptureDraftId,
  markBrowserCaptureTerminalFence,
  markBrowserCaptureDraftCleanupPending,
  publishBrowserCaptureLifecycle,
  removeBrowserCaptureDraft,
  subscribeBrowserCaptureLifecycle,
} from '../../utils/browserCaptureBridge';
import {
  KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT,
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_PURGE_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
} from './knowledgeCaptureModel';

type CaptureResultDetail = {
  schemaVersion: 1;
  draftId: string;
  outcome: 'committed' | 'failed' | 'discarded';
};

const AUTH_REVALIDATE_INTERVAL_MS = 60 * 1000;
const AUTH_REVALIDATE_TIMEOUT_MS = 15 * 1000;
const CLEANUP_REQUIRED_MESSAGE =
  '保存結果は確定し、画面本文は消去済みです。browser session内draftのcontent-free化は確認できていないため、本文消去だけを再試行してください。';
const CLEANUP_PENDING_MESSAGE =
  '保存結果は確定し、本文はbrowser session内でも消去済みです。content-free下書きの物理削除だけを再試行してください。';

function terminalCleanupFeedback(tombstoneConfirmed: boolean) {
  return tombstoneConfirmed
    ? {
        status: 'cleanup_pending' as const,
        message: CLEANUP_PENDING_MESSAGE,
      }
    : {
        status: 'cleanup_required' as const,
        message: CLEANUP_REQUIRED_MESSAGE,
      };
}

function captureResultDetail(value: unknown): CaptureResultDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !isBrowserCaptureDraftId(record.draftId) ||
    (record.outcome !== 'committed' &&
      record.outcome !== 'failed' &&
      record.outcome !== 'discarded')
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    draftId: record.draftId,
    outcome: record.outcome,
  };
}

export function BrowserCaptureLanding({
  draftId,
  knowledgeHubReady,
  activateKnowledgeHub,
  clearLanding,
}: {
  draftId: string;
  knowledgeHubReady: boolean;
  activateKnowledgeHub: () => boolean;
  clearLanding: () => void;
}) {
  const validDraftId = isBrowserCaptureDraftId(draftId);
  const [authenticatedActorKey, setAuthenticatedActorKey] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  const [status, setStatus] = useState<
    | 'waiting_auth'
    | 'loading'
    | 'ready'
    | 'pending'
    | 'failed'
    | 'missing'
    | 'unavailable'
    | 'cleanup_required'
    | 'cleanup_pending'
  >('waiting_auth');
  const [error, setError] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const authGenerationRef = useRef(0);
  const draftGenerationRef = useRef(0);
  const verifiedActorRef = useRef('');
  const cleanupActorKeyRef = useRef('');
  const cleanupTombstoneRef = useRef(false);
  const dispatchedRef = useRef('');
  const terminalOutcomeRef = useRef<
    CaptureResultDetail['outcome'] | 'remote_terminal' | null
  >(null);
  const terminalCleanupPendingRef = useRef(false);
  const manualRetryRequiredRef = useRef(false);
  const authControllerRef = useRef<AbortController | null>(null);
  const draftControllerRef = useRef<AbortController | null>(null);

  const purgeHandoff = useCallback(() => {
    draftGenerationRef.current += 1;
    draftControllerRef.current?.abort();
    draftControllerRef.current = null;
    dispatchedRef.current = '';
    // Keep the claimed draft's expiry timer alive after auth loss. The live
    // actor state and page content are still purged immediately; the retained
    // key is memory-only and can only drive idempotent extension-draft delete.
    if (!cleanupActorKeyRef.current) setExpiresAtMs(null);
    window.dispatchEvent(
      new CustomEvent(KNOWLEDGE_CAPTURE_PURGE_EVENT, {
        detail: { schemaVersion: 1, draftId },
      }),
    );
  }, [draftId]);

  const detachLandingAddress = useCallback(() => {
    const next = new URL(window.location.href);
    if (!next.searchParams.has('browserCapture')) return;
    next.searchParams.delete('browserCapture');
    window.history.replaceState(
      null,
      '',
      `${next.pathname}${next.search}${next.hash}`,
    );
  }, []);

  const dispatchAuthCheck = useCallback(
    (checking: boolean) => {
      window.dispatchEvent(
        new CustomEvent(KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT, {
          detail: { schemaVersion: 1, draftId, checking },
        }),
      );
    },
    [draftId],
  );

  useEffect(() => {
    let disposed = false;
    const verifyAuth = async (purgeBeforeCheck: boolean) => {
      const generation = authGenerationRef.current + 1;
      authGenerationRef.current = generation;
      authControllerRef.current?.abort();
      const controller = new AbortController();
      authControllerRef.current = controller;
      if (purgeBeforeCheck) {
        purgeHandoff();
        setStatus((current) => {
          if (terminalCleanupPendingRef.current) {
            return terminalCleanupFeedback(cleanupTombstoneRef.current).status;
          }
          if (terminalOutcomeRef.current === 'failed') return 'failed';
          if (manualRetryRequiredRef.current) return 'unavailable';
          return current === 'ready' || current === 'pending'
            ? current
            : 'waiting_auth';
        });
      }
      setAuthChecking(true);
      dispatchAuthCheck(true);
      const timeout = window.setTimeout(
        () => controller.abort(),
        AUTH_REVALIDATE_TIMEOUT_MS,
      );
      const localCandidate = getAuthState();
      const bffMode = isBffAuthMode();
      try {
        const verified =
          !bffMode && !localCandidate?.userId
            ? null
            : await refreshAuthStateFromServer({
                dispatchEvent: false,
                allowCachedFallback: false,
                persistState: false,
                signal: controller.signal,
              }).catch(() => null);
        if (disposed || generation !== authGenerationRef.current) return;
        const actorKey = verified?.verifiedActorKey?.trim() ?? '';
        if (
          !verified?.userId ||
          !actorKey ||
          (!bffMode && verified.userId !== localCandidate?.userId)
        ) {
          verifiedActorRef.current = '';
          setAuthenticatedActorKey('');
          purgeHandoff();
          if (terminalCleanupPendingRef.current) {
            const feedback = terminalCleanupFeedback(
              cleanupTombstoneRef.current,
            );
            setError(feedback.message);
            setStatus(feedback.status);
          } else {
            setStatus('waiting_auth');
          }
          return;
        }
        if (verifiedActorRef.current && verifiedActorRef.current !== actorKey) {
          purgeHandoff();
        }
        verifiedActorRef.current = actorKey;
        if (terminalCleanupPendingRef.current && !cleanupActorKeyRef.current) {
          // A remote terminal event can arrive while authentication is still
          // being verified. Retain only the subsequently verified actor key
          // so offline/manual cleanup remains possible without draft content.
          cleanupActorKeyRef.current = actorKey;
        }
        setAuthenticatedActorKey(actorKey);
        dispatchAuthCheck(false);
        setStatus((current) => {
          if (terminalCleanupPendingRef.current) {
            return terminalCleanupFeedback(cleanupTombstoneRef.current).status;
          }
          if (terminalOutcomeRef.current === 'failed') return 'failed';
          if (manualRetryRequiredRef.current) return 'unavailable';
          return current === 'ready' || current === 'pending'
            ? current
            : 'loading';
        });
      } finally {
        window.clearTimeout(timeout);
        if (!disposed && generation === authGenerationRef.current) {
          setAuthChecking(false);
        }
      }
    };

    void verifyAuth(true);
    const syncAuth = () => void verifyAuth(true);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === AUTH_STORAGE_KEY) syncAuth();
    };
    const goOnline = () => {
      setOnline(true);
      void verifyAuth(true);
    };
    const goOffline = () => {
      authGenerationRef.current += 1;
      authControllerRef.current?.abort();
      verifiedActorRef.current = '';
      setAuthenticatedActorKey('');
      setAuthChecking(false);
      setOnline(false);
      purgeHandoff();
      if (terminalCleanupPendingRef.current) {
        manualRetryRequiredRef.current = false;
        const feedback = terminalCleanupFeedback(cleanupTombstoneRef.current);
        setError(feedback.message);
        setStatus(feedback.status);
      } else {
        manualRetryRequiredRef.current = true;
        setError(
          'オフラインです。自動再接続せず、オンライン復帰後に利用者操作で再試行してください。',
        );
        setStatus('unavailable');
      }
    };
    const verifyVisibleSession = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine !== false
      ) {
        void verifyAuth(false);
      }
    };
    const interval = window.setInterval(() => {
      if (navigator.onLine !== false) void verifyAuth(false);
    }, AUTH_REVALIDATE_INTERVAL_MS);
    window.addEventListener('erp4:auth-updated', syncAuth);
    window.addEventListener('storage', syncStorage);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', verifyVisibleSession);
    const unsubscribe = subscribeAuthSessionChanges(syncAuth);
    return () => {
      disposed = true;
      authGenerationRef.current += 1;
      authControllerRef.current?.abort();
      draftControllerRef.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener('erp4:auth-updated', syncAuth);
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', verifyVisibleSession);
      unsubscribe();
    };
  }, [dispatchAuthCheck, purgeHandoff]);

  const authenticated = authenticatedActorKey.length > 0;

  useEffect(() => {
    terminalOutcomeRef.current = null;
    terminalCleanupPendingRef.current = false;
    manualRetryRequiredRef.current = false;
    cleanupActorKeyRef.current = '';
    cleanupTombstoneRef.current = false;
    setExpiresAtMs(null);
  }, [draftId]);

  useEffect(
    () =>
      subscribeBrowserCaptureLifecycle((message) => {
        if (message.draftId !== draftId) return;
        purgeHandoff();
        setError('');
        if (message.lifecycle === 'terminal') {
          // The sender has reached a terminal product result, but its
          // content-free tombstone may still fail. Purge every tab before
          // that storage operation and keep a cleanup-only capability.
          terminalOutcomeRef.current = 'remote_terminal';
          terminalCleanupPendingRef.current = true;
          cleanupTombstoneRef.current = false;
          manualRetryRequiredRef.current = false;
          if (!cleanupActorKeyRef.current && authenticatedActorKey) {
            cleanupActorKeyRef.current = authenticatedActorKey;
          }
          setExpiresAtMs(null);
          detachLandingAddress();
          setError(CLEANUP_REQUIRED_MESSAGE);
          setStatus('cleanup_required');
          return;
        }
        if (message.lifecycle === 'cleanup_pending') {
          terminalCleanupPendingRef.current = true;
          clearLanding();
          return;
        }
        // The publishing tab does not receive its own BroadcastChannel
        // message. Other tabs must discard stale editable state and reload
        // the exact extension-session record before any further action.
        if (terminalOutcomeRef.current !== null) return;
        manualRetryRequiredRef.current = false;
        setStatus('loading');
        setLoadRevision((current) => current + 1);
      }),
    [
      authenticatedActorKey,
      clearLanding,
      detachLandingAddress,
      draftId,
      purgeHandoff,
    ],
  );

  useEffect(() => {
    if (validDraftId && authenticated) activateKnowledgeHub();
  }, [activateKnowledgeHub, authenticated, validDraftId]);

  useEffect(() => {
    if (
      !validDraftId ||
      !authenticated ||
      authChecking ||
      terminalOutcomeRef.current !== null ||
      manualRetryRequiredRef.current ||
      !knowledgeHubReady ||
      dispatchedRef.current === draftId
    ) {
      return;
    }
    const generation = draftGenerationRef.current + 1;
    draftGenerationRef.current = generation;
    draftControllerRef.current?.abort();
    const controller = new AbortController();
    draftControllerRef.current = controller;
    setStatus('loading');
    setError('');
    try {
      armBrowserCaptureTerminalFence(draftId);
      if (hasBrowserCaptureTerminalFence(draftId)) {
        // Two content-free fixed-size fence slots are reserved before any
        // extension content request. Either terminal slot is monotonic and
        // late/reloaded tabs must never overwrite it with active state.
        terminalOutcomeRef.current = 'remote_terminal';
        terminalCleanupPendingRef.current = true;
        cleanupTombstoneRef.current = false;
        cleanupActorKeyRef.current = authenticatedActorKey;
        manualRetryRequiredRef.current = false;
        setExpiresAtMs(null);
        purgeHandoff();
        detachLandingAddress();
        setError(CLEANUP_REQUIRED_MESSAGE);
        setStatus('cleanup_required');
        return;
      }
    } catch {
      manualRetryRequiredRef.current = true;
      setStatus('unavailable');
      setError(
        'Browser Captureのterminal状態を確認できません。本文を読み込まず、利用者操作で再試行してください。',
      );
      return;
    }
    getBrowserCaptureDraft(draftId, authenticatedActorKey, controller.signal)
      .then((capture) => {
        if (
          controller.signal.aborted ||
          draftGenerationRef.current !== generation
        ) {
          return;
        }
        try {
          if (hasBrowserCaptureTerminalFence(draftId)) {
            // The extension response may have been in flight when another tab
            // committed/discarded the draft. Recheck immediately before any
            // page event can receive the returned content.
            terminalOutcomeRef.current = 'remote_terminal';
            terminalCleanupPendingRef.current = true;
            cleanupTombstoneRef.current = false;
            cleanupActorKeyRef.current = authenticatedActorKey;
            manualRetryRequiredRef.current = false;
            setExpiresAtMs(null);
            purgeHandoff();
            detachLandingAddress();
            setError(CLEANUP_REQUIRED_MESSAGE);
            setStatus('cleanup_required');
            return;
          }
        } catch {
          manualRetryRequiredRef.current = true;
          purgeHandoff();
          setStatus('unavailable');
          setError(
            'Browser Captureのterminal状態を再確認できません。本文を表示せず、利用者操作で再試行してください。',
          );
          return;
        }
        if (!capture || capture.id !== draftId) {
          setStatus('missing');
          return;
        }
        cleanupActorKeyRef.current = authenticatedActorKey;
        const expiresAt = Date.parse(capture.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          purgeHandoff();
          setStatus('missing');
          return;
        }
        if (capture.lifecycle === 'cleanup_pending') {
          purgeHandoff();
          detachLandingAddress();
          cleanupTombstoneRef.current = true;
          terminalCleanupPendingRef.current = true;
          manualRetryRequiredRef.current = false;
          dispatchedRef.current = draftId;
          setExpiresAtMs(null);
          setError(CLEANUP_PENDING_MESSAGE);
          setStatus('cleanup_pending');
          return;
        }
        cleanupTombstoneRef.current = false;
        dispatchedRef.current = draftId;
        setExpiresAtMs(expiresAt);
        setStatus(capture.lifecycle === 'pending' ? 'pending' : 'ready');
        window.dispatchEvent(
          new CustomEvent(KNOWLEDGE_CAPTURE_DRAFT_EVENT, {
            detail: {
              draftId,
              requestKey: capture.requestKey,
              actorKey: authenticatedActorKey,
              lifecycle: capture.lifecycle,
              pendingIntent: capture.pendingIntent,
              draft: capture.draft,
            },
          }),
        );
      })
      .catch((caught) => {
        if (
          controller.signal.aborted ||
          draftGenerationRef.current !== generation
        ) {
          return;
        }
        const code =
          caught instanceof BrowserCaptureBridgeError ? caught.code : '';
        manualRetryRequiredRef.current = code !== 'not_found';
        setStatus(code === 'not_found' ? 'missing' : 'unavailable');
        setError(
          code === 'not_found'
            ? ''
            : 'Browser Capture拡張機能へ接続できません。自動送信せず、利用者操作で再試行してください。',
        );
      });
    return () => controller.abort();
  }, [
    authenticated,
    authenticatedActorKey,
    authChecking,
    draftId,
    knowledgeHubReady,
    loadRevision,
    purgeHandoff,
    detachLandingAddress,
    validDraftId,
  ]);

  useEffect(() => {
    const cleanupActorKey = cleanupActorKeyRef.current || authenticatedActorKey;
    if (expiresAtMs === null || !cleanupActorKey) return;
    const remaining = expiresAtMs - Date.now();
    const expire = () => {
      purgeHandoff();
      setStatus('missing');
      void removeBrowserCaptureDraft(draftId, cleanupActorKey)
        .then(() => {
          cleanupActorKeyRef.current = '';
          setExpiresAtMs(null);
          publishBrowserCaptureLifecycle(draftId, 'cleanup_pending');
        })
        .catch(() => undefined);
    };
    if (remaining <= 0) {
      expire();
      return;
    }
    const timeout = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timeout);
  }, [authenticatedActorKey, draftId, expiresAtMs, purgeHandoff]);

  const removeAndClear = useCallback(async () => {
    purgeHandoff();
    // A terminal result owns cleanup from this point. Cancel the TTL path so
    // a failed delete is retried only by the explicit cleanup action, never by
    // a later automatic timer.
    setExpiresAtMs(null);
    const cleanupActorKey = cleanupActorKeyRef.current || authenticatedActorKey;
    if (validDraftId) {
      if (!cleanupActorKey) {
        throw new BrowserCaptureBridgeError('state_conflict');
      }
      // This content-free fence is synchronous and survives reload/new tabs.
      // If the browser storage write is unavailable, still attempt extension
      // tombstoning: either independent path is sufficient to prevent draft
      // rehydration, while a failure of both remains an explicit cleanup state.
      try {
        markBrowserCaptureTerminalFence(draftId);
      } catch {
        // Extension tombstoning below is the independent fail-closed path.
      }
      if (!cleanupTombstoneRef.current) {
        try {
          await markBrowserCaptureDraftCleanupPending(draftId, cleanupActorKey);
          cleanupTombstoneRef.current = true;
          // Other tabs may now purge safely: the extension record no longer
          // contains request-key or capture content even if deletion fails.
          publishBrowserCaptureLifecycle(draftId, 'cleanup_pending');
        } catch (tombstoneError) {
          // Tombstone persistence and physical delete are independent,
          // idempotent cleanup paths. If content-free conversion fails, still
          // attempt delete before exposing a manual cleanup state.
          try {
            await removeBrowserCaptureDraft(draftId, cleanupActorKey);
          } catch {
            throw tombstoneError;
          }
          cleanupActorKeyRef.current = '';
          cleanupTombstoneRef.current = false;
          terminalCleanupPendingRef.current = false;
          if (terminalOutcomeRef.current === 'failed') {
            setStatus('failed');
            setError('');
          } else {
            clearLanding();
          }
          return;
        }
      }
      await removeBrowserCaptureDraft(draftId, cleanupActorKey);
      // Keep the content-free terminal sentinel until its bounded TTL. A late
      // tab or an in-flight `get` must remain fail closed after deletion.
      cleanupActorKeyRef.current = '';
      cleanupTombstoneRef.current = false;
    }
    terminalCleanupPendingRef.current = false;
    if (terminalOutcomeRef.current === 'failed') {
      setStatus('failed');
      setError('');
    } else {
      clearLanding();
    }
  }, [
    authenticatedActorKey,
    clearLanding,
    draftId,
    purgeHandoff,
    validDraftId,
  ]);

  const reportCleanupFailure = useCallback(() => {
    terminalCleanupPendingRef.current = true;
    const feedback = terminalCleanupFeedback(cleanupTombstoneRef.current);
    setStatus(feedback.status);
    setError(feedback.message);
  }, []);

  useEffect(() => {
    const handleResult = (event: Event) => {
      const detail = captureResultDetail((event as CustomEvent).detail);
      if (!detail || detail.draftId !== draftId) return;
      terminalOutcomeRef.current = detail.outcome;
      terminalCleanupPendingRef.current = false;
      manualRetryRequiredRef.current = false;
      cleanupTombstoneRef.current = false;
      try {
        markBrowserCaptureTerminalFence(draftId);
      } catch {
        // The extension tombstone path remains independent and is attempted
        // immediately by removeAndClear().
      }
      // Invalidate all other tabs before any extension storage write. This
      // signal carries no claim that content has already been erased.
      publishBrowserCaptureLifecycle(draftId, 'terminal');
      // Remove the opaque handoff address before extension storage cleanup.
      // If tombstone persistence is unavailable, reloading the current address
      // must not rehydrate the terminal draft into a new capture UI.
      detachLandingAddress();
      void removeAndClear().catch(reportCleanupFailure);
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, handleResult);
    return () =>
      window.removeEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, handleResult);
  }, [detachLandingAddress, draftId, removeAndClear, reportCleanupFailure]);

  if (!draftId) return null;

  return (
    <div style={{ marginTop: 8 }} data-testid="browser-capture-landing">
      <Card padding="small">
        <strong>Browser Capture下書き</strong>
        {!validDraftId ? (
          <Alert variant="error">
            下書きの識別子が不正です。本文は読み込みませんでした。
          </Alert>
        ) : status === 'cleanup_required' || status === 'cleanup_pending' ? (
          <Alert variant="error">
            {error ||
              terminalCleanupFeedback(status === 'cleanup_pending').message}
          </Alert>
        ) : authChecking ? (
          <p role="status">認証状態を確認しています。</p>
        ) : !authenticated ? (
          <Alert variant="warning">
            ERP4で認証後に下書きを確認できます。拡張機能はcookieやtokenを取得しません。
          </Alert>
        ) : status === 'missing' ? (
          <Alert variant="warning">
            下書きは期限切れ、破棄済み、または見つかりません。
          </Alert>
        ) : status === 'pending' ? (
          <Alert variant="warning">
            保存結果を確認中です。自動再送せず、read-only再照合してください。
          </Alert>
        ) : status === 'failed' ? (
          <Alert variant="error">
            保存に失敗しました。browser
            session内の下書きは消去済みです。自動再送は行いません。
          </Alert>
        ) : status === 'unavailable' ? (
          <Alert variant="error">{error}</Alert>
        ) : status === 'loading' ? (
          <p role="status">拡張機能の下書きを読み込んでいます。</p>
        ) : (
          <p role="status">
            Knowledge Hubで送信fieldと保存先を確認してください。
          </p>
        )}
        {!online ? (
          <Alert variant="warning">
            オフラインです。draftは自動送信されません。オンライン復帰後に明示previewしてください。
          </Alert>
        ) : null}
        {status === 'unavailable' ? (
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                manualRetryRequiredRef.current = false;
                dispatchedRef.current = '';
                setLoadRevision((current) => current + 1);
              }}
            >
              拡張機能へ再接続
            </Button>
          </div>
        ) : status === 'cleanup_required' || status === 'cleanup_pending' ? (
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              variant="secondary"
              onClick={() => void removeAndClear().catch(reportCleanupFailure)}
            >
              {status === 'cleanup_pending'
                ? 'content-free下書きの物理削除を再試行'
                : 'browser session内draftの本文消去を再試行'}
            </Button>
          </div>
        ) : status === 'failed' ? (
          <div style={{ marginTop: 8 }}>
            <Button size="small" variant="secondary" onClick={clearLanding}>
              閉じる
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
