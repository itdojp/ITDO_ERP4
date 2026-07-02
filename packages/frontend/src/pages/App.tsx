import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiResponse } from '../api';
import {
  Alert,
  Button,
  Card,
  CommandPalette,
  PageHeader,
  SectionCard,
} from '../ui';
import { CurrentUser } from '../sections/CurrentUser';
import { parseOpenHash, type DeepLinkOpenPayload } from '../utils/deepLink';

type SectionItem = {
  id: string;
  label: string;
  render: () => React.ReactNode;
};

type SectionGroup = {
  title: string;
  items: SectionItem[];
};

const ACTIVE_SECTION_KEY = 'erp4_active_section';
const LEGACY_SECTION_ALIASES: Record<string, string> = {
  'project-chat': 'room-chat',
};
const COMMAND_PALETTE_SEARCH_LABEL = 'コマンド検索';

const Dashboard = React.lazy(() =>
  import('../sections/Dashboard').then((module) => ({
    default: module.Dashboard,
  })),
);
const GlobalSearch = React.lazy(() =>
  import('../sections/GlobalSearch').then((module) => ({
    default: module.GlobalSearch,
  })),
);
const DailyReport = React.lazy(() =>
  import('../sections/DailyReport').then((module) => ({
    default: module.DailyReport,
  })),
);
const TimeEntries = React.lazy(() =>
  import('../sections/TimeEntries').then((module) => ({
    default: module.TimeEntries,
  })),
);
const ProjectTasks = React.lazy(() =>
  import('../sections/ProjectTasks').then((module) => ({
    default: module.ProjectTasks,
  })),
);
const Estimates = React.lazy(() =>
  import('../sections/Estimates').then((module) => ({
    default: module.Estimates,
  })),
);
const Invoices = React.lazy(() =>
  import('../sections/Invoices').then((module) => ({
    default: module.Invoices,
  })),
);
const Expenses = React.lazy(() =>
  import('../sections/Expenses').then((module) => ({
    default: module.Expenses,
  })),
);
const LeaveRequests = React.lazy(() =>
  import('../sections/LeaveRequests').then((module) => ({
    default: module.LeaveRequests,
  })),
);
const HRAnalytics = React.lazy(() =>
  import('../sections/HRAnalytics').then((module) => ({
    default: module.HRAnalytics,
  })),
);
const Reports = React.lazy(() =>
  import('../sections/Reports').then((module) => ({
    default: module.Reports,
  })),
);
const AdminSettings = React.lazy(() =>
  import('../sections/AdminSettings').then((module) => ({
    default: module.AdminSettings,
  })),
);
const Approvals = React.lazy(() =>
  import('../sections/Approvals').then((module) => ({
    default: module.Approvals,
  })),
);
const RoomChat = React.lazy(() =>
  import('../sections/RoomChat').then((module) => ({
    default: module.RoomChat,
  })),
);
const ChatBreakGlass = React.lazy(() =>
  import('../sections/ChatBreakGlass').then((module) => ({
    default: module.ChatBreakGlass,
  })),
);
const MasterData = React.lazy(() =>
  import('../sections/MasterData').then((module) => ({
    default: module.MasterData,
  })),
);
const Projects = React.lazy(() =>
  import('../sections/Projects').then((module) => ({
    default: module.Projects,
  })),
);
const ProjectMilestones = React.lazy(() =>
  import('../sections/ProjectMilestones').then((module) => ({
    default: module.ProjectMilestones,
  })),
);
const VendorDocuments = React.lazy(() =>
  import('../sections/VendorDocuments').then((module) => ({
    default: module.VendorDocuments,
  })),
);
const AccessReviews = React.lazy(() =>
  import('../sections/AccessReviews').then((module) => ({
    default: module.AccessReviews,
  })),
);
const AuditLogs = React.lazy(() =>
  import('../sections/AuditLogs').then((module) => ({
    default: module.AuditLogs,
  })),
);
const PeriodLocks = React.lazy(() =>
  import('../sections/PeriodLocks').then((module) => ({
    default: module.PeriodLocks,
  })),
);
const AdminJobs = React.lazy(() =>
  import('../sections/AdminJobs').then((module) => ({
    default: module.AdminJobs,
  })),
);
const DocumentSendLogs = React.lazy(() =>
  import('../sections/DocumentSendLogs').then((module) => ({
    default: module.DocumentSendLogs,
  })),
);
const PdfFiles = React.lazy(() =>
  import('../sections/PdfFiles').then((module) => ({
    default: module.PdfFiles,
  })),
);

