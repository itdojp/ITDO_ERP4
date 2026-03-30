/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse } = vi.hoisted(() => ({
  apiResponse: vi.fn(),
}));

vi.mock('../api', () => ({ apiResponse }));

vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandPalette: ({
    open,
    actions,
  }: {
    open: boolean;
    actions: Array<{ id: string; label: string; onSelect: () => void }>;
  }) =>
    open ? (
      <div data-testid="command-palette">
        {actions.map((action) => (
          <button key={action.id} type="button" onClick={action.onSelect}>
            {action.label}
          </button>
        ))}
      </div>
    ) : null,
  PageHeader: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <div>{description}</div> : null}
    </header>
  ),
  SectionCard: ({
    title,
    description,
    children,
  }: {
    title?: string;
    description?: string;
    children: React.ReactNode;
  }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {description ? <div>{description}</div> : null}
      {children}
    </section>
  ),
}));

vi.mock('../sections/Dashboard', () => ({
  Dashboard: () => <div data-testid="dashboard-section">Dashboard section</div>,
}));
vi.mock('../sections/GlobalSearch', () => ({
  GlobalSearch: () => (
    <div data-testid="global-search-section">GlobalSearch section</div>
  ),
}));
vi.mock('../sections/DailyReport', () => ({
  DailyReport: () => (
    <div data-testid="daily-report-section">DailyReport section</div>
  ),
}));
vi.mock('../sections/TimeEntries', () => ({
  TimeEntries: () => (
    <div data-testid="time-entries-section">TimeEntries section</div>
  ),
}));
vi.mock('../sections/ProjectTasks', () => ({
  ProjectTasks: () => (
    <div data-testid="project-tasks-section">ProjectTasks section</div>
  ),
}));
vi.mock('../sections/Estimates', () => ({
  Estimates: () => <div data-testid="estimates-section">Estimates section</div>,
}));
vi.mock('../sections/Invoices', () => ({
  Invoices: () => <div data-testid="invoices-section">Invoices section</div>,
}));
vi.mock('../sections/Expenses', () => ({
  Expenses: () => <div data-testid="expenses-section">Expenses section</div>,
}));
vi.mock('../sections/LeaveRequests', () => ({
  LeaveRequests: () => (
    <div data-testid="leave-requests-section">LeaveRequests section</div>
  ),
}));
vi.mock('../sections/HRAnalytics', () => ({
  HRAnalytics: () => (
    <div data-testid="hr-analytics-section">HRAnalytics section</div>
  ),
}));
vi.mock('../sections/CurrentUser', () => ({
  CurrentUser: () => (
    <div data-testid="current-user-section">CurrentUser section</div>
  ),
}));
vi.mock('../sections/Reports', () => ({
  Reports: () => <div data-testid="reports-section">Reports section</div>,
}));
vi.mock('../sections/AdminSettings', () => ({
  AdminSettings: () => (
    <div data-testid="admin-settings-section">AdminSettings section</div>
  ),
}));
vi.mock('../sections/Approvals', () => ({
  Approvals: () => <div data-testid="approvals-section">Approvals section</div>,
}));
vi.mock('../sections/RoomChat', () => ({
  RoomChat: () => <div data-testid="room-chat-section">RoomChat section</div>,
}));
vi.mock('../sections/ChatBreakGlass', () => ({
  ChatBreakGlass: () => (
    <div data-testid="chat-break-glass-section">ChatBreakGlass section</div>
  ),
}));
vi.mock('../sections/MasterData', () => ({
  MasterData: () => (
    <div data-testid="master-data-section">MasterData section</div>
  ),
}));
vi.mock('../sections/Projects', () => ({
  Projects: () => <div data-testid="projects-section">Projects section</div>,
}));
vi.mock('../sections/ProjectMilestones', () => ({
  ProjectMilestones: () => (
    <div data-testid="project-milestones-section">
      ProjectMilestones section
    </div>
  ),
}));
vi.mock('../sections/VendorDocuments', () => ({
  VendorDocuments: () => (
    <div data-testid="vendor-documents-section">VendorDocuments section</div>
  ),
}));
vi.mock('../sections/AccessReviews', () => ({
  AccessReviews: () => (
    <div data-testid="access-reviews-section">AccessReviews section</div>
  ),
}));
vi.mock('../sections/AuditLogs', () => ({
  AuditLogs: () => (
    <div data-testid="audit-logs-section">AuditLogs section</div>
  ),
}));
vi.mock('../sections/PeriodLocks', () => ({
  PeriodLocks: () => (
    <div data-testid="period-locks-section">PeriodLocks section</div>
  ),
}));
vi.mock('../sections/AdminJobs', () => ({
  AdminJobs: () => (
    <div data-testid="admin-jobs-section">AdminJobs section</div>
  ),
}));
vi.mock('../sections/DocumentSendLogs', () => ({
  DocumentSendLogs: () => (
    <div data-testid="document-send-logs-section">DocumentSendLogs section</div>
  ),
}));
vi.mock('../sections/PdfFiles', () => ({
  PdfFiles: () => <div data-testid="pdf-files-section">PdfFiles section</div>,
}));

