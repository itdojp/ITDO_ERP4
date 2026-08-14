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
  BrowserCaptureBridgeError,
  getBrowserCaptureDraft,
  isBrowserCaptureDraftId,
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
    | 'cleanup_pending'
  >('waiting_auth');
  const [error, setError] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const authGenerationRef = useRef(0);
  const draftGenerationRef = useRef(0);
  const verifiedActorRef = useRef('');
  const cleanupActorKeyRef = useRef('');
  const dispatchedRef = useRef('');
  const terminalOutcomeRef = useRef<CaptureResultDetail['outcome'] | null>(
    null,
  );
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
          if (terminalCleanupPendingRef.current) return 'cleanup_pending';
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
          setStatus('waiting_auth');
          return;
        }
        if (verifiedActorRef.current && verifiedActorRef.current !== actorKey) {
          purgeHandoff();
        }
        verifiedActorRef.current = actorKey;
        setAuthenticatedActorKey(actorKey);
        dispatchAuthCheck(false);
        setStatus((current) => {
          if (terminalCleanupPendingRef.current) return 'cleanup_pending';
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
      manualRetryRequiredRef.current = true;
      setError(
        'オフラインです。自動再接続せず、オンライン復帰後に利用者操作で再試行してください。',
      );
      setStatus('unavailable');
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
    setExpiresAtMs(null);
  }, [draftId]);

  useEffect(
    () =>
      subscribeBrowserCaptureLifecycle((message) => {
        if (message.draftId !== draftId) return;
        purgeHandoff();
        setError('');
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
    [clearLanding, draftId, purgeHandoff],
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
    getBrowserCaptureDraft(draftId, authenticatedActorKey, controller.signal)
      .then((capture) => {
        if (
          controller.signal.aborted ||
          draftGenerationRef.current !== generation
        ) {
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
    validDraftId,
  ]);

  useEffect(() => {
    const cleanupActorKey = cleanupActorKeyRef.current;
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
  }, [draftId, expiresAtMs, purgeHandoff]);

  const removeAndClear = useCallback(async () => {
    purgeHandoff();
    // A terminal result owns cleanup from this point. Cancel the TTL path so
    // a failed delete is retried only by the explicit cleanup action, never by
    // a later automatic timer.
    setExpiresAtMs(null);
    const cleanupActorKey = cleanupActorKeyRef.current;
    if (validDraftId) {
      if (!cleanupActorKey) {
        throw new BrowserCaptureBridgeError('state_conflict');
      }
      await removeBrowserCaptureDraft(draftId, cleanupActorKey);
      cleanupActorKeyRef.current = '';
      // Publish only after idempotent physical deletion succeeds. A remote
      // tab receiving this content-free message can safely purge and close.
      publishBrowserCaptureLifecycle(draftId, 'cleanup_pending');
    }
    terminalCleanupPendingRef.current = false;
    if (terminalOutcomeRef.current === 'failed') {
      setStatus('failed');
      setError('');
    } else {
      clearLanding();
    }
  }, [clearLanding, draftId, purgeHandoff, validDraftId]);

  const reportCleanupFailure = useCallback(() => {
    terminalCleanupPendingRef.current = true;
    setStatus('cleanup_pending');
    setError(
      '保存結果は確定しています。本文は画面から消去済みです。browser session内draftの削除だけを再試行してください。',
    );
  }, []);

  useEffect(() => {
    const handleResult = (event: Event) => {
      const detail = captureResultDetail((event as CustomEvent).detail);
      if (!detail || detail.draftId !== draftId) return;
      terminalOutcomeRef.current = detail.outcome;
      terminalCleanupPendingRef.current = false;
      manualRetryRequiredRef.current = false;
      void removeAndClear().catch(reportCleanupFailure);
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, handleResult);
    return () =>
      window.removeEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, handleResult);
  }, [draftId, removeAndClear, reportCleanupFailure]);

  if (!draftId) return null;

  return (
    <div style={{ marginTop: 8 }} data-testid="browser-capture-landing">
      <Card padding="small">
        <strong>Browser Capture下書き</strong>
        {!validDraftId ? (
          <Alert variant="error">
            下書きの識別子が不正です。本文は読み込みませんでした。
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
        ) : status === 'unavailable' || status === 'cleanup_pending' ? (
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
        ) : status === 'cleanup_pending' ? (
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              variant="secondary"
              onClick={() => void removeAndClear().catch(reportCleanupFailure)}
            >
              browser session内draftの削除を再試行
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
