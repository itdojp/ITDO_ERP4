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

const BASE_GROUPS: GroupSummary[] = [
  {
    id: 'grp-1',
    displayName: 'Finance',
    externalId: 'ext-fin',
    active: true,
    memberCount: 3,
    updatedAt: '2026-03-10T12:30:00Z',
    isScimManaged: false,
  },
  {
    id: 'grp-2',
    displayName: 'HR',
    externalId: 'ext-hr',
    active: true,
    memberCount: 1,
    updatedAt: 'invalid-date',
    isScimManaged: true,
  },
];

const BASE_MEMBERS: Record<string, GroupMember[]> = {
  'grp-1': [
    {
      userAccountId: 'ua-1',
      userId: 'user-a',
      displayName: 'Alice',
      active: true,
    },
    {
      userAccountId: 'ua-2',
      userId: 'user-b',
      displayName: 'Bob',
      active: false,
    },
    {
      userAccountId: 'ua-3',
      userId: 'user-c',
      displayName: null,
      active: true,
      deletedAt: '2026-03-11T00:00:00Z',
    },
  ],
  'grp-2': [
    {
      userAccountId: 'ua-4',
      userId: 'user-z',
      displayName: 'Zed',
      active: true,
    },
  ],
};

function findSection(title: string) {
  const heading = screen.getByText(title);
  const section = heading.parentElement;
  expect(section).not.toBeNull();
  return within(section as HTMLElement);
}

async function waitForInteractiveState(groupId = 'grp-1') {
  await waitFor(() => {
    expect(screen.getByLabelText('グループ')).toHaveValue(groupId);
    expect(
      findSection('新規グループ').getByRole('button', { name: '作成' }),
    ).toBeEnabled();
  });
}

async function waitForLoadedDefaultGroup() {
  await waitForInteractiveState();
  await waitFor(() => {
    expect(screen.getByRole('cell', { name: 'user-a' })).toBeInTheDocument();
  });
}

function countCalls(path: string, method?: string) {
  return api.mock.calls.filter(([targetPath, options]) => {
    if (targetPath !== path) return false;
    if (!method) return true;
    return (options as { method?: string } | undefined)?.method === method;
  }).length;
}

function hasCall(path: string, method: string, body?: string) {
  return api.mock.calls.some(([targetPath, options]) => {
    if (targetPath !== path) return false;
    const request = options as { method?: string; body?: string } | undefined;
    if (request?.method !== method) return false;
    return body === undefined || request.body === body;
  });
}

function expectExactText(text: string) {
  expect(
    screen.getByText((_, node) => node?.textContent === text),
  ).toBeInTheDocument();
}

