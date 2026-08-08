export type KnowledgeScope = 'personal' | 'organization';
export type KnowledgeSourceType =
  'x' | 'threads' | 'news' | 'web' | 'pdf' | 'image' | 'manual' | 'other';
export type KnowledgeItemStatus =
  'inbox' | 'reviewing' | 'processed' | 'archived';
export type KnowledgeSnapshotStatus = 'pending' | 'ready' | 'failed';
export type KnowledgeCaptureMethod = 'text' | 'url' | 'upload';
export type KnowledgeCaptureMode = 'text' | 'url' | 'pdf' | 'image';
export type KnowledgeCaptureDestination = 'new' | 'selected';

export type KnowledgeItem = {
  id: string;
  ownerUserId: string;
  scope: KnowledgeScope;
  organizationId: string | null;
  sourceType: KnowledgeSourceType;
  canonicalUrl: string | null;
  title: string | null;
  status: KnowledgeItemStatus;
  version: number;
  capturedAt: string;
  updatedAt: string;
};

export type KnowledgeSnapshot = {
  id: string;
  knowledgeItemId: string;
  version: number;
  status: KnowledgeSnapshotStatus;
  captureMethod: KnowledgeCaptureMethod;
  sourceUrl: string | null;
  originalName: string;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  failureCode: string | null;
  capturedAt: string;
  capturedBy: string;
  readyAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCaptureDraft = {
  destination: KnowledgeCaptureDestination;
  mode: KnowledgeCaptureMode;
  scope: KnowledgeScope;
  title: string;
  organizationGroupIds: string;
  organizationConfirmed: boolean;
  text: string;
  url: string;
  file: File | null;
  selectedItem: KnowledgeItem | null;
};

type ValidKnowledgeCaptureBase = {
  destination: KnowledgeCaptureDestination;
  scope: KnowledgeScope;
  title: string | null;
  organizationGroupIds: string[];
  selectedItem: KnowledgeItem | null;
};

export type ValidKnowledgeCapture = ValidKnowledgeCaptureBase &
  (
    | { mode: 'text'; sourceType: 'manual'; text: string }
    | { mode: 'url'; sourceType: 'web'; url: string }
    | { mode: 'pdf'; sourceType: 'pdf'; file: File }
    | { mode: 'image'; sourceType: 'image'; file: File }
  );

export const KNOWLEDGE_MAX_TEXT_BYTES = 1024 * 1024;
export const KNOWLEDGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const KNOWLEDGE_MAX_TITLE_CODE_POINTS = 500;
const KNOWLEDGE_MAX_URL_CODE_POINTS = 4096;
const KNOWLEDGE_MAX_ORIGINAL_NAME_CODE_POINTS = 255;
const KNOWLEDGE_MAX_GROUP_IDS = 100;
const KNOWLEDGE_MAX_GROUP_ID_CODE_POINTS = 100;

const imageContentTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const sourceTypeSet = new Set<KnowledgeSourceType>([
  'x',
  'threads',
  'news',
  'web',
  'pdf',
  'image',
  'manual',
  'other',
]);
const itemStatusSet = new Set<KnowledgeItemStatus>([
  'inbox',
  'reviewing',
  'processed',
  'archived',
]);
const snapshotStatusSet = new Set<KnowledgeSnapshotStatus>([
  'pending',
  'ready',
  'failed',
]);
const captureMethodSet = new Set<KnowledgeCaptureMethod>([
  'text',
  'url',
  'upload',
]);

function codePointLength(value: string) {
  return [...value].length;
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeGroupIds(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function isOrganizationCapture(draft: KnowledgeCaptureDraft) {
  return draft.destination === 'new'
    ? draft.scope === 'organization'
    : draft.selectedItem?.scope === 'organization';
}

export function validateKnowledgeCapture(
  draft: KnowledgeCaptureDraft,
): { ok: true; value: ValidKnowledgeCapture } | { ok: false; error: string } {
  if (draft.destination === 'selected' && !draft.selectedItem) {
    return { ok: false, error: '保存先のInbox項目を選択してください。' };
  }

  const title = draft.title.trim();
  if (codePointLength(title) > KNOWLEDGE_MAX_TITLE_CODE_POINTS) {
    return { ok: false, error: 'タイトルは500文字以内で入力してください。' };
  }

  const organizationGroupIds = normalizeGroupIds(draft.organizationGroupIds);
  if (draft.destination === 'new' && draft.scope === 'organization') {
    if (organizationGroupIds.length === 0) {
      return {
        ok: false,
        error: '組織scopeでは共有先グループIDを1件以上入力してください。',
      };
    }
    if (organizationGroupIds.length > KNOWLEDGE_MAX_GROUP_IDS) {
      return {
        ok: false,
        error: '共有先グループIDは100件以内で入力してください。',
      };
    }
    if (
      organizationGroupIds.some(
        (groupId) =>
          codePointLength(groupId) > KNOWLEDGE_MAX_GROUP_ID_CODE_POINTS,
      )
    ) {
      return {
        ok: false,
        error: '共有先グループIDは1件100文字以内で入力してください。',
      };
    }
  }

  if (isOrganizationCapture(draft) && !draft.organizationConfirmed) {
    return {
      ok: false,
      error: '組織の共有範囲へ保存することを確認してください。',
    };
  }

  const base: ValidKnowledgeCaptureBase = {
    destination: draft.destination,
    scope:
      draft.destination === 'new'
        ? draft.scope
        : (draft.selectedItem?.scope ?? 'personal'),
    title: title || null,
    organizationGroupIds:
      draft.destination === 'new' && draft.scope === 'organization'
        ? organizationGroupIds
        : [],
    selectedItem: draft.selectedItem,
  };

  if (draft.mode === 'text') {
    if (!draft.text.trim()) {
      return { ok: false, error: '保存するテキストを入力してください。' };
    }
    if (utf8ByteLength(draft.text) > KNOWLEDGE_MAX_TEXT_BYTES) {
      return {
        ok: false,
        error: 'テキストはUTF-8で1 MiB以内にしてください。',
      };
    }
    return {
      ok: true,
      value: {
        ...base,
        mode: 'text',
        sourceType: 'manual',
        text: draft.text,
      },
    };
  }

  if (draft.mode === 'url') {
    const url = draft.url.trim();
    if (!url) {
      return { ok: false, error: '保存するURLを入力してください。' };
    }
    if (codePointLength(url) > KNOWLEDGE_MAX_URL_CODE_POINTS) {
      return { ok: false, error: 'URLは4096文字以内で入力してください。' };
    }
    try {
      const parsed = new URL(url);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      ) {
        return {
          ok: false,
          error: 'URLは認証情報を含まないhttp/https URLにしてください。',
        };
      }
    } catch {
      return { ok: false, error: '有効なhttp/https URLを入力してください。' };
    }
    return {
      ok: true,
      value: { ...base, mode: 'url', sourceType: 'web', url },
    };
  }

  const file = draft.file;
  if (!file) {
    return { ok: false, error: '保存するファイルを選択してください。' };
  }
  if (file.size === 0) {
    return { ok: false, error: '空のファイルは保存できません。' };
  }
  if (file.size > KNOWLEDGE_MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'ファイルは10 MiB以内にしてください。' };
  }
  if (codePointLength(file.name) > KNOWLEDGE_MAX_ORIGINAL_NAME_CODE_POINTS) {
    return { ok: false, error: 'ファイル名は255文字以内にしてください。' };
  }
  if (draft.mode === 'pdf' && file.type !== 'application/pdf') {
    return { ok: false, error: 'PDF形式のファイルを選択してください。' };
  }
  if (draft.mode === 'image' && !imageContentTypes.has(file.type)) {
    return {
      ok: false,
      error: 'PNG、JPEG、WebP、GIF形式の画像を選択してください。',
    };
  }
  if (draft.mode === 'pdf') {
    return {
      ok: true,
      value: { ...base, mode: 'pdf', sourceType: 'pdf', file },
    };
  }
  return {
    ok: true,
    value: { ...base, mode: 'image', sourceType: 'image', file },
  };
}

export type KnowledgeHubErrorCode =
  | 'forbidden'
  | 'idempotency_conflict'
  | 'import_conflict'
  | 'import_oversize'
  | 'invalid_import'
  | 'invalid_request'
  | 'invalid_response'
  | 'network_error'
  | 'not_found'
  | 'preview_token_expired'
  | 'preview_token_invalid'
  | 'snapshot_capture_failed'
  | 'snapshot_capture_timeout'
  | 'snapshot_content_invalid'
  | 'snapshot_content_too_large'
  | 'snapshot_content_type_unsupported'
  | 'snapshot_download_failed'
  | 'snapshot_reconciliation_failed'
  | 'snapshot_reconciliation_pending'
  | 'snapshot_state_conflict'
  | 'snapshot_storage_failed'
  | 'snapshot_storage_pending'
  | 'unknown_error'
  | 'version_conflict';

const errorMessages: Record<KnowledgeHubErrorCode, string> = {
  forbidden: 'この操作を実行する権限がありません。',
  idempotency_conflict:
    '同じ保存操作の内容が一致しません。画面を再読込してください。',
  import_conflict:
    '同じ会話取込が同時に処理されています。結果を再読込してください。',
  import_oversize: '会話データが取込上限を超えています。',
  invalid_import:
    '会話データの形式、role、origin、日時、または上限を確認してください。',
  invalid_request: '入力内容を確認してください。',
  invalid_response: 'サーバー応答を確認できませんでした。再試行してください。',
  network_error: 'サーバーへ接続できませんでした。通信状態を確認してください。',
  not_found: '対象が見つからないか、現在の権限では参照できません。',
  preview_token_expired:
    '取込プレビューの有効期限が切れました。もう一度プレビューしてください。',
  preview_token_invalid:
    '取込内容がプレビュー時点から変わりました。もう一度プレビューしてください。',
  snapshot_capture_failed: '元情報の取得に失敗しました。',
  snapshot_capture_timeout: '元情報の取得が時間内に完了しませんでした。',
  snapshot_content_invalid: '内容またはファイル形式を確認できませんでした。',
  snapshot_content_too_large: '保存上限を超えています。',
  snapshot_content_type_unsupported: 'このコンテンツ形式は保存できません。',
  snapshot_download_failed: 'スナップショットを取得できませんでした。',
  snapshot_reconciliation_failed: '保存結果の照合に失敗しました。',
  snapshot_reconciliation_pending:
    '保存結果はまだ確認中です。時間を置いて再照合してください。',
  snapshot_state_conflict:
    'スナップショットの状態が更新されています。再読込してください。',
  snapshot_storage_failed: 'スナップショットを保存できませんでした。',
  snapshot_storage_pending:
    '保存結果を確認中です。自動再送せず、再照合してください。',
  unknown_error: '処理を完了できませんでした。再試行してください。',
  version_conflict: '項目が更新されています。再読込してください。',
};

export function isKnowledgeHubErrorCode(
  value: unknown,
): value is KnowledgeHubErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(errorMessages, value)
  );
}

