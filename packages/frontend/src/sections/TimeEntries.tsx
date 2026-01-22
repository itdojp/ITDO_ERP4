import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';
import { useProjectTasks } from '../hooks/useProjectTasks';
import {
  clearDraft,
  getDraftOwnerId,
  loadDraft,
  saveDraft,
} from '../utils/drafts';
import { enqueueOfflineItem, isOfflineError } from '../utils/offlineQueue';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FilterBar,
  Input,
  Select,
  Skeleton,
  Spinner,
  Toast,
} from '../ui';

type TimeEntry = {
  id: string;
  projectId: string;
  workDate: string;
  minutes: number;
  status: string;
  workType?: string;
  location?: string;
  taskId?: string;
};
type TimeEntryView = {
  id: string;
  projectId: string;
  projectLabel: string;
  workDate: string;
  minutes: number;
  status: string;
  workType?: string;
  location?: string;
  searchText: string;
};
type FormState = {
  projectId: string;
  taskId: string;
  workDate: string;
  minutes: number;
  workType: string;
  location: string;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;
type ListStatus = 'idle' | 'loading' | 'error' | 'success';
type ColumnMeta = {
  width?: string;
  align?: React.CSSProperties['textAlign'];
};

const defaultForm: FormState = {
  projectId: 'demo-project',
  taskId: '',
  workDate: new Date().toISOString().slice(0, 10),
  minutes: 60,
  workType: '通常',
  location: 'office',
};

const FEATURE_TIMESHEET_GRID =
  (import.meta.env.VITE_FEATURE_TIMESHEET_GRID || '').trim() === '1';
const MOBILE_BREAKPOINT_PX = 768;

const formatMinutes = (minutes: number) => `${minutes}分`;

const formatWorkDate = (value: string) => value.slice(0, 10);

const normalizeSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const buildSearchText = (item: Omit<TimeEntryView, 'searchText'>) =>
  normalizeSearch(
    [
      item.workDate,
      item.projectLabel,
      item.status,
      item.workType,
      item.location,
      `${item.minutes}`,
    ]
      .filter(Boolean)
      .join(' '),
  );

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    if (media.addEventListener) {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [query]);

  return matches;
};

const EmptyListState: React.FC<{
  status: ListStatus;
  error?: string;
  onRetry: () => void;
}> = ({ status, error, onRetry }) => {
  if (status === 'loading') {
    return (
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: '24px 0',
        }}
      >
        <Spinner label="読み込み中" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <EmptyState
        title="工数一覧の取得に失敗しました"
        description={error || '通信環境を確認して再試行してください'}
        action={
          <Button variant="primary" onClick={onRetry}>
            再試行
          </Button>
        }
      />
    );
  }
  return <EmptyState title="工数がありません" />;
};

