import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Alert, Button, Card, Input, Select, Textarea } from '../../ui';
import {
  commitKnowledgeCapture,
  previewKnowledgeCapture,
  reconcileKnowledgeCapture,
} from './knowledgeCaptureApi';
import {
  defaultKnowledgeCaptureFields,
  KNOWLEDGE_CAPTURE_DRAFT_EVENT,
  KNOWLEDGE_CAPTURE_RESULT_EVENT,
  normalizeIncomingKnowledgeCapture,
  splitKnowledgeGroupIds,
  type IncomingKnowledgeCaptureDraft,
  type KnowledgeCaptureField,
  type KnowledgeCapturePreview,
  type KnowledgeCaptureResult,
} from './knowledgeCaptureModel';
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

type IngressEventDetail = { draftId: string; draft: unknown };

function eventDetail(value: unknown): IngressEventDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.draftId !== 'string' ||
    !/^[A-Za-z0-9_-]{22,128}$/u.test(record.draftId)
  )
    return null;
  return { draftId: record.draftId, draft: record.draft };
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
  'not_found',
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

function resultEvent(draftId: string, outcome: 'committed' | 'discarded') {
  window.dispatchEvent(
    new CustomEvent(KNOWLEDGE_CAPTURE_RESULT_EVENT, {
      detail: { schemaVersion: 1, draftId, outcome },
    }),
  );
}

export function KnowledgeCaptureIngress({
  onCommitted,
  onCommitBusyChange,
}: {
  onCommitted?: (itemId: string) => void | Promise<void>;
  onCommitBusyChange?: (busy: boolean) => void;
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
  const requestKeyRef = useRef('');
  const operationAbortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const mutationBusyRef = useRef(false);
  const handoffLockedRef = useRef(false);
  const unresolved =
    result?.status === 'pending' || Boolean(uncertainCaptureId);
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
      setDraft(normalized);
      setSelectedFields(defaultKnowledgeCaptureFields(normalized));
      setScope('personal');
      setGroups('');
      setSourceType(normalized.url ? 'web' : 'manual');
      setOrganizationConfirmed(false);
    };
    window.addEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, receive);
    return () => {
      window.removeEventListener(KNOWLEDGE_CAPTURE_DRAFT_EVENT, receive);
      operationAbortRef.current?.abort();
      generationRef.current += 1;
    };
  }, [invalidatePreview]);

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
      const value = await previewKnowledgeCapture(
        {
          draft,
          selectedFields,
          scope,
          organizationGroupAccountIds:
            scope === 'organization' ? splitKnowledgeGroupIds(groups) : [],
          sourceType,
          requestKey: draftId,
        },
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      setPreview(value);
      // The opaque 128-bit handoff ID is stable across an offline/login
      // resume.  The backend stores only its actor-scoped HMAC.
      requestKeyRef.current = draftId;
      setExplicitlyConfirmed(false);
    } catch (caught) {
      if (controller.signal.aborted || generationRef.current !== generation)
        return;
      setError(safeError(caught));
    } finally {
      if (generationRef.current === generation) setBusy(null);
    }
  };

  const commit = async () => {
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
      onCommitBusyChange?.(value.status === 'pending');
      if (value.status === 'ready') {
        resultEvent(draftId, 'committed');
        await Promise.resolve(onCommitted?.(value.itemId)).catch(
          () => undefined,
        );
      }
    } catch (caught) {
      if (controller.signal.aborted || generationRef.current !== generation)
        return;
      if (isDefiniteCommitRejection(caught)) {
        setPreview(null);
        setExplicitlyConfirmed(false);
        requestKeyRef.current = '';
        handoffLockedRef.current = false;
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
      const value = await reconcileKnowledgeCapture(
        { preview, requestKey: requestKeyRef.current },
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      setResult(value);
      setUncertainCaptureId('');
      handoffLockedRef.current = value.status !== 'ready';
      onCommitBusyChange?.(value.status === 'pending');
      if (value.status === 'ready') {
        resultEvent(draftId, 'committed');
        await Promise.resolve(onCommitted?.(value.itemId)).catch(
          () => undefined,
        );
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
    onCommitBusyChange?.(false);
    if (draftId) resultEvent(draftId, 'discarded');
    invalidatePreview();
    setDraftId('');
    setDraft(null);
    setSelectedFields([]);
    setGroups('');
    setScope('personal');
    setOrganizationConfirmed(false);
  };

  if (!draft) return null;
  const handoffLocked = result !== null || Boolean(uncertainCaptureId);
  return (
    <Card padding="small">
      <section aria-labelledby="knowledge-capture-ingress-title">
        <h3 id="knowledge-capture-ingress-title">ブラウザー共有の確認</h3>
        <p>
          外部入力はまだ保存されていません。送信fieldとscopeを確認し、preview後に明示確定してください。
        </p>
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
                  disabled={busy !== null || handoffLocked}
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
          disabled={busy !== null || handoffLocked}
          onChange={(event) => updateDraft('title', event.target.value)}
        />
        <Input
          label="URL"
          value={draft.url ?? ''}
          maxLength={4096}
          disabled={busy !== null || handoffLocked}
          onChange={(event) => updateDraft('url', event.target.value)}
        />
        <Textarea
          label="選択テキスト"
          value={draft.selectedText ?? ''}
          rows={5}
          disabled={busy !== null || handoffLocked}
          onChange={(event) => updateDraft('selectedText', event.target.value)}
        />
        <Textarea
          label="説明"
          value={draft.description ?? ''}
          rows={3}
          disabled={busy !== null || handoffLocked}
          onChange={(event) => updateDraft('description', event.target.value)}
        />
        <Input
          label="著者"
          value={draft.author ?? ''}
          maxLength={500}
          disabled={busy !== null || handoffLocked}
          onChange={(event) => updateDraft('author', event.target.value)}
        />
        <Input
          label="公開日時"
          value={draft.publishedAt ?? ''}
          maxLength={200}
          disabled={busy !== null || handoffLocked}
          onChange={(event) => updateDraft('publishedAt', event.target.value)}
        />
        <Select
          label="source type"
          value={sourceType}
          disabled={busy !== null || handoffLocked}
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
          disabled={busy !== null || handoffLocked}
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
              disabled={busy !== null || handoffLocked}
              onChange={(event) => {
                invalidatePreview();
                setGroups(event.target.value);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={organizationConfirmed}
                disabled={busy !== null || handoffLocked}
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
                disabled={busy !== null || handoffLocked}
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

        <div className="knowledge-capture-ingress-actions">
          <Button
            variant="secondary"
            loading={busy === 'preview'}
            disabled={busy !== null || handoffLocked}
            onClick={() => void runPreview()}
          >
            Preview
          </Button>
          <Button
            loading={busy === 'commit'}
            disabled={
              !preview || !explicitlyConfirmed || busy !== null || handoffLocked
            }
            onClick={() => void commit()}
          >
            明示確定して保存
          </Button>
          {unresolved ? (
            <Button
              variant="secondary"
              loading={busy === 'reconcile'}
              disabled={busy !== null}
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
