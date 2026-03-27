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

const { api, apiResponse, getAuthState, navigateToOpen } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  getAuthState: vi.fn(),
  navigateToOpen: vi.fn(),
}));

vi.mock('../api', () => ({ api, apiResponse, getAuthState }));
vi.mock('../utils/deepLink', () => ({ navigateToOpen }));

import { Approvals } from './Approvals';

type MockJsonResponseOptions = {
  ok?: boolean;
  status?: number;
  payload?: Record<string, unknown>;
};

type ApprovalOverride = Partial<{
  id: string;
  flowType: string;
  targetTable: string;
  targetId: string;
  projectId: string | null;
  status: string;
  currentStep: number | null;
  createdAt: string | null;
  createdBy: string | null;
  steps: Array<Record<string, unknown>>;
  rule: Record<string, unknown> | null;
}>;

function makeJsonResponse(options?: MockJsonResponseOptions) {
  return {
    ok: options?.ok ?? true,
    status: options?.status ?? 200,
    json: async () => options?.payload ?? {},
  } as Response;
}

function makeApproval(overrides?: ApprovalOverride) {
  return {
    id: 'approval-1',
    flowType: 'invoice',
    targetTable: 'invoices',
    targetId: 'inv-1',
    projectId: 'pj-1',
    status: 'pending_qa',
    currentStep: 0,
    createdAt: '2026-03-27T00:00:00.000Z',
    createdBy: 'requester-1',
    steps: [
      {
        id: 'step-1',
        stepOrder: 0,
        approverGroupId: 'general_affairs',
        status: 'pending_qa',
      },
    ],
    rule: { id: 'rule-1', name: 'default-rule' },
    ...overrides,
  };
}

function mockApiRoutes(options?: {
  approvals?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  ackLinks?: Record<string, unknown>[];
}) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/projects') {
      return {
        items: options?.projects ?? [
          { id: 'pj-1', code: 'PJ-001', name: 'Alpha' },
        ],
      } as never;
    }
    if (path.startsWith('/approval-instances')) {
      return {
        items: options?.approvals ?? [makeApproval()],
      } as never;
    }
    if (path.startsWith('/chat-ack-links?targetTable=approval_instances')) {
      return {
        items: options?.ackLinks ?? [],
      } as never;
    }
    throw new Error(`Unhandled api path: ${path}`);
  });
}

function mockApiResponseRoutes(options?: {
  actResponse?: MockJsonResponseOptions;
  annotationResponse?: MockJsonResponseOptions;
  snapshotGetResponse?: MockJsonResponseOptions;
  snapshotPostResponse?: MockJsonResponseOptions;
  chatPreviewResponse?: MockJsonResponseOptions;
  chatAckCreateResponse?: MockJsonResponseOptions;
}) {
  vi.mocked(apiResponse).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (
        path === '/approval-instances/approval-1/act' &&
        init?.method === 'POST'
      ) {
        return makeJsonResponse(options?.actResponse);
      }
      if (path === '/annotations/invoice/inv-1') {
        return makeJsonResponse(
          options?.annotationResponse ?? {
            payload: {
              targetKind: 'invoice',
              targetId: 'inv-1',
              notes: 'annotation-note',
              internalRefs: [
                { kind: 'chat_message', id: 'msg-1', label: 'message-label' },
              ],
            },
          },
        );
      }
      if (path === '/approval-instances/approval-1/evidence-snapshot') {
        if (init?.method === 'POST') {
          return makeJsonResponse(options?.snapshotPostResponse);
        }
        return makeJsonResponse(
          options?.snapshotGetResponse ?? {
            payload: {
              exists: true,
              snapshot: {
                id: 'snapshot-1',
                approvalInstanceId: 'approval-1',
                targetTable: 'invoices',
                targetId: 'inv-1',
                capturedAt: '2026-03-27T01:00:00.000Z',
                capturedBy: 'admin-user',
                version: 2,
                items: {
                  externalUrls: ['https://example.com/evidence'],
                  internalRefs: [{ kind: 'chat_message', id: 'msg-1' }],
                  chatMessages: [],
                },
              },
            },
          },
        );
      }
      if (path === '/chat-messages/msg-1') {
        return makeJsonResponse(
          options?.chatPreviewResponse ?? {
            payload: {
              id: 'msg-1',
              roomId: 'room-1',
              createdAt: '2026-03-27T01:00:00.000Z',
              excerpt: 'preview body',
            },
          },
        );
      }
      if (path === '/chat-ack-links' && init?.method === 'POST') {
        return makeJsonResponse(
          options?.chatAckCreateResponse ?? {
            payload: {
              id: 'ack-link-1',
            },
          },
        );
      }
      throw new Error(`Unhandled apiResponse path: ${path}`);
    },
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthState).mockReturnValue({
    token: 'token',
    userId: 'admin-user',
    roles: ['admin'],
    groupIds: [],
    groupAccountIds: ['general_affairs'],
  });
  mockApiRoutes();
  mockApiResponseRoutes();
});