function SectionLoadingFallback({ label }: { label: string }) {
  return (
    <Card>
      <div role="status" aria-live="polite">
        {`${label}を読み込んでいます…`}
      </div>
    </Card>
  );
}

function SectionReadyMarker({
  sectionLoadKey,
  onReady,
  children,
}: {
  sectionLoadKey: string;
  onReady: (sectionLoadKey: string) => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    onReady(sectionLoadKey);
  }, [onReady, sectionLoadKey]);

  return <>{children}</>;
}

type SectionLoadErrorBoundaryProps = {
  sectionId: string;
  sectionLabel: string;
  children: React.ReactNode;
};

type SectionLoadErrorBoundaryState = {
  hasError: boolean;
};

class SectionLoadErrorBoundary extends React.Component<
  SectionLoadErrorBoundaryProps,
  SectionLoadErrorBoundaryState
> {
  state: SectionLoadErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SectionLoadErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Alert variant="warning">
          {`${this.props.sectionLabel}の読み込みに失敗しました。ページを再読み込みしてから再度開いてください。`}
        </Alert>
      );
    }

    return this.props.children;
  }
}

function normalizeSectionId(sectionId: string) {
  return LEGACY_SECTION_ALIASES[sectionId] || sectionId;
}

type DeepLinkResolvedTarget = {
  sectionId: string;
  payload: DeepLinkOpenPayload;
  chatMessage?: {
    roomId: string;
    roomType: string;
    projectId?: string | null;
    createdAt: string;
    excerpt?: string;
  };
};

function resolveDeepLinkTarget(
  payload: DeepLinkOpenPayload,
): DeepLinkResolvedTarget | null {
  switch (payload.kind) {
    case 'project_chat':
      return { sectionId: 'room-chat', payload };
    case 'room_chat':
      return { sectionId: 'room-chat', payload };
    case 'chat_message':
      return null;
    case 'document_send_log':
      return { sectionId: 'document-send-logs', payload };
    case 'audit_logs':
      return { sectionId: 'audit-logs', payload };
    case 'invoice':
      return { sectionId: 'invoices', payload };
    case 'estimate':
      return { sectionId: 'estimates', payload };
    case 'expense':
      return { sectionId: 'expenses', payload };
    case 'purchase_order':
    case 'vendor_quote':
    case 'vendor_invoice':
      return { sectionId: 'vendor-documents', payload };
    case 'approvals':
      return { sectionId: 'approvals', payload };
    case 'project':
      return { sectionId: 'projects', payload };
    case 'time_entry':
      return { sectionId: 'time-entries', payload };
    case 'daily_report':
      return { sectionId: 'daily-report', payload };
    case 'leave_request':
      return { sectionId: 'leave-requests', payload };
    case 'customer':
    case 'vendor':
      return { sectionId: 'master-data', payload };
    default:
      return null;
  }
}

type ApiErrorPayload = {
  error?: { code?: unknown; message?: unknown };
};

