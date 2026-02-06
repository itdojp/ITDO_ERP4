import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiResponse, getAuthState } from '../api';
import {
  Alert,
  Button,
  Card,
  EventLog,
  Input,
  MarkdownRenderer,
  Spinner,
  Textarea,
  Toast,
} from '../ui';
import {
  buildOpenHash,
  navigateToOpen,
  parseOpenHash,
} from '../utils/deepLink';
import { copyToClipboard } from '../utils/clipboard';

type AnnotationTargetKind =
  | 'estimate'
  | 'invoice'
  | 'purchase_order'
  | 'vendor_quote'
  | 'vendor_invoice'
  | 'expense'
  | 'project'
  | 'customer'
  | 'vendor';

type InternalRefKind =
  | 'invoice'
  | 'estimate'
  | 'purchase_order'
  | 'vendor_quote'
  | 'vendor_invoice'
  | 'expense'
  | 'project'
  | 'customer'
  | 'vendor'
  | 'time_entry'
  | 'daily_report'
  | 'leave_request'
  | 'project_chat'
  | 'room_chat'
  | 'chat_message';

type InternalRef = {
  kind: InternalRefKind;
  id: string;
  label?: string;
};

type AnnotationPayload = {
  targetKind: AnnotationTargetKind;
  targetId: string;
  notes: string | null;
  externalUrls: string[];
  internalRefs: InternalRef[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type AnnotationHistoryItem = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  actorRole: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  notes: string | null;
  externalUrls: string[];
  internalRefs: InternalRef[];
};

type RefCandidateKind =
  | 'invoice'
  | 'estimate'
  | 'purchase_order'
  | 'vendor_quote'
  | 'vendor_invoice'
  | 'expense'
  | 'project'
  | 'customer'
  | 'vendor'
  | 'chat_message';

type RefCandidateItem = {
  kind: RefCandidateKind;
  id: string;
  label: string;
  url: string;
  projectId?: string | null;
  projectLabel?: string | null;
  meta?: Record<string, unknown>;
};

type MessageState = {
  variant: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
} | null;

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
}

function buildInternalLink(kind: string, id: string) {
  const hash = buildOpenHash({ kind, id });
  return `/${hash}`;
}

function toSafeExternalHref(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

const ALLOWED_INTERNAL_REF_KIND_SET = new Set<InternalRefKind>([
  'invoice',
  'estimate',
  'purchase_order',
  'vendor_quote',
  'vendor_invoice',
  'expense',
  'project',
  'customer',
  'vendor',
  'time_entry',
  'daily_report',
  'leave_request',
  'project_chat',
  'room_chat',
  'chat_message',
]);

function parseInternalRefInput(
  value: string,
): { kind: InternalRefKind; id: string } | null {
  const raw = value.trim();
  if (!raw) return null;

  // Full URL (https://.../#/open?kind=...&id=...)
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const open = parseOpenHash(url.hash || '');
      if (
        open &&
        ALLOWED_INTERNAL_REF_KIND_SET.has(open.kind as InternalRefKind)
      ) {
        return { kind: open.kind as InternalRefKind, id: open.id };
      }
    } catch {
      // fall through
    }
  }

  // /#/open?... or #/open?...
  const normalized = raw.startsWith('/#/open')
    ? raw.slice(1)
    : raw.startsWith('#/open')
      ? raw
      : '';
  if (normalized) {
    const open = parseOpenHash(normalized);
    if (
      open &&
      ALLOWED_INTERNAL_REF_KIND_SET.has(open.kind as InternalRefKind)
    ) {
      return { kind: open.kind as InternalRefKind, id: open.id };
    }
  }

  // kind:id
  const sep = raw.indexOf(':');
  if (sep > 0) {
    const kindRaw = raw.slice(0, sep).trim();
    const id = raw.slice(sep + 1).trim();
    if (id && ALLOWED_INTERNAL_REF_KIND_SET.has(kindRaw as InternalRefKind)) {
      return { kind: kindRaw as InternalRefKind, id };
    }
  }

  return null;
}

