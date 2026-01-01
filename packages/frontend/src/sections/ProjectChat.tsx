import React, { useCallback, useEffect, useState } from 'react';
import { api, getAuthState } from '../api';

type ChatMessage = {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  tags?: string[];
  reactions?: Record<string, number | { count: number; userIds: string[] }>;
  createdAt: string;
};

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

const reactionOptions = ['👍', '🎉'];

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

export const ProjectChat: React.FC = () => {
  const auth = getAuthState();
  const defaultProjectId = auth?.projectIds?.[0] || 'demo-project';
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectMessage, setProjectMessage] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: ProjectOption[] }>('/projects');
      setProjects(res.items || []);
      setProjectMessage('');
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setProjectMessage('案件一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (projects.length === 0) return;
    setProjectId((prev) => {
      if (projects.some((project) => project.id === prev)) {
        return prev;
      }
      return projects[0].id;
    });
  }, [projects]);

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await api<{ items: ChatMessage[] }>(
        `/projects/${projectId}/chat-messages`,
      );
      setItems(res.items || []);
      setMessage('読み込みました');
    } catch (error) {
      console.error('チャットの取得に失敗しました', error);
      setMessage('読み込みに失敗しました');
    } finally {
      setIsLoading(false);
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
              <div>{item.body}</div>
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
    </div>
  );
};
