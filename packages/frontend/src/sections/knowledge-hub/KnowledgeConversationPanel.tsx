import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
} from 'react';

import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from '../../ui';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  commitKnowledgeConversationImport,
  listKnowledgeConversations,
  listKnowledgeConversationTurns,
  previewKnowledgeConversationImport,
} from './knowledgeProvenanceApi';
import {
  createKnowledgeRequestKey,
  formatKnowledgeDateTime,
  knowledgeHubErrorMessage,
} from './knowledgeHubModel';
import {
  buildManualKnowledgeConversation,
  encodeKnowledgeImportInput,
  KNOWLEDGE_IMPORT_MAX_BYTES,
  knowledgeOriginLabels,
  knowledgeRelationLabels,
  knowledgeRoleLabels,
  roleOriginCompatible,
  utf8Length,
  type KnowledgeConversation,
  type KnowledgeConversationImportCommit,
  type KnowledgeConversationImportEnvelope,
  type KnowledgeConversationImportPreview,
  type KnowledgeConversationRole,
  type KnowledgeConversationSourceType,
  type KnowledgeConversationTurn,
  type KnowledgeProvenanceOrigin,
} from './knowledgeProvenanceModel';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

type ConversationListState = {
  itemId: string;
  status: LoadStatus;
  items: KnowledgeConversation[];
  nextCursor: string | null;
  loadingMore: boolean;
  error: string;
};

type ConversationSelection = {
  itemId: string;
  conversationId: string;
};

type TurnListState = ConversationSelection & {
  status: LoadStatus;
  items: KnowledgeConversationTurn[];
  nextCursor: string | null;
  loadingMore: boolean;
  error: string;
};

type ImportField =
  | 'manualTitle'
  | 'manualOrigin'
  | 'manualOccurredAt'
  | 'manualContent'
  | 'jsonInput'
  | 'markdownInput';

type ImportFieldErrors = Partial<Record<ImportField, string>>;

type EnvelopeValidation =
  | { ok: true; value: KnowledgeConversationImportEnvelope }
  | { ok: false; field?: ImportField; error: string };

type ReadyPreview = {
  itemId: string;
  draftRevision: number;
  envelope: KnowledgeConversationImportEnvelope;
  previewToken: string;
  requestKey: string;
  summary: KnowledgeConversationImportPreview['summary'];
  warningCount: number;
  rejectedFieldCount: number;
  expiresAt: string;
};

type Notice = {
  tone: 'success' | 'warning' | 'error' | 'info';
  text: string;
};

const KNOWLEDGE_TURN_MAX_BYTES = 64 * 1024;
const KNOWLEDGE_TITLE_MAX_CODE_POINTS = 500;

const roleBadgeDictionary = {
  user: { label: knowledgeRoleLabels.user, tone: 'info' },
  assistant: { label: knowledgeRoleLabels.assistant, tone: 'success' },
  system: { label: knowledgeRoleLabels.system, tone: 'neutral' },
  tool: { label: knowledgeRoleLabels.tool, tone: 'warning' },
} as const;

const originBadgeDictionary = {
  user: { label: knowledgeOriginLabels.user, tone: 'info' },
  external: { label: knowledgeOriginLabels.external, tone: 'warning' },
  ai: { label: knowledgeOriginLabels.ai, tone: 'success' },
  system: { label: knowledgeOriginLabels.system, tone: 'neutral' },
  tool: { label: knowledgeOriginLabels.tool, tone: 'warning' },
} as const;

const relationBadgeDictionary = {
  primary: { label: knowledgeRelationLabels.primary, tone: 'success' },
  supporting: { label: knowledgeRelationLabels.supporting, tone: 'info' },
  contradicting: {
    label: knowledgeRelationLabels.contradicting,
    tone: 'danger',
  },
  context: { label: knowledgeRelationLabels.context, tone: 'neutral' },
} as const;

const sourceTypeLabels: Record<KnowledgeConversationSourceType, string> = {
  manual: '手動',
  json: 'JSON',
  markdown: '限定Markdown',
};

const formatTabs = [
  ['manual', '手動入力'],
  ['json', 'JSON入力'],
  ['markdown', '限定Markdown入力'],
] as const;

