import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, apiResponse, getAuthState } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  getAuthState: vi.fn(),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ default: {} }));
vi.mock('remark-breaks', () => ({ default: {} }));
vi.mock('../api', () => ({ api, apiResponse, getAuthState }));
vi.mock('../ui', () => ({
  DateTimeRangePicker: ({
    value,
    onChange,
  }: {
    value: { from?: string; to?: string };
    onChange: (next: { from?: string; to?: string }) => void;
  }) => (
    <div>
      <input
        aria-label="targetFrom"
        value={value.from || ''}
        onChange={(event) =>
          onChange({ from: event.target.value, to: value.to })
        }
      />
      <input
        aria-label="targetUntil"
        value={value.to || ''}
        onChange={(event) =>
          onChange({ from: value.from, to: event.target.value })
        }
      />
    </div>
  ),
}));

import { ChatBreakGlass } from './ChatBreakGlass';

beforeEach(() => {
  api.mockReset();
  apiResponse.mockReset();
  getAuthState.mockReset();
  getAuthState.mockReturnValue({
    userId: 'user-1',
    roles: ['mgmt'],
    projectIds: ['project-1'],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatBreakGlass', () => {
  it('shows disabled reason for non-mgmt or admin users', () => {
    getAuthState.mockReturnValueOnce({
      userId: 'user-1',
      roles: ['member'],
      projectIds: ['project-1'],
    });
    const { rerender } = render(<ChatBreakGlass />);
    expect(screen.getByText('mgmt/exec ロールが必要です')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();

    getAuthState.mockReturnValueOnce({
      userId: 'user-1',
      roles: ['mgmt', 'admin'],
      projectIds: ['project-1'],
    });
    rerender(<ChatBreakGlass />);
    expect(
      screen.getByText('admin ロールは break-glass を利用できません'),
    ).toBeInTheDocument();
  });

  it('loads requests on mount and supports approve flow', async () => {
    api
      .mockResolvedValueOnce({
        items: [
          {
            id: 'req-1',
            targetType: 'project',
            projectId: 'project-1',
            requesterUserId: 'req-user',
            viewerUserId: 'viewer-1',
            reasonCode: 'security_incident',
            ttlHours: 24,
            status: 'requested',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ items: [] });
    apiResponse.mockResolvedValueOnce({ ok: true, text: async () => '' });

    render(<ChatBreakGlass />);

    expect(await screen.findByText('requested')).toBeInTheDocument();
    expect(api).toHaveBeenNthCalledWith(
      1,
      '/chat-break-glass/requests?limit=50',
    );

    const requestedItem = screen.getByText('requested').closest('li');
    expect(requestedItem).not.toBeNull();
    fireEvent.click(
      within(requestedItem as HTMLLIElement).getByRole('button', {
        name: '承認',
      }),
    );
    expect(await screen.findByText('承認しました')).toBeInTheDocument();
    expect(apiResponse).toHaveBeenNthCalledWith(
      1,
      '/chat-break-glass/requests/req-1/approve',
      { method: 'POST' },
    );
  });

  it('supports reject flow for requested requests', async () => {
    api.mockResolvedValueOnce({
      items: [
        {
          id: 'req-1',
          targetType: 'project',
          projectId: 'project-1',
          requesterUserId: 'req-user',
          viewerUserId: 'viewer-1',
          reasonCode: 'security_incident',
          ttlHours: 24,
          status: 'requested',
          createdAt: '2026-03-27T00:00:00.000Z',
          updatedAt: '2026-03-27T00:00:00.000Z',
        },
      ],
    });
    api.mockResolvedValueOnce({
      items: [
        {
          id: 'req-1',
          targetType: 'project',
          projectId: 'project-1',
          requesterUserId: 'req-user',
          viewerUserId: 'viewer-1',
          reasonCode: 'security_incident',
          ttlHours: 24,
          status: 'rejected',
          rejectedReason: '監査理由',
          createdAt: '2026-03-27T00:00:00.000Z',
          updatedAt: '2026-03-27T00:30:00.000Z',
        },
      ],
    });
    apiResponse.mockResolvedValueOnce({ ok: true, text: async () => '' });
    vi.spyOn(window, 'prompt').mockReturnValue('監査理由');

    render(<ChatBreakGlass />);

    const requestedItem = await screen.findByText('requested');
    fireEvent.click(
      within(requestedItem.closest('li') as HTMLLIElement).getByRole('button', {
        name: '却下',
      }),
    );
    expect(await screen.findByText('却下しました')).toBeInTheDocument();
    expect(window.prompt).toHaveBeenCalledWith('却下理由を入力してください');
    expect(apiResponse).toHaveBeenNthCalledWith(
      1,
      '/chat-break-glass/requests/req-1/reject',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('supports access flow for approved requests', async () => {
    api
      .mockResolvedValueOnce({
        items: [
          {
            id: 'req-2',
            targetType: 'project',
            projectId: 'project-1',
            requesterUserId: 'req-user',
            viewerUserId: 'viewer-1',
            reasonCode: 'fraud',
            ttlHours: 24,
            status: 'approved',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'msg-1',
            projectId: 'project-1',
            userId: 'viewer-1',
            body: 'message body',
            createdAt: '2026-03-27T01:00:00.000Z',
          },
        ],
      });

    render(<ChatBreakGlass />);

    const approvedItem = await screen.findByText('approved');
    fireEvent.click(
      within(approvedItem.closest('li') as HTMLLIElement).getByRole('button', {
        name: '閲覧',
      }),
    );
    expect(await screen.findByText('取得しました')).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith(
      '/chat-break-glass/requests/req-2/messages?limit=50',
    );
    expect(screen.getByText('message body')).toBeInTheDocument();
  });

  it('validates request payload before submit', async () => {
    render(<ChatBreakGlass />);

    fireEvent.change(screen.getByLabelText('breakglass-projectId'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('breakglass-roomId'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: '申請' }));
    expect(
      await screen.findByText('projectId または roomId を入力してください'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('breakglass-projectId'), {
      target: { value: 'project-1' },
    });
    fireEvent.change(screen.getByLabelText('targetFrom'), {
      target: { value: '2026-03-28T09:00' },
    });
    fireEvent.change(screen.getByLabelText('targetUntil'), {
      target: { value: '2026-03-27T09:00' },
    });
    fireEvent.change(screen.getByLabelText('breakglass-reasonText'), {
      target: { value: '監査対応' },
    });
    fireEvent.click(screen.getByRole('button', { name: '申請' }));
    expect(
      await screen.findByText(
        'targetFrom は targetUntil 以前を指定してください',
      ),
    ).toBeInTheDocument();
  });

  it('creates request and refreshes list', async () => {
    api
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        items: [
          {
            id: 'req-3',
            targetType: 'project',
            projectId: 'project-1',
            requesterUserId: 'req-user',
            viewerUserId: 'viewer-1',
            reasonCode: 'legal',
            ttlHours: 24,
            status: 'requested',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
      });

    render(<ChatBreakGlass />);
    await screen.findByText('申請なし');

    fireEvent.change(screen.getByLabelText('breakglass-projectId'), {
      target: { value: 'project-1' },
    });
    fireEvent.change(screen.getByLabelText('breakglass-viewerUserId'), {
      target: { value: 'viewer-2' },
    });
    fireEvent.change(screen.getByLabelText('breakglass-reasonCode'), {
      target: { value: 'legal' },
    });
    fireEvent.change(screen.getByLabelText('breakglass-reasonText'), {
      target: { value: '法令対応' },
    });
    fireEvent.change(screen.getByLabelText('breakglass-ttlHours'), {
      target: { value: '48' },
    });
    fireEvent.click(screen.getByRole('button', { name: '申請' }));

    expect(await screen.findByText('申請しました')).toBeInTheDocument();
    expect(api).toHaveBeenNthCalledWith(
      2,
      '/chat-break-glass/requests',
      expect.objectContaining({ method: 'POST' }),
    );
    const payload = JSON.parse(api.mock.calls[1][1].body as string);
    expect(payload).toEqual(
      expect.objectContaining({
        projectId: 'project-1',
        viewerUserId: 'viewer-2',
        reasonCode: 'legal',
        reasonText: '法令対応',
        ttlHours: 48,
      }),
    );
    expect(await screen.findByText('legal')).toBeInTheDocument();
  });
});