describe('Approvals', () => {
  it('loads approvals with the default pending_qa filter and approves an actionable item', async () => {
    render(<Approvals />);

    expect(
      await screen.findByText(/invoice \/ invoices:inv-1/),
    ).toBeInTheDocument();
    expect(vi.mocked(api)).toHaveBeenCalledWith('/projects');
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/approval-instances?status=pending_qa',
    );

    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    expect(await screen.findByText('承認しました')).toBeInTheDocument();
    expect(vi.mocked(apiResponse)).toHaveBeenCalledWith(
      '/approval-instances/approval-1/act',
      expect.objectContaining({ method: 'POST' }),
    );
    await waitFor(() => {
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(
            ([path]) => path === '/approval-instances?status=pending_qa',
          ).length,
      ).toBeGreaterThan(1);
    });
  });

  it('maps ACTION_POLICY_DENIED with expired chat ack requests to a specific message', async () => {
    mockApiResponseRoutes({
      actResponse: {
        ok: false,
        status: 409,
        payload: {
          error: {
            code: 'ACTION_POLICY_DENIED',
            details: {
              guardFailures: [
                {
                  type: 'chat_ack_completed',
                  details: {
                    requests: [{ id: 'ack-1', reason: 'expired' }],
                  },
                },
              ],
            },
          },
        },
      },
    });

    render(<Approvals />);

    await screen.findByText(/invoice \/ invoices:inv-1/);
    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    expect(
      await screen.findByText('確認依頼リンクに期限超過の未確認ユーザがいます'),
    ).toBeInTheDocument();
  });

  it('validates chat ack link input before issuing a create request', async () => {
    render(<Approvals />);

    await screen.findByText(/invoice \/ invoices:inv-1/);
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(
      await screen.findByText(
        '発言URL / Markdown / messageId を入力してください',
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(apiResponse)).not.toHaveBeenCalledWith(
      '/chat-ack-links',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows an unsupported evidence message for unsupported approval targets', async () => {
    mockApiRoutes({
      approvals: [
        makeApproval({
          targetTable: 'leave_requests',
          targetId: 'leave-1',
        }),
      ],
    });
    mockApiResponseRoutes({
      snapshotGetResponse: {
        payload: { exists: false },
      },
    });

    render(<Approvals />);

    await screen.findByText(/invoice \/ leave_requests:leave-1/);
    fireEvent.click(screen.getByRole('button', { name: '表示' }));

    expect(
      await screen.findByText(
        'この承認対象は注釈エビデンス表示の対象外です（対応予定）',
      ),
    ).toBeInTheDocument();
  });

  it('requires a reason before regenerating an evidence snapshot', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('   ');

    try {
      render(<Approvals />);

      await screen.findByText(/invoice \/ invoices:inv-1/);
      fireEvent.click(screen.getByRole('button', { name: '表示' }));
      await screen.findByText(/状態: 生成済み/);

      fireEvent.click(screen.getByRole('button', { name: '再生成' }));

      expect(
        await screen.findByText('再生成には理由が必要です'),
      ).toBeInTheDocument();
      expect(
        vi
          .mocked(apiResponse)
          .mock.calls.some(
            ([path, init]) =>
              path === '/approval-instances/approval-1/evidence-snapshot' &&
              init?.method === 'POST',
          ),
      ).toBe(false);
    } finally {
      promptSpy.mockRestore();
    }
  });

  it('shows a permission guidance when chat preview fetch is forbidden', async () => {
    mockApiResponseRoutes({
      chatPreviewResponse: {
        ok: false,
        status: 403,
        payload: { error: { code: 'FORBIDDEN_ROOM_MEMBER' } },
      },
    });

    render(<Approvals />);

    await screen.findByText(/invoice \/ invoices:inv-1/);
    fireEvent.click(screen.getByRole('button', { name: '表示' }));
    const approvalItem = screen
      .getByText(/invoice \/ invoices:inv-1/)
      .closest('li');
    expect(approvalItem).not.toBeNull();
    const previewButton = await within(
      approvalItem as HTMLLIElement,
    ).findByRole('button', {
      name: 'プレビュー',
    });
    fireEvent.click(previewButton);

    expect(
      await screen.findByText('権限が不足しているため発言を表示できません'),
    ).toBeInTheDocument();
    expect(navigateToOpen).not.toHaveBeenCalled();
  });
});