const roleOptions = Object.keys(
  knowledgeRoleLabels,
) as KnowledgeConversationRole[];

const compatibleOrigins: Record<
  KnowledgeConversationRole,
  KnowledgeProvenanceOrigin[]
> = {
  user: ['user', 'external'],
  assistant: ['ai', 'external'],
  system: ['system'],
  tool: ['tool'],
};

function toSafeErrorMessage(error: unknown) {
  if (
    error instanceof KnowledgeHubApiError &&
    (error.status === 403 || error.status === 404)
  ) {
    return knowledgeHubErrorMessage('not_found');
  }
  return knowledgeHubErrorMessage(
    error instanceof KnowledgeHubApiError ? error.code : 'unknown_error',
  );
}

function relationForItem(conversation: KnowledgeConversation, itemId: string) {
  return conversation.items.find((item) => item.knowledgeItemId === itemId);
}

function codePointLength(value: string) {
  return [...value].length;
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const merged = [...current];
  const indexes = new Map(merged.map((item, index) => [item.id, index]));
  for (const item of incoming) {
    const existingIndex = indexes.get(item.id);
    if (existingIndex === undefined) {
      indexes.set(item.id, merged.length);
      merged.push(item);
    } else {
      merged[existingIndex] = item;
    }
  }
  return merged;
}

function importResultMessage(result: KnowledgeConversationImportCommit) {
  if (result.reused) {
    return `同じ内容の既存会話を再利用しました（重複取込）。${result.turnCount}ターン、${result.linkedItemCount}項目。`;
  }
  return `会話を取り込みました。${result.turnCount}ターン、${result.linkedItemCount}項目。`;
}

