import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  apiResponse,
  Dashboard,
  GlobalSearch,
  DailyReport,
  TimeEntries,
  ProjectTasks,
  Estimates,
  Invoices,
  Expenses,
  LeaveRequests,
  HRAnalytics,
  CurrentUser,
  Reports,
  AdminSettings,
  Approvals,
  RoomChat,
  ChatBreakGlass,
  MasterData,
  Projects,
  ProjectMilestones,
  VendorDocuments,
  AccessReviews,
  AuditLogs,
  PeriodLocks,
  AdminJobs,
  DocumentSendLogs,
  PdfFiles,
} = vi.hoisted(() => {
  const makeSectionMock = (testId: string, label: string) =>
    vi.fn(() => <div data-testid={testId}>{label}</div>);

  return {
    apiResponse: vi.fn(),
    Dashboard: makeSectionMock('section-dashboard', 'Dashboard'),
    GlobalSearch: makeSectionMock('section-global-search', 'GlobalSearch'),
    DailyReport: makeSectionMock('section-daily-report', 'DailyReport'),
    TimeEntries: makeSectionMock('section-time-entries', 'TimeEntries'),
    ProjectTasks: makeSectionMock('section-project-tasks', 'ProjectTasks'),
    Estimates: makeSectionMock('section-estimates', 'Estimates'),
    Invoices: makeSectionMock('section-invoices', 'Invoices'),
    Expenses: makeSectionMock('section-expenses', 'Expenses'),
    LeaveRequests: makeSectionMock('section-leave-requests', 'LeaveRequests'),
    HRAnalytics: makeSectionMock('section-hr-analytics', 'HRAnalytics'),
    CurrentUser: makeSectionMock('section-current-user', 'CurrentUser'),
    Reports: makeSectionMock('section-reports', 'Reports'),
    AdminSettings: makeSectionMock('section-admin-settings', 'AdminSettings'),
    Approvals: makeSectionMock('section-approvals', 'Approvals'),
    RoomChat: makeSectionMock('section-room-chat', 'RoomChat'),
    ChatBreakGlass: makeSectionMock(
      'section-chat-break-glass',
      'ChatBreakGlass',
    ),
    MasterData: makeSectionMock('section-master-data', 'MasterData'),
    Projects: makeSectionMock('section-projects', 'Projects'),
    ProjectMilestones: makeSectionMock(
      'section-project-milestones',
      'ProjectMilestones',
    ),
    VendorDocuments: makeSectionMock(
      'section-vendor-documents',
      'VendorDocuments',
    ),
    AccessReviews: makeSectionMock('section-access-reviews', 'AccessReviews'),
    AuditLogs: makeSectionMock('section-audit-logs', 'AuditLogs'),
    PeriodLocks: makeSectionMock('section-period-locks', 'PeriodLocks'),
    AdminJobs: makeSectionMock('section-admin-jobs', 'AdminJobs'),
    DocumentSendLogs: makeSectionMock(
      'section-document-send-logs',
      'DocumentSendLogs',
    ),
    PdfFiles: makeSectionMock('section-pdf-files', 'PdfFiles'),
  };
});

vi.mock('../api', () => ({
  apiResponse,
}));

vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandPalette: () => null,
  PageHeader: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
  SectionCard: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children: React.ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}));

vi.mock('../sections/Dashboard', () => ({ Dashboard }));
vi.mock('../sections/GlobalSearch', () => ({ GlobalSearch }));
vi.mock('../sections/DailyReport', () => ({ DailyReport }));
vi.mock('../sections/TimeEntries', () => ({ TimeEntries }));
vi.mock('../sections/ProjectTasks', () => ({ ProjectTasks }));
vi.mock('../sections/Estimates', () => ({ Estimates }));
vi.mock('../sections/Invoices', () => ({ Invoices }));
vi.mock('../sections/Expenses', () => ({ Expenses }));
vi.mock('../sections/LeaveRequests', () => ({ LeaveRequests }));
vi.mock('../sections/HRAnalytics', () => ({ HRAnalytics }));
vi.mock('../sections/CurrentUser', () => ({ CurrentUser }));
vi.mock('../sections/Reports', () => ({ Reports }));
vi.mock('../sections/AdminSettings', () => ({ AdminSettings }));
vi.mock('../sections/Approvals', () => ({ Approvals }));
vi.mock('../sections/RoomChat', () => ({ RoomChat }));
vi.mock('../sections/ChatBreakGlass', () => ({ ChatBreakGlass }));
vi.mock('../sections/MasterData', () => ({ MasterData }));
vi.mock('../sections/Projects', () => ({ Projects }));
vi.mock('../sections/ProjectMilestones', () => ({ ProjectMilestones }));
vi.mock('../sections/VendorDocuments', () => ({ VendorDocuments }));
vi.mock('../sections/AccessReviews', () => ({ AccessReviews }));
vi.mock('../sections/AuditLogs', () => ({ AuditLogs }));
vi.mock('../sections/PeriodLocks', () => ({ PeriodLocks }));
vi.mock('../sections/AdminJobs', () => ({ AdminJobs }));
vi.mock('../sections/DocumentSendLogs', () => ({ DocumentSendLogs }));
vi.mock('../sections/PdfFiles', () => ({ PdfFiles }));

import { App } from './App';

function makeJsonResponse(options: {
  ok?: boolean;
  status?: number;
  payload?: Record<string, unknown>;
}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => options.payload ?? {},
  } as Response;
}

function resetLocation() {
  window.history.replaceState(null, '', '/');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  resetLocation();
});

beforeEach(() => {
  window.localStorage.clear();
  resetLocation();
  vi.mocked(apiResponse).mockReset();
});