import { App } from './App';

function createResponse({
  ok,
  status,
  json,
}: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}) {
  return {
    ok,
    status: status ?? (ok ? 200 : 400),
    json: json ?? (async () => ({})),
  } as Response;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  apiResponse.mockReset();
  vi.useRealTimers();
});

beforeEach(() => {
  apiResponse.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('uses the legacy stored section alias and persists the normalized section id', async () => {
    window.localStorage.setItem('erp4_active_section', 'project-chat');

    render(<App />);

    expect(screen.getByTestId('room-chat-section')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem('erp4_active_section')).toBe(
        'room-chat',
      );
    });
  });

  it('falls back to home when the stored section id is invalid', () => {
    window.localStorage.setItem('erp4_active_section', 'missing-section');

    render(<App />);

    expect(screen.getByTestId('dashboard-section')).toBeInTheDocument();
    expect(screen.getByTestId('global-search-section')).toBeInTheDocument();
  });

  it('shows an error for unsupported deep links', async () => {
    window.history.replaceState(null, '', '/#/open?kind=unsupported&id=item-1');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'deep link の kind が未対応です: unsupported',
      );
    });
    expect(screen.getByTestId('dashboard-section')).toBeInTheDocument();
  });

  it('dispatches a fallback entity event for a project deep link and clears the hash', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    try {
      window.history.replaceState(
        null,
        '',
        '/#/open?kind=project&id=project-1',
      );

      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('projects-section')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(dispatchEventSpy).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'erp4_open_entity' }),
        );
      });

      const entityEvent = dispatchEventSpy.mock.calls.find(
        ([event]) =>
          event instanceof CustomEvent && event.type === 'erp4_open_entity',
      )?.[0] as CustomEvent | undefined;
      expect(entityEvent?.detail).toEqual({ kind: 'project', id: 'project-1' });
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/');
    } finally {
      dispatchEventSpy.mockRestore();
      replaceStateSpy.mockRestore();
    }
  });

  it('resolves a chat_message deep link and dispatches room/message events', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    apiResponse.mockResolvedValue(
      createResponse({
        ok: true,
        json: async () => ({
          roomId: 'room-1',
          createdAt: '2026-03-29T00:00:00Z',
          excerpt: '抜粋',
          room: {
            id: 'room-1',
            type: 'project',
            projectId: 'project-1',
          },
        }),
      }),
    );

    try {
      window.history.replaceState(
        null,
        '',
        '/#/open?kind=chat_message&id=msg-1',
      );

      render(<App />);

      await waitFor(() => {
        expect(apiResponse).toHaveBeenCalledWith('/chat-messages/msg-1');
      });
      await waitFor(() => {
        expect(screen.getByTestId('room-chat-section')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(dispatchEventSpy).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'erp4_open_chat_message' }),
        );
      });

      const openRoomEvent = dispatchEventSpy.mock.calls.find(
        ([event]) =>
          event instanceof CustomEvent && event.type === 'erp4_open_room_chat',
      )?.[0] as CustomEvent | undefined;
      const openMessageEvent = dispatchEventSpy.mock.calls.find(
        ([event]) =>
          event instanceof CustomEvent &&
          event.type === 'erp4_open_chat_message',
      )?.[0] as CustomEvent | undefined;

      expect(openRoomEvent?.detail).toEqual({ roomId: 'room-1' });
      expect(openMessageEvent?.detail).toEqual({
        messageId: 'msg-1',
        roomId: 'room-1',
        roomType: 'project',
        projectId: 'project-1',
        createdAt: '2026-03-29T00:00:00Z',
        excerpt: '抜粋',
      });
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/');
    } finally {
      dispatchEventSpy.mockRestore();
      replaceStateSpy.mockRestore();
    }
  });

  it('opens the command palette and dispatches global search focus', () => {
    vi.useFakeTimers();
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    try {
      render(<App />);

      fireEvent.click(
        screen.getByRole('button', { name: 'コマンドを開く (Ctrl/Cmd + K)' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: '検索: グローバル検索を開く' }),
      );

      vi.runAllTimers();

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'erp4_global_search_focus' }),
      );
      expect(screen.getByTestId('dashboard-section')).toBeInTheDocument();
      expect(screen.getByTestId('global-search-section')).toBeInTheDocument();
    } finally {
      dispatchEventSpy.mockRestore();
    }
  });
});