export function knowledgeHubErrorMessage(code: KnowledgeHubErrorCode) {
  return errorMessages[code];
}

export function createKnowledgeRequestKey(cryptoValue = globalThis.crypto) {
  if (typeof cryptoValue?.randomUUID === 'function') {
    return cryptoValue.randomUUID();
  }
  if (typeof cryptoValue?.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    cryptoValue.getRandomValues(bytes);
    return [...bytes]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('secure_request_key_unavailable');
}

export function isKnowledgeSourceType(
  value: unknown,
): value is KnowledgeSourceType {
  return typeof value === 'string' && sourceTypeSet.has(value as never);
}

export function isKnowledgeItemStatus(
  value: unknown,
): value is KnowledgeItemStatus {
  return typeof value === 'string' && itemStatusSet.has(value as never);
}

export function isKnowledgeSnapshotStatus(
  value: unknown,
): value is KnowledgeSnapshotStatus {
  return typeof value === 'string' && snapshotStatusSet.has(value as never);
}

export function isKnowledgeCaptureMethod(
  value: unknown,
): value is KnowledgeCaptureMethod {
  return typeof value === 'string' && captureMethodSet.has(value as never);
}

export function formatKnowledgeDateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ja-JP');
}

export function formatKnowledgeBytes(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return '-';
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}