describe('App', () => {
  it('normalizes legacy saved section aliases before restoring the active section', async () => {
    window.localStorage.setItem('erp4_active_section', 'project-chat');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('チャット / ルームチャット')).toBeInTheDocument();
      expect(screen.getByTestId('section-room-chat')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('erp4_active_section')).toBe(
      'room-chat',
    );
  });

  it('falls back to the home section when the saved section is invalid', async () => {
    window.localStorage.setItem('erp4_active_section', 'not-a-real-section');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('ホーム / ホーム')).toBeInTheDocument();
      expect(screen.getByTestId('section-dashboard')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('erp4_active_section')).toBe('home');
  });

  it.each([
    [
      'dispatches project chat deep links to the project chat app event',
      '#/open?kind=project_chat&id=PJ-123',
      'erp4_open_project_chat',
      { projectId: 'PJ-123' },
    ],
    [
      'dispatches room chat deep links to the room chat app event',
      '#/open?kind=room_chat&id=ROOM-456',
      'erp4_open_room_chat',
      { roomId: 'ROOM-456' },
    ],
  ] as const)('%s', async (_label, hash, eventName, expectedDetail) => {
    const listener = vi.fn();
    window.addEventListener(eventName, listener as EventListener);
    window.location.hash = hash;

    try {
      render(<App />);

      await waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByTestId('section-room-chat')).toBeInTheDocument();
      expect(listener.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
      expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
        expectedDetail,
      );
    } finally {
      window.removeEventListener(eventName, listener as EventListener);
    }
  });

  it.each([
    [
      'dispatches project deep links to the projects section handler',
      '#/open?kind=project&id=PJ-789',
      'section-projects',
      { kind: 'project', id: 'PJ-789' },
    ],
    [
      'dispatches invoice deep links to the invoices section handler',
      '#/open?kind=invoice&id=INV-789',
      'section-invoices',
      { kind: 'invoice', id: 'INV-789' },
    ],
    [
      'dispatches estimate deep links to the estimates section handler',
      '#/open?kind=estimate&id=EST-789',
      'section-estimates',
      { kind: 'estimate', id: 'EST-789' },
    ],
    [
      'dispatches expense deep links to the expenses section handler',
      '#/open?kind=expense&id=EXP-789',
      'section-expenses',
      { kind: 'expense', id: 'EXP-789' },
    ],
    [
      'dispatches daily report deep links to the daily report section handler',
      '#/open?kind=daily_report&id=DR-2024-01-02',
      'section-daily-report',
      { kind: 'daily_report', id: 'DR-2024-01-02' },
    ],
    [
      'dispatches leave request deep links to the leave requests section handler',
      '#/open?kind=leave_request&id=LR-789',
      'section-leave-requests',
      { kind: 'leave_request', id: 'LR-789' },
    ],
    [
      'dispatches time entry deep links to the time entries section handler',
      '#/open?kind=time_entry&id=TE-789',
      'section-time-entries',
      { kind: 'time_entry', id: 'TE-789' },
    ],
    [
      'dispatches approvals deep links to the approvals section handler',
      '#/open?kind=approvals&id=APR-789',
      'section-approvals',
      { kind: 'approvals', id: 'APR-789' },
    ],
    [
      'dispatches customer deep links to the master data section handler',
      '#/open?kind=customer&id=CUST-789',
      'section-master-data',
      { kind: 'customer', id: 'CUST-789' },
    ],
    [
      'dispatches vendor deep links to the master data section handler',
      '#/open?kind=vendor&id=VEND-789',
      'section-master-data',
      { kind: 'vendor', id: 'VEND-789' },
    ],
    [
      'dispatches purchase order deep links to the vendor documents section handler',
      '#/open?kind=purchase_order&id=PO-789',
      'section-vendor-documents',
      { kind: 'purchase_order', id: 'PO-789' },
    ],
    [
      'dispatches vendor quote deep links to the vendor documents section handler',
      '#/open?kind=vendor_quote&id=VQ-789',
      'section-vendor-documents',
      { kind: 'vendor_quote', id: 'VQ-789' },
    ],
    [
      'dispatches vendor invoice deep links to the vendor documents section handler',
      '#/open?kind=vendor_invoice&id=VI-789',
      'section-vendor-documents',
      { kind: 'vendor_invoice', id: 'VI-789' },
    ],
  ] as const)('%s', async (_label, hash, sectionTestId, expectedDetail) => {
    const listener = vi.fn();
    window.addEventListener('erp4_open_entity', listener as EventListener);
    window.location.hash = hash;

    try {
      render(<App />);

      await waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByTestId(sectionTestId)).toBeInTheDocument();
      expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
        expectedDetail,
      );
    } finally {
      window.removeEventListener('erp4_open_entity', listener as EventListener);
    }
  });

  it('shows a warning for unsupported deep link kinds', async () => {
    window.location.hash = '#/open?kind=unsupported_kind&id=XYZ-1';

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'deep link の kind が未対応です: unsupported_kind',
      );
    });
  });

  it('shows an error when chat_message deep link resolution fails', async () => {
    vi.mocked(apiResponse).mockResolvedValue(
      makeJsonResponse({
        ok: false,
        status: 404,
        payload: { error: { code: 'NOT_FOUND' } },
      }),
    );
    window.location.hash = '#/open?kind=chat_message&id=MSG-404';

    render(<App />);

    await waitFor(() => {
      expect(apiResponse).toHaveBeenCalledWith('/chat-messages/MSG-404');
      expect(screen.getByRole('alert')).toHaveTextContent(
        '対象の発言が見つかりません',
      );
    });
  });
});
