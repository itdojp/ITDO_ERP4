import React, { useCallback, useEffect, useRef, useState } from 'react';

import { revalidateCurrentAuthActor } from '../../api';
import { Alert, Button, Card, Input, Select, Textarea } from '../../ui';
import {
  commitKnowledgeCapture,
  previewKnowledgeCapture,
  reconcileKnowledgeCapture,
} from './knowledgeCaptureApi';
import {
  defaultKnowledgeCaptureFields,
  KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT,
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_PURGE_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
  normalizeIncomingKnowledgeCapture,
  splitKnowledgeGroupIds,
  type IncomingKnowledgeCaptureDraft,
  type KnowledgeCaptureField,
  type KnowledgeCapturePreview,
  type KnowledgeCaptureResult,
} from './knowledgeCaptureModel';
import {
  createShareTargetPendingOperationId,
  markShareTargetDraftPending,
  markShareTargetDraftStaged,
  normalizeShareTargetPendingIntent,
  publishShareTargetLifecycle,
  type ShareTargetLifecycle,
  type ShareTargetPendingIntent,
} from '../../utils/shareTargetQueue';
import {
  markBrowserCaptureDraftPending,
  markBrowserCaptureDraftStaged,
  publishBrowserCaptureLifecycle,
} from '../../utils/browserCaptureBridge';
import {
  knowledgeHubErrorMessage,
  type KnowledgeScope,
  type KnowledgeSourceType,
} from './knowledgeHubModel';
import { KnowledgeHubApiError } from './knowledgeHubApi';

const fieldLabels: Record<KnowledgeCaptureField, string> = {
  title: 'ページタイトル',
  url: 'URL',
  selectedText: '選択テキスト',
  description: '説明',
  author: '著者',
  publishedAt: '公開日時',
};

type IngressEventDetail = {
  draftId: string;
  requestKey: string;
  actorKey: string;
  lifecycle: Exclude<ShareTargetLifecycle, 'cleanup_pending'>;
  pendingIntent: ShareTargetPendingIntent | null;
  draft: unknown;
};
type PurgeEventDetail = { draftId: string };
type AuthCheckEventDetail = { draftId: string; checking: boolean };

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? -1;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function eventDetail(value: unknown): IngressEventDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.draftId !== 'string' ||
    !/^[A-Za-z0-9_-]{22,128}$/u.test(record.draftId) ||
    typeof record.requestKey !== 'string' ||
    !/^[A-Za-z0-9_-]{22,128}$/u.test(record.requestKey) ||
    typeof record.actorKey !== 'string' ||
    record.actorKey.length < 1 ||
    record.actorKey.length > 256 ||
    hasControlCharacter(record.actorKey) ||
    (record.lifecycle !== 'staged' && record.lifecycle !== 'pending')
  )
    return null;
  const pendingIntent =
    record.lifecycle === 'pending'
      ? normalizeShareTargetPendingIntent(record.pendingIntent)
      : null;
  if (record.lifecycle === 'pending' && !pendingIntent) return null;
  return {
    draftId: record.draftId,
    requestKey: record.requestKey,
    actorKey: record.actorKey,
    lifecycle: record.lifecycle,
    pendingIntent,
    draft: record.draft,
  };
}

function purgeEventDetail(value: unknown): PurgeEventDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draftId = (value as Record<string, unknown>).draftId;
  return typeof draftId === 'string' && /^[A-Za-z0-9_-]{22,128}$/u.test(draftId)
    ? { draftId }
    : null;
}

function authCheckEventDetail(value: unknown): AuthCheckEventDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.draftId === 'string' &&
    /^[A-Za-z0-9_-]{22,128}$/u.test(record.draftId) &&
    typeof record.checking === 'boolean'
    ? { draftId: record.draftId, checking: record.checking }
    : null;
}

function safeError(error: unknown) {
  return knowledgeHubErrorMessage(
    error instanceof KnowledgeHubApiError ? error.code : 'unknown_error',
  );
}

