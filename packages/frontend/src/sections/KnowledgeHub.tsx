import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from '../ui';
import { downloadResponseAsFile } from '../utils/download';
import {
  WorkflowMetricGrid,
  WorkflowPageHeader,
  WorkflowPanel,
  type WorkflowMetric,
} from './workflowUx';
import {
  captureKnowledgeTextOrUrl,
  createKnowledgeItem,
  KnowledgeHubApiError,
  listKnowledgeInbox,
  listKnowledgeSnapshots,
  openKnowledgeSnapshotDownload,
  reconcileKnowledgeSnapshot,
  uploadKnowledgeSnapshot,
} from './knowledge-hub/knowledgeHubApi';
import {
  createKnowledgeRequestKey,
  formatKnowledgeBytes,
  formatKnowledgeDateTime,
  isKnowledgeHubErrorCode,
  knowledgeHubErrorMessage,
  validateKnowledgeCapture,
  type KnowledgeCaptureDestination,
  type KnowledgeCaptureMode,
  type KnowledgeItem,
  type KnowledgeScope,
  type KnowledgeSnapshot,
} from './knowledge-hub/knowledgeHubModel';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';
type Notice = {
  tone: 'success' | 'warning' | 'error' | 'info';
  text: string;
};
type PendingAttempt = {
  itemId: string;
  snapshotId: string;
  requestKey: string;
};