function installStatefulApiMock() {
  let groups = BASE_GROUPS.map((group) => ({ ...group }));
  const members = Object.fromEntries(
    Object.entries(BASE_MEMBERS).map(([groupId, items]) => [
      groupId,
      items.map((member) => ({ ...member })),
    ]),
  ) as Record<string, GroupMember[]>;

  api.mockImplementation(
    async (
      path: string,
      options?: { method?: string; body?: string },
    ): Promise<unknown> => {
      const method = options?.method ?? 'GET';

      if (path === '/groups' && method === 'GET') {
        return { items: groups.map((group) => ({ ...group })) };
      }

      if (path === '/groups' && method === 'POST') {
        const payload = JSON.parse(options?.body ?? '{}') as {
          displayName: string;
          active: boolean;
          userIds: string[];
        };
        groups = [
          ...groups,
          {
            id: 'grp-new',
            displayName: payload.displayName,
            active: payload.active,
            memberCount: payload.userIds.length,
            updatedAt: '2026-03-12T09:00:00Z',
            isScimManaged: false,
          },
        ];
        members['grp-new'] = payload.userIds.map((userId, index) => ({
          userAccountId: `ua-new-${index + 1}`,
          userId,
          displayName: null,
          active: true,
        }));
        return { id: 'grp-new' };
      }

      if (path === '/groups/grp-1' && method === 'PATCH') {
        const payload = JSON.parse(options?.body ?? '{}') as {
          displayName: string;
          active: boolean;
        };
        groups = groups.map((group) =>
          group.id === 'grp-1'
            ? {
                ...group,
                displayName: payload.displayName,
                active: payload.active,
                updatedAt: '2026-03-13T09:00:00Z',
              }
            : group,
        );
        return {};
      }

      const membersMatch = path.match(/^\/groups\/([^/]+)\/members$/);
      if (membersMatch && method === 'GET') {
        return {
          items: (members[membersMatch[1]] ?? []).map((member) => ({
            ...member,
          })),
        };
      }

      if (path === '/groups/grp-1/members' && method === 'POST') {
        const payload = JSON.parse(options?.body ?? '{}') as {
          userIds: string[];
        };
        members['grp-1'] = [
          ...members['grp-1'],
          ...payload.userIds.map((userId, index) => ({
            userAccountId: `ua-added-${index + 1}`,
            userId,
            displayName: null,
            active: true,
          })),
        ];
        groups = groups.map((group) =>
          group.id === 'grp-1'
            ? { ...group, memberCount: members['grp-1'].length }
            : group,
        );
        return {};
      }

      if (path === '/groups/grp-1/members' && method === 'DELETE') {
        const payload = JSON.parse(options?.body ?? '{}') as {
          userIds: string[];
        };
        members['grp-1'] = members['grp-1'].filter(
          (member) => !payload.userIds.includes(member.userId),
        );
        groups = groups.map((group) =>
          group.id === 'grp-1'
            ? { ...group, memberCount: members['grp-1'].length }
            : group,
        );
        return {};
      }

      throw new Error(`unexpected request: ${method} ${path}`);
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
  it('shows a read-only message for users without admin or mgmt', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['user'] });
    api.mockResolvedValue({ items: [] });

    render(<GroupManagementCard />);

    expect(screen.getByText('admin/mgmt のみ操作できます')).toBeInTheDocument();
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/groups');
    });
  });

  it('loads groups, members, and disables manual edits for SCIM groups', async () => {
    installStatefulApiMock();

    render(<GroupManagementCard />);

    await waitForLoadedDefaultGroup();

    expect(screen.getByText(/externalId: ext-fin/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'user-a' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('無効')).toBeInTheDocument();
    expect(screen.getByText('削除済み')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('グループ'), {
      target: { value: 'grp-2' },
    });

    await waitFor(() => {
      expect(
        screen.getByText('SCIM管理グループは手動で編集できません'),
      ).toBeInTheDocument();
    });

    expectExactText(
      'id: grp-2 / 更新: invalid-date / externalId: ext-hr / SCIM管理',
    );
    expect(
      findSection('既存グループ').getByRole('button', { name: '更新' }),
    ).toBeDisabled();
    expect(
      findSection('メンバー管理').getByRole('button', { name: '追加' }),
    ).toBeDisabled();
    expect(
      findSection('メンバー管理').getByRole('button', { name: '削除' }),
    ).toBeDisabled();
  });

  it('validates blank create, update, add, and remove inputs', async () => {
    installStatefulApiMock();

    render(<GroupManagementCard />);

    await waitForLoadedDefaultGroup();

    const createSection = findSection('新規グループ');
    fireEvent.click(createSection.getByRole('button', { name: '作成' }));
    await waitFor(() => {
      expectExactText('表示名を入力してください');
    });
    expect(countCalls('/groups', 'POST')).toBe(0);

    const existingSection = findSection('既存グループ');
    fireEvent.change(existingSection.getByLabelText('表示名'), {
      target: { value: '   ' },
    });
    fireEvent.click(existingSection.getByRole('button', { name: '更新' }));
    await waitFor(() => {
      expectExactText('表示名を入力してください');
    });
    expect(countCalls('/groups/grp-1', 'PATCH')).toBe(0);

    const memberSection = findSection('メンバー管理');
    fireEvent.click(memberSection.getByRole('button', { name: '追加' }));
    await waitFor(() => {
      expectExactText('追加するユーザIDを入力してください');
    });
    expect(countCalls('/groups/grp-1/members', 'POST')).toBe(0);

    fireEvent.click(memberSection.getByRole('button', { name: '削除' }));
    await waitFor(() => {
      expectExactText('削除するユーザIDを入力してください');
    });
    expect(countCalls('/groups/grp-1/members', 'DELETE')).toBe(0);
  });

  it('creates groups, updates the selected group, and manages members', async () => {
    installStatefulApiMock();

    render(<GroupManagementCard />);

    await waitForLoadedDefaultGroup();

    const createSection = findSection('新規グループ');
    fireEvent.change(createSection.getByLabelText('表示名'), {
      target: { value: ' New Group ' },
    });
    fireEvent.change(
      createSection.getByLabelText('初期メンバー（userId, 区切り）'),
      {
        target: { value: ' user-x, user-y ,, ' },
      },
    );
    fireEvent.click(createSection.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(
        hasCall(
          '/groups',
          'POST',
          JSON.stringify({
            displayName: 'New Group',
            active: true,
            userIds: ['user-x', 'user-y'],
          }),
        ),
      ).toBe(true);
      expect(screen.getByLabelText('グループ')).toHaveValue('grp-new');
    });

    expect(createSection.getByLabelText('表示名')).toHaveValue('');
    expect(
      createSection.getByLabelText('初期メンバー（userId, 区切り）'),
    ).toHaveValue('');

    fireEvent.change(screen.getByLabelText('グループ'), {
      target: { value: 'grp-1' },
    });

    await waitForLoadedDefaultGroup();

    const existingSection = findSection('既存グループ');
    fireEvent.change(existingSection.getByLabelText('表示名'), {
      target: { value: ' Finance Ops ' },
    });
    fireEvent.click(existingSection.getByLabelText('有効'));
    fireEvent.click(existingSection.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/groups/grp-1', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Finance Ops', active: false }),
      });
    });
    await waitForLoadedDefaultGroup();

    const memberSection = findSection('メンバー管理');
    fireEvent.change(memberSection.getByLabelText('追加（userId, 区切り）'), {
      target: { value: ' user-d, user-e ' },
    });
    fireEvent.click(memberSection.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      expect(
        hasCall(
          '/groups/grp-1/members',
          'POST',
          JSON.stringify({ userIds: ['user-d', 'user-e'] }),
        ),
      ).toBe(true);
    });

    fireEvent.change(memberSection.getByLabelText('削除（userId, 区切り）'), {
      target: { value: ' user-a, user-e ' },
    });
    fireEvent.click(memberSection.getByRole('button', { name: '削除' }));

    await waitFor(() => {
      expect(
        hasCall(
          '/groups/grp-1/members',
          'DELETE',
          JSON.stringify({ userIds: ['user-a', 'user-e'] }),
        ),
      ).toBe(true);
    });
  });

  it('shows load and member load failure messages', async () => {
    let groupLoadCount = 0;
    api.mockImplementation(
      async (path: string, options?: { method?: string }): Promise<unknown> => {
        const method = options?.method ?? 'GET';
        if (path === '/groups' && method === 'GET') {
          groupLoadCount += 1;
          if (groupLoadCount === 1) {
            throw new Error('load groups failed');
          }
          return { items: BASE_GROUPS.map((group) => ({ ...group })) };
        }
        if (path === '/groups/grp-1/members' && method === 'GET') {
          throw new Error('load members failed');
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<GroupManagementCard />);

    await waitFor(() => {
      expect(
        screen.getByText('グループ一覧の取得に失敗しました'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await waitFor(() => {
      expect(
        screen.getByText('グループメンバーの取得に失敗しました'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('メンバーが登録されていません'),
    ).toBeInTheDocument();
  });
});