function parseApiError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  if (!('error' in payload)) return '';
  const record = payload as Record<string, unknown>;
  return normalizeString(record.error);
}

function mapAnnotationError(code: string) {
  switch (code) {
    case 'unauthorized':
      return '認証情報が不足しています';
    case 'forbidden':
      return '権限がありません';
    case 'forbidden_project':
      return '権限がありません（案件スコープ外）';
    case 'forbidden_locked':
      return '承認済みのため更新できません（管理者のみ更新可）';
    case 'projectId_required':
      return '案件IDが必要です';
    case 'project_not_found':
      return '案件が見つかりません';
    case 'query_too_short':
      return '検索文字列が短すぎます';
    case 'query_too_long':
      return '検索文字列が長すぎます';
    case 'reason_required':
      return '管理者更新のため理由の入力が必要です';
    case 'NOTES_TOO_LONG':
      return 'メモが長すぎます';
    case 'TOO_MANY_EXTERNAL_URLS':
      return '外部URLの件数が上限を超えています';
    case 'EXTERNAL_URL_TOO_LONG':
      return '外部URLが長すぎます';
    case 'EXTERNAL_URL_TOTAL_TOO_LONG':
      return '外部URLの合計文字数が上限を超えています';
    case 'INVALID_EXTERNAL_URL':
    case 'INVALID_EXTERNAL_URLS':
      return '外部URLが不正です';
    case 'INVALID_INTERNAL_REF':
    case 'INVALID_INTERNAL_REFS':
    case 'INVALID_INTERNAL_REF_KIND':
    case 'INVALID_INTERNAL_REF_ID':
      return '内部参照が不正です';
    default:
      return code || '更新に失敗しました';
  }
}

const InternalOpenLink = ({
  href,
  children,
  style,
  ...props
}: React.ComponentPropsWithoutRef<'a'> & {
  children?: React.ReactNode;
}): React.ReactElement => {
  const link = normalizeString(href);
  const isOpen = link.startsWith('/#/open') || link.startsWith('#/open');
  const safeHref = link || '#';
  const mergedStyle: React.CSSProperties = {
    ...(style || {}),
    color: '#2563eb',
  };

  return (
    <a
      {...props}
      href={safeHref}
      target={isOpen ? undefined : '_blank'}
      rel={isOpen ? undefined : 'noreferrer'}
      style={mergedStyle}
      onClick={(e) => {
        if (!isOpen) return;
        e.preventDefault();
        if (typeof window === 'undefined') return;
        if (safeHref.startsWith('/#/open')) {
          window.location.hash = safeHref.slice(1);
          return;
        }
        if (safeHref.startsWith('#/open')) {
          window.location.hash = safeHref;
        }
      }}
    >
      {children}
    </a>
  );
};

export type AnnotationsCardProps = {
  targetKind: AnnotationTargetKind;
  targetId: string;
  projectId?: string | null;
  title?: string;
};

