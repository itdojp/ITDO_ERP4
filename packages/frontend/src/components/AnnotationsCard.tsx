import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiResponse, getAuthState } from '../api';
import {
  ChatEvidencePicker,
  type ChatEvidenceCandidate,
} from './ChatEvidencePicker';
import {
  Alert,
  Button,
  Card,
  Drawer,
  EntityReferencePicker,
  EventLog,
  Input,
  MarkdownRenderer,
  Spinner,
  Textarea,
  Toast,
  type EntityReferenceCandidate,
  type EntityReferenceItem,
  type EntityReferenceKind,
  type EntityReferenceScope,
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

type MessageState = {
  variant: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
} | null;

type RefValidationState = {
  status: 'ok' | 'forbidden' | 'not_found' | 'error';
  message: string;
  checkedAt: string;
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRefKey(ref: Pick<InternalRef, 'kind' | 'id'>) {
  return `${ref.kind}:${ref.id}`;
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

const REF_PICKER_KINDS: RefCandidateKind[] = [
  'invoice',
  'estimate',
  'purchase_order',
  'vendor_quote',
  'vendor_invoice',
  'expense',
  'project',
  'customer',
  'vendor',
  'chat_message',
];
const REF_PICKER_KIND_SET = new Set<RefCandidateKind>(REF_PICKER_KINDS);

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

  const [refPickerError, setRefPickerError] = useState('');
  const [refValidationByKey, setRefValidationByKey] = useState<
    Record<string, RefValidationState>
  >({});
  const [validatingRefs, setValidatingRefs] = useState(false);

  const addInternalRef = useCallback(
    (ref: InternalRef) => {
      const key = buildRefKey(ref);
      const exists = internalRefs.some((item) => buildRefKey(item) === key);
      if (exists) return;
      setInternalRefs((prev) => [...prev, ref]);
    },
    [internalRefs],
  );

  const removeInternalRef = useCallback(
    (index: number) => {
      const removed = internalRefs[index];
      if (removed?.kind === 'chat_message') {
        const key = buildRefKey(removed);
        setRefValidationByKey((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
      setInternalRefs((prev) => prev.filter((_, i) => i !== index));
    },
    [internalRefs],
  );

  const validateChatMessageRef = useCallback(
    async (messageId: string): Promise<RefValidationState> => {
      const now = new Date().toISOString();
      try {
        const res = await apiResponse(`/chat-messages/${messageId}`);
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        if (res.ok) {
          return {
            status: 'ok',
            message: '参照可能',
            checkedAt: now,
          };
        }
        const code = payload?.error?.code;
        if (
          code === 'FORBIDDEN_PROJECT' ||
          code === 'FORBIDDEN_ROOM_MEMBER' ||
          code === 'FORBIDDEN_EXTERNAL_ROOM'
        ) {
          return {
            status: 'forbidden',
            message: '権限不足',
            checkedAt: now,
          };
        }
        if (code === 'NOT_FOUND' || res.status === 404) {
          return {
            status: 'not_found',
            message: '発言が見つかりません',
            checkedAt: now,
          };
        }
        return {
          status: 'error',
          message: '参照状態の確認に失敗しました',
          checkedAt: now,
        };
      } catch (error) {
        console.error('Failed to validate chat message ref', error);
        return {
          status: 'error',
          message: '参照状態の確認に失敗しました',
          checkedAt: now,
        };
      }
    },
    [],
  );

  const checkChatRefStates = useCallback(
    async (refs: InternalRef[]) => {
      if (refs.length === 0) return;
      setValidatingRefs(true);
      try {
        const entries = await Promise.all(
          refs.map(async (ref) => {
            const status = await validateChatMessageRef(ref.id);
            return [buildRefKey(ref), status] as const;
          }),
        );
        setRefValidationByKey((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      } finally {
        setValidatingRefs(false);
      }
    },
    [validateChatMessageRef],
  );

  const [manualRefInput, setManualRefInput] = useState('');

  const addManualInternalRef = useCallback(async () => {
    const parsed = parseInternalRefInput(manualRefInput);
    if (!parsed) {
      setMessage({
        variant: 'error',
        title: '内部参照が不正です（deep link / kind:id）',
      });
      return;
    }
    if (parsed.kind === 'chat_message') {
      const validation = await validateChatMessageRef(parsed.id);
      if (validation.status === 'forbidden') {
        setMessage({
          variant: 'error',
          title: 'この発言は権限不足のため追加できません',
        });
        return;
      }
      if (validation.status === 'not_found') {
        setMessage({
          variant: 'error',
          title: 'この発言は見つからないため追加できません',
        });
        return;
      }
      if (validation.status === 'error') {
        setMessage({
          variant: 'error',
          title: '発言の参照状態確認に失敗したため追加できません',
        });
        return;
      }
    }
    addInternalRef({ kind: parsed.kind, id: parsed.id });
    setManualRefInput('');
    setMessage({ variant: 'success', title: '内部参照を追加しました' });
  }, [addInternalRef, manualRefInput, validateChatMessageRef]);

  useEffect(() => {
    const chatRefs = internalRefs.filter((ref) => ref.kind === 'chat_message');
    if (chatRefs.length === 0) {
      setRefValidationByKey((prev) =>
        Object.keys(prev).length === 0 ? prev : {},
      );
      return;
    }

    const refKeySet = new Set(chatRefs.map((ref) => buildRefKey(ref)));
    setRefValidationByKey((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([key]) => refKeySet.has(key)),
      ) as Record<string, RefValidationState>;
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      if (
        prevEntries.length === nextEntries.length &&
        nextEntries.every(([key, value]) => prev[key] === value)
      ) {
        return prev;
      }
      return next;
    });

    const refsToValidate = chatRefs.filter(
      (ref) => !refValidationByKey[buildRefKey(ref)],
    );
    if (refsToValidate.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      checkChatRefStates(refsToValidate).catch(() => undefined);
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [checkChatRefStates, internalRefs, refValidationByKey]);

  const entityReferenceKinds: EntityReferenceKind[] =
    REF_PICKER_KINDS as EntityReferenceKind[];
  const entityReferenceScope: EntityReferenceScope = 'project_tree';

  const entityReferenceValue = useMemo<EntityReferenceItem[]>(() => {
    return internalRefs
      .filter((ref) => REF_PICKER_KIND_SET.has(ref.kind as RefCandidateKind))
      .map((ref) => {
        const label = ref.label?.trim() || `${ref.kind}:${ref.id}`;
        return {
          id: ref.id,
          kind: ref.kind,
          label,
          deepLink: buildInternalLink(ref.kind, ref.id),
        };
      });
  }, [internalRefs]);

  const handleEntityReferenceChange = useCallback(
    (next: EntityReferenceItem[] | EntityReferenceItem | null) => {
      const items = Array.isArray(next) ? next : next ? [next] : [];
      const preserved = internalRefs.filter(
        (ref) => !REF_PICKER_KIND_SET.has(ref.kind as RefCandidateKind),
      );
      const mapped: InternalRef[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const kind = normalizeString(item.kind) as InternalRefKind;
        if (!ALLOWED_INTERNAL_REF_KIND_SET.has(kind)) continue;
        if (!REF_PICKER_KIND_SET.has(kind as RefCandidateKind)) continue;
        const id = normalizeString(item.id);
        if (!id) continue;
        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = normalizeString(item.label);
        mapped.push(label ? { kind, id, label } : { kind, id });
      }
      setInternalRefs([...preserved, ...mapped]);
      setRefPickerError('');
    },
    [internalRefs],
  );

  const fetchEntityReferenceCandidates = useCallback(
    async (
      query: string,
      kind: EntityReferenceKind,
      _scope: EntityReferenceScope,
    ): Promise<EntityReferenceCandidate[]> => {
      const q = query.trim();
      if (!projectId || q.length < 2) {
        setRefPickerError('');
        return [];
      }
      const requestedKind = normalizeString(kind);
      if (!REF_PICKER_KIND_SET.has(requestedKind as RefCandidateKind)) {
        setRefPickerError('');
        return [];
      }
      try {
        const params = new URLSearchParams({
          projectId,
          q,
          limit: '20',
          types: requestedKind,
        });
        const res = await apiResponse(`/ref-candidates?${params.toString()}`);
        const payload = (await res.json().catch(() => ({}))) as {
          items?: unknown;
          error?: unknown;
        };
        if (!res.ok) {
          setRefPickerError(mapAnnotationError(parseApiError(payload)));
          return [];
        }
        setRefPickerError('');
        const items = Array.isArray(payload.items)
          ? (payload.items as Array<Record<string, unknown>>)
          : [];
        return items.flatMap((item) => {
          const itemKind = normalizeString(item.kind);
          const id = normalizeString(item.id);
          if (!id || !REF_PICKER_KIND_SET.has(itemKind as RefCandidateKind)) {
            return [];
          }
          const label = normalizeString(item.label) || `${itemKind}:${id}`;
          const url = normalizeString(item.url);
          return [
            {
              id,
              kind: itemKind,
              label,
              deepLink: url ? `/${url}` : buildInternalLink(itemKind, id),
            },
          ];
        });
      } catch (err) {
        console.error('Failed to load ref-candidates', err);
        setRefPickerError('候補の取得に失敗しました');
        return [];
      }
    },
    [projectId],
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

  const [evidencePickerOpen, setEvidencePickerOpen] = useState(false);

  const addChatEvidenceRef = useCallback(
    (candidate: ChatEvidenceCandidate) => {
      const nextRef: InternalRef = {
        kind: 'chat_message',
        id: candidate.id,
        label: candidate.label?.trim() || `chat_message:${candidate.id}`,
      };
      const key = `${nextRef.kind}:${nextRef.id}`;
      const exists = internalRefs.some(
        (item) => `${item.kind}:${item.id}` === key,
      );
      if (exists) {
        setMessage({ variant: 'info', title: '内部参照は既に追加済みです' });
        return;
      }
      addInternalRef(nextRef);
      setMessage({ variant: 'success', title: 'エビデンスを追加しました' });
    },
    [addInternalRef, internalRefs],
  );

  const insertChatEvidenceToNotes = useCallback(
    (candidate: ChatEvidenceCandidate) => {
      addChatEvidenceRef(candidate);
      const label = candidate.label?.trim() || `chat_message:${candidate.id}`;
      insertIntoNotes(`[${escapeMarkdownLinkLabel(label)}](${candidate.url})`);
    },
    [addChatEvidenceRef, insertIntoNotes],
  );

  const copyChatEvidenceLink = useCallback(
    (mode: 'url' | 'markdown', candidate: ChatEvidenceCandidate) => {
      const label = candidate.label?.trim() || `chat_message:${candidate.id}`;
      copyLink(mode, label, candidate.url).catch(() => undefined);
    },
    [copyLink],
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
          <Button
            variant="secondary"
            size="small"
            onClick={() => setEvidencePickerOpen(true)}
            disabled={!projectId}
          >
            エビデンス追加
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() =>
              checkChatRefStates(
                internalRefs.filter((ref) => ref.kind === 'chat_message'),
              ).catch(() => undefined)
            }
            disabled={validatingRefs}
          >
            {validatingRefs ? '参照確認中' : '参照状態を確認'}
          </Button>
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
              onClick={() => addManualInternalRef().catch(() => undefined)}
              disabled={!manualRefInput.trim()}
            >
              追加
            </Button>
          </div>
          <EntityReferencePicker
            label="候補検索"
            kinds={entityReferenceKinds}
            scope={entityReferenceScope}
            fetchCandidates={fetchEntityReferenceCandidates}
            value={entityReferenceValue}
            onChange={handleEntityReferenceChange}
            multiple
            maxItems={100}
            placeholder="例: INV- / PRJ- / 顧客名 / 業者名 / 発言内容…"
            noResultsText="候補が見つかりません"
            loadingText="候補を検索中…"
            hint={
              projectId
                ? '案件スコープ（同一案件・親子案件）から候補を検索します'
                : '案件ID未指定のため候補検索は無効です'
            }
            error={refPickerError || undefined}
            disabled={!projectId}
          />

          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            {internalRefs.length === 0 && (
              <div style={{ fontSize: 12, color: '#64748b' }}>
                内部参照はありません
              </div>
            )}
            {internalRefs.map((ref, index) => {
              const label = ref.label?.trim() || `${ref.kind}:${ref.id}`;
              const url = buildInternalLink(ref.kind, ref.id);
              const refKey = buildRefKey(ref);
              const refState =
                ref.kind === 'chat_message'
                  ? refValidationByKey[refKey]
                  : undefined;
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
                  {ref.kind === 'chat_message' && (
                    <span
                      className="badge"
                      style={{
                        background:
                          refState?.status === 'ok'
                            ? '#dcfce7'
                            : refState?.status === 'forbidden' ||
                                refState?.status === 'not_found'
                              ? '#fee2e2'
                              : refState?.status === 'error'
                                ? '#ffedd5'
                                : '#e2e8f0',
                        color:
                          refState?.status === 'ok'
                            ? '#166534'
                            : refState?.status === 'forbidden' ||
                                refState?.status === 'not_found'
                              ? '#991b1b'
                              : refState?.status === 'error'
                                ? '#9a3412'
                                : '#334155',
                      }}
                    >
                      {refState?.message || '未確認'}
                    </span>
                  )}
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
      <Drawer
        open={evidencePickerOpen}
        onClose={() => setEvidencePickerOpen(false)}
        title="エビデンス追加（チャット発言）"
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setEvidencePickerOpen(false)}
            >
              閉じる
            </Button>
          </div>
        }
      >
        <ChatEvidencePicker
          projectId={projectId ?? null}
          onAddCandidate={addChatEvidenceRef}
          onInsertCandidate={insertChatEvidenceToNotes}
          onCopyCandidate={copyChatEvidenceLink}
        />
      </Drawer>
    </div>
  );
};
