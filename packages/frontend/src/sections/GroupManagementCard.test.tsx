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

import { GroupManagementCard } from './GroupManagementCard';

type GroupSummary = {
  id: string;
  displayName: string;
  externalId?: string | null;
  active?: boolean | null;
  memberCount?: number | null;
  updatedAt?: string | null;
  isScimManaged?: boolean | null;
};

type GroupMember = {
  userAccountId: string;
  userId: string;
  displayName?: string | null;
  active?: boolean | null;
  deletedAt?: string | null;
};

const baseGroups: GroupSummary[] = [
  {
    id: 'group-1',
    displayName: 'Finance Team',
    externalId: 'ext-finance',
    active: true,
    memberCount: 2,
    updatedAt: '2026-03-28T00:00:00.000Z',
    isScimManaged: false,
  },
  {
    id: 'group-2',
    displayName: 'Corp Directory',
    externalId: 'ext-scim',
    active: true,
    memberCount: 1,
    updatedAt: '2026-03-28T01:00:00.000Z',
    isScimManaged: true,
  },
];

const financeMembers: GroupMember[] = [
  {
    userAccountId: 'ua-1',
    userId: 'user-a',
    displayName: 'Alice',
    active: true,
  },
  {
    userAccountId: 'ua-2',
    userId: 'user-b',
    displayName: null,
    active: false,
  },
];

