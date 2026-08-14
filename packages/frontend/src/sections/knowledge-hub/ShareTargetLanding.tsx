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
  KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT,
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_PURGE_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
} from './knowledgeCaptureModel';
import {
  claimShareTargetDraft,
  isOpaqueShareTargetDraftId,
  markShareTargetDraftCleanupPending,
  publishShareTargetLifecycle,
  removeShareTargetDraft,
  subscribeShareTargetLifecycle,
} from '../../utils/shareTargetQueue';

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
    !isOpaqueShareTargetDraftId(record.draftId) ||
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

export function ShareTargetLanding({
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
  const validDraftId = isOpaqueShareTargetDraftId(draftId);
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
    | 'cleanup_pending'
    | 'missing'
    | 'error'
  >('waiting_auth');
  const [error, setError] = useState('');
  const [cleanupPending, setCleanupPending] = useState(false);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [lifecycleRevision, setLifecycleRevision] = useState(0);
  const authGenerationRef = useRef(0);
  const draftGenerationRef = useRef(0);
  const cleanupTombstoneRef = useRef(false);
  const cleanupAllowPendingRef = useRef(false);
  const terminalFailureRef = useRef(false);
  const dispatchedRef = useRef('');
  const verifiedActorRef = useRef('');
  const verificationRef = useRef<{
    promise: Promise<void>;
    controller: AbortController;
    restartAfter: boolean;
    generation: number;
  } | null>(null);

  const purgeHandoff = useCallback(() => {
    draftGenerationRef.current += 1;
    dispatchedRef.current = '';
    setExpiresAtMs(null);
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
    cleanupTombstoneRef.current = false;
    cleanupAllowPendingRef.current = false;
    terminalFailureRef.current = false;
  }, [draftId]);

  useEffect(() => {
    let disposed = false;
    const verifyAuth = (purgeBeforeCheck: boolean) => {
      if (purgeBeforeCheck) {
        purgeHandoff();
        setStatus('waiting_auth');
        if (verificationRef.current) {
          // Coalesce event storms into one fresh verification after the
          // current request. Its pre-transition result must not re-expose a
          // purged draft, but repeatedly aborting a slow request would let a
          // 60-second revalidation perpetually starve verification.
          verificationRef.current.restartAfter = true;
          return verificationRef.current.promise;
        }
      }
      if (verificationRef.current) return verificationRef.current.promise;

      const generation = authGenerationRef.current + 1;
      authGenerationRef.current = generation;
      setAuthChecking(true);
      dispatchAuthCheck(true);
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        AUTH_REVALIDATE_TIMEOUT_MS,
      );
      const localCandidate = getAuthState();
      const bffMode = isBffAuthMode();
      const promise = (async () => {
        const verified =
          !bffMode && !localCandidate?.userId
            ? null
            : await refreshAuthStateFromServer({
                dispatchEvent: false,
                allowCachedFallback: false,
                persistState: false,
                signal: controller.signal,
              }).catch(() => null);
        if (disposed || authGenerationRef.current !== generation) return;
        if (
          verificationRef.current?.generation === generation &&
          verificationRef.current.restartAfter
        ) {
          return;
        }
        setAuthChecking(false);
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
        const actorChanged =
          verifiedActorRef.current !== '' &&
          verifiedActorRef.current !== actorKey;
        if (actorChanged) purgeHandoff();
        verifiedActorRef.current = actorKey;
        setAuthenticatedActorKey(actorKey);
        dispatchAuthCheck(false);
        setStatus((current) =>
          (current === 'ready' ||
            current === 'pending' ||
            current === 'failed') &&
          !purgeBeforeCheck &&
          !actorChanged
            ? current
            : 'loading',
        );
      })().finally(() => {
        window.clearTimeout(timeout);
        let restartAfter = false;
        if (verificationRef.current?.generation === generation) {
          restartAfter = verificationRef.current.restartAfter;
          verificationRef.current = null;
        }
        if (restartAfter && !disposed) void verifyAuth(false);
      });
      verificationRef.current = {
        promise,
        controller,
        restartAfter: false,
        generation,
      };
      return promise;
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
      verificationRef.current?.controller.abort();
      verificationRef.current = null;
      verifiedActorRef.current = '';
      setAuthenticatedActorKey('');
      setAuthChecking(false);
      setOnline(false);
      purgeHandoff();
      setStatus('waiting_auth');
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
    const unsubscribeAuthSessionChanges = subscribeAuthSessionChanges(syncAuth);
    return () => {
      disposed = true;
      authGenerationRef.current += 1;
      draftGenerationRef.current += 1;
      verificationRef.current?.controller.abort();
      verificationRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener('erp4:auth-updated', syncAuth);
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', verifyVisibleSession);
      unsubscribeAuthSessionChanges();
    };
  }, [dispatchAuthCheck, purgeHandoff]);

  useEffect(
    () =>
      subscribeShareTargetLifecycle((message) => {
        if (message.draftId !== draftId) return;
        purgeHandoff();
        setError('');
        if (message.lifecycle === 'cleanup_pending') {
          clearLanding();
          return;
        }
        // The publisher's own tab uses the same BroadcastChannel object and
        // does not receive this notification. A remote tab must reload the
        // exact staged/pending record instead of retaining stale editable
        // state or a stale result-unknown intent.
        setStatus('loading');
        setLifecycleRevision((current) => current + 1);
      }),
    [clearLanding, draftId, purgeHandoff],
  );

  const authenticated = authenticatedActorKey.length > 0;

  useEffect(() => {
    if (!validDraftId || !authenticated) return;
    activateKnowledgeHub();
  }, [activateKnowledgeHub, authenticated, validDraftId]);

  useEffect(() => {
    if (
      !validDraftId ||
      !authenticated ||
      authChecking ||
      cleanupTombstoneRef.current ||
      terminalFailureRef.current ||
      !knowledgeHubReady ||
      dispatchedRef.current === draftId
    ) {
      return;
    }
    const generation = draftGenerationRef.current + 1;
    draftGenerationRef.current = generation;
    setStatus('loading');
    setError('');
    claimShareTargetDraft(draftId, authenticatedActorKey)
      .then((record) => {
        if (draftGenerationRef.current !== generation) return;
        if (!record || record.id !== draftId) {
          setStatus('missing');
          return;
        }
        if (record.lifecycle === 'cleanup_pending') {
          purgeHandoff();
          cleanupTombstoneRef.current = true;
          setCleanupPending(true);
          setStatus('cleanup_pending');
          return;
        }
        cleanupTombstoneRef.current = false;
        if (!record.draft || !record.requestKey) {
          setStatus('missing');
          return;
        }
        const expiresAt = Date.parse(record.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          purgeHandoff();
          setStatus('missing');
          return;
        }
        dispatchedRef.current = draftId;
        setExpiresAtMs(expiresAt);
        setStatus(record.lifecycle === 'pending' ? 'pending' : 'ready');
        window.dispatchEvent(
          new CustomEvent(KNOWLEDGE_CAPTURE_DRAFT_EVENT, {
            detail: {
              draftId,
              requestKey: record.requestKey,
              actorKey: authenticatedActorKey,
              lifecycle: record.lifecycle,
              pendingIntent: record.pendingIntent,
              draft: record.draft,
            },
          }),
        );
      })
      .catch(() => {
        if (draftGenerationRef.current !== generation) return;
        setStatus('error');
        setError('共有下書きを安全に読み出せませんでした。');
      });
  }, [
    authenticated,
    authenticatedActorKey,
    authChecking,
    draftId,
    knowledgeHubReady,
    lifecycleRevision,
    validDraftId,
    purgeHandoff,
  ]);

  useEffect(() => {
    if (expiresAtMs === null) return;
    const remaining = expiresAtMs - Date.now();
    const expire = () => {
      purgeHandoff();
      publishShareTargetLifecycle(draftId, 'cleanup_pending');
      setStatus('missing');
      setError('');
      void removeShareTargetDraft(
        draftId,
        authenticatedActorKey || undefined,
      ).catch(() => undefined);
    };
    if (remaining <= 0) {
      expire();
      return;
    }
    const timeout = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timeout);
  }, [authenticatedActorKey, draftId, expiresAtMs, purgeHandoff]);

  const removeAndClear = useCallback(
    async (options?: {
      allowPending?: boolean;
      tombstoneExists?: boolean;
      preserveFailure?: boolean;
    }) => {
      purgeHandoff();
      if (validDraftId) {
        if (authenticatedActorKey) {
          if (options?.tombstoneExists || cleanupTombstoneRef.current) {
            cleanupTombstoneRef.current = true;
          } else {
            await markShareTargetDraftCleanupPending(
              draftId,
              authenticatedActorKey,
              options?.allowPending === true,
            );
            cleanupTombstoneRef.current = true;
          }
        }
        publishShareTargetLifecycle(draftId, 'cleanup_pending');
        await removeShareTargetDraft(
          draftId,
          authenticatedActorKey || undefined,
        );
      }
      cleanupTombstoneRef.current = false;
      cleanupAllowPendingRef.current = false;
      setCleanupPending(false);
      if (options?.preserveFailure) {
        setStatus('failed');
        setError('');
      } else {
        clearLanding();
      }
    },
    [authenticatedActorKey, clearLanding, draftId, purgeHandoff, validDraftId],
  );

  const reportCleanupFailure = useCallback(() => {
    setCleanupPending(true);
    setStatus('cleanup_pending');
    setError(
      '端末内の共有下書きを削除できませんでした。URLを維持したまま再試行できます。',
    );
  }, []);

  useEffect(() => {
    const handleResult = (event: Event) => {
      const detail = captureResultDetail((event as CustomEvent).detail);
      if (!detail || detail.draftId !== draftId) return;
      cleanupTombstoneRef.current = false;
      cleanupAllowPendingRef.current = detail.outcome !== 'discarded';
      terminalFailureRef.current = detail.outcome === 'failed';
      removeAndClear({
        allowPending: detail.outcome !== 'discarded',
        preserveFailure: detail.outcome === 'failed',
      }).catch(reportCleanupFailure);
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, handleResult);
    return () =>
      window.removeEventListener(KNOWLEDGE_CAPTURE_RESULT_EVENT, handleResult);
  }, [draftId, removeAndClear, reportCleanupFailure]);

  if (!draftId) return null;

  const canDiscard =
    status !== 'ready' &&
    status !== 'pending' &&
    status !== 'failed' &&
    status !== 'cleanup_pending' &&
    !cleanupPending;

  return (
    <div style={{ marginTop: 8 }} data-testid="share-target-landing">
      <Card padding="small">
        <strong>PWA共有下書き</strong>
        {!validDraftId ? (
          <Alert variant="error">
            共有下書きの識別子が不正です。本文は読み込みませんでした。
          </Alert>
        ) : authChecking ? (
          <p role="status">認証状態を確認しています。</p>
        ) : !authenticated ? (
          <Alert variant="warning">
            下書きは端末内に保持されています。ログイン後に内容を確認できます。
          </Alert>
        ) : status === 'missing' ? (
          <Alert variant="warning">
            共有下書きは期限切れ、破棄済み、または見つかりません。
          </Alert>
        ) : status === 'pending' ? (
          <Alert variant="warning">
            保存結果を確認中です。本文を変更・破棄せず、表示された内容からread-only再照合してください。
          </Alert>
        ) : status === 'failed' ? (
          <Alert variant="error">
            保存に失敗しました。端末内の共有下書きは消去済みです。自動再送は行いません。
          </Alert>
        ) : status === 'cleanup_pending' ? (
          <Alert variant="error">
            {error ||
              '本文を消去済みです。端末内の削除だけを再試行してください。'}
          </Alert>
        ) : status === 'error' ? (
          <Alert variant="error">{error}</Alert>
        ) : status === 'loading' ? (
          <p role="status">共有下書きを読み込んでいます。</p>
        ) : (
          <p role="status">
            Knowledge Hubで送信fieldと保存先を確認してください。
          </p>
        )}
        {!online && (
          <Alert variant="warning">
            オフラインです。下書きは自動送信されません。オンライン復帰後にpreviewしてください。
          </Alert>
        )}
        {cleanupPending || status === 'cleanup_pending' ? (
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              variant="secondary"
              onClick={() =>
                void removeAndClear({
                  allowPending: cleanupAllowPendingRef.current,
                  tombstoneExists: cleanupTombstoneRef.current,
                  preserveFailure: terminalFailureRef.current,
                }).catch(reportCleanupFailure)
              }
            >
              端末内下書きの削除を再試行
            </Button>
          </div>
        ) : status === 'failed' ? (
          <div style={{ marginTop: 8 }}>
            <Button size="small" variant="secondary" onClick={clearLanding}>
              閉じる
            </Button>
          </div>
        ) : canDiscard ? (
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              variant="secondary"
              onClick={() => void removeAndClear().catch(reportCleanupFailure)}
            >
              共有下書きを破棄
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