export function KnowledgeConversationPanel(props: {
  itemId: string;
}): JSX.Element {
  const { itemId } = props;
  const [conversationList, setConversationList] =
    useState<ConversationListState>({
      itemId: '',
      status: 'idle',
      items: [],
      nextCursor: null,
      loadingMore: false,
      error: '',
    });
  const [selection, setSelection] = useState<ConversationSelection | null>(
    null,
  );
  const [turnList, setTurnList] = useState<TurnListState | null>(null);

  const [format, setFormat] =
    useState<KnowledgeConversationSourceType>('manual');
  const [manualTitle, setManualTitle] = useState('');
  const [manualRole, setManualRole] =
    useState<KnowledgeConversationRole>('user');
  const [manualOrigin, setManualOrigin] =
    useState<KnowledgeProvenanceOrigin>('user');
  const [manualOccurredAt, setManualOccurredAt] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [markdownInput, setMarkdownInput] = useState('');
  const [readyPreview, setReadyPreview] = useState<ReadyPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitAttempted, setCommitAttempted] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ImportFieldErrors>({});

  const mountedRef = useRef(false);
  const currentItemIdRef = useRef(itemId);
  const selectionRef = useRef<ConversationSelection | null>(null);
  const conversationLoadSequence = useRef(0);
  const turnLoadSequence = useRef(0);
  const previewSequence = useRef(0);
  const commitSequence = useRef(0);
  const draftRevision = useRef(0);
  const formatTabRefs = useRef<
    Partial<Record<KnowledgeConversationSourceType, HTMLButtonElement | null>>
  >({});

  useLayoutEffect(() => {
    currentItemIdRef.current = itemId;
  }, [itemId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversationLoadSequence.current += 1;
      turnLoadSequence.current += 1;
      previewSequence.current += 1;
      commitSequence.current += 1;
    };
  }, []);

  const invalidatePreview = useCallback(() => {
    draftRevision.current += 1;
    previewSequence.current += 1;
    commitSequence.current += 1;
    setReadyPreview(null);
    setPreviewBusy(false);
    setCommitBusy(false);
    setCommitAttempted(false);
    setNotice(null);
    setFieldErrors({});
  }, []);

  const loadConversations = useCallback(
    async (
      targetItemId: string,
      cursor: string | null = null,
      append = false,
    ) => {
      const sequence = conversationLoadSequence.current + 1;
      conversationLoadSequence.current = sequence;
      setConversationList((current) => ({
        itemId: targetItemId,
        status: targetItemId
          ? append && current.itemId === targetItemId
            ? current.status
            : 'loading'
          : 'success',
        items: append && current.itemId === targetItemId ? current.items : [],
        nextCursor:
          append && current.itemId === targetItemId ? current.nextCursor : null,
        loadingMore: Boolean(targetItemId && append),
        error: '',
      }));
      if (!targetItemId) return;

      try {
        const page = await listKnowledgeConversations({
          knowledgeItemId: targetItemId,
          cursor,
        });
        if (
          !mountedRef.current ||
          conversationLoadSequence.current !== sequence ||
          currentItemIdRef.current !== targetItemId
        ) {
          return;
        }
        setConversationList((current) => ({
          itemId: targetItemId,
          status: 'success',
          items:
            append && current.itemId === targetItemId
              ? mergeById(current.items, page.items)
              : page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          error: '',
        }));
      } catch (error) {
        if (
          !mountedRef.current ||
          conversationLoadSequence.current !== sequence ||
          currentItemIdRef.current !== targetItemId
        ) {
          return;
        }
        const message = toSafeErrorMessage(error);
        setConversationList((current) => ({
          itemId: targetItemId,
          status:
            append && current.itemId === targetItemId
              ? current.status
              : 'error',
          items: append && current.itemId === targetItemId ? current.items : [],
          nextCursor:
            append && current.itemId === targetItemId
              ? current.nextCursor
              : null,
          loadingMore: false,
          error: message,
        }));
      }
    },
    [],
  );

  useEffect(() => {
    selectionRef.current = null;
    turnLoadSequence.current += 1;
    setSelection(null);
    setTurnList(null);
    invalidatePreview();
    void loadConversations(itemId);
  }, [invalidatePreview, itemId, loadConversations]);

  const visibleConversations = useMemo(
    () => (conversationList.itemId === itemId ? conversationList.items : []),
    [conversationList, itemId],
  );
  const selectedConversationId =
    selection?.itemId === itemId ? selection.conversationId : '';
  const selectedConversation = useMemo(
    () =>
      visibleConversations.find(
        (conversation) => conversation.id === selectedConversationId,
      ) ?? null,
    [selectedConversationId, visibleConversations],
  );
  const visibleTurnList =
    turnList?.itemId === itemId &&
    turnList.conversationId === selectedConversationId
      ? turnList
      : null;

  const loadTurns = useCallback(
    async (
      targetSelection: ConversationSelection,
      cursor: string | null = null,
      append = false,
    ) => {
      const sequence = turnLoadSequence.current + 1;
      turnLoadSequence.current = sequence;
      setTurnList((current) => ({
        ...targetSelection,
        status:
          append &&
          current?.itemId === targetSelection.itemId &&
          current.conversationId === targetSelection.conversationId
            ? current.status
            : 'loading',
        items:
          append &&
          current?.itemId === targetSelection.itemId &&
          current.conversationId === targetSelection.conversationId
            ? current.items
            : [],
        nextCursor:
          append &&
          current?.itemId === targetSelection.itemId &&
          current.conversationId === targetSelection.conversationId
            ? current.nextCursor
            : null,
        loadingMore: append,
        error: '',
      }));
      try {
        const page = await listKnowledgeConversationTurns(
          targetSelection.conversationId,
          cursor,
        );
        const currentSelection = selectionRef.current;
        if (
          !mountedRef.current ||
          turnLoadSequence.current !== sequence ||
          currentItemIdRef.current !== targetSelection.itemId ||
          currentSelection?.itemId !== targetSelection.itemId ||
          currentSelection.conversationId !== targetSelection.conversationId
        ) {
          return;
        }
        const turns = page.items.filter(
          (turn) => turn.conversationId === targetSelection.conversationId,
        );
        setTurnList((current) => ({
          ...targetSelection,
          status: 'success',
          items: (append &&
          current?.itemId === targetSelection.itemId &&
          current.conversationId === targetSelection.conversationId
            ? mergeById(current.items, turns)
            : turns
          ).sort((left, right) => left.sequence - right.sequence),
          nextCursor: page.nextCursor,
          loadingMore: false,
          error: '',
        }));
      } catch (error) {
        const currentSelection = selectionRef.current;
        if (
          !mountedRef.current ||
          turnLoadSequence.current !== sequence ||
          currentItemIdRef.current !== targetSelection.itemId ||
          currentSelection?.itemId !== targetSelection.itemId ||
          currentSelection.conversationId !== targetSelection.conversationId
        ) {
          return;
        }
        const message = toSafeErrorMessage(error);
        setTurnList((current) => ({
          ...targetSelection,
          status:
            append &&
            current?.itemId === targetSelection.itemId &&
            current.conversationId === targetSelection.conversationId
              ? current.status
              : 'error',
          items:
            append &&
            current?.itemId === targetSelection.itemId &&
            current.conversationId === targetSelection.conversationId
              ? current.items
              : [],
          nextCursor:
            append &&
            current?.itemId === targetSelection.itemId &&
            current.conversationId === targetSelection.conversationId
              ? current.nextCursor
              : null,
          loadingMore: false,
          error: message,
        }));
      }
    },
    [],
  );

  const selectConversation = (conversationId: string) => {
    const targetItemId = itemId;
    if (
      !visibleConversations.some(
        (conversation) => conversation.id === conversationId,
      )
    ) {
      return;
    }
    const nextSelection = { itemId: targetItemId, conversationId };
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    void loadTurns(nextSelection);
  };

  const changeDraft = (change: () => void) => {
    invalidatePreview();
    change();
  };

  const selectFormatTab = (nextFormat: KnowledgeConversationSourceType) => {
    if (nextFormat !== format) changeDraft(() => setFormat(nextFormat));
  };

  const navigateFormatTabs = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % formatTabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + formatTabs.length) % formatTabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = formatTabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextFormat = formatTabs[nextIndex][0];
    selectFormatTab(nextFormat);
    formatTabRefs.current[nextFormat]?.focus();
  };

  const buildEnvelope = (): EnvelopeValidation => {
    if (!itemId) {
      return { ok: false, error: '取込先の項目を選択してください。' };
    }

    let rawInput: string;
    if (format === 'manual') {
      const title = manualTitle.trim();
      if (!title) {
        return {
          ok: false,
          field: 'manualTitle',
          error: '会話タイトルを入力してください。',
        };
      }
      if (codePointLength(title) > KNOWLEDGE_TITLE_MAX_CODE_POINTS) {
        return {
          ok: false,
          field: 'manualTitle',
          error: '会話タイトルは500文字以内で入力してください。',
        };
      }
      if (!manualContent.trim()) {
        return {
          ok: false,
          field: 'manualContent',
          error: 'ターン本文を入力してください。',
        };
      }
      if (utf8Length(manualContent) > KNOWLEDGE_TURN_MAX_BYTES) {
        return {
          ok: false,
          field: 'manualContent',
          error: '1ターンの本文はUTF-8で64 KiB以内にしてください。',
        };
      }
      if (!roleOriginCompatible(manualRole, manualOrigin)) {
        return {
          ok: false,
          field: 'manualOrigin',
          error: 'roleとoriginの組み合わせを確認してください。',
        };
      }
      let occurredAt: string | null = null;
      if (manualOccurredAt) {
        const date = new Date(manualOccurredAt);
        if (Number.isNaN(date.getTime())) {
          return {
            ok: false,
            field: 'manualOccurredAt',
            error: '発生日時を確認してください。',
          };
        }
        occurredAt = date.toISOString();
      }
      rawInput = buildManualKnowledgeConversation({
        title,
        role: manualRole,
        origin: manualOrigin,
        content: manualContent,
        occurredAt,
      });
    } else {
      rawInput = format === 'json' ? jsonInput : markdownInput;
      if (!rawInput.trim()) {
        return {
          ok: false,
          field: format === 'json' ? 'jsonInput' : 'markdownInput',
          error:
            format === 'json'
              ? 'JSON本文を入力してください。'
              : '限定Markdown本文を入力してください。',
        };
      }
    }

    if (utf8Length(rawInput) > KNOWLEDGE_IMPORT_MAX_BYTES) {
      return {
        ok: false,
        field:
          format === 'json'
            ? 'jsonInput'
            : format === 'markdown'
              ? 'markdownInput'
              : 'manualContent',
        error: '取込本文はUTF-8で512 KiB以内にしてください。',
      };
    }

    return {
      ok: true,
      value: {
        format,
        inputBase64: encodeKnowledgeImportInput(rawInput),
        linkedItems: [{ itemId, relationType: 'primary' }],
      },
    };
  };

  const previewImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    invalidatePreview();
    const validation = buildEnvelope();
    if (!validation.ok) {
      if (validation.field) {
        setFieldErrors({ [validation.field]: validation.error });
      }
      setNotice({ tone: 'error', text: validation.error });
      return;
    }

    let requestKey: string;
    try {
      requestKey = createKnowledgeRequestKey();
    } catch {
      setNotice({
        tone: 'error',
        text: '安全な取込識別子を生成できません。ブラウザを再読込してください。',
      });
      return;
    }

    const targetItemId = itemId;
    const currentDraftRevision = draftRevision.current;
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    setPreviewBusy(true);
    setNotice(null);
    try {
      const preview = await previewKnowledgeConversationImport(
        validation.value,
      );
      if (
        !mountedRef.current ||
        previewSequence.current !== sequence ||
        currentItemIdRef.current !== targetItemId ||
        draftRevision.current !== currentDraftRevision
      ) {
        return;
      }
      setReadyPreview({
        itemId: targetItemId,
        draftRevision: currentDraftRevision,
        envelope: validation.value,
        previewToken: preview.previewToken,
        requestKey,
        summary: preview.summary,
        warningCount: preview.warnings.length,
        rejectedFieldCount: preview.rejectedFields.length,
        expiresAt: preview.expiresAt,
      });
      setNotice({
        tone: 'info',
        text: 'プレビューを確認し、問題がなければ明示的に取込を確定してください。',
      });
    } catch (error) {
      if (
        !mountedRef.current ||
        previewSequence.current !== sequence ||
        currentItemIdRef.current !== targetItemId ||
        draftRevision.current !== currentDraftRevision
      ) {
        return;
      }
      setNotice({ tone: 'error', text: toSafeErrorMessage(error) });
    } finally {
      if (mountedRef.current && previewSequence.current === sequence) {
        setPreviewBusy(false);
      }
    }
  };

  const commitImport = async () => {
    const preview = readyPreview;
    if (
      !preview ||
      preview.itemId !== itemId ||
      preview.draftRevision !== draftRevision.current
    ) {
      return;
    }

    const sequence = commitSequence.current + 1;
    commitSequence.current = sequence;
    setCommitBusy(true);
    setCommitAttempted(true);
    setNotice(null);
    try {
      const result = await commitKnowledgeConversationImport({
        ...preview.envelope,
        previewToken: preview.previewToken,
        requestKey: preview.requestKey,
      });
      if (
        !mountedRef.current ||
        commitSequence.current !== sequence ||
        currentItemIdRef.current !== preview.itemId ||
        draftRevision.current !== preview.draftRevision
      ) {
        return;
      }
      setReadyPreview(null);
      setCommitAttempted(false);
      setNotice({
        tone: result.reused ? 'warning' : 'success',
        text: importResultMessage(result),
      });
      void loadConversations(preview.itemId);
    } catch (error) {
      if (
        !mountedRef.current ||
        commitSequence.current !== sequence ||
        currentItemIdRef.current !== preview.itemId ||
        draftRevision.current !== preview.draftRevision
      ) {
        return;
      }
      setNotice({ tone: 'error', text: toSafeErrorMessage(error) });
      if (
        error instanceof KnowledgeHubApiError &&
        (error.code === 'preview_token_expired' ||
          error.code === 'preview_token_invalid')
      ) {
        setReadyPreview(null);
        setCommitAttempted(false);
      }
    } finally {
      if (mountedRef.current && commitSequence.current === sequence) {
        setCommitBusy(false);
      }
    }
  };

  const conversationListContent = (() => {
    if (
      conversationList.itemId !== itemId ||
      conversationList.status === 'idle' ||
      conversationList.status === 'loading'
    ) {
      return <p role="status">関連する会話を取得中です。</p>;
    }
    if (conversationList.status === 'error') {
      return (
        <div>
          <Alert variant="error">{conversationList.error}</Alert>
          <Button
            size="small"
            variant="secondary"
            onClick={() => void loadConversations(itemId)}
          >
            会話一覧を再読込
          </Button>
        </div>
      );
    }
    return (
      <div>
        {visibleConversations.length === 0 ? (
          <p>この項目に関連する会話はありません。</p>
        ) : (
          <ul aria-label="選択項目に関連する会話">
            {visibleConversations.map((conversation) => {
              const relation = relationForItem(conversation, itemId);
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    aria-pressed={conversation.id === selectedConversationId}
                    onClick={() => selectConversation(conversation.id)}
                  >
                    <strong>{conversation.title}</strong>
                    <span>
                      {sourceTypeLabels[conversation.sourceType]} /{' '}
                      {formatKnowledgeDateTime(conversation.capturedAt)}
                    </span>
                    {relation ? (
                      <span
                        aria-label={`relation ${knowledgeRelationLabels[relation.relationType]}`}
                      >
                        <StatusBadge
                          status={relation.relationType}
                          dictionary={relationBadgeDictionary}
                          size="sm"
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {conversationList.error ? (
          <Alert variant="error">{conversationList.error}</Alert>
        ) : null}
        {conversationList.nextCursor ? (
          <Button
            size="small"
            variant="secondary"
            loading={conversationList.loadingMore}
            aria-label="関連する会話をさらに読み込む"
            onClick={() =>
              void loadConversations(itemId, conversationList.nextCursor, true)
            }
          >
            さらに会話を読み込む
          </Button>
        ) : null}
      </div>
    );
  })();

  const timelineContent = (() => {
    if (!selectedConversation) {
      return <p>会話を選択するとターンを取得します。</p>;
    }
    if (!visibleTurnList || visibleTurnList.status === 'loading') {
      return <p role="status">会話ターンを取得中です。</p>;
    }
    if (visibleTurnList.status === 'error') {
      return (
        <div>
          <Alert variant="error">{visibleTurnList.error}</Alert>
          <Button
            size="small"
            variant="secondary"
            onClick={() =>
              void loadTurns({
                itemId,
                conversationId: selectedConversation.id,
              })
            }
          >
            ターンを再読込
          </Button>
        </div>
      );
    }
    return (
      <div>
        {visibleTurnList.items.length === 0 ? (
          <p>表示できるターンはありません。</p>
        ) : (
          <ol aria-label="会話タイムライン">
            {visibleTurnList.items.map((turn) => (
              <li key={turn.id}>
                <article aria-label={`ターン ${turn.sequence}`}>
                  <div>
                    <span aria-label={`role ${knowledgeRoleLabels[turn.role]}`}>
                      <StatusBadge
                        status={turn.role}
                        dictionary={roleBadgeDictionary}
                        size="sm"
                      />
                    </span>
                    <span
                      aria-label={`origin ${knowledgeOriginLabels[turn.origin]}`}
                    >
                      <StatusBadge
                        status={turn.origin}
                        dictionary={originBadgeDictionary}
                        size="sm"
                      />
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>発生日時</dt>
                      <dd>
                        {turn.occurredAt ? (
                          <time dateTime={turn.occurredAt}>
                            {formatKnowledgeDateTime(turn.occurredAt)}
                          </time>
                        ) : (
                          '記録なし'
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{turn.content}</p>
                </article>
              </li>
            ))}
          </ol>
        )}
        {visibleTurnList.error ? (
          <Alert variant="error">{visibleTurnList.error}</Alert>
        ) : null}
        {visibleTurnList.nextCursor ? (
          <Button
            size="small"
            variant="secondary"
            loading={visibleTurnList.loadingMore}
            aria-label="会話ターンをさらに読み込む"
            onClick={() =>
              void loadTurns(
                { itemId, conversationId: selectedConversation.id },
                visibleTurnList.nextCursor,
                true,
              )
            }
          >
            さらにターンを読み込む
          </Button>
        ) : null}
      </div>
    );
  })();

  const activePreview = readyPreview?.itemId === itemId ? readyPreview : null;

  return (
    <section aria-labelledby="knowledge-conversation-heading">
      <h4 id="knowledge-conversation-heading">会話・取込</h4>
      <p>
        選択中のKnowledge項目に関連する会話だけを確認し、手動、JSON、限定Markdownから二段階で取り込みます。
      </p>

      <div>
        <section aria-labelledby="linked-conversations-heading">
          <h5 id="linked-conversations-heading">関連する会話</h5>
          <Card padding="small">{conversationListContent}</Card>
        </section>

        <section aria-labelledby="conversation-timeline-heading">
          <h5 id="conversation-timeline-heading">会話タイムライン</h5>
          <Card padding="small">
            {selectedConversation ? (
              <div>
                <strong>{selectedConversation.title}</strong>
                <dl>
                  <div>
                    <dt>形式</dt>
                    <dd>{sourceTypeLabels[selectedConversation.sourceType]}</dd>
                  </div>
                  <div>
                    <dt>provider</dt>
                    <dd>{selectedConversation.provider ?? '未設定'}</dd>
                  </div>
                  <div>
                    <dt>model</dt>
                    <dd>{selectedConversation.model ?? '未設定'}</dd>
                  </div>
                  <div>
                    <dt>取得日時</dt>
                    <dd>
                      {formatKnowledgeDateTime(selectedConversation.capturedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}
            {timelineContent}
          </Card>
        </section>
      </div>

      <section aria-labelledby="conversation-import-heading">
        <h5 id="conversation-import-heading">会話を取り込む</h5>
        <Card padding="small">
          {notice ? (
            <div aria-live="polite">
              <Alert variant={notice.tone}>{notice.text}</Alert>
            </div>
          ) : null}

          <div role="tablist" aria-label="会話取込形式">
            {formatTabs.map(([value, label], index) => (
              <button
                key={value}
                ref={(node) => {
                  formatTabRefs.current[value] = node;
                }}
                id={`knowledge-import-tab-${value}`}
                type="button"
                role="tab"
                aria-selected={format === value}
                aria-controls={`knowledge-import-panel-${value}`}
                tabIndex={format === value ? 0 : -1}
                onClick={() => selectFormatTab(value)}
                onKeyDown={(event) => navigateFormatTabs(event, index)}
              >
                {label}
              </button>
            ))}
          </div>

          <form noValidate onSubmit={previewImport}>
            <div
              id={`knowledge-import-panel-${format}`}
              role="tabpanel"
              aria-labelledby={`knowledge-import-tab-${format}`}
            >
              {format === 'manual' ? (
                <>
                  <Input
                    label="会話タイトル"
                    aria-label="会話タイトル"
                    value={manualTitle}
                    maxLength={KNOWLEDGE_TITLE_MAX_CODE_POINTS}
                    error={fieldErrors.manualTitle}
                    onChange={(event) =>
                      changeDraft(() => setManualTitle(event.target.value))
                    }
                    required
                  />
                  <Select
                    label="role"
                    value={manualRole}
                    onChange={(event) => {
                      const nextRole = event.target
                        .value as KnowledgeConversationRole;
                      changeDraft(() => {
                        setManualRole(nextRole);
                        if (!roleOriginCompatible(nextRole, manualOrigin)) {
                          setManualOrigin(compatibleOrigins[nextRole][0]);
                        }
                      });
                    }}
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {knowledgeRoleLabels[role]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="origin"
                    value={manualOrigin}
                    error={fieldErrors.manualOrigin}
                    onChange={(event) =>
                      changeDraft(() =>
                        setManualOrigin(
                          event.target.value as KnowledgeProvenanceOrigin,
                        ),
                      )
                    }
                  >
                    {compatibleOrigins[manualRole].map((origin) => (
                      <option key={origin} value={origin}>
                        {knowledgeOriginLabels[origin]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="発生日時（任意）"
                    type="datetime-local"
                    value={manualOccurredAt}
                    error={fieldErrors.manualOccurredAt}
                    onChange={(event) =>
                      changeDraft(() => setManualOccurredAt(event.target.value))
                    }
                  />
                  <Textarea
                    label="ターン本文"
                    aria-label="ターン本文"
                    value={manualContent}
                    rows={7}
                    maxLength={KNOWLEDGE_TURN_MAX_BYTES}
                    error={fieldErrors.manualContent}
                    helpText="一件のstructured turnとして取り込みます。UTF-8で最大64 KiBです。"
                    onChange={(event) =>
                      changeDraft(() => setManualContent(event.target.value))
                    }
                    required
                  />
                </>
              ) : null}

              {format === 'json' ? (
                <Textarea
                  label="JSON本文"
                  aria-label="JSON本文"
                  value={jsonInput}
                  rows={12}
                  maxLength={KNOWLEDGE_IMPORT_MAX_BYTES}
                  error={fieldErrors.jsonInput}
                  helpText="strict object grammarのraw JSONをUTF-8で最大512 KiBまで入力できます。"
                  onChange={(event) =>
                    changeDraft(() => setJsonInput(event.target.value))
                  }
                  required
                />
              ) : null}

              {format === 'markdown' ? (
                <Textarea
                  label="限定Markdown本文"
                  aria-label="限定Markdown本文"
                  value={markdownInput}
                  rows={12}
                  maxLength={KNOWLEDGE_IMPORT_MAX_BYTES}
                  error={fieldErrors.markdownInput}
                  helpText="Knowledge Conversation v1形式をUTF-8で最大512 KiBまで入力します。linkやHTMLは実行・取得しません。"
                  onChange={(event) =>
                    changeDraft(() => setMarkdownInput(event.target.value))
                  }
                  required
                />
              ) : null}
            </div>

            <Button type="submit" loading={previewBusy}>
              取込内容をプレビュー
            </Button>
          </form>

          {activePreview ? (
            <section aria-labelledby="conversation-import-preview-heading">
              <h6 id="conversation-import-preview-heading">取込プレビュー</h6>
              <dl>
                <div>
                  <dt>タイトル</dt>
                  <dd>{activePreview.summary.title}</dd>
                </div>
                <div>
                  <dt>形式</dt>
                  <dd>{sourceTypeLabels[activePreview.summary.format]}</dd>
                </div>
                <div>
                  <dt>provider</dt>
                  <dd>{activePreview.summary.provider ?? '未設定'}</dd>
                </div>
                <div>
                  <dt>model</dt>
                  <dd>{activePreview.summary.model ?? '未設定'}</dd>
                </div>
                <div>
                  <dt>role</dt>
                  <dd>
                    {activePreview.summary.roles
                      .map((role) => knowledgeRoleLabels[role])
                      .join('、')}
                  </dd>
                </div>
                <div>
                  <dt>origin</dt>
                  <dd>
                    {activePreview.summary.origins
                      .map((origin) => knowledgeOriginLabels[origin])
                      .join('、')}
                  </dd>
                </div>
                <div>
                  <dt>ターン数</dt>
                  <dd>{activePreview.summary.turnCount}</dd>
                </div>
                <div>
                  <dt>関連項目数</dt>
                  <dd>{activePreview.summary.linkedItemCount}</dd>
                </div>
                <div>
                  <dt>relation</dt>
                  <dd>{knowledgeRelationLabels.primary}</dd>
                </div>
                <div>
                  <dt>有効期限</dt>
                  <dd>{formatKnowledgeDateTime(activePreview.expiresAt)}</dd>
                </div>
                <div>
                  <dt>検証警告</dt>
                  <dd>{activePreview.warningCount}件</dd>
                </div>
                <div>
                  <dt>拒否フィールド</dt>
                  <dd>{activePreview.rejectedFieldCount}件</dd>
                </div>
              </dl>
              <Alert variant="warning">
                まだ保存されていません。内容を確認したうえで取込を確定してください。
              </Alert>
              <Button
                type="button"
                loading={commitBusy}
                onClick={() => void commitImport()}
              >
                {commitAttempted ? '取込確定を再試行' : '取込を確定'}
              </Button>
            </section>
          ) : null}
        </Card>
      </section>
    </section>
  );
}
