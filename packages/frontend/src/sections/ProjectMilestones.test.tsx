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

const { api, getAuthState, useProjects } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  useProjects: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../hooks/useProjects', () => ({ useProjects }));

import { ProjectMilestones } from './ProjectMilestones';

const defaultProjects = [
  { id: 'project-1', code: 'P001', name: 'Project One' },
  { id: 'project-2', code: 'P002', name: 'Project Two' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthState).mockReturnValue({ projectIds: ['project-1'] });
  vi.mocked(useProjects).mockImplementation(
    ({ selectedProjectId, onSelect }) => {
      if (!selectedProjectId) onSelect(defaultProjects[0].id);
      return {
        projects: defaultProjects,
        projectMessage: '',
        loadProjects: vi.fn(),
      };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectMilestones', () => {
  it('loads milestones for the selected project', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      items: [
        {
          id: 'milestone-1',
          projectId: 'project-1',
          name: '第1回請求',
          amount: 120000,
          billUpon: 'date',
          dueDate: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    render(<ProjectMilestones />);

    fireEvent.click(screen.getByRole('button', { name: '読み込み' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/milestones');
    });

    expect(screen.getByText('読み込みました')).toBeInTheDocument();
    expect(screen.getByText(/第1回請求/)).toBeInTheDocument();
    expect(
      screen.getByText(
        (content, element) =>
          element?.tagName === 'LI' && content.includes('P001 / Project One'),
      ),
    ).toBeInTheDocument();
  });

  it('validates required fields before save', async () => {
    vi.mocked(getAuthState).mockReturnValue({ projectIds: [] });
    vi.mocked(useProjects).mockReturnValue({
      projects: defaultProjects,
      projectMessage: '',
      loadProjects: vi.fn(),
    });

    render(<ProjectMilestones />);

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(screen.getByText('案件を選択してください')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('案件選択'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    expect(screen.getByText('名称は必須です')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('creates a milestone and resets the form', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      id: 'milestone-2',
      projectId: 'project-1',
      name: '着手金',
      amount: 50000,
      billUpon: 'acceptance',
      dueDate: '2026-04-15T00:00:00.000Z',
      taxRate: 0.1,
    });

    render(<ProjectMilestones />);

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '着手金' },
    });
    fireEvent.change(screen.getByLabelText('金額'), {
      target: { value: '50000' },
    });
    fireEvent.change(screen.getByLabelText('請求タイミング'), {
      target: { value: 'acceptance' },
    });
    fireEvent.change(screen.getByLabelText('納期'), {
      target: { value: '2026-04-15' },
    });
    fireEvent.change(screen.getByLabelText('税率'), {
      target: { value: '0.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/milestones', {
        method: 'POST',
        body: JSON.stringify({
          name: '着手金',
          amount: 50000,
          billUpon: 'acceptance',
          dueDate: '2026-04-15',
          taxRate: 0.1,
        }),
      });
    });

    expect(screen.getByText('作成しました')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('');
    expect(screen.getByText(/着手金/)).toBeInTheDocument();
  });

  it('edits and deletes milestones with a required reason', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        items: [
          {
            id: 'milestone-3',
            projectId: 'project-1',
            name: '中間金',
            amount: 90000,
            billUpon: 'date',
            dueDate: '2026-05-01T00:00:00.000Z',
            taxRate: 0.1,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'milestone-3',
        projectId: 'project-1',
        name: '中間金(更新)',
        amount: 95000,
        billUpon: 'time',
        dueDate: '2026-05-10T00:00:00.000Z',
        taxRate: 0.08,
      })
      .mockResolvedValueOnce({});

    const promptSpy = vi.spyOn(window, 'prompt');
    try {
      render(<ProjectMilestones />);
      fireEvent.click(screen.getByRole('button', { name: '読み込み' }));
      await screen.findByText(/中間金/);

      fireEvent.click(screen.getByRole('button', { name: '編集' }));
      fireEvent.change(screen.getByLabelText('名称'), {
        target: { value: '中間金(更新)' },
      });
      fireEvent.change(screen.getByLabelText('金額'), {
        target: { value: '95000' },
      });
      fireEvent.change(screen.getByLabelText('請求タイミング'), {
        target: { value: 'time' },
      });
      fireEvent.change(screen.getByLabelText('納期'), {
        target: { value: '2026-05-10' },
      });
      fireEvent.change(screen.getByLabelText('税率'), {
        target: { value: '0.08' },
      });
      fireEvent.click(screen.getByRole('button', { name: '更新' }));

      await waitFor(() => {
        expect(api).toHaveBeenCalledWith(
          '/projects/project-1/milestones/milestone-3',
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: '中間金(更新)',
              amount: 95000,
              billUpon: 'time',
              dueDate: '2026-05-10',
              taxRate: 0.08,
            }),
          },
        );
      });
      expect(screen.getByText('更新しました')).toBeInTheDocument();

      promptSpy.mockReturnValueOnce('   ');
      fireEvent.click(screen.getByRole('button', { name: '削除' }));
      expect(screen.getByText('削除理由は必須です')).toBeInTheDocument();

      promptSpy.mockReturnValueOnce('重複登録');
      fireEvent.click(screen.getByRole('button', { name: '削除' }));

      await waitFor(() => {
        expect(api).toHaveBeenCalledWith(
          '/projects/project-1/milestones/milestone-3/delete',
          {
            method: 'POST',
            body: JSON.stringify({ reason: '重複登録' }),
          },
        );
      });
      expect(screen.getByText('削除しました')).toBeInTheDocument();
      expect(screen.getByText('データなし')).toBeInTheDocument();
    } finally {
      promptSpy.mockRestore();
    }
  });

  it('loads delivery due report with filters and shows errors on failure', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        items: [
          {
            milestoneId: 'milestone-4',
            projectId: 'project-1',
            projectCode: 'P001',
            name: '検収金',
            amount: 110000,
            dueDate: '2026-05-20T00:00:00.000Z',
            invoiceCount: 0,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('network down'));

    render(<ProjectMilestones />);

    fireEvent.change(screen.getByLabelText('from'), {
      target: { value: '2026-05-01' },
    });
    fireEvent.change(screen.getByLabelText('to'), {
      target: { value: '2026-05-31' },
    });
    const reportSection = screen
      .getByText('未請求（納期範囲）レポート')
      .closest('div')!;
    fireEvent.click(
      within(reportSection).getByRole('button', { name: '取得' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/reports/delivery-due?from=2026-05-01&to=2026-05-31&projectId=project-1',
      );
    });
    expect(screen.getByText('取得しました')).toBeInTheDocument();
    expect(screen.getByText(/P001 \/ 検収金/)).toBeInTheDocument();

    fireEvent.click(
      within(reportSection).getByRole('button', { name: '取得' }),
    );
    expect(
      await screen.findByText('取得に失敗しました (network down)'),
    ).toBeInTheDocument();
    expect(screen.getByText('該当なし')).toBeInTheDocument();
  });
});