function buildChatMessageDeepLinkError(params: {
  status: number;
  payload?: ApiErrorPayload;
}) {
  const code = params.payload?.error?.code;
  if (typeof code === 'string') {
    switch (code) {
      case 'FORBIDDEN_PROJECT':
        return 'アクセス不可: 案件スコープ外です';
      case 'FORBIDDEN_ROOM_MEMBER':
        return 'アクセス不可: ルームのメンバーではありません';
      case 'FORBIDDEN_EXTERNAL_ROOM':
        return 'アクセス不可: 外部ユーザはこのルームを参照できません';
      case 'NOT_FOUND':
        return '対象の発言が見つかりません';
      case 'MISSING_USER_ID':
        return '認証情報が不足しています（userId）';
      default:
        break;
    }
  }
  if (params.status === 404) return '対象の発言が見つかりません';
  if (params.status === 403) return 'アクセス不可: 権限がありません';
  return 'chat_message の deep link 解決に失敗しました';
}

export const App: React.FC = () => {
  const mainContentRef = useRef<HTMLElement>(null);
  const sectionGroups = useMemo<SectionGroup[]>(
    () => [
      {
        title: 'ホーム',
        items: [
          {
            id: 'home',
            label: 'ホーム',
            render: () => (
              <div style={{ display: 'grid', gap: 12 }}>
                <Card>
                  <Dashboard />
                </Card>
                <Card>
                  <GlobalSearch />
                </Card>
              </div>
            ),
          },
        ],
      },
      {
        title: '日次',
        items: [
          {
            id: 'daily-report',
            label: '日報 + ウェルビーイング',
            render: () => (
              <Card>
                <DailyReport />
              </Card>
            ),
          },
          {
            id: 'time-entries',
            label: '工数入力',
            render: () => (
              <Card>
                <TimeEntries />
              </Card>
            ),
          },
        ],
      },
      {
        title: '案件',
        items: [
          {
            id: 'projects',
            label: '案件',
            render: () => (
              <Card>
                <Projects />
              </Card>
            ),
          },
          {
            id: 'project-tasks',
            label: 'タスク',
            render: () => (
              <Card>
                <ProjectTasks />
              </Card>
            ),
          },
          {
            id: 'project-milestones',
            label: 'マイルストーン',
            render: () => (
              <Card>
                <ProjectMilestones />
              </Card>
            ),
          },
        ],
      },
      {
        title: '請求・仕入',
        items: [
          {
            id: 'estimates',
            label: '見積',
            render: () => (
              <Card>
                <Estimates />
              </Card>
            ),
          },
          {
            id: 'invoices',
            label: '請求',
            render: () => (
              <Card>
                <Invoices />
              </Card>
            ),
          },
          {
            id: 'vendor-documents',
            label: '仕入/発注',
            render: () => (
              <Card>
                <VendorDocuments />
              </Card>
            ),
          },
        ],
      },
      {
        title: '精算・申請',
        items: [
          {
            id: 'expenses',
            label: '経費精算',
            render: () => (
              <Card>
                <Expenses />
              </Card>
            ),
          },
          {
            id: 'leave-requests',
            label: '休暇申請',
            render: () => (
              <Card>
                <LeaveRequests />
              </Card>
            ),
          },
          {
            id: 'approvals',
            label: '承認',
            render: () => (
              <Card>
                <Approvals />
              </Card>
            ),
          },
        ],
      },
      {
        title: 'チャット',
        items: [
          {
            id: 'room-chat',
            label: 'ルームチャット',
            render: () => (
              <Card>
                <RoomChat />
              </Card>
            ),
          },
          {
            id: 'chat-break-glass',
            label: '監査閲覧',
            render: () => (
              <Card>
                <ChatBreakGlass />
              </Card>
            ),
          },
        ],
      },
      {
        title: 'レポート・分析',
        items: [
          {
            id: 'reports',
            label: 'レポート',
            render: () => (
              <Card>
                <Reports />
              </Card>
            ),
          },
          {
            id: 'hr-analytics',
            label: 'HR分析',
            render: () => (
              <Card>
                <HRAnalytics />
              </Card>
            ),
          },
        ],
      },
      {
        title: '管理',
        items: [
          {
            id: 'master-data',
            label: 'マスタ管理',
            render: () => (
              <Card>
                <MasterData />
              </Card>
            ),
          },
          {
            id: 'admin-settings',
            label: '設定',
            render: () => (
              <Card>
                <AdminSettings />
              </Card>
            ),
          },
          {
            id: 'admin-jobs',
            label: 'ジョブ管理',
            render: () => (
              <Card>
                <AdminJobs />
              </Card>
            ),
          },
          {
            id: 'document-send-logs',
            label: '送信ログ',
            render: () => (
              <Card>
                <DocumentSendLogs />
              </Card>
            ),
          },
          {
            id: 'pdf-files',
            label: 'PDF管理',
            render: () => (
              <Card>
                <PdfFiles />
              </Card>
            ),
          },
          {
            id: 'access-reviews',
            label: 'アクセスレビュー',
            render: () => (
              <Card>
                <AccessReviews />
              </Card>
            ),
          },
          {
            id: 'audit-logs',
            label: '監査ログ',
            render: () => (
              <Card>
                <AuditLogs />
              </Card>
            ),
          },
          {
            id: 'period-locks',
            label: '期間締め',
            render: () => (
              <Card>
                <PeriodLocks />
              </Card>
            ),
          },
        ],
      },
    ],
    [],
  );
  const sections = useMemo(
    () => sectionGroups.flatMap((group) => group.items),
    [sectionGroups],
  );
  const fallbackSectionId = sections[0]?.id || 'home';
  const [activeSectionState, setActiveSectionState] = useState(() => {
    if (typeof window === 'undefined') {
      return { id: fallbackSectionId, loadSeq: 0 };
    }
    const storedId = window.localStorage.getItem(ACTIVE_SECTION_KEY);
    if (!storedId) return { id: fallbackSectionId, loadSeq: 0 };
    const normalizedStoredId = normalizeSectionId(storedId);
    const isValid = sections.some(
      (section) => section.id === normalizedStoredId,
    );
    return {
      id: isValid ? normalizedStoredId : fallbackSectionId,
      loadSeq: 0,
    };
  });
  const activeSectionId = activeSectionState.id;
  const activeSectionLoadKey = `${activeSectionState.id}:${activeSectionState.loadSeq}`;
  const [pendingDeepLink, setPendingDeepLink] =
    useState<DeepLinkResolvedTarget | null>(null);
  const [deepLinkError, setDeepLinkError] = useState<string>('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [mainFocusRequestCount, setMainFocusRequestCount] = useState(0);
  const [pendingGlobalSearchFocus, setPendingGlobalSearchFocus] =
    useState(false);
  const [activeSectionReadyKey, setActiveSectionReadyKey] = useState<
    string | null
  >(null);

  const prepareActiveSectionChange = useCallback((sectionId: string) => {
    const normalizedSectionId = normalizeSectionId(sectionId);
    setActiveSectionState((current) => {
      if (current.id === normalizedSectionId) return current;
      return {
        id: normalizedSectionId,
        loadSeq: current.loadSeq + 1,
      };
    });
  }, []);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    if (typeof document === 'undefined') return;

    const handle = window.setTimeout(() => {
      const commandSearch = document.querySelector<HTMLInputElement>(
        '.itdo-command-palette__input[role="combobox"]',
      );
      commandSearch?.setAttribute('aria-label', COMMAND_PALETTE_SEARCH_LABEL);
    }, 0);

    return () => window.clearTimeout(handle);
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!activeSectionId) return;
    window.localStorage.setItem(ACTIVE_SECTION_KEY, activeSectionId);
  }, [activeSectionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let requestSeq = 0;
    const handle = () => {
      requestSeq += 1;
      const currentSeq = requestSeq;
      const parsed = parseOpenHash(window.location.hash);
      if (!parsed) {
        setDeepLinkError('');
        setPendingDeepLink(null);
        return;
      }

      if (parsed.kind === 'chat_message') {
        setDeepLinkError('');
        setPendingDeepLink(null);
        const messageId = parsed.id;
        const run = async () => {
          const res = await apiResponse(`/chat-messages/${messageId}`);
          const payload = (await res
            .json()
            .catch(() => ({}))) as ApiErrorPayload & {
            roomId?: unknown;
            createdAt?: unknown;
            excerpt?: unknown;
            room?: { id?: unknown; type?: unknown; projectId?: unknown };
          };
          if (currentSeq !== requestSeq) return;
          if (!res.ok) {
            setDeepLinkError(
              buildChatMessageDeepLinkError({ status: res.status, payload }),
            );
            return;
          }

          const roomId =
            typeof payload.roomId === 'string'
              ? payload.roomId
              : typeof payload.room?.id === 'string'
                ? payload.room.id
                : '';
          const createdAt =
            typeof payload.createdAt === 'string' ? payload.createdAt : '';
          const roomType =
            typeof payload.room?.type === 'string' ? payload.room.type : '';
          const projectId =
            typeof payload.room?.projectId === 'string'
              ? payload.room.projectId
              : null;
          if (!roomId || !createdAt || !roomType) {
            setDeepLinkError('chat_message の deep link 解決に失敗しました');
            return;
          }

          const sectionId = 'room-chat';

          setPendingDeepLink({
            sectionId,
            payload: { kind: parsed.kind, id: parsed.id },
            chatMessage: {
              roomId,
              roomType,
              projectId,
              createdAt,
              excerpt:
                typeof payload.excerpt === 'string' ? payload.excerpt : '',
            },
          });
          prepareActiveSectionChange(sectionId);
        };
        run().catch((error) => {
          console.error('chat_message deeplink resolve failed', error);
          if (currentSeq !== requestSeq) return;
          setDeepLinkError('chat_message の deep link 解決に失敗しました');
        });
        return;
      }

      const resolved = resolveDeepLinkTarget(parsed);
      if (!resolved) {
        setDeepLinkError(`deep link の kind が未対応です: ${parsed.kind}`);
        setPendingDeepLink(null);
        return;
      }
      setDeepLinkError('');
      setPendingDeepLink(resolved);
      prepareActiveSectionChange(resolved.sectionId);
    };
    handle();
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [prepareActiveSectionChange]);

  useEffect(() => {
    if (!pendingGlobalSearchFocus) return;
    if (activeSectionId !== 'home') return;
    if (activeSectionReadyKey !== activeSectionLoadKey) return;
    if (typeof window === 'undefined') return;

    const handle = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('erp4_global_search_focus'));
      setPendingGlobalSearchFocus(false);
    }, 0);

    return () => window.clearTimeout(handle);
  }, [
    activeSectionId,
    activeSectionLoadKey,
    activeSectionReadyKey,
    pendingGlobalSearchFocus,
  ]);

  useEffect(() => {
    if (!pendingDeepLink) return;
    if (activeSectionId !== pendingDeepLink.sectionId) return;
    if (activeSectionReadyKey !== activeSectionLoadKey) return;

    const { kind, id } = pendingDeepLink.payload;
    if (kind === 'project_chat') {
      window.dispatchEvent(
        new CustomEvent('erp4_open_project_chat', {
          detail: { projectId: id },
        }),
      );
    } else if (kind === 'room_chat') {
      window.dispatchEvent(
        new CustomEvent('erp4_open_room_chat', { detail: { roomId: id } }),
      );
    } else if (kind === 'chat_message' && pendingDeepLink.chatMessage) {
      const chatMessage = pendingDeepLink.chatMessage;
      window.dispatchEvent(
        new CustomEvent('erp4_open_room_chat', {
          detail: { roomId: chatMessage.roomId },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('erp4_open_chat_message', {
          detail: {
            messageId: id,
            roomId: chatMessage.roomId,
            roomType: chatMessage.roomType,
            projectId: chatMessage.projectId,
            createdAt: chatMessage.createdAt,
            excerpt: chatMessage.excerpt,
          },
        }),
      );
    } else if (kind === 'document_send_log') {
      window.dispatchEvent(
        new CustomEvent('erp4_open_document_send_log', {
          detail: { sendLogId: id },
        }),
      );
    } else if (kind === 'audit_logs') {
      window.dispatchEvent(
        new CustomEvent('erp4_open_audit_logs', {
          detail: { sendLogId: id },
        }),
      );
    } else {
      // Fallback: allow section-level handlers to implement deep link opening later.
      window.dispatchEvent(
        new CustomEvent('erp4_open_entity', { detail: { kind, id } }),
      );
    }
    setPendingDeepLink(null);
    // 1回限りの「open」アクションとして扱い、リロード時の再実行を避ける。
    if (typeof window !== 'undefined') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  }, [
    activeSectionId,
    activeSectionLoadKey,
    activeSectionReadyKey,
    pendingDeepLink,
  ]);

  const activeSection =
    sections.find((section) => section.id === activeSectionId) || sections[0];
  const activeSectionGroup =
    sectionGroups.find((group) =>
      group.items.some((item) => item.id === activeSection?.id),
    ) || null;
  const sectionGroupLabelBySectionId = useMemo(
    () =>
      new Map(
        sectionGroups.flatMap((group) =>
          group.items.map((item) => [item.id, group.title] as const),
        ),
      ),
    [sectionGroups],
  );

  useEffect(() => {
    if (mainFocusRequestCount === 0) return;
    if (typeof window === 'undefined') return;

    const handle = window.setTimeout(() => {
      mainContentRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(handle);
  }, [mainFocusRequestCount]);

  const activateSection = useCallback(
    (
      sectionId: string,
      options: { focusMain?: boolean } = { focusMain: true },
    ) => {
      const normalizedSectionId = normalizeSectionId(sectionId);
      setDeepLinkError('');
      setPendingDeepLink(null);
      prepareActiveSectionChange(normalizedSectionId);
      if (options.focusMain ?? true) {
        setMainFocusRequestCount((current) => current + 1);
      }
      if (
        typeof window !== 'undefined' &&
        window.location.hash.startsWith('#/open')
      ) {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
      }
    },
    [prepareActiveSectionChange],
  );

  const handleSectionReady = useCallback((sectionLoadKey: string) => {
    setActiveSectionReadyKey(sectionLoadKey);
  }, []);

  const commandActions = useMemo(
    () => [
      {
        id: 'action-refresh-current',
        label: '再取得: アプリを再読み込み',
        group: '主要操作',
        description: '現在表示中の画面状態を初期化して再読み込みします',
        keywords: ['再取得', 'refresh', 'reload'],
        onSelect: () => {
          if (typeof window === 'undefined') return;
          window.location.reload();
        },
      },
      {
        id: 'action-search-global',
        label: '検索: グローバル検索を開く',
        group: '主要操作',
        description:
          'ホームの検索（ERP横断）に移動して入力欄へフォーカスします',
        keywords: ['検索', 'search', 'global'],
        onSelect: () => {
          setPendingGlobalSearchFocus(true);
          activateSection('home', { focusMain: false });
        },
      },
      {
        id: 'action-create-project',
        label: '作成: 案件を開く',
        group: '主要操作',
        description: '案件画面に移動し、新規作成導線へ入ります',
        keywords: ['作成', 'create', 'project', '案件'],
        onSelect: () => activateSection('projects'),
      },
      {
        id: 'action-create-estimate',
        label: '作成: 見積を開く',
        group: '主要操作',
        description: '見積画面に移動し、新規作成導線へ入ります',
        keywords: ['作成', 'create', 'estimate', '見積'],
        onSelect: () => activateSection('estimates'),
      },
      {
        id: 'action-create-invoice',
        label: '作成: 請求を開く',
        group: '主要操作',
        description: '請求画面に移動し、新規作成導線へ入ります',
        keywords: ['作成', 'create', 'invoice', '請求'],
        onSelect: () => activateSection('invoices'),
      },
      {
        id: 'action-create-vendor-docs',
        label: '作成: 仕入/発注を開く',
        group: '主要操作',
        description: '仕入/発注画面に移動し、登録フォームへアクセスします',
        keywords: ['作成', 'create', 'purchase', 'vendor', '仕入', '発注'],
        onSelect: () => activateSection('vendor-documents'),
      },
      ...sections.map((section) => ({
        id: `goto-${section.id}`,
        label: `移動: ${section.label}`,
        group: '画面遷移',
        description: `遷移先: ${sectionGroupLabelBySectionId.get(section.id) || '未分類'}`,
        keywords: [section.id, section.label],
        onSelect: () => activateSection(section.id),
      })),
    ],
    [activateSection, sectionGroupLabelBySectionId, sections],
  );

  return (
    <div className="container">
      <a className="skip-link" href="#erp4-main-content">
        メインコンテンツへ移動
      </a>
      <PageHeader
        title="ERP4 MVP PoC"
        description={
          activeSection
            ? activeSectionGroup
              ? `${activeSectionGroup.title} / ${activeSection.label}`
              : activeSection.label
            : undefined
        }
      />
      <CurrentUser />
      {deepLinkError && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="warning">{deepLinkError}</Alert>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div
          style={{ minWidth: 220, flex: '0 0 220px', alignSelf: 'flex-start' }}
        >
          <SectionCard title="メニュー" density="compact">
            <nav aria-label="主要メニュー">
              <div style={{ display: 'grid', gap: 12 }}>
                <Button
                  size="small"
                  fullWidth
                  variant="secondary"
                  aria-keyshortcuts="Control+K Meta+K"
                  onClick={() => setIsCommandPaletteOpen(true)}
                >
                  コマンドを開く (Ctrl/Cmd + K)
                </Button>
                {sectionGroups.map((group, groupIndex) => {
                  const groupHeadingId = `erp4-menu-group-${groupIndex}`;
                  return (
                    <div
                      key={group.title}
                      role="group"
                      aria-labelledby={groupHeadingId}
                      style={{ display: 'grid', gap: 6 }}
                    >
                      <div
                        id={groupHeadingId}
                        style={{
                          fontSize: 12,
                          color: '#64748b',
                          margin: 0,
                          fontWeight: 700,
                        }}
                      >
                        {group.title}
                      </div>
                      {group.items.map((item) => (
                        <Button
                          key={item.id}
                          size="small"
                          fullWidth
                          aria-current={
                            item.id === activeSection?.id ? 'page' : undefined
                          }
                          variant={
                            item.id === activeSection?.id ? 'primary' : 'ghost'
                          }
                          onClick={() => activateSection(item.id)}
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </nav>
          </SectionCard>
        </div>
        <main
          className="erp4-main"
          id="erp4-main-content"
          ref={mainContentRef}
          tabIndex={-1}
          aria-label={
            activeSection
              ? `${activeSectionGroup?.title ?? '未分類'} / ${activeSection.label}`
              : '主要コンテンツ'
          }
          style={{ flex: '1 1 720px', minWidth: 280 }}
        >
          {activeSection ? (
            <SectionCard
              title={activeSection.label}
              description={activeSectionGroup?.title}
            >
              <SectionLoadErrorBoundary
                key={activeSection.id}
                sectionId={activeSection.id}
                sectionLabel={activeSection.label}
              >
                <React.Suspense
                  fallback={
                    <SectionLoadingFallback label={activeSection.label} />
                  }
                >
                  <SectionReadyMarker
                    sectionLoadKey={activeSectionLoadKey}
                    onReady={handleSectionReady}
                  >
                    {activeSection.render()}
                  </SectionReadyMarker>
                </React.Suspense>
              </SectionLoadErrorBoundary>
            </SectionCard>
          ) : null}
        </main>
      </div>
      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        actions={commandActions}
        title="ERP4 コマンドパレット"
        placeholder="コマンド・画面名・キーワードで検索"
        ariaLabel="コマンド候補"
        emptyMessage="該当するコマンドがありません"
      />
    </div>
  );
};