const snapshotStatusDictionary = {
  pending: { label: '確認中', tone: 'warning' },
  ready: { label: '保存済み', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
} as const;

const itemScopeDictionary = {
  personal: { label: '個人', tone: 'info' },
  organization: { label: '組織', tone: 'warning' },
} as const;

function toSafeErrorMessage(error: unknown) {
  return knowledgeHubErrorMessage(
    error instanceof KnowledgeHubApiError ? error.code : 'unknown_error',
  );
}

function itemLabel(item: KnowledgeItem) {
  return item.title?.trim() || `${item.sourceType} / 無題の項目`;
}

function upsertSnapshot(
  snapshots: KnowledgeSnapshot[],
  next: KnowledgeSnapshot,
) {
  return [
    next,
    ...snapshots.filter((snapshot) => snapshot.id !== next.id),
  ].sort((left, right) => right.version - left.version);
}

function safeFailureMessage(snapshot: KnowledgeSnapshot) {
  return isKnowledgeHubErrorCode(snapshot.failureCode)
    ? knowledgeHubErrorMessage(snapshot.failureCode)
    : knowledgeHubErrorMessage('unknown_error');
}

export const KnowledgeHub: React.FC = () => {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [itemsStatus, setItemsStatus] = useState<LoadStatus>('idle');
  const [itemsError, setItemsError] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [snapshots, setSnapshots] = useState<KnowledgeSnapshot[]>([]);
  const [snapshotsStatus, setSnapshotsStatus] = useState<LoadStatus>('idle');
  const [snapshotsError, setSnapshotsError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  const [destination, setDestination] =
    useState<KnowledgeCaptureDestination>('new');
  const [mode, setMode] = useState<KnowledgeCaptureMode>('text');
  const [scope, setScope] = useState<KnowledgeScope>('personal');
  const [title, setTitle] = useState('');
  const [organizationGroupIds, setOrganizationGroupIds] = useState('');
  const [organizationConfirmed, setOrganizationConfirmed] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [downloadBusyId, setDownloadBusyId] = useState('');
  const [reconcileBusyId, setReconcileBusyId] = useState('');
  const [pendingAttempt, setPendingAttempt] = useState<PendingAttempt | null>(
    null,
  );

  const itemLoadSequence = useRef(0);
  const snapshotLoadSequence = useRef(0);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const loadItems = useCallback(async () => {
    const sequence = itemLoadSequence.current + 1;
    itemLoadSequence.current = sequence;
    setItemsStatus('loading');
    setItemsError('');
    try {
      const nextItems = await listKnowledgeInbox();
      if (itemLoadSequence.current !== sequence) return;
      setItems(nextItems);
      setSelectedItemId((current) =>
        current && nextItems.some((item) => item.id === current)
          ? current
          : (nextItems[0]?.id ?? ''),
      );
      setItemsStatus('success');
    } catch (error) {
      if (itemLoadSequence.current !== sequence) return;
      setItems([]);
      setSelectedItemId('');
      setItemsStatus('error');
      setItemsError(toSafeErrorMessage(error));
    }
  }, []);

  const loadSnapshots = useCallback(async (itemId: string) => {
    const sequence = snapshotLoadSequence.current + 1;
    snapshotLoadSequence.current = sequence;
    if (!itemId) {
      setSnapshots([]);
      setSnapshotsStatus('idle');
      setSnapshotsError('');
      return [];
    }
    setSnapshotsStatus('loading');
    setSnapshotsError('');
    try {
      const nextSnapshots = await listKnowledgeSnapshots(itemId);
      if (snapshotLoadSequence.current !== sequence) return nextSnapshots;
      setSnapshots(nextSnapshots);
      setSnapshotsStatus('success');
      return nextSnapshots;
    } catch (error) {
      if (snapshotLoadSequence.current !== sequence) return [];
      setSnapshots([]);
      setSnapshotsStatus('error');
      setSnapshotsError(toSafeErrorMessage(error));
      return [];
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadSnapshots(selectedItemId);
  }, [loadSnapshots, selectedItemId]);

  useEffect(() => {
    if (selectedItem || destination !== 'selected') return;
    setDestination('new');
  }, [destination, selectedItem]);

  const organizationCapture =
    destination === 'new'
      ? scope === 'organization'
      : selectedItem?.scope === 'organization';

  const resetCaptureContent = () => {
    setText('');
    setUrl('');
    setFile(null);
    setFileInputKey((current) => current + 1);
  };

  const submitCapture = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const validation = validateKnowledgeCapture({
      destination,
      mode,
      scope,
      title,
      organizationGroupIds,
      organizationConfirmed,
      text,
      url,
      file,
      selectedItem,
    });
    if (!validation.ok) {
      setNotice({ tone: 'error', text: validation.error });
      return;
    }

    let requestKey: string;
    try {
      requestKey = createKnowledgeRequestKey();
    } catch {
      setNotice({
        tone: 'error',
        text: '安全なリクエスト識別子を生成できません。ブラウザを再読込してください。',
      });
      return;
    }

    const input = validation.value;
    setCaptureBusy(true);
    const previousSnapshotIds = new Set(
      input.destination === 'selected'
        ? snapshots.map((snapshot) => snapshot.id)
        : [],
    );
    let targetItem = input.selectedItem;
    let createdItem: KnowledgeItem | null = null;
    try {
      if (input.destination === 'new') {
        const newItem = await createKnowledgeItem({
          canonicalUrl: input.mode === 'url' ? input.url : undefined,
          organizationGroupIds: input.organizationGroupIds,
          scope: input.scope,
          sourceType: input.sourceType,
          title: input.title,
        });
        createdItem = newItem;
        targetItem = newItem;
        setItems((current) => [
          newItem,
          ...current.filter((item) => item.id !== newItem.id),
        ]);
      }
      if (!targetItem) {
        setNotice({
          tone: 'error',
          text: '保存先のInbox項目を確認できませんでした。',
        });
        return;
      }

      const captured =
        input.mode === 'text' || input.mode === 'url'
          ? await captureKnowledgeTextOrUrl({
              itemId: targetItem.id,
              requestKey,
              mode: input.mode,
              text: input.text,
              url: input.url,
            })
          : await uploadKnowledgeSnapshot({
              itemId: targetItem.id,
              requestKey,
              file: input.file as File,
            });

      setSelectedItemId(targetItem.id);
      setSnapshots((current) =>
        input.destination === 'new'
          ? [captured]
          : upsertSnapshot(current, captured),
      );
      setSnapshotsStatus('success');
      setSnapshotsError('');
      if (captured.status === 'pending') {
        setPendingAttempt({
          itemId: targetItem.id,
          snapshotId: captured.id,
          requestKey,
        });
        setNotice({
          tone: 'warning',
          text: '保存結果を確認中です。自動再送せず「保存結果を再照合」を実行してください。',
        });
      } else {
        setPendingAttempt(null);
        setNotice({
          tone: 'success',
          text: `スナップショット version ${captured.version} を保存しました。`,
        });
        resetCaptureContent();
      }
    } catch (error) {
      if (!targetItem) {
        setNotice({ tone: 'error', text: toSafeErrorMessage(error) });
        return;
      }
      setSelectedItemId(targetItem.id);
      const history = await listKnowledgeSnapshots(targetItem.id).catch(
        () => [] as KnowledgeSnapshot[],
      );
      setSnapshots(history);
      setSnapshotsStatus('success');
      setSnapshotsError('');
      const pending = history.find(
        (snapshot) =>
          snapshot.status === 'pending' &&
          !previousSnapshotIds.has(snapshot.id),
      );
      setPendingAttempt(
        pending
          ? { itemId: targetItem.id, snapshotId: pending.id, requestKey }
          : null,
      );
      setNotice({
        tone: pending ? 'warning' : 'error',
        text: `${createdItem ? 'Inbox項目は保持されました。' : ''}${toSafeErrorMessage(error)}`,
      });
    } finally {
      setCaptureBusy(false);
    }
  };

  const reconcile = async (snapshot: KnowledgeSnapshot) => {
    if (
      !pendingAttempt ||
      pendingAttempt.itemId !== snapshot.knowledgeItemId ||
      pendingAttempt.snapshotId !== snapshot.id
    ) {
      return;
    }
    setReconcileBusyId(snapshot.id);
    setNotice(null);
    try {
      const reconciled = await reconcileKnowledgeSnapshot(pendingAttempt);
      setSnapshots((current) => upsertSnapshot(current, reconciled));
      if (reconciled.status !== 'pending') setPendingAttempt(null);
      setNotice({
        tone: reconciled.status === 'ready' ? 'success' : 'warning',
        text:
          reconciled.status === 'ready'
            ? `version ${reconciled.version} の保存結果を確認しました。`
            : '保存結果はまだ確認中です。時間を置いて再照合してください。',
      });
    } catch (error) {
      setNotice({ tone: 'error', text: toSafeErrorMessage(error) });
      const refreshed = await listKnowledgeSnapshots(
        snapshot.knowledgeItemId,
      ).catch(() => snapshots);
      setSnapshots(refreshed);
    } finally {
      setReconcileBusyId('');
    }
  };

  const download = async (snapshot: KnowledgeSnapshot) => {
    setDownloadBusyId(snapshot.id);
    setNotice(null);
    try {
      const response = await openKnowledgeSnapshotDownload({
        itemId: snapshot.knowledgeItemId,
        snapshotId: snapshot.id,
      });
      await downloadResponseAsFile(response, snapshot.originalName);
      setNotice({
        tone: 'success',
        text: `version ${snapshot.version} をダウンロードしました。`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: toSafeErrorMessage(error) });
    } finally {
      setDownloadBusyId('');
    }
  };

  const metrics = useMemo<WorkflowMetric[]>(() => {
    const ready = snapshots.filter(
      (snapshot) => snapshot.status === 'ready',
    ).length;
    const pending = snapshots.filter(
      (snapshot) => snapshot.status === 'pending',
    ).length;
    return [
      {
        label: 'Inbox',
        value: `${items.length}件`,
        helper: '現在の権限で参照できる未整理項目',
      },
      {
        label: '選択中',
        value: selectedItem ? itemLabel(selectedItem) : '未選択',
        helper: selectedItem
          ? `${selectedItem.scope} / ${selectedItem.sourceType}`
          : 'Inboxから項目を選択',
      },
      {
        label: '保存済みversion',
        value: `${ready}件`,
        helper: '認可済みdownloadが可能',
        tone: ready ? 'success' : 'default',
      },
      {
        label: '確認中',
        value: `${pending}件`,
        helper: pending
          ? '自動再送せず保存結果を再照合'
          : '未確定の外部副作用なし',
        tone: pending ? 'warning' : 'default',
      },
    ];
  }, [items.length, selectedItem, snapshots]);

  const itemList = (() => {
    if (itemsStatus === 'idle' || itemsStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="Inboxを取得中" />;
    }
    if (itemsStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: 'Inboxを取得できませんでした',
            detail: itemsError,
            retryLabel: '再試行',
            onRetry: () => void loadItems(),
          }}
        />
      );
    }
    if (items.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'Inboxは空です',
            description: '左のクイック保存から最初の情報を登録してください。',
          }}
        />
      );
    }
    return (
      <ul className="knowledge-hub-item-list" aria-label="Knowledge Inbox">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="knowledge-hub-item-button"
              aria-pressed={item.id === selectedItemId}
              onClick={() => setSelectedItemId(item.id)}
            >
              <span className="knowledge-hub-item-title">
                {itemLabel(item)}
              </span>
              <span className="knowledge-hub-item-meta">
                <StatusBadge
                  status={item.scope}
                  dictionary={itemScopeDictionary}
                  size="sm"
                />
                <span>{item.sourceType}</span>
                <span>{formatKnowledgeDateTime(item.capturedAt)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  })();

  const snapshotList = (() => {
    if (!selectedItem) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '項目が選択されていません',
            description: 'Inboxから履歴を確認する項目を選択してください。',
          }}
        />
      );
    }
    if (snapshotsStatus === 'idle' || snapshotsStatus === 'loading') {
      return (
        <AsyncStatePanel state="loading" loadingText="version履歴を取得中" />
      );
    }
    if (snapshotsStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: 'version履歴を取得できませんでした',
            detail: snapshotsError,
            retryLabel: '再試行',
            onRetry: () => void loadSnapshots(selectedItem.id),
          }}
        />
      );
    }
    if (snapshots.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'スナップショットはありません',
            description:
              'クイック保存で「選択中の項目へversion追加」を選択できます。',
          }}
        />
      );
    }
    return (
      <div className="knowledge-hub-snapshot-list">
        {snapshots.map((snapshot) => {
          const canReconcile =
            snapshot.status === 'pending' &&
            pendingAttempt?.itemId === snapshot.knowledgeItemId &&
            pendingAttempt.snapshotId === snapshot.id;
          return (
            <article
              className="knowledge-hub-snapshot-card"
              key={snapshot.id}
              aria-label={`version ${snapshot.version}`}
            >
              <div className="knowledge-hub-snapshot-heading">
                <div>
                  <strong>version {snapshot.version}</strong>
                  <span className="knowledge-hub-snapshot-name">
                    {snapshot.originalName}
                  </span>
                </div>
                <StatusBadge
                  status={snapshot.status}
                  dictionary={snapshotStatusDictionary}
                  size="sm"
                />
              </div>
              <dl className="knowledge-hub-provenance-grid">
                <div>
                  <dt>取得方式</dt>
                  <dd>{snapshot.captureMethod}</dd>
                </div>
                <div>
                  <dt>content type</dt>
                  <dd>{snapshot.contentType || '-'}</dd>
                </div>
                <div>
                  <dt>サイズ</dt>
                  <dd>{formatKnowledgeBytes(snapshot.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>取得日時</dt>
                  <dd>{formatKnowledgeDateTime(snapshot.capturedAt)}</dd>
                </div>
                <div className="knowledge-hub-provenance-wide">
                  <dt>SHA-256</dt>
                  <dd className="knowledge-hub-hash">
                    {snapshot.sha256 || '確定前'}
                  </dd>
                </div>
                {snapshot.sourceUrl ? (
                  <div className="knowledge-hub-provenance-wide">
                    <dt>元URL</dt>
                    <dd className="knowledge-hub-source-url">
                      {snapshot.sourceUrl}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {snapshot.status === 'failed' ? (
                <Alert variant="error">{safeFailureMessage(snapshot)}</Alert>
              ) : null}
              {snapshot.status === 'pending' && !canReconcile ? (
                <Alert variant="warning">
                  このsessionには照合用のrequest
                  keyがありません。自動再送せず、保存操作を行ったsessionで再照合してください。
                </Alert>
              ) : null}
              <div className="knowledge-hub-snapshot-actions">
                {snapshot.status === 'ready' ? (
                  <Button
                    size="small"
                    variant="secondary"
                    loading={downloadBusyId === snapshot.id}
                    onClick={() => void download(snapshot)}
                  >
                    認可済みファイルをダウンロード
                  </Button>
                ) : null}
                {canReconcile ? (
                  <Button
                    size="small"
                    variant="secondary"
                    loading={reconcileBusyId === snapshot.id}
                    onClick={() => void reconcile(snapshot)}
                  >
                    保存結果を再照合
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    );
  })();

  return (
    <div className="knowledge-hub">
      <WorkflowPageHeader
        title="Knowledge Hub"
        description="外部情報や手動メモをInboxへ保存し、immutableなversion・SHA-256・出所を確認します。"
      />
      <WorkflowMetricGrid items={metrics} ariaLabel="Knowledge Hubサマリー" />

      {notice ? (
        <div className="knowledge-hub-notice" aria-live="polite">
          <Alert variant={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      <div className="knowledge-hub-primary-grid">
        <WorkflowPanel
          title="クイック保存"
          description="既定は個人Inboxです。元情報とsnapshotは分離され、確定済みsnapshotは更新されません。"
        >
          <Card padding="small">
            <form
              className="knowledge-hub-capture-form"
              noValidate
              onSubmit={submitCapture}
            >
              <Select
                label="保存先"
                value={destination}
                onChange={(event) => {
                  setDestination(
                    event.target.value as KnowledgeCaptureDestination,
                  );
                  setOrganizationConfirmed(false);
                }}
              >
                <option value="new">新しいInbox項目</option>
                <option value="selected" disabled={!selectedItem}>
                  選択中の項目へversion追加
                </option>
              </Select>

              <Select
                label="保存形式"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as KnowledgeCaptureMode);
                  resetCaptureContent();
                }}
              >
                <option value="text">手動テキスト</option>
                <option value="url">URL</option>
                <option value="pdf">PDF</option>
                <option value="image">画像</option>
              </Select>

              {destination === 'new' ? (
                <>
                  <Select
                    label="scope"
                    value={scope}
                    onChange={(event) => {
                      setScope(event.target.value as KnowledgeScope);
                      setOrganizationConfirmed(false);
                    }}
                    helpText="既定のpersonalは所有者だけが通常UI/APIから参照できます。"
                  >
                    <option value="personal">personal（個人）</option>
                    <option value="organization">organization（組織）</option>
                  </Select>
                  <Input
                    label="タイトル（任意）"
                    value={title}
                    maxLength={500}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="後で見つけやすい短いタイトル"
                  />
                  {scope === 'organization' ? (
                    <Textarea
                      label="共有先グループID"
                      aria-label="共有先グループID"
                      value={organizationGroupIds}
                      onChange={(event) =>
                        setOrganizationGroupIds(event.target.value)
                      }
                      rows={2}
                      helpText="有効なGroupAccount IDをカンマまたは改行で入力します。"
                    />
                  ) : null}
                </>
              ) : (
                <Alert variant="info">
                  選択中: {selectedItem ? itemLabel(selectedItem) : '未選択'}
                </Alert>
              )}

              {mode === 'text' ? (
                <Textarea
                  label="保存するテキスト"
                  aria-label="保存するテキスト"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={7}
                  helpText="UTF-8で最大1 MiB。元情報へメモやAI回答を連結せず、保存時点の本文だけを登録します。"
                  required
                />
              ) : null}
              {mode === 'url' ? (
                <Input
                  label="保存するURL"
                  aria-label="保存するURL"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/article"
                  helpText="認証情報を含まないhttp/https URLのみ。redirect、private IP、timeout、type/sizeをserver側でもfail-closedに検証します。"
                  required
                />
              ) : null}
              {mode === 'pdf' || mode === 'image' ? (
                <FormField
                  label={mode === 'pdf' ? 'PDFファイル' : '画像ファイル'}
                  helpText="最大10 MiB。PDF、PNG、JPEG、WebP、GIFだけを受け付け、内容のmagic bytesもserver側で検証します。"
                  required
                >
                  <input
                    key={fileInputKey}
                    className="knowledge-hub-file-input"
                    type="file"
                    aria-label={mode === 'pdf' ? 'PDFファイル' : '画像ファイル'}
                    accept={
                      mode === 'pdf'
                        ? 'application/pdf'
                        : 'image/png,image/jpeg,image/webp,image/gif'
                    }
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </FormField>
              ) : null}

              {organizationCapture ? (
                <label className="knowledge-hub-confirmation">
                  <input
                    type="checkbox"
                    checked={organizationConfirmed}
                    onChange={(event) =>
                      setOrganizationConfirmed(event.target.checked)
                    }
                  />
                  組織の共有範囲へ保存することを確認しました
                </label>
              ) : (
                <Alert variant="info">
                  personalはアプリケーション上の非公開領域です。会社運用者、監査、バックアップから独立した私物保管領域ではありません。
                </Alert>
              )}

              <div className="knowledge-hub-form-actions">
                <Button type="submit" loading={captureBusy}>
                  {destination === 'new'
                    ? 'Inboxへ保存'
                    : '新しいversionを保存'}
                </Button>
              </div>
            </form>
          </Card>
        </WorkflowPanel>

        <WorkflowPanel
          title="Knowledge Inbox"
          description="現在の権限で参照できるinbox項目を選択します。personal項目は所有者だけに表示されます。"
        >
          <Card padding="small">
            <div className="knowledge-hub-panel-actions">
              <Button
                size="small"
                variant="ghost"
                loading={itemsStatus === 'loading'}
                onClick={() => void loadItems()}
              >
                Inboxを再読込
              </Button>
            </div>
            {itemList}
          </Card>
        </WorkflowPanel>
      </div>

      <WorkflowPanel
        title="immutable snapshot / version履歴"
        description="認可後にstatus、取得方式、size、SHA-256、出所を確認します。provider URL/keyやactive contentは表示しません。"
      >
        <Card padding="small">
          {selectedItem ? (
            <div className="knowledge-hub-selected-summary">
              <div>
                <strong>{itemLabel(selectedItem)}</strong>
                <span>
                  {selectedItem.scope} / {selectedItem.sourceType} /{' '}
                  {selectedItem.status}
                </span>
              </div>
              <Button
                size="small"
                variant="ghost"
                loading={snapshotsStatus === 'loading'}
                onClick={() => void loadSnapshots(selectedItem.id)}
              >
                履歴を再読込
              </Button>
            </div>
          ) : null}
          {snapshotList}
        </Card>
      </WorkflowPanel>
    </div>
  );
};
