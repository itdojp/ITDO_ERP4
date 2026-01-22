import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card } from '../ui';
import { Dashboard } from '../sections/Dashboard';
import { GlobalSearch } from '../sections/GlobalSearch';
import { DailyReport } from '../sections/DailyReport';
import { TimeEntries } from '../sections/TimeEntries';
import { ProjectTasks } from '../sections/ProjectTasks';
import { Estimates } from '../sections/Estimates';
import { Invoices } from '../sections/Invoices';
import { Expenses } from '../sections/Expenses';
import { LeaveRequests } from '../sections/LeaveRequests';
import { HRAnalytics } from '../sections/HRAnalytics';
import { CurrentUser } from '../sections/CurrentUser';
import { Reports } from '../sections/Reports';
import { AdminSettings } from '../sections/AdminSettings';
import { Approvals } from '../sections/Approvals';
import { ProjectChat } from '../sections/ProjectChat';
import { RoomChat } from '../sections/RoomChat';
import { ChatBreakGlass } from '../sections/ChatBreakGlass';
import { MasterData } from '../sections/MasterData';
import { Projects } from '../sections/Projects';
import { ProjectMilestones } from '../sections/ProjectMilestones';
import { VendorDocuments } from '../sections/VendorDocuments';
import { AccessReviews } from '../sections/AccessReviews';
import { AuditLogs } from '../sections/AuditLogs';
import { PeriodLocks } from '../sections/PeriodLocks';
import { AdminJobs } from '../sections/AdminJobs';
import { DocumentSendLogs } from '../sections/DocumentSendLogs';
import { PdfFiles } from '../sections/PdfFiles';

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

export const App: React.FC = () => {
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
            id: 'project-chat',
            label: 'プロジェクトチャット',
            render: () => (
              <Card>
                <ProjectChat />
              </Card>
            ),
          },
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
  const [activeSectionId, setActiveSectionId] = useState(() => {
    if (typeof window === 'undefined') return fallbackSectionId;
    const storedId = window.localStorage.getItem(ACTIVE_SECTION_KEY);
    if (!storedId) return fallbackSectionId;
    const isValid = sections.some((section) => section.id === storedId);
    return isValid ? storedId : fallbackSectionId;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!activeSectionId) return;
    window.localStorage.setItem(ACTIVE_SECTION_KEY, activeSectionId);
  }, [activeSectionId]);

  const activeSection =
    sections.find((section) => section.id === activeSectionId) || sections[0];

  return (
    <div className="container">
      <h1>ERP4 MVP PoC</h1>
      <CurrentUser />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card
          padding="small"
          style={{ minWidth: 220, flex: '0 0 220px', alignSelf: 'flex-start' }}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            {sectionGroups.map((group) => (
              <div key={group.title} style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {group.title}
                </div>
                {group.items.map((item) => (
                  <Button
                    key={item.id}
                    size="small"
                    fullWidth
                    variant={
                      item.id === activeSection?.id ? 'primary' : 'ghost'
                    }
                    onClick={() => setActiveSectionId(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Card>
        <main style={{ flex: '1 1 720px', minWidth: 280 }}>
          {activeSection ? activeSection.render() : null}
        </main>
      </div>
    </div>
  );
};