const definiteCommitRejectionCodes = new Set([
  'capture_transaction_conflict_pre_dispatch',
  'forbidden',
  'idempotency_conflict',
  'invalid_request',
  'preview_token_expired',
  'preview_token_invalid',
]);

function isDefiniteCommitRejection(error: unknown) {
  return (
    error instanceof KnowledgeHubApiError &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    definiteCommitRejectionCodes.has(error.code)
  );
}

function resultEvent(
  draftId: string,
  outcome: 'committed' | 'failed' | 'discarded',
) {
  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
      detail: { schemaVersion: 1, draftId, outcome },
    }),
  );
}

async function markLocalDraftPending(
  channel: IncomingKnowledgeCaptureDraft['channel'],
  draftId: string,
  actorKey: string,
  operationId: string,
  pendingIntent: ShareTargetPendingIntent,
  draft: IncomingKnowledgeCaptureDraft,
) {
  return channel === 'browser_extension'
    ? markBrowserCaptureDraftPending(
        draftId,
        actorKey,
        operationId,
        pendingIntent,
        draft,
      )
    : markShareTargetDraftPending(
        draftId,
        actorKey,
        operationId,
        pendingIntent,
        draft,
      );
}

async function markLocalDraftStaged(
  channel: IncomingKnowledgeCaptureDraft['channel'],
  draftId: string,
  actorKey: string,
  operationId: string,
) {
  return channel === 'browser_extension'
    ? markBrowserCaptureDraftStaged(draftId, actorKey, operationId)
    : markShareTargetDraftStaged(draftId, actorKey, operationId);
}

function publishLocalDraftLifecycle(
  channel: IncomingKnowledgeCaptureDraft['channel'],
  draftId: string,
  lifecycle: 'staged' | 'pending',
) {
  if (channel === 'pwa_share_target') {
    publishShareTargetLifecycle(draftId, lifecycle);
  } else {
    publishBrowserCaptureLifecycle(draftId, lifecycle);
  }
}

