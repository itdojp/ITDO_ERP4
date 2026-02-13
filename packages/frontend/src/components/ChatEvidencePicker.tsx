import React, { useCallback, useMemo, useState } from 'react';
import { apiResponse } from '../api';
import { Alert, Button, Card, Input, Spinner } from '../ui';

export type ChatEvidenceCandidate = {
  id: string;
  label: string;
  url: string;
  roomId: string;
  roomName: string;
  projectLabel: string;
  userId: string;
  createdAt: string;
  excerpt: string;
};

type ChatEvidencePickerProps = {
  projectId?: string | null;
  onAddCandidate: (candidate: ChatEvidenceCandidate) => void;
  onInsertCandidate?: (candidate: ChatEvidenceCandidate) => void;
  onCopyCandidate?: (
    mode: 'url' | 'markdown',
    candidate: ChatEvidenceCandidate,
  ) => void;
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveErrorCode(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return normalizeString(record.code);
}

function formatDateTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeDeepLink(id: string, rawUrl: string) {
  if (rawUrl.startsWith('/#/')) return rawUrl;
  if (rawUrl.startsWith('#/')) return `/${rawUrl}`;
  const params = new URLSearchParams();
  params.set('kind', 'chat_message');
  params.set('id', id);
  return `/#/open?${params.toString()}`;
}

export const ChatEvidencePicker: React.FC<ChatEvidencePickerProps> = ({
  projectId,
  onAddCandidate,
  onInsertCandidate,
  onCopyCandidate,
}) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<ChatEvidenceCandidate[]>([]);
  const [searchedQuery, setSearchedQuery] = useState('');

  const canSearch = useMemo(
    () => Boolean(projectId && query.trim().length >= 2),
    [projectId, query],
  );

  const searchCandidates = useCallback(async () => {
    const pid = normalizeString(projectId);
    const q = query.trim();
    if (!pid) {
      setError('案件ID未指定のため候補検索は利用できません');
      setCandidates([]);
      return;
    }
    if (q.length < 2) {
      setError('検索キーワードは2文字以上で入力してください');
      setCandidates([]);
      return;
    }
    try {
      setSearching(true);
      setError('');
      const params = new URLSearchParams({
        projectId: pid,
        q,
        limit: '20',
        types: 'chat_message',
      });
      const res = await apiResponse(`/ref-candidates?${params.toString()}`);
      const payload = (await res.json().catch(() => ({}))) as {
        items?: unknown;
        error?: unknown;
      };
      if (!res.ok) {
        const code = resolveErrorCode(payload.error);
        if (code === 'query_too_short') {
          setError('検索キーワードは2文字以上で入力してください');
        } else if (code === 'forbidden_project') {
          setError('案件スコープ外のため候補を取得できません');
        } else if (code === 'project_not_found') {
          setError('案件が見つかりません');
        } else {
          setError('候補の取得に失敗しました');
        }
        setCandidates([]);
        return;
      }
      const items = Array.isArray(payload.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : [];
      const next = items.flatMap((item) => {
        const kind = normalizeString(item.kind);
        if (kind !== 'chat_message') return [];
        const id = normalizeString(item.id);
        if (!id) return [];
        const label =
          normalizeString(item.label) || `chat_message:${id}`;
        const url = normalizeDeepLink(id, normalizeString(item.url));
        const projectLabel = normalizeString(item.projectLabel);
        const meta =
          item.meta && typeof item.meta === 'object'
            ? (item.meta as Record<string, unknown>)
            : {};
        return [
          {
            id,
            label,
            url,
            roomId: normalizeString(meta.roomId),
            roomName: normalizeString(meta.roomName),
            projectLabel,
            userId: normalizeString(meta.userId),
            createdAt: normalizeString(meta.createdAt),
            excerpt: normalizeString(meta.excerpt),
          } satisfies ChatEvidenceCandidate,
        ];
      });
      setCandidates(next);
      setSearchedQuery(q);
    } catch (err) {
      console.error('Failed to load chat evidence candidates', err);
      setError('候補の取得に失敗しました');
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }, [projectId, query]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        案件スコープ内（同一案件・親子案件）のチャット発言を候補検索します。
      </div>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <Input
          label="キーワード"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            searchCandidates().catch(() => undefined);
          }}
          placeholder="例: 納期 / 仕様 / 承認 / 支払"
          style={{ minWidth: 320 }}
        />
        <Button
          variant="secondary"
          size="small"
          disabled={!canSearch || searching}
          onClick={() => searchCandidates().catch(() => undefined)}
        >
          {searching ? '検索中' : '検索'}
        </Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {searching && <Spinner label="候補を検索中" />}
      {!searching && !error && searchedQuery && candidates.length === 0 && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          「{searchedQuery}」に一致する候補はありません
        </div>
      )}
      {!searching && candidates.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {candidates.map((candidate) => {
            const roomLabel = candidate.roomName || candidate.roomId || '-';
            const authorLabel = candidate.userId || '-';
            const excerpt = candidate.excerpt || '(本文なし)';
            return (
              <Card key={candidate.id} padding="small">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {candidate.projectLabel || '案件未設定'} / {roomLabel}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                  投稿日時: {formatDateTime(candidate.createdAt)} / 投稿者:{' '}
                  {authorLabel}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    color: '#0f172a',
                    marginBottom: 8,
                  }}
                >
                  {excerpt}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => onAddCandidate(candidate)}
                  >
                    追加
                  </Button>
                  {onInsertCandidate && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => onInsertCandidate(candidate)}
                    >
                      メモへ挿入
                    </Button>
                  )}
                  {onCopyCandidate && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => onCopyCandidate('url', candidate)}
                    >
                      URLコピー
                    </Button>
                  )}
                  {onCopyCandidate && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => onCopyCandidate('markdown', candidate)}
                    >
                      Markdownコピー
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
