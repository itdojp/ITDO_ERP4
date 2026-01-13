import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getAuthState } from '../api';
import type { ProjectOption } from '../hooks/useProjects';
import { HelpModal } from './HelpModal';
import {
  clearDraft,
  getDraftOwnerId,
  loadDraft,
  saveDraft,
} from '../utils/drafts';
import { enqueueOfflineItem, isOfflineError } from '../utils/offlineQueue';

const tags = [
  '仕事量が多い',
  '役割/進め方',
  '人間関係',
  '体調',
  '私生活',
  '特になし',
];

type MessageState = { text: string; type: 'success' | 'error' } | null;

type DailyReportItem = {
  id: string;
  userId: string;
  reportDate: string;
  content: string;
  linkedProjectIds?: unknown;
  status?: string | null;
};

export const DailyReport: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId || 'demo-user';
  const isPrivileged =
    auth?.roles?.includes('admin') || auth?.roles?.includes('mgmt');
  const draftOwnerId = getDraftOwnerId(auth?.userId);
  const draftKey = `daily-report:${draftOwnerId}`;

  const [status, setStatus] = useState<'good' | 'not_good' | ''>('');
  const [reportContent, setReportContent] = useState('');
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [helpRequested, setHelpRequested] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectMessage, setProjectMessage] = useState('');
  const [historyItems, setHistoryItems] = useState<DailyReportItem[]>([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyUserId, setHistoryUserId] = useState(() =>
    isPrivileged ? userId : '',
  );
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  useEffect(() => {
    api<{ items: ProjectOption[] }>('/projects')
      .then((res) => {
        setProjects(res.items || []);
        setProjectMessage('');
      })
      .catch(() => {
        setProjects([]);
        setProjectMessage('案件一覧の取得に失敗しました');
      });
  }, []);

  useEffect(() => {
    loadDraft<{
      status: 'good' | 'not_good' | '';
      reportContent?: string;
      linkedProjectIds?: string[];
      notes?: string;
      selectedTags?: string[];
      helpRequested?: boolean;
    }>(draftKey).then((draft) => {
      if (!draft) return;
      setStatus(draft.status ?? '');
      setReportContent(draft.reportContent ?? '');
      setLinkedProjectIds(draft.linkedProjectIds ?? []);
      setNotes(draft.notes ?? '');
      setSelectedTags(draft.selectedTags ?? []);
      setHelpRequested(Boolean(draft.helpRequested));
    });
  }, [draftKey]);

  useEffect(() => {
    saveQueueRef.current = Promise.resolve();
  }, [draftKey]);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = saveQueueRef.current.then(() =>
        saveDraft(draftKey, {
          status,
          reportContent,
          linkedProjectIds,
          notes,
          selectedTags,
          helpRequested,
        }),
      );
      saveQueueRef.current = next.catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [
    draftKey,
    status,
    reportContent,
    linkedProjectIds,
    notes,
    selectedTags,
    helpRequested,
  ]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const loadHistory = useCallback(async () => {
    const qs = new URLSearchParams();
    const trimmedUserId = historyUserId.trim();
    if (trimmedUserId) {
      qs.set('userId', trimmedUserId);
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    try {
      setIsHistoryLoading(true);
      const res = await api<{ items: DailyReportItem[] }>(
        `/daily-reports${suffix}`,
      );
      setHistoryItems(res.items || []);
      setHistoryMessage('読み込みました');
    } catch (err) {
      setHistoryItems([]);
      setHistoryMessage('読み込みに失敗しました');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [historyUserId]);

  useEffect(() => {
    loadHistory().catch(() => undefined);
  }, [loadHistory]);

  const handleLinkedProjectsChange = (value: string[]) => {
    setLinkedProjectIds(value);
  };

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const parseLinkedProjectIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  };

  const submit = async () => {
    if (!status) {
      setMessage({ text: 'Good / Not Good を選択してください', type: 'error' });
      return;
    }
    const now = new Date();
    const isoNow = now.toISOString();
    const requests = [
      {
        path: '/daily-reports',
        method: 'POST',
        body: {
          userId,
          content: reportContent,
          reportDate: isoNow,
          linkedProjectIds,
          status: 'submitted',
        },
      },
      {
        path: '/wellbeing-entries',
        method: 'POST',
        body: {
          userId,
          entryDate: isoNow,
          status,
          notes: selectedTags.length
            ? `${notes}\nTags:${selectedTags.join(',')}`
            : notes,
          helpRequested,
          visibilityGroupId: 'hr-group',
        },
      },
    ];
    let cursor = 0;
    try {
      setIsSubmitting(true);
      for (const req of requests) {
        await api(req.path, {
          method: req.method,
          body: JSON.stringify(req.body),
        });
        cursor += 1;
      }
      setMessage({ text: '送信しました', type: 'success' });
      setNotes('');
      setReportContent('');
      setLinkedProjectIds([]);
      setSelectedTags([]);
      setHelpRequested(false);
      setStatus('');
      await clearDraft(draftKey);
      await loadHistory();
    } catch (e) {
      if (isOfflineError(e)) {
        await enqueueOfflineItem({
          kind: 'daily-report',
          label: `日報 ${isoNow.slice(0, 10)}`,
          requests,
          cursor,
        });
        setMessage({
          text: 'オフラインのため送信待ちに保存しました',
          type: 'success',
        });
        setNotes('');
        setReportContent('');
        setLinkedProjectIds([]);
        setSelectedTags([]);
        setHelpRequested(false);
        setStatus('');
        await clearDraft(draftKey);
      } else {
        setMessage({ text: '送信に失敗しました', type: 'error' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <h2>日報 + ウェルビーイング</h2>
      <div style={{ marginTop: 8 }}>
        <textarea
          placeholder="日報本文（任意）"
          value={reportContent}
          onChange={(e) => setReportContent(e.target.value)}
          style={{ width: '100%', minHeight: 80 }}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>
          関連案件（任意・複数選択可）
        </label>
        <select
          multiple
          value={linkedProjectIds}
          onChange={(e) =>
            handleLinkedProjectsChange(
              Array.from(e.target.selectedOptions).map((opt) => opt.value),
            )
          }
          style={{ width: '100%', minHeight: 96 }}
          aria-label="関連案件"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </select>
        {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <span>今日のコンディション:</span>
        <button
          className="button secondary"
          onClick={() => setStatus('good')}
          aria-pressed={status === 'good'}
        >
          Good
        </button>
        <button
          className="button secondary"
          onClick={() => setStatus('not_good')}
          aria-pressed={status === 'not_good'}
        >
          Not Good
        </button>
        <button
          className="button"
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowHelp(true)}
        >
          ヘルプ / 相談したい
        </button>
      </div>
      {status === 'not_good' && (
        <div style={{ marginTop: 12 }}>
          <div>タグ（任意）</div>
          <div className="row">
            {tags.map((tag) => (
              <button
                key={tag}
                className="button secondary"
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.includes(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <textarea
              placeholder="共有してもよければ、今日しんどかったことを書いてください（空欄可）"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '100%', minHeight: 80 }}
            />
          </div>
          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginTop: 8,
            }}
          >
            <input
              type="checkbox"
              checked={helpRequested}
              onChange={(e) => setHelpRequested(e.target.checked)}
            />
            相談したい（人事/相談窓口へ）
          </label>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="button" onClick={submit} disabled={isSubmitting}>
          送信
        </button>
      </div>
      {message && (
        <p style={{ color: message.type === 'error' ? '#dc2626' : undefined }}>
          {message.text}
        </p>
      )}
      <p style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
        この入力は評価に使われません。職場環境の改善とサポートのためにのみ利用します。
      </p>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <hr style={{ margin: '16px 0' }} />
      <h3 style={{ margin: '0 0 8px' }}>日報履歴</h3>
      {isPrivileged && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={historyUserId}
            onChange={(e) => setHistoryUserId(e.target.value)}
            placeholder="userId（空欄で全員: 最新50件）"
            style={{ flex: 1, minWidth: 240 }}
          />
          <button
            className="button secondary"
            onClick={() => loadHistory()}
            disabled={isHistoryLoading}
          >
            履歴を読み込み
          </button>
        </div>
      )}
      {!isPrivileged && (
        <button
          className="button secondary"
          onClick={() => loadHistory()}
          disabled={isHistoryLoading}
        >
          履歴を読み込み
        </button>
      )}
      {historyMessage && <p style={{ fontSize: 12 }}>{historyMessage}</p>}
      <ul className="list" style={{ marginTop: 8 }}>
        {historyItems.length === 0 && (
          <li className="card" style={{ padding: 12 }}>
            まだ日報はありません
          </li>
        )}
        {historyItems.map((item) => {
          const linked = parseLinkedProjectIds(item.linkedProjectIds);
          return (
            <li key={item.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <strong>{item.reportDate.slice(0, 10)}</strong>
                {isPrivileged && <span>User: {item.userId}</span>}
                {item.status && (
                  <span style={{ color: '#475569' }}>({item.status})</span>
                )}
              </div>
              {item.content && (
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                  {item.content}
                </div>
              )}
              {linked.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
                  関連案件: {linked.map(renderProject).join(', ')}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