export function KnowledgeCaptureIngress({
  onCommitted,
  onCommitBusyChange,
  mutationBlocked = false,
}: {
  onCommitted?: (itemId: string) => void | Promise<void>;
  onCommitBusyChange?: (busy: boolean) => void;
  mutationBlocked?: boolean;
}) {
  const [draftId, setDraftId] = useState('');
  const [draft, setDraft] = useState<IncomingKnowledgeCaptureDraft | null>(
    null,
  );
  const [selectedFields, setSelectedFields] = useState<KnowledgeCaptureField[]>(
    [],
  );
  const [scope, setScope] = useState<KnowledgeScope>('personal');
  const [groups, setGroups] = useState('');
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>('manual');
  const [organizationConfirmed, setOrganizationConfirmed] = useState(false);
  const [explicitlyConfirmed, setExplicitlyConfirmed] = useState(false);
  const [preview, setPreview] = useState<KnowledgeCapturePreview | null>(null);
  const [result, setResult] = useState<KnowledgeCaptureResult | null>(null);
  const [uncertainCaptureId, setUncertainCaptureId] = useState('');
  const [busy, setBusy] = useState<'preview' | 'commit' | 'reconcile' | null>(
    null,
  );
  const [error, setError] = useState('');
  const [resumePending, setResumePending] = useState(false);
  const [authSuspended, setAuthSuspended] = useState(false);
  const handoffRequestKeyRef = useRef('');
  const handoffActorKeyRef = useRef('');
  const draftIdRef = useRef('');
  const requestKeyRef = useRef('');
  const operationAbortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const mutationBusyRef = useRef(false);
  const handoffLockedRef = useRef(false);
  const unresolved =
    resumePending ||
    result?.status === 'pending' ||
    Boolean(uncertainCaptureId);
  const blocksNavigation =
    busy === 'commit' || busy === 'reconcile' || unresolved;

  useEffect(() => {
    onCommitBusyChange?.(blocksNavigation);
  }, [blocksNavigation, onCommitBusyChange]);

  useEffect(() => () => onCommitBusyChange?.(false), [onCommitBusyChange]);

  const invalidatePreview = useCallback(() => {
    generationRef.current += 1;
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    setPreview(null);
    setResult(null);
    setUncertainCaptureId('');
    setExplicitlyConfirmed(false);
    setError('');
    requestKeyRef.current = '';
    handoffLockedRef.current = false;
  }, []);

  const purgeSensitiveDraft = useCallback(() => {
    onCommitBusyChange?.(false);
    mutationBusyRef.current = false;
    invalidatePreview();
    setBusy(null);
    setDraftId('');
    draftIdRef.current = '';
    setDraft(null);
    setSelectedFields([]);
    setGroups('');
    setScope('personal');
    setSourceType('manual');
    setOrganizationConfirmed(false);
    handoffRequestKeyRef.current = '';
    handoffActorKeyRef.current = '';
    setResumePending(false);
    setAuthSuspended(false);
  }, [invalidatePreview, onCommitBusyChange]);

  const revalidateHandoffActor = useCallback(
    async (signal: AbortSignal, generation: number) => {
      const expectedActorKey = handoffActorKeyRef.current;
      const valid =
        expectedActorKey.length > 0 &&
        (await revalidateCurrentAuthActor(expectedActorKey, signal));
      if (signal.aborted || generationRef.current !== generation) return false;
      if (valid) return true;
      // Trigger the landing controller's fail-closed verification path as well
      // as synchronously purging the editable payload in this component.
      window.dispatchEvent(new Event('erp4:auth-updated'));
      purgeSensitiveDraft();
      return false;
    },
    [purgeSensitiveDraft],
  );

  useEffect(() => {
    const receive = (event: Event) => {
      if (mutationBusyRef.current || handoffLockedRef.current) return;
      const detail = eventDetail((event as CustomEvent).detail);
      if (!detail) return;
      const normalized = normalizeIncomingKnowledgeCapture(detail.draft);
      if (!normalized) {
        setError('共有データの形式または上限を確認できません。');
        return;
      }
      invalidatePreview();
      setDraftId(detail.draftId);
      draftIdRef.current = detail.draftId;
      handoffRequestKeyRef.current = detail.requestKey;
      handoffActorKeyRef.current = detail.actorKey;
      setDraft(normalized);
      setSelectedFields(
        detail.pendingIntent?.selectedFields ??
          defaultKnowledgeCaptureFields(normalized),
      );
      setScope(detail.pendingIntent?.scope ?? 'personal');
      setGroups(
        detail.pendingIntent?.organizationGroupAccountIds.join('\n') ?? '',
      );
      setSourceType(
        detail.pendingIntent?.sourceType ?? (normalized.url ? 'web' : 'manual'),
      );
      setResumePending(detail.lifecycle === 'pending');
      setOrganizationConfirmed(false);
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, receive);
    const purge = (event: Event) => {
      const detail = purgeEventDetail((event as CustomEvent).detail);
      if (!detail || detail.draftId !== draftIdRef.current) return;
      purgeSensitiveDraft();
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purge);
    const authCheck = (event: Event) => {
      const detail = authCheckEventDetail((event as CustomEvent).detail);
      if (!detail || detail.draftId !== draftIdRef.current) return;
      setAuthSuspended(detail.checking);
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT, authCheck);
    return () => {
      window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, receive);
      window.removeEventListener(KNOWLEDGE_CAPTURE_PURGE_EVENT, purge);
      window.removeEventListener(KNOWLEDGE_CAPTURE_AUTH_CHECK_EVENT, authCheck);
      operationAbortRef.current?.abort();
      generationRef.current += 1;
    };
  }, [invalidatePreview, purgeSensitiveDraft]);

  const updateDraft = (
    field: keyof IncomingKnowledgeCaptureDraft,
    value: string,
  ) => {
    if (!draft) return;
    invalidatePreview();
    setDraft({ ...draft, [field]: value.trim().length === 0 ? null : value });
  };

  const toggleField = (field: KnowledgeCaptureField) => {
    invalidatePreview();
    setSelectedFields((current) =>
      current.includes(field)
        ? current.filter((candidate) => candidate !== field)
        : [...current, field],
    );
  };

  const runPreview = async () => {
    if (mutationBlocked) {
      setError('別のKnowledge保存処理が完了するまでpreviewできません。');
      return;
    }
    if (!draft || selectedFields.length === 0) {
      setError('保存するfieldを1件以上選択してください。');
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    setBusy('preview');
    setError('');
    try {
      if (!(await revalidateHandoffActor(controller.signal, generation))) {
        return;
      }
      const value = await previewKnowledgeCapture(
        {
          draft,
          selectedFields,
          scope,
          organizationGroupAccountIds:
            scope === 'organization' ? splitKnowledgeGroupIds(groups) : [],
          sourceType,
          requestKey: handoffRequestKeyRef.current,
        },
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      if (!(await revalidateHandoffActor(controller.signal, generation))) {
        return;
      }
      setPreview(value);
      requestKeyRef.current = handoffRequestKeyRef.current;
      setExplicitlyConfirmed(false);
      if (resumePending) {
        setUncertainCaptureId(value.captureId);
        handoffLockedRef.current = true;
      }
    } catch (caught) {
      if (controller.signal.aborted || generationRef.current !== generation)
        return;
      setError(safeError(caught));
    } finally {
      if (generationRef.current === generation) setBusy(null);
    }
  };

  const commit = async () => {
    if (mutationBlocked) {
      setError('別のKnowledge保存処理が完了するまで保存できません。');
      return;
    }
    if (!preview || !explicitlyConfirmed || !requestKeyRef.current) {
      setError('exact previewを確認してから保存してください。');
      return;
    }
    if (scope === 'organization' && !organizationConfirmed) {
      setError('組織の共有範囲へ保存することを追加確認してください。');
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    mutationBusyRef.current = true;
    onCommitBusyChange?.(true);
    setBusy('commit');
    setError('');
    if (!(await revalidateHandoffActor(controller.signal, generation))) {
      mutationBusyRef.current = false;
      onCommitBusyChange?.(false);
      return;
    }
    const commitDraftId = draftId;
    const commitActorKey = handoffActorKeyRef.current;
    let pendingOperationId = '';
    if (commitDraftId && commitActorKey) {
      try {
        pendingOperationId = createShareTargetPendingOperationId();
        const pendingTransition = await markLocalDraftPending(
          preview.draft.channel,
          commitDraftId,
          commitActorKey,
          pendingOperationId,
          {
            selectedFields: preview.selectedFields,
            scope: preview.scope,
            organizationGroupAccountIds: preview.organizationGroupAccountIds,
            sourceType: preview.sourceType,
          },
          preview.draft,
        );
        if (controller.signal.aborted || generationRef.current !== generation) {
          // A remote owner may have published pending while this caller was
          // waiting for the serialized IndexedDB transaction. Only the CAS
          // winner may compensate its own transition; a loser leaves the
          // exact pending row untouched for the landing reload.
          if (pendingTransition.transitioned) {
            const restored = await markLocalDraftStaged(
              preview.draft.channel,
              commitDraftId,
              commitActorKey,
              pendingOperationId,
            )
              .then(() => true)
              .catch(() => false);
            publishLocalDraftLifecycle(
              preview.draft.channel,
              commitDraftId,
              restored ? 'staged' : 'pending',
            );
          }
          return;
        }
        if (!pendingTransition.transitioned) {
          setDraft(pendingTransition.draft);
          setSelectedFields(pendingTransition.pendingIntent.selectedFields);
          setScope(pendingTransition.pendingIntent.scope);
          setGroups(
            pendingTransition.pendingIntent.organizationGroupAccountIds.join(
              '\n',
            ),
          );
          setSourceType(pendingTransition.pendingIntent.sourceType);
          setPreview(null);
          requestKeyRef.current = '';
          setExplicitlyConfirmed(false);
          setResumePending(true);
          setUncertainCaptureId('');
          handoffLockedRef.current = false;
          onCommitBusyChange?.(true);
          setError(
            '別の画面で保存処理が開始されています。保存中のexact draftを再読込しました。read-only preview後に保存結果を再照合してください。',
          );
          mutationBusyRef.current = false;
          if (generationRef.current === generation) setBusy(null);
          return;
        }
        publishLocalDraftLifecycle(
          preview.draft.channel,
          commitDraftId,
          'pending',
        );
      } catch {
        if (controller.signal.aborted || generationRef.current !== generation) {
          return;
        }
        mutationBusyRef.current = false;
        onCommitBusyChange?.(false);
        if (generationRef.current === generation) setBusy(null);
        setError(
          '端末内の共有下書きを保存中として固定できませんでした。外部送信は開始していません。',
        );
        return;
      }
    }
    try {
      const value = await commitKnowledgeCapture(
        {
          preview,
          requestKey: requestKeyRef.current,
          organizationConfirmed,
        },
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      setResult(value);
      handoffLockedRef.current = value.status !== 'ready';
      if (value.status === 'ready') {
        resultEvent(draftId, 'committed');
        await Promise.resolve(onCommitted?.(value.itemId)).catch(
          () => undefined,
        );
        onCommitBusyChange?.(false);
      } else if (value.status === 'failed') {
        resultEvent(draftId, 'failed');
        onCommitBusyChange?.(false);
      } else {
        onCommitBusyChange?.(true);
      }
    } catch (caught) {
      if (controller.signal.aborted || generationRef.current !== generation)
        return;
      if (isDefiniteCommitRejection(caught)) {
        let localStateRestored = true;
        if (draftId && handoffActorKeyRef.current) {
          try {
            await markLocalDraftStaged(
              preview.draft.channel,
              draftId,
              handoffActorKeyRef.current,
              pendingOperationId,
            );
            publishLocalDraftLifecycle(
              preview.draft.channel,
              draftId,
              'staged',
            );
          } catch {
            localStateRestored = false;
          }
        }
        if (!localStateRestored) {
          setUncertainCaptureId(preview.captureId);
          handoffLockedRef.current = true;
          onCommitBusyChange?.(true);
          setError(
            '端末内の保存状態を復元できませんでした。新規送信せず、状態を確認してください。',
          );
          return;
        }
        setPreview(null);
        setExplicitlyConfirmed(false);
        requestKeyRef.current = '';
        handoffLockedRef.current = false;
        setResumePending(false);
        onCommitBusyChange?.(false);
        setError(safeError(caught));
      } else {
        setUncertainCaptureId(preview.captureId);
        handoffLockedRef.current = true;
        onCommitBusyChange?.(true);
        setError(
          '保存結果が不明です。自動再送せず、同じrequest keyで再照合してください。',
        );
      }
    } finally {
      mutationBusyRef.current = false;
      if (generationRef.current === generation) setBusy(null);
    }
  };

  const reconcile = async () => {
    if (mutationBlocked) {
      setError('別のKnowledge保存処理が完了するまで再照合できません。');
      return;
    }
    if (!preview || !requestKeyRef.current || !unresolved) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    mutationBusyRef.current = true;
    onCommitBusyChange?.(true);
    setBusy('reconcile');
    setError('');
    try {
      if (!(await revalidateHandoffActor(controller.signal, generation))) {
        onCommitBusyChange?.(false);
        return;
      }
      const value = await reconcileKnowledgeCapture(
        { preview, requestKey: requestKeyRef.current },
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      setResult(value);
      setUncertainCaptureId('');
      handoffLockedRef.current = value.status !== 'ready';
      if (value.status === 'ready') {
        resultEvent(draftId, 'committed');
        await Promise.resolve(onCommitted?.(value.itemId)).catch(
          () => undefined,
        );
        onCommitBusyChange?.(false);
      } else if (value.status === 'failed') {
        resultEvent(draftId, 'failed');
        onCommitBusyChange?.(false);
      } else {
        onCommitBusyChange?.(true);
      }
    } catch (caught) {
      if (controller.signal.aborted || generationRef.current !== generation)
        return;
      setError(safeError(caught));
      onCommitBusyChange?.(true);
    } finally {
      mutationBusyRef.current = false;
      if (generationRef.current === generation) setBusy(null);
    }
  };

  const discard = () => {
    if (draftId) resultEvent(draftId, 'discarded');
    purgeSensitiveDraft();
  };

  if (!draft || authSuspended) return null;
  const handoffLocked = result !== null || Boolean(uncertainCaptureId);
  const actionBlocked = mutationBlocked || busy !== null || handoffLocked;
  const controlsBlocked = actionBlocked || resumePending;
  return (
    <Card padding="small">
      <section aria-labelledby="knowledge-capture-ingress-title">
        <h3 id="knowledge-capture-ingress-title">ブラウザー共有の確認</h3>
        <p>
          外部入力はまだ保存されていません。送信fieldとscopeを確認し、preview後に明示確定してください。
        </p>
        {mutationBlocked ? (
          <Alert variant="warning">
            別のKnowledge保存処理が完了するまで、このcaptureは開始できません。
          </Alert>
        ) : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        <div className="knowledge-capture-ingress-fields">
          {(
            [
              ['title', draft.title],
              ['url', draft.url],
              ['selectedText', draft.selectedText],
              ['description', draft.description],
              ['author', draft.author],
              ['publishedAt', draft.publishedAt],
            ] as const
          ).map(([field, value]) =>
            value === null ? null : (
              <label key={field}>
                <input
                  type="checkbox"
                  checked={selectedFields.includes(field)}
                  disabled={controlsBlocked}
                  onChange={() => toggleField(field)}
                />{' '}
                {fieldLabels[field]}
              </label>
            ),
          )}
        </div>
        <Input
          label="ページタイトル"
          value={draft.title ?? ''}
          maxLength={500}
          disabled={controlsBlocked}
          onChange={(event) => updateDraft('title', event.target.value)}
        />
        <Input
          label="URL"
          value={draft.url ?? ''}
          maxLength={4096}
          disabled={controlsBlocked}
          onChange={(event) => updateDraft('url', event.target.value)}
        />
        <Textarea
          label="選択テキスト"
          value={draft.selectedText ?? ''}
          rows={5}
          disabled={controlsBlocked}
          onChange={(event) => updateDraft('selectedText', event.target.value)}
        />
        <Textarea
          label="説明"
          value={draft.description ?? ''}
          rows={3}
          disabled={controlsBlocked}
          onChange={(event) => updateDraft('description', event.target.value)}
        />
        <Input
          label="著者"
          value={draft.author ?? ''}
          maxLength={500}
          disabled={controlsBlocked}
          onChange={(event) => updateDraft('author', event.target.value)}
        />
        <Input
          label="公開日時"
          value={draft.publishedAt ?? ''}
          maxLength={200}
          disabled={controlsBlocked}
          onChange={(event) => updateDraft('publishedAt', event.target.value)}
        />
        <Select
          label="source type"
          value={sourceType}
          disabled={controlsBlocked}
          onChange={(event) => {
            invalidatePreview();
            setSourceType(event.target.value as KnowledgeSourceType);
          }}
        >
          <option value="web">web</option>
          <option value="manual">manual</option>
          <option value="other">other</option>
        </Select>
        <Select
          label="保存scope"
          value={scope}
          disabled={controlsBlocked}
          onChange={(event) => {
            invalidatePreview();
            setScope(event.target.value as KnowledgeScope);
            setOrganizationConfirmed(false);
          }}
        >
          <option value="personal">personal（既定）</option>
          <option value="organization">organization（追加確認）</option>
        </Select>
        {scope === 'organization' ? (
          <>
            <Textarea
              label="共有先グループアカウントID"
              value={groups}
              rows={2}
              disabled={controlsBlocked}
              onChange={(event) => {
                invalidatePreview();
                setGroups(event.target.value);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={organizationConfirmed}
                disabled={controlsBlocked}
                onChange={(event) =>
                  setOrganizationConfirmed(event.target.checked)
                }
              />{' '}
              組織の対象groupへ保存することを追加確認しました
            </label>
          </>
        ) : null}

        {preview ? (
          <div aria-live="polite" className="knowledge-capture-ingress-preview">
            <h4>Exact preview</h4>
            <p>
              選択 {preview.fieldCount} field / {preview.byteCount} bytes、除外{' '}
              {preview.omittedFields.length} field
            </p>
            <ul>
              {preview.selectedFields.map((field) => (
                <li key={field}>{fieldLabels[field]}</li>
              ))}
            </ul>
            <dl>
              {preview.selectedFields.map((field) => (
                <React.Fragment key={field}>
                  <dt>{fieldLabels[field]}</dt>
                  <dd>
                    <pre>{preview.draft[field] ?? '（空）'}</pre>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
            <p>
              保存しないfield:{' '}
              {preview.omittedFields.length === 0
                ? 'なし'
                : preview.omittedFields
                    .map((field) => fieldLabels[field])
                    .join('、')}
            </p>
            {preview.duplicateCandidate.detected ? (
              <Alert variant="warning">
                同じ内容の保存候補があります。確定時はrequest
                keyにより増殖を防止します。
              </Alert>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={explicitlyConfirmed}
                disabled={controlsBlocked}
                onChange={(event) =>
                  setExplicitlyConfirmed(event.target.checked)
                }
              />{' '}
              このexact previewを保存します
            </label>
          </div>
        ) : null}

        {result ? (
          <Alert
            variant={
              result.status === 'ready'
                ? 'success'
                : result.status === 'failed'
                  ? 'error'
                  : 'warning'
            }
          >
            {result.reused
              ? '既存の保存結果を表示しています。'
              : result.status === 'ready'
                ? '保存しました。'
                : result.status === 'failed'
                  ? '保存に失敗しました。自動再送は行いません。'
                  : '保存結果を確認中です。自動再送せず、再照合してください。'}
          </Alert>
        ) : null}

        {uncertainCaptureId ? (
          <Alert variant="warning">
            結果不明のcaptureを保持しています。新規送信は行わず、まず保存結果を再照合してください。
          </Alert>
        ) : null}

        {resumePending && !preview ? (
          <Alert variant="warning">
            前回の保存結果を確認するため、まずread-only
            previewを再作成してください。
          </Alert>
        ) : null}

        <div className="knowledge-capture-ingress-actions">
          <Button
            variant="secondary"
            loading={busy === 'preview'}
            disabled={actionBlocked}
            onClick={() => void runPreview()}
          >
            Preview
          </Button>
          <Button
            loading={busy === 'commit'}
            disabled={
              !preview ||
              !explicitlyConfirmed ||
              controlsBlocked ||
              resumePending
            }
            onClick={() => void commit()}
          >
            明示確定して保存
          </Button>
          {preview && unresolved ? (
            <Button
              variant="secondary"
              loading={busy === 'reconcile'}
              disabled={busy !== null || mutationBlocked}
              onClick={() => void reconcile()}
            >
              保存結果を再照合
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={busy !== null || unresolved}
            onClick={discard}
          >
            破棄
          </Button>
        </div>
      </section>
    </Card>
  );
}
