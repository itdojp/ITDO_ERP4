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

import { ProjectTasks } from './ProjectTasks';

const defaultProjects = [
  { id: 'project-1', code: 'P001', name: 'Project One' },
  { id: 'project-2', code: 'P002', name: 'Project Two' },
];

const defaultTasks = [
  {
    id: 'task-1',
    projectId: 'project-1',
    name: '要件定義',
    status: 'open',
    progressPercent: 20,
  },
  {
    id: 'task-2',
    projectId: 'project-1',
    name: '設計',
    status: 'in_progress',
    progressPercent: 40,
    parentTaskId: null,
  },
];

const defaultBaselines = [
  {
    id: 'baseline-1',
    projectId: 'project-1',
    name: 'Sprint 1',
  },
];

const defaultBaselineDetails: Record<string, Record<string, unknown>> = {
  'baseline-1': {
    id: 'baseline-1',
    projectId: 'project-1',
    name: 'Sprint 1',
    createdAt: '2026-03-01T00:00:00.000Z',
    tasks: [
      {
        id: 'baseline-task-1',
        baselineId: 'baseline-1',
        taskId: 'task-1',
        name: '要件定義',
        planStart: '2026-03-01T00:00:00.000Z',
        planEnd: '2026-03-05T00:00:00.000Z',
        progressPercent: 20,
      },
    ],
  },
};

function createApiMock(options?: {
  items?: Array<Record<string, unknown>>;
  baselines?: Array<Record<string, unknown>>;
  baselineDetails?: Record<string, Record<string, unknown>>;
  dependencies?: Record<string, string[]>;
}) {
  let items = [...(options?.items ?? defaultTasks)];
  let baselines = [...(options?.baselines ?? defaultBaselines)];
  const baselineDetails: Record<string, Record<string, unknown>> = {
    ...(options?.baselineDetails ?? defaultBaselineDetails),
  };
  const dependencies = new Map(
    Object.entries(options?.dependencies ?? { 'task-2': ['task-1'] }),
  );

  vi.mocked(api).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === '/projects/project-1/tasks' && !init?.method) {
        return { items };
      }
      if (path === '/projects/project-1/baselines' && !init?.method) {
        return { items: baselines };
      }
      if (
        path === '/projects/project-1/baselines/baseline-1' &&
        !init?.method
      ) {
        return baselineDetails['baseline-1'];
      }
      if (
        path === '/projects/project-1/tasks/task-2/dependencies' &&
        !init?.method
      ) {
        return { predecessorIds: dependencies.get('task-2') ?? [] };
      }
      if (path === '/projects/project-1/baselines' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { name?: string };
        const created = {
          id: 'baseline-created',
          projectId: 'project-1',
          name: body.name || '自動ベースライン',
        };
        baselines = [created, ...baselines];
        baselineDetails['baseline-created'] = {
          ...created,
          createdAt: '2026-03-02T00:00:00.000Z',
          tasks: [],
        };
        return created;
      }
      if (
        path === '/projects/project-1/baselines/baseline-created' &&
        !init?.method
      ) {
        return baselineDetails['baseline-created'];
      }
      if (path === '/projects/project-1/tasks' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as Record<
          string,
          unknown
        >;
        const created = {
          id: 'task-created',
          projectId: 'project-1',
          name: body.name,
          status: body.status ?? null,
          progressPercent: body.progressPercent ?? null,
          parentTaskId: body.parentTaskId ?? null,
          planStart: body.planStart ?? null,
          planEnd: body.planEnd ?? null,
          actualStart: body.actualStart ?? null,
          actualEnd: body.actualEnd ?? null,
        };
        items = [created, ...items];
        return created;
      }
      if (
        path === '/projects/project-1/tasks/task-2' &&
        init?.method === 'PATCH'
      ) {
        const body = JSON.parse(String(init.body || '{}')) as Record<
          string,
          unknown
        >;
        const updated = {
          id: 'task-2',
          projectId: 'project-1',
          name: body.name,
          status: body.status ?? null,
          progressPercent: body.progressPercent ?? null,
          parentTaskId: body.parentTaskId ?? null,
          planStart: body.planStart ?? null,
          planEnd: body.planEnd ?? null,
          actualStart: body.actualStart ?? null,
          actualEnd: body.actualEnd ?? null,
        };
        items = items.map((item) => (item.id === 'task-2' ? updated : item));
        return updated;
      }
      if (
        path === '/projects/project-1/tasks/task-2/dependencies' &&
        init?.method === 'PUT'
      ) {
        const body = JSON.parse(String(init.body || '{}')) as {
          predecessorIds?: string[];
        };
        dependencies.set('task-2', body.predecessorIds ?? []);
        return {};
      }
      if (
        path === '/projects/project-1/tasks/task-2/delete' &&
        init?.method === 'POST'
      ) {
        items = items.filter((item) => item.id !== 'task-2');
        return {};
      }
      throw new Error(`Unhandled api call: ${path} ${init?.method || 'GET'}`);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthState).mockReturnValue({
    projectIds: ['project-1'],
    roles: ['admin'],
  });
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

