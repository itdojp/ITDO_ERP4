import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, getAuthState } from '../api';
import type { ProjectOption } from '../hooks/useProjects';
import { HelpModal } from './HelpModal';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Textarea,
  Toast,
} from '../ui';
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

const pad2 = (value: number) => String(value).padStart(2, '0');
const toLocalDateKey = (value: Date) =>
  `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
const toLocalDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const diffInDays = (from: string, to: string) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor(
    (toLocalDate(to).getTime() - toLocalDate(from).getTime()) / msPerDay,
  );
};
const isEditableByDate = (dateKey: string, editableDays: number) =>
  diffInDays(dateKey, toLocalDateKey(new Date())) <= editableDays;
const parseLinkedProjectIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

type MessageState = { text: string; type: 'success' | 'error' } | null;

type DailyReportItem = {
  id: string;
  userId: string;
  reportDate: string;
  content: string;
  linkedProjectIds?: unknown;
  status?: string | null;
};

type DailyReportRevision = {
  id: string;
  version: number;
  content: string;
  linkedProjectIds?: unknown;
  status?: string | null;
  reasonText?: string | null;
  createdAt: string;
  createdBy?: string | null;
};

type TimeEntryItem = {
  id: string;
  projectId: string;
  workDate: string;
  minutes: number;
  status: string;
  workType?: string;
  location?: string;
  notes?: string;
};

export const DailyReport: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId || 'demo-user';
  const isPrivileged =
    auth?.roles?.includes('admin') || auth?.roles?.includes('mgmt');
  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);
  const draftOwnerId = getDraftOwnerId(auth?.userId);
  const [reportDate, setReportDate] = useState(todayKey);
  const draftKey = `daily-report:${draftOwnerId}:${reportDate}`;

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
  const [reportId, setReportId] = useState<string | null>(null);
  const [editableDays, setEditableDays] = useState(14);
  const [reasonText, setReasonText] = useState('');
  const [revisionItems, setRevisionItems] = useState<DailyReportRevision[]>([]);
  const [revisionMessage, setRevisionMessage] = useState('');
  const [isRevisionLoading, setIsRevisionLoading] = useState(false);
  const [isRevisionLoaded, setIsRevisionLoaded] = useState(false);
  const [historyItems, setHistoryItems] = useState<DailyReportItem[]>([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyUserId, setHistoryUserId] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [timeEntries, setTimeEntries] = useState<TimeEntryItem[]>([]);
  const [timeEntryMessage, setTimeEntryMessage] = useState('');
  const [isTimeEntryLoading, setIsTimeEntryLoading] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    setReportContent('');
    setLinkedProjectIds([]);
    setStatus('');
    setNotes('');
    setSelectedTags([]);
    setHelpRequested(false);
    setReasonText('');
    setReportId(null);
    setRevisionItems([]);
    setRevisionMessage('');
    setIsRevisionLoaded(false);
  }, [reportDate]);

  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const isLocked = useMemo(() => {
    if (!reportDate) return false;
    return !isEditableByDate(reportDate, editableDays);
  }, [reportDate, editableDays]);

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
    api<{ editableDays?: number }>('/worklog-settings')
      .then((res) => {
        if (typeof res.editableDays === 'number') {
          setEditableDays(res.editableDays);
        }
      })
      .catch(() => undefined);
  }, []);

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

  const loadReport = useCallback(
    async (options?: { preferDraft?: boolean }) => {
      const preferDraft = options?.preferDraft ?? true;
      const qs = new URLSearchParams({ reportDate });
      const suffix = qs.toString() ? `?${qs}` : '';
      let item: DailyReportItem | null = null;
      try {
        const res = await api<{ items: DailyReportItem[] }>(
          `/daily-reports${suffix}`,
        );
        item = res.items?.[0] ?? null;
      } catch {
        item = null;
      }
      if (item) {
        setReportId(item.id);
      } else {
        setReportId(null);
      }

      type DraftType = {
        status: 'good' | 'not_good' | '';
        reportContent?: string;
        linkedProjectIds?: string[];
        notes?: string;
        selectedTags?: string[];
        helpRequested?: boolean;
      };
      let draft: DraftType | null = null;
      try {
        draft = await loadDraft<DraftType>(draftKey);
      } catch {
        draft = null;
      }

      if (preferDraft && draft) {
        setStatus(draft.status ?? '');
        setReportContent(draft.reportContent ?? item?.content ?? '');
        setLinkedProjectIds(
          draft.linkedProjectIds ??
            (item ? parseLinkedProjectIds(item.linkedProjectIds) : []),
        );
        setNotes(draft.notes ?? '');
        setSelectedTags(draft.selectedTags ?? []);
        setHelpRequested(Boolean(draft.helpRequested));
        return;
      }

      if (item) {
        setReportContent(item.content ?? '');
        setLinkedProjectIds(parseLinkedProjectIds(item.linkedProjectIds));
      } else {
        setReportContent('');
        setLinkedProjectIds([]);
      }
    },
    [draftKey, reportDate],
  );

  useEffect(() => {
    loadReport().catch(() => undefined);
  }, [loadReport]);

  const loadTimeEntries = useCallback(async () => {
    if (!reportDate) return;
    const qs = new URLSearchParams({ from: reportDate, to: reportDate });
    if (userId) {
      qs.set('userId', userId);
    }
    try {
      setIsTimeEntryLoading(true);
      const res = await api<{ items: TimeEntryItem[] }>(
        `/time-entries?${qs.toString()}`,
      );
      const items = Array.isArray(res.items) ? res.items : [];
      setTimeEntries(items);
      setTimeEntryMessage(items.length > 0 ? '' : '当日の工数はありません');
    } catch {
      setTimeEntries([]);
      setTimeEntryMessage('当日の工数を取得できませんでした');
    } finally {
      setIsTimeEntryLoading(false);
    }
  }, [reportDate, userId]);

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
      const items = res.items || [];
      setHistoryItems(items);
      setHistoryMessage(items.length > 0 ? '読み込みました' : '');
    } catch (err) {
      setHistoryItems([]);
      setHistoryMessage('読み込みに失敗しました');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [historyUserId]);

  const loadRevisions = useCallback(async () => {
    if (!reportId) {
      setRevisionItems([]);
      setRevisionMessage('');
      setIsRevisionLoaded(false);
      return;
    }
    try {
      setIsRevisionLoading(true);
      const res = await api<{ items: DailyReportRevision[] }>(
        `/daily-reports/${reportId}/revisions`,
      );
      const items = res.items || [];
      setRevisionItems(items);
      setRevisionMessage(items.length > 0 ? '読み込みました' : '');
    } catch {
      setRevisionItems([]);
      setRevisionMessage('読み込みに失敗しました');
    } finally {
      setIsRevisionLoaded(true);
      setIsRevisionLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    loadHistory().catch(() => undefined);
  }, [loadHistory]);

  useEffect(() => {
    loadTimeEntries().catch(() => undefined);
  }, [loadTimeEntries]);

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const timeEntrySummary = useMemo(() => {
    const totalMinutes = timeEntries.reduce(
      (sum, entry) => sum + (entry.minutes || 0),
      0,
    );
    const byProject = new Map<string, number>();
    timeEntries.forEach((entry) => {
      byProject.set(
        entry.projectId,
        (byProject.get(entry.projectId) || 0) + entry.minutes,
      );
    });
    return { totalMinutes, byProject };
  }, [timeEntries]);

  const addLinkedProject = (projectId: string) => {
    setLinkedProjectIds((prev) =>
      prev.includes(projectId) ? prev : [...prev, projectId],
    );
  };

  const addAllLinkedProjects = () => {
    const uniqueProjectIds = Array.from(
      new Set(timeEntries.map((entry) => entry.projectId)),
    );
    if (uniqueProjectIds.length === 0) return;
    setLinkedProjectIds((prev) => {
      const next = new Set(prev);
      uniqueProjectIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const submit = async () => {
    if (!reportDate) {
      setMessage({ text: '対象日を選択してください', type: 'error' });
      return;
    }
    if (isLocked && !isPrivileged) {
      setMessage({
        text: `対象日から${editableDays}日を超えたため修正できません`,
        type: 'error',
      });
      return;
    }
    const trimmedReason = reasonText.trim();
    if (isLocked && isPrivileged && !trimmedReason) {
      setMessage({
        text: 'ロック解除で修正する場合は理由を入力してください',
        type: 'error',
      });
      return;
    }
    if (!status) {
      setMessage({ text: 'Good / Not Good を選択してください', type: 'error' });
      return;
    }
    const requests = [
      {
        path: '/daily-reports',
        method: 'POST',
        body: {
          userId,
          content: reportContent,
          reportDate,
          linkedProjectIds,
          status: 'submitted',
          reasonText: trimmedReason || undefined,
        },
      },
      {
        path: '/wellbeing-entries',
        method: 'POST',
        body: {
          userId,
          entryDate: reportDate,
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
      setReasonText('');
      await clearDraft(draftKey);
      await loadReport();
      await loadHistory();
    } catch (e) {
      if (isOfflineError(e)) {
        await enqueueOfflineItem({
          kind: 'daily-report',
          label: `日報 ${reportDate}`,
          requests,
          cursor,
        });
        setMessage({
          text: 'オフラインのため送信待ちに保存しました',
          type: 'success',
        });
        setReasonText('');
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
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <Input
          label="対象日"
          aria-label="対象日"
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          max={todayKey}
        />
        <Button
          variant="secondary"
          onClick={() => loadReport({ preferDraft: false })}
        >
          日報を再読み込み
        </Button>
      </div>
      {isLocked && !isPrivileged && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="warning">
            対象日から{editableDays}日を超えているため修正できません。
          </Alert>
        </div>
      )}
      {isLocked && isPrivileged && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="warning">
            対象日から{editableDays}
            日を超えています。管理者は理由を記載して修正できます。
          </Alert>
        </div>
      )}
      <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        <Card padding="small">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong>当日の工数</strong>
            <Button
              variant="secondary"
              onClick={() => loadTimeEntries()}
              loading={isTimeEntryLoading}
            >
              再取得
            </Button>
            <Button
              variant="outline"
              onClick={addAllLinkedProjects}
              disabled={
                (isLocked && !isPrivileged) || timeEntries.length === 0
              }
            >
              工数の案件を全て関連付け
            </Button>
            {timeEntrySummary.totalMinutes > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 12 }}>
                合計: {timeEntrySummary.totalMinutes} 分
              </span>
            )}
          </div>
          {timeEntryMessage && (
            <div style={{ marginTop: 8 }}>
              <Alert variant="warning">{timeEntryMessage}</Alert>
            </div>
          )}
          {timeEntries.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {Array.from(timeEntrySummary.byProject.entries()).map(
                ([projectId, minutes]) => (
                  <div
                    key={projectId}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{renderProject(projectId)}</span>
                    <span style={{ fontSize: 12, color: '#475569' }}>
                      {minutes} 分
                    </span>
                    {!linkedProjectIds.includes(projectId) && (
                      <Button
                        variant="secondary"
                        onClick={() => addLinkedProject(projectId)}
                        disabled={isLocked && !isPrivileged}
                      >
                        関連案件に追加
                      </Button>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </Card>
        <Textarea
          label="日報本文（任意）"
          aria-label="日報本文"
          placeholder="日報本文（任意）"
          value={reportContent}
          onChange={(e) => setReportContent(e.target.value)}
          fullWidth
          rows={4}
          disabled={isLocked && !isPrivileged}
        />
        <Select
          label="関連案件（任意・複数選択可）"
          multiple
          value={linkedProjectIds}
          onChange={(e) =>
            setLinkedProjectIds(
              Array.from(e.target.selectedOptions).map((opt) => opt.value),
            )
          }
          fullWidth
          aria-label="関連案件"
          disabled={isLocked && !isPrivileged}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </Select>
        {projectMessage && <Alert variant="error">{projectMessage}</Alert>}
        {isLocked && isPrivileged && (
          <Input
            label="修正理由（管理者のみ）"
            aria-label="修正理由"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            fullWidth
          />
        )}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <span>今日のコンディション:</span>
        <Button
          variant={status === 'good' ? 'primary' : 'secondary'}
          onClick={() => setStatus('good')}
          aria-pressed={status === 'good'}
          disabled={isLocked && !isPrivileged}
        >
          Good
        </Button>
        <Button
          variant={status === 'not_good' ? 'primary' : 'secondary'}
          onClick={() => setStatus('not_good')}
          aria-pressed={status === 'not_good'}
          disabled={isLocked && !isPrivileged}
        >
          Not Good
        </Button>
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="outline" onClick={() => setShowHelp(true)}>
            ヘルプ / 相談したい
          </Button>
        </div>
      </div>
      {status === 'not_good' && (
        <div style={{ marginTop: 12 }}>
          <div>タグ（任意）</div>
          <div className="row">
            {tags.map((tag) => (
              <Button
                key={tag}
                variant={selectedTags.includes(tag) ? 'primary' : 'secondary'}
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.includes(tag)}
                disabled={isLocked && !isPrivileged}
              >
                {tag}
              </Button>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <Textarea
              label="メモ（空欄可）"
              placeholder="共有してもよければ、今日しんどかったことを書いてください（空欄可）"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
              rows={4}
              disabled={isLocked && !isPrivileged}
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
              disabled={isLocked && !isPrivileged}
            />
            相談したい（人事/相談窓口へ）
          </label>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button
          onClick={submit}
          loading={isSubmitting}
          disabled={isLocked && !isPrivileged}
        >
          送信
        </Button>
      </div>
      {message && (
        <div style={{ marginTop: 12 }}>
          <Toast
            variant={message.type}
            title={message.type === 'success' ? '完了' : 'エラー'}
            description={message.text}
            dismissible
            onClose={() => setMessage(null)}
          />
        </div>
      )}
      <p style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
        この入力は評価に使われません。職場環境の改善とサポートのためにのみ利用します。
      </p>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>編集履歴（選択日）</h3>
        <Button
          variant="secondary"
          onClick={() => loadRevisions()}
          loading={isRevisionLoading}
          disabled={!reportId}
        >
          編集履歴を読み込み
        </Button>
        {revisionMessage && (
          <p style={{ fontSize: 12, marginTop: 6 }}>{revisionMessage}</p>
        )}
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {!isRevisionLoaded && (
            <p style={{ fontSize: 12, color: '#6b7280' }}>
              履歴を読み込みボタンをクリックしてください
            </p>
          )}
          {isRevisionLoaded && revisionItems.length === 0 && (
            <EmptyState title="履歴はありません" />
          )}
          {revisionItems.map((rev) => {
            const linked = parseLinkedProjectIds(rev.linkedProjectIds);
            return (
              <Card key={rev.id} padding="small">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <strong>v{rev.version}</strong>
                  <span>{rev.createdAt.slice(0, 19).replace('T', ' ')}</span>
                  {rev.createdBy && <span>by {rev.createdBy}</span>}
                </div>
                {rev.reasonText && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    修正理由: {rev.reasonText}
                  </div>
                )}
                {rev.content && (
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    {rev.content}
                  </div>
                )}
                {linked.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
                    関連案件: {linked.map(renderProject).join(', ')}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <hr style={{ margin: '16px 0' }} />
      <h3 style={{ margin: '0 0 8px' }}>日報履歴</h3>
      {isPrivileged && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Input
            label="userId で絞り込み"
            value={historyUserId}
            onChange={(e) => setHistoryUserId(e.target.value)}
            placeholder="userId（空欄で全員: 最新50件）"
            aria-label="ユーザーIDで絞り込み"
            fullWidth
          />
          <Button
            variant="secondary"
            onClick={() => loadHistory()}
            loading={isHistoryLoading}
          >
            履歴を読み込み
          </Button>
        </div>
      )}
      {!isPrivileged && (
        <Button
          variant="secondary"
          onClick={() => loadHistory()}
          loading={isHistoryLoading}
        >
          履歴を読み込み
        </Button>
      )}
      {historyMessage && <p style={{ fontSize: 12 }}>{historyMessage}</p>}
      <div
        style={{ display: 'grid', gap: 8, marginTop: 8 }}
        data-e2e="daily-history-list"
      >
        {historyItems.length === 0 && (
          <EmptyState title="まだ日報はありません" />
        )}
        {historyItems.map((item) => {
          const linked = parseLinkedProjectIds(item.linkedProjectIds);
          return (
            <Card key={item.id} padding="small">
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
            </Card>
          );
        })}
      </div>
    </div>
  );
};
