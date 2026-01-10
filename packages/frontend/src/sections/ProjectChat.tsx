import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { api, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';

type ChatMessage = {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  tags?: string[];
  reactions?: Record<string, number | { count: number; userIds: string[] }>;
  createdAt: string;
};

const reactionOptions = ['👍', '🎉', '❤️', '😂', '🙏', '👀'];
const pageSize = 50;

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getReactionCount(value: unknown) {
  if (typeof value === 'number') return value;
  if (
    value &&
    typeof value === 'object' &&
    'count' in value &&
    typeof (value as { count?: unknown }).count === 'number'
  ) {
    return (value as { count: number }).count;
  }
  return 0;
}

const markdownAllowedElements = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'blockquote',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'a',
  'h1',
  'h2',
  'h3',
  'hr',
];

function transformLinkUri(uri?: string) {
  if (!uri) return '';
  const trimmed = uri.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
    if (parsed.protocol === 'mailto:') return trimmed;
  } catch {
    // ignore
  }
  return '';
}

export const ProjectChat: React.FC = () => {
  const auth = getAuthState();
  const defaultProjectId = auth?.projectIds?.[0] || 'demo-project';
  const [projectId, setProjectId] = useState(defaultProjectId);
  const { projects, projectMessage } = useProjects({
    selectedProjectId: projectId,
    onSelect: setProjectId,
  });
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = async () => {
    try {
      setIsLoading(true);
      const query = new URLSearchParams({ limit: String(pageSize) });
      const trimmedTag = filterTag.trim();
      if (trimmedTag) {
        query.set('tag', trimmedTag);
      }
      const res = await api<{ items: ChatMessage[] }>(
        `/projects/${projectId}/chat-messages?${query.toString()}`,
      );
      setItems(res.items || []);
      setHasMore((res.items || []).length === pageSize);
      setMessage('読み込みました');
    } catch (error) {
      console.error('チャットの取得に失敗しました', error);
      setMessage('読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    const lastItem = items[items.length - 1];
    if (!lastItem) return;
    try {
      setIsLoadingMore(true);
      const query = new URLSearchParams({
        limit: String(pageSize),
        before: lastItem.createdAt,
      });
      const trimmedTag = filterTag.trim();
      if (trimmedTag) {
        query.set('tag', trimmedTag);
      }
      const res = await api<{ items: ChatMessage[] }>(
        `/projects/${projectId}/chat-messages?${query.toString()}`,
      );
      const nextItems = res.items || [];
      setItems((prevItems) => [...prevItems, ...nextItems]);
      setHasMore(nextItems.length === pageSize);
    } catch (error) {
      console.error('追加読み込みに失敗しました', error);
      setMessage('追加読み込みに失敗しました');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const postMessage = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setMessage('メッセージを入力してください');
      return;
    }
    if (trimmedBody.length > 2000) {
      setMessage('メッセージは2000文字以内で入力してください');
      return;
    }
    const parsedTags = parseTags(tags);
    if (parsedTags.length > 8) {
      setMessage('タグは最大8件までです');
      return;
    }
    const invalidTag = parsedTags.find((tag) => tag.length > 32);
    if (invalidTag) {
      setMessage('タグは1つあたり32文字以内で入力してください');
      return;
    }
    try {
      setIsPosting(true);
      await api(`/projects/${projectId}/chat-messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: trimmedBody,
          tags: parsedTags,
        }),
      });
      setBody('');
      setTags('');
      setMessage('投稿しました');
      await load();
    } catch (error) {
      console.error('チャットの投稿に失敗しました', error);
      setMessage('投稿に失敗しました');
    } finally {
      setIsPosting(false);
    }
  };

  const addReaction = async (id: string, emoji: string) => {
    try {
      const updated = await api<ChatMessage>(`/chat-messages/${id}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setItems((prevItems) =>
        prevItems.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      console.error('リアクションに失敗しました', error);
      setMessage('リアクションに失敗しました');
    }
  };

  return (
    <div>
      <h2>プロジェクトチャット</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select
          aria-label="案件選択"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">案件を選択</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </select>
        <button
          className="button secondary"
          onClick={load}
          disabled={isLoading}
        >
          {isLoading ? '読み込み中...' : '読み込み'}
        </button>
        <input
          type="text"
          placeholder="タグで絞り込み (任意)"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          maxLength={32}
          style={{ minWidth: 200 }}
        />
      </div>
      <div style={{ marginTop: 4 }}>
        <small style={{ fontSize: 12, color: '#6b7280' }}>
          タグを変更した後は「読み込み」ボタンを押して絞り込みを適用します。
        </small>
      </div>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      <div style={{ marginTop: 8 }}>
        <textarea
          placeholder="メッセージを書く"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          style={{ width: '100%', minHeight: 80 }}
        />
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="タグ (comma separated)"
          style={{ width: '100%', marginTop: 8 }}
        />
        <button className="button" onClick={postMessage} disabled={isPosting}>
          {isPosting ? '投稿中...' : '投稿'}
        </button>
      </div>
      {message && <p>{message}</p>}
      <ul className="list">
        {items.map((item) => {
          const reactions =
            item.reactions && typeof item.reactions === 'object'
              ? item.reactions
              : {};
          const reactionEntries = Object.entries(reactions).map(
            ([emoji, value]) => [emoji, getReactionCount(value)],
          );
          return (
            <li key={item.id}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {item.userId} / {new Date(item.createdAt).toLocaleString()}
              </div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                allowedElements={markdownAllowedElements}
                transformLinkUri={transformLinkUri}
                linkTarget="_blank"
              >
                {item.body}
              </ReactMarkdown>
              {item.tags && item.tags.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  {item.tags.map((tag) => (
                    <span key={tag} className="badge">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {reactionOptions.map((emoji) => (
                  <button
                    key={emoji}
                    className="button secondary"
                    onClick={() => addReaction(item.id, emoji)}
                  >
                    {emoji} {getReactionCount(reactions[emoji]) || ''}
                  </button>
                ))}
                {reactionEntries
                  .filter(([emoji]) => !reactionOptions.includes(emoji))
                  .map(([emoji, count]) => (
                    <span key={emoji} className="badge">
                      {emoji} {count}
                    </span>
                  ))}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li>メッセージなし</li>}
      </ul>
      {items.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            className="button secondary"
            onClick={loadMore}
            disabled={!hasMore || isLoadingMore}
          >
            {isLoadingMore ? '読み込み中...' : 'もっと読み込む'}
          </button>
        </div>
      )}
    </div>
  );
};