describe('ProjectTasks', () => {
  it('loads tasks and baseline detail for the selected project', async () => {
    createApiMock();

    render(<ProjectTasks />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/tasks');
      expect(api).toHaveBeenCalledWith('/projects/project-1/baselines');
    });

    fireEvent.click(screen.getByRole('button', { name: '読み込み' }));

    await waitFor(() => {
      expect(screen.getByText('読み込みました')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes('要件定義 / P001 / Project One'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes('設計 / P001 / Project One'),
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('ベースライン選択'), {
      target: { value: 'baseline-1' },
    });

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/projects/project-1/baselines/baseline-1',
      );
    });

    expect(screen.getByText(/Sprint 1/)).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes(
            '要件定義 / 計画: 2026-03-01〜2026-03-05 / 進捗: 20%',
          ),
      ),
    ).toBeInTheDocument();
  });

  it('validates required fields and progress bounds before create', async () => {
    createApiMock({
      items: [],
      baselines: [],
      baselineDetails: {},
      dependencies: {},
    });

    render(<ProjectTasks />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/tasks');
    });

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(screen.getByText('タスク名は必須です')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('タスク名'), {
      target: { value: 'レビュー' },
    });
    fireEvent.change(screen.getByLabelText('進捗率'), {
      target: { value: '101' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    expect(
      screen.getByText('進捗率は0〜100の整数で入力してください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      '/projects/project-1/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates a baseline with a trimmed name and loads its detail', async () => {
    createApiMock({
      items: [],
      baselines: [],
      baselineDetails: {},
      dependencies: {},
    });
    const promptSpy = vi.spyOn(window, 'prompt');

    try {
      promptSpy.mockReturnValueOnce('  Sprint 2  ');

      render(<ProjectTasks />);

      await waitFor(() => {
        expect(api).toHaveBeenCalledWith('/projects/project-1/baselines');
      });

      fireEvent.click(screen.getByRole('button', { name: 'ベースライン作成' }));

      await waitFor(() => {
        expect(api).toHaveBeenCalledWith('/projects/project-1/baselines', {
          method: 'POST',
          body: JSON.stringify({ name: 'Sprint 2' }),
        });
      });

      expect(
        screen.getByText('ベースラインを作成しました'),
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(api).toHaveBeenCalledWith(
          '/projects/project-1/baselines/baseline-created',
        );
      });

      expect(screen.getByText('タスクなし')).toBeInTheDocument();
    } finally {
      promptSpy.mockRestore();
    }
  });

  it('requires a reason when changing the parent task and updates dependencies', async () => {
    createApiMock();

    render(<ProjectTasks />);

    const taskRow = await screen.findByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent?.includes('設計 / P001 / Project One'),
    );
    const row = taskRow.closest('li');
    expect(row).not.toBeNull();
    fireEvent.click(
      within(row as HTMLLIElement).getByRole('button', { name: '編集' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/projects/project-1/tasks/task-2/dependencies',
      );
    });

    fireEvent.change(screen.getByLabelText('親タスク選択'), {
      target: { value: 'task-1' },
    });
    fireEvent.change(screen.getByLabelText('進捗率'), {
      target: { value: '55' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    expect(
      screen.getByText('親タスクを変更する場合は理由を入力してください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      '/projects/project-1/tasks/task-2',
      expect.objectContaining({ method: 'PATCH' }),
    );

    fireEvent.change(screen.getByLabelText('親タスクの変更理由'), {
      target: { value: '依存関係を整理' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/tasks/task-2', {
        method: 'PATCH',
        body: JSON.stringify({
          name: '設計',
          status: 'in_progress',
          parentTaskId: 'task-1',
          progressPercent: 55,
          planStart: null,
          planEnd: null,
          actualStart: null,
          actualEnd: null,
          reasonText: '依存関係を整理',
        }),
      });
    });

    expect(api).toHaveBeenCalledWith(
      '/projects/project-1/tasks/task-2/dependencies',
      {
        method: 'PUT',
        body: JSON.stringify({ predecessorIds: ['task-1'] }),
      },
    );
    expect(screen.getByText('更新しました')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'キャンセル' }),
    ).not.toBeInTheDocument();
  });

  it('requires a deletion reason and removes the task for privileged users', async () => {
    createApiMock();
    const promptSpy = vi.spyOn(window, 'prompt');

    try {
      render(<ProjectTasks />);

      const taskRow = await screen.findByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes('設計 / P001 / Project One'),
      );
      const row = taskRow.closest('li');
      expect(row).not.toBeNull();

      promptSpy.mockReturnValueOnce('   ');
      fireEvent.click(
        within(row as HTMLLIElement).getByRole('button', { name: '削除' }),
      );
      expect(screen.getByText('削除理由は必須です')).toBeInTheDocument();

      promptSpy.mockReturnValueOnce('不要タスク');
      fireEvent.click(
        within(row as HTMLLIElement).getByRole('button', { name: '削除' }),
      );

      await waitFor(() => {
        expect(api).toHaveBeenCalledWith(
          '/projects/project-1/tasks/task-2/delete',
          {
            method: 'POST',
            body: JSON.stringify({ reason: '不要タスク' }),
          },
        );
      });

      expect(screen.getByText('削除しました')).toBeInTheDocument();
      expect(screen.queryByText('設計')).not.toBeInTheDocument();
    } finally {
      promptSpy.mockRestore();
    }
  });
});
