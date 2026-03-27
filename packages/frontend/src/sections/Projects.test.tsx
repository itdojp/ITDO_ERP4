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

const { api, getAuthState } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: () => <div data-testid="annotations-card" />,
}));

import { Projects } from './Projects';

const defaultCustomers = [
  { id: 'customer-1', code: 'C001', name: 'Alpha Corp' },
  { id: 'customer-2', code: 'C002', name: 'Beta Corp' },
];

const defaultProjects = [
  {
    id: 'project-1',
    code: 'P001',
    name: 'Parent Project',
    status: 'active',
    customerId: 'customer-1',
  },
  {
    id: 'project-2',
    code: 'P002',
    name: 'Child Project',
    status: 'draft',
    customerId: 'customer-2',
    parentId: null,
    planHours: 120,
    budgetCost: 500000,
  },
];

function createProjectsApiMock(options?: {
  projects?: Array<Record<string, unknown>>;
  customers?: Array<Record<string, unknown>>;
  members?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
}) {
  let projects = [...(options?.projects ?? defaultProjects)];
  const customers = [...(options?.customers ?? defaultCustomers)];
  let members = [
    ...(options?.members ?? [
      { id: 'member-1', userId: 'leader@example.com', role: 'leader' },
    ]),
  ];
  const candidates = [
    ...(options?.candidates ?? [
      {
        userId: 'alice@example.com',
        displayName: 'Alice',
        department: 'PMO',
      },
    ]),
  ];

  vi.mocked(api).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === '/projects' && !init?.method) {
        return { items: projects };
      }
      if (path === '/customers' && !init?.method) {
        return { items: customers };
      }
      if (path === '/projects' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as Record<
          string,
          unknown
        >;
        const created = {
          id: 'project-created',
          code: body.code,
          name: body.name,
          status: body.status,
          customerId: body.customerId,
          parentId: body.parentId ?? null,
          planHours: body.planHours ?? null,
          budgetCost: body.budgetCost ?? null,
        };
        projects = [created, ...projects];
        return created;
      }
      if (path === '/projects/project-2' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<
          string,
          unknown
        >;
        const updated = {
          id: 'project-2',
          code: body.code,
          name: body.name,
          status: body.status,
          customerId: body.customerId,
          parentId: body.parentId ?? null,
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          planHours: body.planHours ?? null,
          budgetCost: body.budgetCost ?? null,
        };
        projects = projects.map((item) =>
          item.id === 'project-2' ? updated : item,
        );
        return updated;
      }
      if (path === '/projects/project-1/members' && !init?.method) {
        return { items: members };
      }
      if (
        path === '/projects/project-1/member-candidates?q=ali' &&
        !init?.method
      ) {
        return { items: candidates };
      }
      if (path === '/projects/project-1/members' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as {
          userId: string;
          role: string;
        };
        const existing = members.find((item) => item.userId === body.userId);
        if (existing) {
          members = members.map((item) =>
            item.userId === body.userId ? { ...item, role: body.role } : item,
          );
        } else {
          members = [
            ...members,
            {
              id: `member-${members.length + 1}`,
              userId: body.userId,
              role: body.role,
            },
          ];
        }
        return {};
      }
      if (
        path === '/projects/project-1/members/leader%40example.com' &&
        init?.method === 'DELETE'
      ) {
        members = members.filter(
          (item) => item.userId !== 'leader@example.com',
        );
        return {};
      }
      throw new Error(`Unhandled api call: ${path} ${init?.method || 'GET'}`);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthState).mockReturnValue({ roles: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Projects', () => {
  it('validates required fields before creating a project', async () => {
    createProjectsApiMock();

    render(<Projects />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
      expect(api).toHaveBeenCalledWith('/customers');
    });

    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(screen.getByText('コードと名称は必須です')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      '/projects',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates a project and reloads the list', async () => {
    createProjectsApiMock();

    render(<Projects />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.change(screen.getByLabelText('案件コード'), {
      target: { value: 'P003' },
    });
    fireEvent.change(screen.getByLabelText('案件名称'), {
      target: { value: 'New Project' },
    });
    fireEvent.change(screen.getByLabelText('顧客選択'), {
      target: { value: 'customer-1' },
    });
    fireEvent.change(screen.getByLabelText('予定工数'), {
      target: { value: '80' },
    });
    fireEvent.change(screen.getByLabelText('予算コスト'), {
      target: { value: '250000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    const successMessage = await screen.findByText('案件を追加しました');
    const newProjectItem = await screen.findByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent?.includes('P003 / New Project'),
    );

    expect(api).toHaveBeenCalledWith('/projects', {
      method: 'POST',
      body: JSON.stringify({
        code: 'P003',
        name: 'New Project',
        status: 'draft',
        customerId: 'customer-1',
        startDate: null,
        endDate: null,
        planHours: 80,
        budgetCost: 250000,
      }),
    });
    expect(successMessage).toBeInTheDocument();
    expect(newProjectItem).toBeInTheDocument();
  });

  it('requires a reason when changing the parent project and updates after input', async () => {
    createProjectsApiMock();

    render(<Projects />);

    const row = await screen.findByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent?.includes('P002 / Child Project'),
    );
    fireEvent.click(
      within(row.closest('li') as HTMLLIElement).getByRole('button', {
        name: '編集',
      }),
    );

    fireEvent.change(screen.getByLabelText('親案件選択'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    expect(
      screen.getByText('親案件を変更する場合は理由を入力してください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      '/projects/project-2',
      expect.objectContaining({ method: 'PATCH' }),
    );

    fireEvent.change(screen.getByLabelText('親案件の変更理由'), {
      target: { value: '構成を整理' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-2', {
        method: 'PATCH',
        body: JSON.stringify({
          code: 'P002',
          name: 'Child Project',
          status: 'draft',
          customerId: 'customer-2',
          startDate: null,
          endDate: null,
          planHours: 120,
          budgetCost: 500000,
          parentId: 'project-1',
          reasonText: '構成を整理',
        }),
      });
    });

    const successMessage = await screen.findByText('案件を更新しました');
    expect(successMessage).toBeInTheDocument();
  });

  it('shows duplicate-member guidance for non-admin users', async () => {
    createProjectsApiMock();

    render(<Projects />);

    const row = await screen.findByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent?.includes('P001 / Parent Project'),
    );
    fireEvent.click(
      within(row.closest('li') as HTMLLIElement).getByRole('button', {
        name: 'メンバー管理',
      }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/members');
    });

    const memberPanel = screen
      .getByRole('heading', { name: 'メンバー管理' })
      .closest('div');
    expect(memberPanel).not.toBeNull();

    expect(
      within(memberPanel as HTMLDivElement).getByLabelText(
        '案件メンバーの権限',
      ),
    ).toHaveTextContent('権限: メンバー (固定)');

    fireEvent.change(
      within(memberPanel as HTMLDivElement).getByLabelText(
        '案件メンバーのユーザID',
      ),
      {
        target: { value: 'leader@example.com' },
      },
    );
    fireEvent.click(
      within(memberPanel as HTMLDivElement).getByRole('button', {
        name: '追加',
      }),
    );

    expect(
      screen.getByText('既存メンバーの権限変更は管理者のみ可能です。'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      '/projects/project-1/members',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('searches member candidates and selects a candidate user id', async () => {
    createProjectsApiMock();

    render(<Projects />);

    const row = await screen.findByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent?.includes('P001 / Parent Project'),
    );
    fireEvent.click(
      within(row.closest('li') as HTMLLIElement).getByRole('button', {
        name: 'メンバー管理',
      }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/project-1/members');
    });

    const memberPanel = screen
      .getByRole('heading', { name: 'メンバー管理' })
      .closest('div');
    expect(memberPanel).not.toBeNull();

    fireEvent.change(
      within(memberPanel as HTMLDivElement).getByLabelText('メンバー候補検索'),
      { target: { value: 'a' } },
    );
    fireEvent.click(
      within(memberPanel as HTMLDivElement).getByRole('button', {
        name: '検索',
      }),
    );
    expect(screen.getByText('2文字以上で検索してください')).toBeInTheDocument();

    fireEvent.change(
      within(memberPanel as HTMLDivElement).getByLabelText('メンバー候補検索'),
      { target: { value: 'ali' } },
    );
    fireEvent.click(
      within(memberPanel as HTMLDivElement).getByRole('button', {
        name: '検索',
      }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/projects/project-1/member-candidates?q=ali',
      );
    });

    const selectButton = await within(memberPanel as HTMLDivElement).findByRole(
      'button',
      {
        name: '選択',
      },
    );
    fireEvent.click(selectButton);
    expect(
      within(memberPanel as HTMLDivElement).getByLabelText(
        '案件メンバーのユーザID',
      ),
    ).toHaveValue('alice@example.com');
  });
});