const LegacyTimeEntryList: React.FC<{
  items: TimeEntryView[];
  status: ListStatus;
  error?: string;
  onRetry: () => void;
}> = ({ items, status, error, onRetry }) => {
  if (status === 'loading' || status === 'error' || items.length === 0) {
    return (
      <Card padding="small">
        <EmptyListState status={status} error={error} onRetry={onRetry} />
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((entry) => (
        <Card key={entry.id} padding="small">
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span className="badge">{entry.status}</span>
            <span>{formatWorkDate(entry.workDate)}</span>
            <span>/ {entry.projectLabel}</span>
            <span>/ {formatMinutes(entry.minutes)}</span>
            {entry.workType && <span>/ {entry.workType}</span>}
            {entry.location && <span>/ {entry.location}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
};

const MobileTimeEntryList: React.FC<{
  items: TimeEntryView[];
  status: ListStatus;
  error?: string;
  onRetry: () => void;
}> = ({ items, status, error, onRetry }) => {
  if (status === 'loading' || status === 'error' || items.length === 0) {
    return (
      <Card padding="small">
        <EmptyListState status={status} error={error} onRetry={onRetry} />
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((entry) => (
        <Card key={entry.id} padding="small">
          <div style={{ display: 'grid', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <strong>{formatWorkDate(entry.workDate)}</strong>
              <span className="badge">{entry.status}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {entry.projectLabel}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span>{formatMinutes(entry.minutes)}</span>
              {entry.workType && <span>{entry.workType}</span>}
              {entry.location && <span>{entry.location}</span>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

const TimesheetGrid: React.FC<{
  items: TimeEntryView[];
  status: ListStatus;
  error?: string;
  onRetry: () => void;
}> = ({ items, status, error, onRetry }) => {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'workDate', desc: true },
  ]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const statusOptions = useMemo(() => {
    const unique = Array.from(new Set(items.map((item) => item.status))).filter(
      (value) => value && value !== 'all',
    );
    return unique;
  }, [items]);

  const filteredItems = useMemo(() => {
    let next = items;
    if (statusFilter !== 'all') {
      next = next.filter((item) => item.status === statusFilter);
    }
    const needle = normalizeSearch(search);
    if (needle) {
      next = next.filter((item) => item.searchText.includes(needle));
    }
    return next;
  }, [items, search, statusFilter]);

  const columns = useMemo<ColumnDef<TimeEntryView>[]>(
    () => [
      {
        accessorKey: 'workDate',
        header: '日付',
        cell: (info) => formatWorkDate(String(info.getValue())),
        sortingFn: (a, b) =>
          String(a.getValue('workDate')).localeCompare(
            String(b.getValue('workDate')),
          ),
        meta: { width: '120px' },
      },
      {
        accessorKey: 'projectLabel',
        header: '案件',
        cell: (info) => info.getValue(),
        meta: { width: 'minmax(220px, 1.6fr)' },
      },
      {
        accessorKey: 'minutes',
        header: '工数',
        cell: (info) => formatMinutes(Number(info.getValue())),
        sortingFn: 'basic',
        meta: { align: 'right', width: '100px' },
      },
      {
        accessorKey: 'status',
        header: '状態',
        cell: (info) => <span className="badge">{info.getValue() as string}</span>,
        meta: { width: '110px' },
      },
      {
        accessorKey: 'workType',
        header: '作業種別',
        cell: (info) => info.getValue() || '-',
        meta: { width: '160px' },
      },
      {
        accessorKey: 'location',
        header: '場所',
        cell: (info) => info.getValue() || '-',
        meta: { width: '140px' },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const VIRTUALIZED_ROW_HEIGHT_PX = 44;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => VIRTUALIZED_ROW_HEIGHT_PX,
    overscan: 8,
  });

  const columnTemplate = useMemo(() => {
    return table
      .getAllLeafColumns()
      .map((column) => {
        const meta = column.columnDef.meta as ColumnMeta | undefined;
        return meta?.width || 'minmax(120px, 1fr)';
      })
      .join(' ');
  }, [table]);

  const statusBanner =
    status === 'success' ? (
      <Alert variant="success">{`最新の工数を表示中（${items.length}件）`}</Alert>
    ) : status === 'error' ? (
      <Alert variant="error">
        {error || '工数一覧の取得に失敗しました'}
      </Alert>
    ) : null;

  if (status === 'loading') {
    return (
      <Card padding="small">
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton height={20} width="40%" />
          <Skeleton height={320} width="100%" />
        </div>
      </Card>
    );
  }

  if (status === 'error' || items.length === 0) {
    return (
      <Card padding="small">
        <EmptyListState status={status} error={error} onRetry={onRetry} />
      </Card>
    );
  }

  return (
    <Card padding="small">
      <div style={{ display: 'grid', gap: 12 }}>
        <FilterBar
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={onRetry}>
                再取得
              </Button>
            </div>
          }
        >
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="検索（案件名/メモ/状態 など）"
              aria-label="工数検索"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="状態フィルタ"
            >
              <option value="all">状態: 全て</option>
              {statusOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        {statusBanner}
        {filteredItems.length === 0 ? (
          <EmptyState
            title="該当する工数がありません"
            description="条件を変更してください"
            action={
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
              >
                条件をクリア
              </Button>
            }
          />
        ) : (
          <div
            style={{
              border: '1px solid var(--color-border-default)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              role="rowgroup"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                background: 'var(--color-neutral-50)',
                borderBottom: '1px solid var(--color-border-default)',
              }}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <div
                  key={headerGroup.id}
                  role="row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: columnTemplate,
                    gap: 0,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                    const canSort = header.column.getCanSort();
                    const sortState = header.column.getIsSorted();
                    return (
                      <div
                        key={header.id}
                        role="columnheader"
                        aria-sort={
                          sortState === 'asc'
                            ? 'ascending'
                            : sortState === 'desc'
                              ? 'descending'
                              : 'none'
                        }
                        style={{
                          textAlign: meta?.align || 'left',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          style={{
                            all: 'unset',
                            cursor: canSort ? 'pointer' : 'default',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sortState ? (
                            <span style={{ fontSize: 10 }}>
                              {sortState === 'asc' ? '▲' : '▼'}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div
              ref={parentRef}
              style={{
                height: 420,
                overflow: 'auto',
                position: 'relative',
              }}
            >
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const isEven = virtualRow.index % 2 === 0;
                  return (
                    <div
                      key={row.id}
                      role="row"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        display: 'grid',
                        gridTemplateColumns: columnTemplate,
                        gap: 0,
                        alignItems: 'center',
                        padding: '10px 12px',
                        background: isEven
                          ? 'var(--color-neutral-50)'
                          : 'var(--color-white)',
                        borderBottom: '1px solid var(--color-border-default)',
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                        return (
                          <div
                            key={cell.id}
                            role="cell"
                            style={{
                              textAlign: meta?.align || 'left',
                              fontSize: 13,
                              color: 'var(--color-text-primary)',
                            }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export const TimeEntries: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId || 'demo-user';
  const defaultProjectId = auth?.projectIds?.[0] || defaultForm.projectId;
  const draftOwnerId = getDraftOwnerId(auth?.userId);
  const [items, setItems] = useState<TimeEntry[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('idle');
  const [listError, setListError] = useState('');
  const [form, setForm] = useState<FormState>({
    ...defaultForm,
    projectId: defaultProjectId,
  });
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const draftKey = `time-entry:${draftOwnerId}`;
  const saveQueueRef = useRef(Promise.resolve());
  const handleProjectSelect = useCallback(
    (projectId: string) => {
      setForm((prev) => ({ ...prev, projectId }));
    },
    [setForm],
  );
  const { projects, projectMessage } = useProjects({
    selectedProjectId: form.projectId,
    onSelect: handleProjectSelect,
  });
  const {
    tasks,
    taskMessage,
    isLoading: tasksLoading,
  } = useProjectTasks({
    projectId: form.projectId,
  });
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const viewItems = useMemo<TimeEntryView[]>(
    () =>
      items.map((entry) => {
        const project = projectMap.get(entry.projectId);
        const projectLabel = project
          ? `${project.code} / ${project.name}`
          : entry.projectId;
        const base = { ...entry, projectLabel };
        return { ...base, searchText: buildSearchText(base) };
      }),
    [items, projectMap],
  );
  const [message, setMessage] = useState<MessageState>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const minutesValue = Number.isFinite(form.minutes) ? form.minutes : 0;
  const minutesError =
    minutesValue <= 0
      ? '工数は1分以上で入力してください'
      : minutesValue > 1440
        ? '工数は1440分以内で入力してください'
        : minutesValue % 15 !== 0
          ? '工数は15分単位で入力してください'
          : '';
  const baseValid = Boolean(form.projectId.trim()) && Boolean(form.workDate);
  const isValid = baseValid && !minutesError;
  const validationHint = !baseValid ? '案件と日付は必須です' : minutesError;

  const fetchItems = useCallback(async () => {
    setListStatus('loading');
    setListError('');
    try {
      const res = await api<{ items: TimeEntry[] }>('/time-entries');
      setItems(res.items);
      setListStatus('success');
    } catch {
      setListStatus('error');
      setListError('工数一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    loadDraft<FormState>(draftKey).then((draft) => {
      if (!draft) return;
      const { projectId, ...rest } = draft;
      setForm((prev) => ({ ...prev, ...rest }));
      setDraftProjectId(projectId ?? null);
    });
  }, [draftKey]);

  useEffect(() => {
    saveQueueRef.current = Promise.resolve();
  }, [draftKey]);

  useEffect(() => {
    if (!draftProjectId) return;
    setForm((prev) => ({ ...prev, projectId: draftProjectId }));
    setDraftProjectId(null);
  }, [draftProjectId]);

  useEffect(() => {
    if (!form.taskId) return;
    if (tasks.length === 0) return;
    const exists = tasks.some((task) => task.id === form.taskId);
    if (!exists) {
      setForm((prev) => ({ ...prev, taskId: '' }));
    }
  }, [form.taskId, tasks]);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = saveQueueRef.current.then(() => saveDraft(draftKey, form));
      saveQueueRef.current = next.catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [draftKey, form]);

  const add = async () => {
    if (!isValid) {
      setMessage(null);
      return;
    }
    const payload = {
      ...form,
      projectId: form.projectId.trim(),
      taskId: form.taskId.trim() || undefined,
      workType: form.workType.trim() || undefined,
      location: form.location.trim() || undefined,
      userId,
    };
    const request = {
      path: '/time-entries',
      method: 'POST',
      body: payload,
    };
    try {
      setIsSaving(true);
      await api(request.path, {
        method: request.method,
        body: JSON.stringify(request.body),
      });
      setMessage({ text: '保存しました', type: 'success' });
      await fetchItems();
      setForm({ ...defaultForm, projectId: defaultProjectId });
      await clearDraft(draftKey);
    } catch (e) {
      if (isOfflineError(e)) {
        await enqueueOfflineItem({
          kind: 'time-entry',
          label: `工数 ${form.workDate} ${form.minutes}分`,
          requests: [request],
        });
        setMessage({
          text: 'オフラインのため送信待ちに保存しました',
          type: 'success',
        });
        setForm({ ...defaultForm, projectId: defaultProjectId });
        await clearDraft(draftKey);
      } else {
        setMessage({ text: '保存に失敗しました', type: 'error' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <h2>工数入力</h2>
      <Card padding="small" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <Select
            label="案件"
            aria-label="案件選択"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            placeholder="案件を選択"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} / {project.name}
              </option>
            ))}
          </Select>
          <Select
            label="タスク"
            aria-label="タスク選択"
            value={form.taskId}
            onChange={(e) => setForm({ ...form, taskId: e.target.value })}
            disabled={!form.projectId || tasksLoading}
            placeholder="タスク未選択"
          >
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </Select>
          <Input
            label="日付"
            type="date"
            value={form.workDate}
            onChange={(e) => setForm({ ...form, workDate: e.target.value })}
          />
          <Input
            label="工数 (分)"
            type="number"
            min={1}
            max={1440}
            step={15}
            value={form.minutes}
            onChange={(e) =>
              setForm({ ...form, minutes: Number(e.target.value) })
            }
            error={minutesError || undefined}
          />
          <Input
            label="作業種別"
            type="text"
            value={form.workType}
            onChange={(e) => setForm({ ...form, workType: e.target.value })}
            placeholder="例: 通常"
          />
          <Input
            label="場所"
            type="text"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="例: office"
          />
          <Button
            onClick={add}
            disabled={!isValid || isSaving}
            loading={isSaving}
          >
            追加
          </Button>
        </div>
        {validationHint && (
          <div style={{ marginTop: 12 }}>
            <Alert variant="error">{validationHint}</Alert>
          </div>
        )}
        {projectMessage && (
          <div style={{ marginTop: 12 }}>
            <Alert variant="error">{projectMessage}</Alert>
          </div>
        )}
        {taskMessage && (
          <div style={{ marginTop: 12 }}>
            <Alert variant="error">{taskMessage}</Alert>
          </div>
        )}
      </Card>
      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>工数一覧</h3>
        {FEATURE_TIMESHEET_GRID ? (
          isMobile ? (
            <MobileTimeEntryList
              items={viewItems}
              status={listStatus}
              error={listError}
              onRetry={fetchItems}
            />
          ) : (
            <TimesheetGrid
              items={viewItems}
              status={listStatus}
              error={listError}
              onRetry={fetchItems}
            />
          )
        ) : (
          <LegacyTimeEntryList
            items={viewItems}
            status={listStatus}
            error={listError}
            onRetry={fetchItems}
          />
        )}
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
    </div>
  );
};