function setupApi(overrides?: {
  onCreate?: (body: {
    displayName: string;
    active: boolean;
    userIds: string[];
  }) => void;
  onUpdate?: (body: { displayName: string; active: boolean }) => void;
  onAddMembers?: (body: { userIds: string[] }) => void;
  onRemoveMembers?: (body: { userIds: string[] }) => void;
  failGroups?: boolean;
  failMembers?: boolean;
}) {
  let groups = [...baseGroups];
  const membersByGroup: Record<string, GroupMember[]> = {
    'group-1': [...financeMembers],
    'group-2': [],
    'group-3': [],
  };

  api.mockImplementation(
    async (path: string, options?: { method?: string; body?: string }) => {
      if (path === '/groups' && !options?.method) {
        if (overrides?.failGroups) throw new Error('load groups failed');
        return { items: groups };
      }
      if (path === '/groups' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}') as {
          displayName: string;
          active: boolean;
          userIds: string[];
        };
        overrides?.onCreate?.(body);
        groups = [
          ...groups,
          {
            id: 'group-3',
            displayName: body.displayName,
            active: body.active,
            memberCount: body.userIds.length,
            updatedAt: '2026-03-28T02:00:00.000Z',
            isScimManaged: false,
          },
        ];
        membersByGroup['group-3'] = body.userIds.map((userId, index) => ({
          userAccountId: `ua-new-${index + 1}`,
          userId,
          active: true,
        }));
        return { id: 'group-3' };
      }
      if (path === '/groups/group-1' && options?.method === 'PATCH') {
        const body = JSON.parse(options.body || '{}') as {
          displayName: string;
          active: boolean;
        };
        overrides?.onUpdate?.(body);
        groups = groups.map((group) =>
          group.id === 'group-1'
            ? { ...group, displayName: body.displayName, active: body.active }
            : group,
        );
        return {};
      }
      if (path === '/groups/group-1/members' && !options?.method) {
        if (overrides?.failMembers) throw new Error('load members failed');
        return { items: membersByGroup['group-1'] };
      }
      if (path === '/groups/group-2/members' && !options?.method) {
        if (overrides?.failMembers) throw new Error('load members failed');
        return { items: membersByGroup['group-2'] };
      }
      if (path === '/groups/group-3/members' && !options?.method) {
        return { items: membersByGroup['group-3'] };
      }
      if (path === '/groups/group-1/members' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}') as { userIds: string[] };
        overrides?.onAddMembers?.(body);
        membersByGroup['group-1'] = [
          ...membersByGroup['group-1'],
          ...body.userIds.map((userId, index) => ({
            userAccountId: `ua-added-${index + 1}`,
            userId,
            active: true,
          })),
        ];
        return {};
      }
      if (path === '/groups/group-1/members' && options?.method === 'DELETE') {
        const body = JSON.parse(options.body || '{}') as { userIds: string[] };
        overrides?.onRemoveMembers?.(body);
        membersByGroup['group-1'] = membersByGroup['group-1'].filter(
          (member) => !body.userIds.includes(member.userId),
        );
        return {};
      }
      throw new Error(
        `unexpected api call: ${path} ${options?.method || 'GET'}`,
      );
    },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  api.mockReset();
  getAuthState.mockReset();
  getAuthState.mockReturnValue({ userId: 'admin-1', roles: ['admin'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GroupManagementCard', () => {
  function getCreateSection() {
    return within(
      screen.getByText('新規グループ').parentElement as HTMLElement,
    );
  }

  function getExistingSection() {
    return within(
      screen.getByText('既存グループ').parentElement as HTMLElement,
    );
  }

  it('shows a read-only message for non-admin users', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['user'] });
    setupApi();

    render(<GroupManagementCard />);

    expect(screen.getByText('admin/mgmt のみ操作できます')).toBeInTheDocument();
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/groups');
    });
  });

  it('loads groups, members, and reflects SCIM managed selection', async () => {
    setupApi();

    render(<GroupManagementCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('グループ')).toHaveValue('group-1');
    });

    await waitFor(() => {
      expect(screen.getAllByLabelText('表示名')[1]).toHaveValue('Finance Team');
      expect(screen.getByText('メンバー数: 2')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    expect(screen.getByText(/externalId: ext-finance/)).toBeInTheDocument();
    expect(screen.getByText('無効')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('グループ'), {
      target: { value: 'group-2' },
    });

    await waitFor(() => {
      expect(
        screen.getByText('SCIM管理グループは手動で編集できません'),
      ).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Corp Directory')).toBeDisabled();
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled();
    expect(
      screen.getByText('メンバーが登録されていません'),
    ).toBeInTheDocument();
  });

  it('validates create input and creates a group with normalized user ids', async () => {
    const onCreate = vi.fn();
    setupApi({ onCreate });

    render(<GroupManagementCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('グループ')).toHaveValue('group-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(screen.getByText('表示名を入力してください')).toBeInTheDocument();

    fireEvent.change(getCreateSection().getByLabelText('表示名'), {
      target: { value: ' Accounting Ops ' },
    });
    fireEvent.change(screen.getByLabelText('初期メンバー（userId, 区切り）'), {
      target: { value: ' user-c, user-d ,, ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        displayName: 'Accounting Ops',
        active: true,
        userIds: ['user-c', 'user-d'],
      });
      expect(screen.getByText('グループを作成しました')).toBeInTheDocument();
      expect(screen.getByLabelText('グループ')).toHaveValue('group-3');
    });

    expect(getCreateSection().getByLabelText('表示名')).toHaveValue('');
    expect(screen.getByLabelText('初期メンバー（userId, 区切り）')).toHaveValue(
      '',
    );
  });

  it('updates groups and adds/removes members with normalized ids', async () => {
    const onUpdate = vi.fn();
    const onAddMembers = vi.fn();
    const onRemoveMembers = vi.fn();
    setupApi({ onUpdate, onAddMembers, onRemoveMembers });

    render(<GroupManagementCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('グループ')).toHaveValue('group-1');
    });

    const existingSection = getExistingSection();

    fireEvent.change(existingSection.getByLabelText('表示名'), {
      target: { value: 'Finance Ops' },
    });
    fireEvent.click(existingSection.getByLabelText('有効'));
    fireEvent.click(existingSection.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        displayName: 'Finance Ops',
        active: false,
      });
      expect(screen.getByText('グループを更新しました')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('追加（userId, 区切り）'), {
      target: { value: ' user-c, user-d ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      expect(onAddMembers).toHaveBeenCalledWith({
        userIds: ['user-c', 'user-d'],
      });
      expect(screen.getByText('メンバーを追加しました')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('削除（userId, 区切り）'), {
      target: { value: ' user-b ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '削除' }));

    await waitFor(() => {
      expect(onRemoveMembers).toHaveBeenCalledWith({ userIds: ['user-b'] });
      expect(screen.getByText('メンバーを削除しました')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    expect(rows.some((row) => within(row).queryByText('user-c'))).toBe(true);
    expect(rows.some((row) => within(row).queryByText('user-b'))).toBe(false);
  });

  it('shows a group load error', async () => {
    setupApi({ failGroups: true });

    render(<GroupManagementCard />);

    await waitFor(() => {
      expect(
        screen.getByText('グループ一覧の取得に失敗しました'),
      ).toBeInTheDocument();
    });
  });

  it('shows a member load error', async () => {
    setupApi({ failMembers: true });

    render(<GroupManagementCard />);

    await waitFor(() => {
      expect(
        screen.getByText('グループメンバーの取得に失敗しました'),
      ).toBeInTheDocument();
    });
  });
});