export const AnnotationsCard: React.FC<AnnotationsCardProps> = ({
  targetKind,
  targetId,
  projectId,
  title,
}) => {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const isPrivileged = roles.includes('admin') || roles.includes('mgmt');

  const [message, setMessage] = useState<MessageState>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [notes, setNotes] = useState('');
  const [externalUrls, setExternalUrls] = useState<string[]>([]);
  const [internalRefs, setInternalRefs] = useState<InternalRef[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [requiresReason, setRequiresReason] = useState(false);

  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  const [previewVisible, setPreviewVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setMessage(null);
    try {
      const res = await apiResponse(`/annotations/${targetKind}/${targetId}`);
      const payload = (await res.json().catch(() => ({}))) as AnnotationPayload;
      if (!res.ok) {
        setLoadError(mapAnnotationError(parseApiError(payload)));
        return;
      }
      setNotes(typeof payload.notes === 'string' ? payload.notes : '');
      setExternalUrls(
        Array.isArray(payload.externalUrls) ? payload.externalUrls : [],
      );
      setInternalRefs(
        Array.isArray(payload.internalRefs) ? payload.internalRefs : [],
      );
      setUpdatedAt(
        typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
      );
      setUpdatedBy(
        typeof payload.updatedBy === 'string' ? payload.updatedBy : null,
      );
      setRequiresReason(false);
      setReasonText('');
    } catch (err) {
      console.error('Failed to load annotations', err);
      setLoadError('注釈の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [targetKind, targetId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const insertIntoNotes = useCallback(
    (text: string) => {
      const value = text;
      if (!value) return;

      const textarea = notesRef.current;
      if (!textarea) {
        setNotes((prev) => (prev ? `${prev}\n${value}` : value));
        return;
      }

      const start = textarea.selectionStart ?? notes.length;
      const end = textarea.selectionEnd ?? notes.length;
      const next = `${notes.slice(0, start)}${value}${notes.slice(end)}`;
      setNotes(next);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + value.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    },
    [notes],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        notes: notes.trim() ? notes : null,
        externalUrls,
        internalRefs,
        reasonText: reasonText.trim() || undefined,
      };
      const res = await apiResponse(`/annotations/${targetKind}/${targetId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as AnnotationPayload;
      if (!res.ok) {
        const code = parseApiError(payload);
        if (code === 'reason_required') {
          setRequiresReason(true);
        }
        setMessage({
          variant: 'error',
          title: mapAnnotationError(code),
        });
        return;
      }
      setNotes(typeof payload.notes === 'string' ? payload.notes : '');
      setExternalUrls(
        Array.isArray(payload.externalUrls) ? payload.externalUrls : [],
      );
      setInternalRefs(
        Array.isArray(payload.internalRefs) ? payload.internalRefs : [],
      );
      setUpdatedAt(
        typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
      );
      setUpdatedBy(
        typeof payload.updatedBy === 'string' ? payload.updatedBy : null,
      );
      setMessage({ variant: 'success', title: '保存しました' });
      setRequiresReason(false);
      setReasonText('');
    } catch (err) {
      console.error('Failed to save annotations', err);
      setMessage({ variant: 'error', title: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  }, [externalUrls, internalRefs, notes, reasonText, targetId, targetKind]);

  const [externalUrlInput, setExternalUrlInput] = useState('');

  const addExternalUrls = useCallback(() => {
    const raw = externalUrlInput;
    const parts = raw
      .split(/\s+/g)
      .map((value) => value.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const merged = [...externalUrls];
    for (const url of parts) {
      if (!merged.includes(url)) merged.push(url);
    }
    setExternalUrls(merged);
    setExternalUrlInput('');
  }, [externalUrlInput, externalUrls]);

  const removeExternalUrl = useCallback(
    (index: number) => {
      setExternalUrls((prev) => prev.filter((_, i) => i !== index));
    },
    [setExternalUrls],
  );

  const [refQuery, setRefQuery] = useState('');
  const [refItems, setRefItems] = useState<RefCandidateItem[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState('');
  const refSeq = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    const q = refQuery.trim();
    if (q.length < 2) {
      setRefItems([]);
      setRefError('');
      return;
    }
    refSeq.current += 1;
    const current = refSeq.current;
    const timer = setTimeout(() => {
      const run = async () => {
        setRefLoading(true);
        setRefError('');
        try {
          const params = new URLSearchParams({ projectId, q, limit: '20' });
          const res = await apiResponse(`/ref-candidates?${params.toString()}`);
          const payload = (await res.json().catch(() => ({}))) as {
            items?: unknown;
            error?: unknown;
          };
          if (current !== refSeq.current) return;
          if (!res.ok) {
            setRefItems([]);
            setRefError(mapAnnotationError(parseApiError(payload)));
            return;
          }
          const items = Array.isArray(payload.items)
            ? (payload.items as RefCandidateItem[])
            : [];
          setRefItems(items);
        } catch (err) {
          console.error('Failed to load ref-candidates', err);
          if (current !== refSeq.current) return;
          setRefItems([]);
          setRefError('候補の取得に失敗しました');
        } finally {
          if (current === refSeq.current) setRefLoading(false);
        }
      };
      run().catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [projectId, refQuery]);

  const addInternalRef = useCallback(
    (ref: InternalRef) => {
      const key = `${ref.kind}:${ref.id}`;
      const exists = internalRefs.some(
        (item) => `${item.kind}:${item.id}` === key,
      );
      if (exists) return;
      setInternalRefs((prev) => [...prev, ref]);
    },
    [internalRefs],
  );

  const removeInternalRef = useCallback(
    (index: number) => {
      setInternalRefs((prev) => prev.filter((_, i) => i !== index));
    },
    [setInternalRefs],
  );

  const [manualRefInput, setManualRefInput] = useState('');

  const addManualInternalRef = useCallback(() => {
    const parsed = parseInternalRefInput(manualRefInput);
    if (!parsed) {
      setMessage({
        variant: 'error',
        title: '内部参照が不正です（deep link / kind:id）',
      });
      return;
    }
    addInternalRef({ kind: parsed.kind, id: parsed.id });
    setManualRefInput('');
    setMessage({ variant: 'success', title: '内部参照を追加しました' });
  }, [addInternalRef, manualRefInput]);

  const insertRef = useCallback(
    async (candidate: RefCandidateItem) => {
      addInternalRef({
        kind: candidate.kind as InternalRefKind,
        id: candidate.id,
        label: candidate.label,
      });
      const url = `/${candidate.url}`;
      const markdown = `[${escapeMarkdownLinkLabel(candidate.label)}](${url})`;
      insertIntoNotes(markdown);
      setMessage({ variant: 'success', title: '参照を挿入しました' });
    },
    [addInternalRef, insertIntoNotes],
  );

  const copyLink = useCallback(
    async (mode: 'url' | 'markdown', label: string, link: string) => {
      const url = link;
      if (mode === 'url') {
        const ok = await copyToClipboard(url);
        setMessage({
          variant: ok ? 'success' : 'error',
          title: ok ? 'リンクURLをコピーしました' : 'コピーに失敗しました',
        });
        return;
      }
      const markdown = `[${escapeMarkdownLinkLabel(label)}](${url})`;
      const ok = await copyToClipboard(markdown);
      setMessage({
        variant: ok ? 'success' : 'error',
        title: ok ? 'Markdownリンクをコピーしました' : 'コピーに失敗しました',
      });
    },
    [],
  );

  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<AnnotationHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState('');

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      const res = await apiResponse(
        `/annotations/${targetKind}/${targetId}/history?${params.toString()}`,
      );
      const payload = (await res.json().catch(() => ({}))) as {
        items?: unknown;
        error?: unknown;
      };
      if (!res.ok) {
        setHistoryItems([]);
        setHistoryError(mapAnnotationError(parseApiError(payload)));
        return;
      }
      const items = Array.isArray(payload.items)
        ? (payload.items as AnnotationHistoryItem[])
        : [];
      setHistoryItems(items);
    } catch (err) {
      console.error('Failed to load annotation history', err);
      setHistoryItems([]);
      setHistoryError('履歴の取得に失敗しました');
    } finally {
      setHistoryLoading(false);
    }
  }, [targetId, targetKind]);

  const eventLogItems = useMemo(() => {
    const formatCount = (value: unknown) =>
      typeof value === 'number' ? `${value}` : `${Number(value) || 0}`;
    const safeLength = (value: string | null) =>
      typeof value === 'string' ? value.length : 0;
    const safeArrayLen = (value: unknown[]) =>
      Array.isArray(value) ? value.length : 0;

    return historyItems.map((entry, index) => {
      const prev = historyItems[index + 1];
      const changes: Array<{ field: string; before?: string; after?: string }> =
        [];

      const beforeNotesLen = prev ? safeLength(prev.notes) : undefined;
      const afterNotesLen = safeLength(entry.notes);
      if (beforeNotesLen === undefined || beforeNotesLen !== afterNotesLen) {
        changes.push({
          field: 'メモ文字数',
          before:
            beforeNotesLen === undefined
              ? undefined
              : formatCount(beforeNotesLen),
          after: formatCount(afterNotesLen),
        });
      }

      const beforeUrlCount = prev ? safeArrayLen(prev.externalUrls) : undefined;
      const afterUrlCount = safeArrayLen(entry.externalUrls);
      if (beforeUrlCount === undefined || beforeUrlCount !== afterUrlCount) {
        changes.push({
          field: '外部URL件数',
          before:
            beforeUrlCount === undefined
              ? undefined
              : formatCount(beforeUrlCount),
          after: formatCount(afterUrlCount),
        });
      }

      const beforeRefCount = prev ? safeArrayLen(prev.internalRefs) : undefined;
      const afterRefCount = safeArrayLen(entry.internalRefs);
      if (beforeRefCount === undefined || beforeRefCount !== afterRefCount) {
        changes.push({
          field: '内部参照件数',
          before:
            beforeRefCount === undefined
              ? undefined
              : formatCount(beforeRefCount),
          after: formatCount(afterRefCount),
        });
      }

      const adminOverride = entry.reasonCode === 'admin_override';
      const actor = [
        entry.createdBy ? `user:${entry.createdBy}` : null,
        entry.actorRole ? `role:${entry.actorRole}` : null,
      ]
        .filter(Boolean)
        .join(' ');
      const description = [actor, entry.reasonText].filter(Boolean).join(' / ');
      const timestamp = (() => {
        const date = new Date(entry.createdAt);
        if (Number.isNaN(date.getTime())) return entry.createdAt;
        return date.toLocaleString();
      })();

      return {
        id: entry.id,
        title: '注釈更新',
        description: description || undefined,
        timestamp,
        status: adminOverride ? ('warning' as const) : ('info' as const),
        adminOverride,
        changes: changes.length > 0 ? changes : undefined,
      };
    });
  }, [historyItems]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {message && (
        <Toast
          variant={message.variant}
          title={message.title}
          description={message.description}
          dismissible
          onClose={() => setMessage(null)}
        />
      )}
      {loadError && <Alert variant="error">{loadError}</Alert>}

      <Card padding="small">
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 600 }}>{title || '注釈'}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {updatedAt
              ? `更新: ${new Date(updatedAt).toLocaleString()}`
              : '更新: -'}
            {updatedBy ? ` / 更新者: ${updatedBy}` : ''}
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <Button
              variant="secondary"
              size="small"
              onClick={load}
              disabled={loading}
            >
              再読込
            </Button>
          </div>
        </div>
        {loading ? (
          <div style={{ marginTop: 8 }}>
            <Spinner label="読み込み中" />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <Textarea
              ref={notesRef}
              label="メモ（Markdown）"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              placeholder="メモを入力（Markdown可）"
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setPreviewVisible((prev) => !prev)}
                disabled={!notes.trim()}
              >
                {previewVisible ? 'プレビューを隠す' : 'プレビュー'}
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={save}
                disabled={saving}
              >
                {saving ? '保存中' : '保存'}
              </Button>
            </div>
            {requiresReason && isPrivileged && (
              <Input
                label="管理者更新理由（必須）"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="例: 承認後に参照URLを追加する必要があるため"
              />
            )}
            {previewVisible && (
              <Card padding="small" style={{ background: '#f8fafc' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  プレビュー
                </div>
                <MarkdownRenderer
                  content={notes}
                  linkComponent={InternalOpenLink}
                />
              </Card>
            )}
          </div>
        )}
      </Card>

      <Card padding="small">
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 600 }}>外部URL</div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginTop: 8,
          }}
        >
          <Input
            label="追加（スペース区切りで複数可）"
            value={externalUrlInput}
            onChange={(e) => setExternalUrlInput(e.target.value)}
            placeholder="https://example.com"
            style={{ minWidth: 320 }}
          />
          <Button
            variant="secondary"
            size="small"
            onClick={addExternalUrls}
            disabled={!externalUrlInput.trim()}
          >
            追加
          </Button>
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
          {externalUrls.length === 0 && (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              外部URLはありません
            </div>
          )}
          {externalUrls.map((url, index) => {
            const safeHref = toSafeExternalHref(url);
            return (
              <div
                key={`${url}:${index}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {safeHref ? (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#2563eb', wordBreak: 'break-all' }}
                  >
                    {url}
                  </a>
                ) : (
                  <span style={{ color: '#64748b', wordBreak: 'break-all' }}>
                    {url}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => copyLink('url', url, url)}
                >
                  コピー
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => removeExternalUrl(index)}
                >
                  削除
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card padding="small">
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 600 }}>内部参照</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {projectId
              ? '候補は案件スコープ内から検索'
              : '案件ID未指定のため候補検索は無効'}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <Input
              label="手動追加（deep link / kind:id）"
              value={manualRefInput}
              onChange={(e) => setManualRefInput(e.target.value)}
              placeholder="/#/open?kind=chat_message&id=... または chat_message:<id>"
              style={{ minWidth: 360 }}
            />
            <Button
              variant="secondary"
              size="small"
              onClick={addManualInternalRef}
              disabled={!manualRefInput.trim()}
            >
              追加
            </Button>
          </div>
          <Input
            label="候補検索"
            value={refQuery}
            onChange={(e) => setRefQuery(e.target.value)}
            placeholder="例: INV- / PRJ- / 顧客名 / 業者名 / 発言内容…"
            disabled={!projectId}
          />
          {refLoading && (
            <div style={{ fontSize: 12, color: '#64748b' }}>検索中…</div>
          )}
          {refError && <Alert variant="warning">{refError}</Alert>}
          {refItems.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              {refItems.map((item) => (
                <div
                  key={`${item.kind}:${item.id}`}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    padding: '6px 8px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: '#fff',
                  }}
                >
                  <span className="badge">{item.kind}</span>
                  <span style={{ flex: '1 1 280px' }}>{item.label}</span>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => insertRef(item)}
                  >
                    挿入
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      navigateToOpen({ kind: item.kind, id: item.id });
                      setMessage({
                        variant: 'info',
                        title: '参照先を開きました',
                      });
                    }}
                  >
                    開く
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            {internalRefs.length === 0 && (
              <div style={{ fontSize: 12, color: '#64748b' }}>
                内部参照はありません
              </div>
            )}
            {internalRefs.map((ref, index) => {
              const label = ref.label?.trim() || `${ref.kind}:${ref.id}`;
              const url = buildInternalLink(ref.kind, ref.id);
              return (
                <div
                  key={`${ref.kind}:${ref.id}:${index}`}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="badge">{ref.kind}</span>
                  <a
                    href={url}
                    style={{ color: '#2563eb', wordBreak: 'break-all' }}
                    onClick={(e) => {
                      e.preventDefault();
                      navigateToOpen({ kind: ref.kind, id: ref.id });
                    }}
                  >
                    {label}
                  </a>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() =>
                      insertIntoNotes(
                        `[${escapeMarkdownLinkLabel(label)}](${url})`,
                      )
                    }
                  >
                    挿入
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => copyLink('url', label, url)}
                  >
                    コピー
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => copyLink('markdown', label, url)}
                  >
                    Markdown
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => removeInternalRef(index)}
                  >
                    削除
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card padding="small">
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 600 }}>履歴（監査ログ）</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                setHistoryVisible((prev) => !prev);
                if (
                  !historyVisible &&
                  historyItems.length === 0 &&
                  !historyLoading
                ) {
                  loadHistory().catch(() => undefined);
                }
              }}
            >
              {historyVisible ? '履歴を隠す' : '履歴を表示'}
            </Button>
          </div>
        </div>
        {historyVisible && (
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => loadHistory().catch(() => undefined)}
                disabled={historyLoading}
              >
                再読込
              </Button>
            </div>
            {historyLoading && <Spinner label="読み込み中" />}
            {historyError && <Alert variant="error">{historyError}</Alert>}
            {!historyLoading && !historyError && (
              <EventLog
                items={eventLogItems}
                labels={{ adminOverride: '管理者更新', changes: '変更' }}
                emptyState={
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    履歴はありません
                  </div>
                }
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
