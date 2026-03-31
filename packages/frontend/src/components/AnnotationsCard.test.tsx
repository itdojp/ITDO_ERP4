import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse, getAuthState, copyToClipboard } = vi.hoisted(() => ({
  apiResponse: vi.fn(),
  getAuthState: vi.fn(),
  copyToClipboard: vi.fn(),
}));

vi.mock('../api', () => ({
  apiResponse,
  getAuthState,
}));
vi.mock('../utils/clipboard', () => ({
  copyToClipboard,
}));
vi.mock('./ChatEvidencePicker', () => ({
  ChatEvidencePicker: () => <div data-testid="chat-evidence-picker" />,
}));

import { AnnotationsCard } from './AnnotationsCard';

type ApiResponseInit = {
  ok?: boolean;
  status?: number;
  payload?: Record<string, unknown>;
};

function jsonResponse(body: unknown, init?: ApiResponseInit) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  } as Response;
}

function makeLoadResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    targetKind: 'project',
    targetId: 'project-1',
    notes: 'initial note',
    externalUrls: ['https://safe.example/path', 'javascript:alert(1)'],
    internalRefs: [
      { kind: 'project_chat', id: 'room-1', label: 'Room One' },
      { kind: 'chat_message', id: 'msg-1', label: 'Chat One' },
      { kind: 'chat_message', id: 'msg-1', label: 'Chat One Duplicate' },
    ],
    updatedAt: '2026-03-28T00:00:00.000Z',
    updatedBy: 'user-1',
    ...overrides,
  });
}

function renderCard() {
  return render(
    <AnnotationsCard
      targetKind="project"
      targetId="project-1"
      projectId="proj-1"
      title="案件注釈"
    />,
  );
}

function getManualRefAddButton() {
  const manualInput = screen.getByLabelText('手動追加（deep link / kind:id）');
  const manualControls = manualInput.parentElement?.parentElement;
  expect(manualControls).not.toBeNull();
  return within(manualControls as HTMLElement).getByRole('button', {
    name: '追加',
  });
}

beforeEach(() => {
  vi.mocked(apiResponse).mockReset();
  vi.mocked(apiResponse).mockImplementation(async (path: string) => {
    if (path === '/chat-messages/msg-1') {
      return jsonResponse({ id: 'msg-1' });
    }
    throw new Error(`Unhandled api path: ${path}`);
  });
  vi.mocked(getAuthState).mockReturnValue({ userId: 'user-1', roles: [] });
  vi.mocked(copyToClipboard).mockResolvedValue(true);
  window.history.pushState({}, '', '/projects/project-1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AnnotationsCard', () => {
  it('normalizes loaded annotations and renders unsafe URLs as plain text', async () => {
    vi.mocked(apiResponse).mockResolvedValueOnce(makeLoadResponse());

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );
    const loadMeta = screen.getAllByText(
      (_, node) =>
        !!node?.textContent &&
        node.textContent.includes('更新:') &&
        node.textContent.includes('更新者: user-1'),
    )[0];
    expect(loadMeta).toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://safe.example/path' }),
    ).toHaveAttribute('href', 'https://safe.example/path');
    expect(screen.getAllByText('room_chat')).toHaveLength(1);
    expect(screen.getAllByText('Chat One')[0]).toBeInTheDocument();
    expect(apiResponse).toHaveBeenCalledWith('/annotations/project/project-1');
  });

  it('saves annotations and reflects the server response', async () => {
    const savedResponse = jsonResponse({
      targetKind: 'project',
      targetId: 'project-1',
      notes: 'saved note',
      externalUrls: [
        'https://safe.example/path',
        'javascript:alert(1)',
        'https://new.example/path',
      ],
      internalRefs: [
        { kind: 'room_chat', id: 'room-1', label: 'Room One' },
        { kind: 'chat_message', id: 'msg-1', label: 'Chat One' },
        { kind: 'room_chat', id: 'room-2', label: 'Room Two' },
      ],
      updatedAt: '2026-03-28T01:00:00.000Z',
      updatedBy: 'admin-1',
    });
    vi.mocked(apiResponse).mockImplementation(async (path: string, init) => {
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      if (
        path === '/annotations/project/project-1' &&
        init?.method === 'PATCH'
      ) {
        return savedResponse;
      }
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('メモ（Markdown）'), {
      target: { value: 'updated note' },
    });
    fireEvent.change(screen.getByLabelText('追加（スペース区切りで複数可）'), {
      target: { value: 'https://new.example/path' },
    });
    const externalUrlInput =
      screen.getByLabelText('追加（スペース区切りで複数可）');
    const externalUrlControls = externalUrlInput.parentElement?.parentElement;
    expect(externalUrlControls).not.toBeNull();
    fireEvent.click(
      within(externalUrlControls as HTMLElement).getByRole('button', {
        name: '追加',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(screen.getByText('保存しました')).toBeInTheDocument(),
    );
    const savedMeta = screen.getAllByText(
      (_, node) =>
        !!node?.textContent &&
        node.textContent.includes('更新:') &&
        node.textContent.includes('更新者: admin-1'),
    )[0];
    expect(savedMeta).toBeInTheDocument();
    expect(screen.getByDisplayValue('saved note')).toBeInTheDocument();
    expect(apiResponse).toHaveBeenCalledWith(
      '/annotations/project/project-1',
      expect.objectContaining({ method: 'PATCH' }),
    );

    const patchCall = vi
      .mocked(apiResponse)
      .mock.calls.find(
        ([path, init]) =>
          path === '/annotations/project/project-1' && init?.method === 'PATCH',
      );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(String(patchCall?.[1]?.body));
    expect(body).toMatchObject({
      notes: 'updated note',
    });
    expect(body).not.toHaveProperty('reasonText');
    expect(body.externalUrls).toEqual(
      expect.arrayContaining([
        'https://safe.example/path',
        'javascript:alert(1)',
        'https://new.example/path',
      ]),
    );
    expect(body.internalRefs).toEqual([
      { kind: 'room_chat', id: 'room-1', label: 'Room One' },
      { kind: 'chat_message', id: 'msg-1', label: 'Chat One' },
    ]);
  });

  it('copies links and shows success feedback', async () => {
    vi.mocked(apiResponse).mockResolvedValueOnce(makeLoadResponse());
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    renderCard();

    await waitFor(() =>
      expect(screen.getByText('initial note')).toBeInTheDocument(),
    );

    const externalRow = screen
      .getByText('https://safe.example/path')
      .closest('div');
    expect(externalRow).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        within(externalRow as HTMLElement).getByRole('button', {
          name: 'コピー',
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText('リンクURLをコピーしました')).toBeInTheDocument(),
    );
    expect(copyToClipboard).toHaveBeenCalledWith('https://safe.example/path');
  });

  it('copies internal ref markdown links and shows success feedback', async () => {
    vi.mocked(apiResponse).mockResolvedValueOnce(makeLoadResponse());
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    renderCard();

    await waitFor(() =>
      expect(screen.getByText('initial note')).toBeInTheDocument(),
    );

    const roomLink = screen.getByRole('link', { name: 'Room One' });
    const roomRow = roomLink.closest('div');
    expect(roomRow).not.toBeNull();

    await act(async () => {
      fireEvent.click(
        within(roomRow as HTMLElement).getByRole('button', {
          name: 'Markdown',
        }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText('Markdownリンクをコピーしました'),
      ).toBeInTheDocument(),
    );
    expect(copyToClipboard).toHaveBeenCalledWith(
      '[Room One](/#/open?kind=room_chat&id=room-1)',
    );
  });

  it('shows an error when the manual internal ref is invalid', async () => {
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('手動追加（deep link / kind:id）'), {
      target: { value: 'invalid-ref' },
    });
    fireEvent.click(getManualRefAddButton());

    await waitFor(() =>
      expect(
        screen.getByText('内部参照が不正です（deep link / kind:id）'),
      ).toBeInTheDocument(),
    );
  });

  it('rejects forbidden manual chat_message refs', async () => {
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      if (path === '/chat-messages/msg-forbidden') {
        return jsonResponse(
          { error: { code: 'FORBIDDEN_ROOM_MEMBER' } },
          { ok: false, status: 403 },
        );
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('手動追加（deep link / kind:id）'), {
      target: { value: 'chat_message:msg-forbidden' },
    });
    fireEvent.click(getManualRefAddButton());

    await waitFor(() =>
      expect(
        screen.getByText('この発言は権限不足のため追加できません'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('link', { name: 'chat_message:msg-forbidden' }),
    ).not.toBeInTheDocument();
  });

  it('normalizes project_chat manual refs into room_chat links', async () => {
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('手動追加（deep link / kind:id）'), {
      target: { value: 'project_chat:room-2' },
    });
    fireEvent.click(getManualRefAddButton());

    await waitFor(() =>
      expect(screen.getByText('内部参照を追加しました')).toBeInTheDocument(),
    );
    const roomLink = screen.getByRole('link', { name: 'room_chat:room-2' });
    expect(roomLink).toHaveAttribute(
      'href',
      '/#/open?kind=room_chat&id=room-2',
    );
  });

  it('shows a copy failure message when copying an external url fails', async () => {
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });
    vi.mocked(copyToClipboard).mockResolvedValue(false);

    renderCard();

    await waitFor(() =>
      expect(screen.getByText('initial note')).toBeInTheDocument(),
    );

    const externalRow = screen
      .getByText('https://safe.example/path')
      .closest('div');
    expect(externalRow).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        within(externalRow as HTMLElement).getByRole('button', {
          name: 'コピー',
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText('コピーに失敗しました')).toBeInTheDocument(),
    );
  });

  it('shows a save error message when the patch request fails', async () => {
    vi.mocked(apiResponse).mockImplementation(async (path: string, init) => {
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      if (
        path === '/annotations/project/project-1' &&
        init?.method === 'PATCH'
      ) {
        throw new Error('patch_failed');
      }
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('メモ（Markdown）'), {
      target: { value: 'broken note' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(screen.getByText('保存に失敗しました')).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('broken note')).toBeInTheDocument();
  });

  it.each([
    {
      mode: 'forbidden',
      expectedMessage: 'この発言は権限不足のため追加できません',
      validationResponseFactory: () =>
        jsonResponse(
          { error: { code: 'FORBIDDEN_PROJECT' } },
          { ok: false, status: 403 },
        ),
    },
    {
      mode: 'not_found',
      expectedMessage: 'この発言は見つからないため追加できません',
      validationResponseFactory: () =>
        jsonResponse(
          { error: { code: 'NOT_FOUND' } },
          { ok: false, status: 404 },
        ),
    },
    {
      mode: 'generic error',
      expectedMessage: '発言の参照状態確認に失敗したため追加できません',
      validationResponseFactory: () =>
        jsonResponse(
          { error: { code: 'INTERNAL_ERROR' } },
          { ok: false, status: 500 },
        ),
    },
  ] as const)(
    'chat_message の手動追加で $mode エラー時は保存せずにエラーを表示する',
    async ({ expectedMessage, validationResponseFactory }) => {
      vi.mocked(apiResponse).mockImplementation(async (path: string) => {
        if (path === '/chat-messages/msg-1') {
          return jsonResponse({ id: 'msg-1' });
        }
        if (path === '/chat-messages/msg-2') {
          return validationResponseFactory!();
        }
        if (path === '/annotations/project/project-1') {
          return makeLoadResponse();
        }
        throw new Error(`Unhandled api path: ${path}`);
      });

      renderCard();

      await waitFor(() =>
        expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
      );

      const manualRefInput = screen.getByLabelText(
        '手動追加（deep link / kind:id）',
      );
      fireEvent.change(manualRefInput, {
        target: { value: 'chat_message:msg-2' },
      });
      const manualRefControls = manualRefInput.parentElement?.parentElement;
      expect(manualRefControls).not.toBeNull();
      fireEvent.click(
        within(manualRefControls as HTMLElement).getByRole('button', {
          name: '追加',
        }),
      );

      await waitFor(() =>
        expect(screen.getByText(expectedMessage)).toBeInTheDocument(),
      );
      expect(screen.queryByText('chat_message:msg-2')).not.toBeInTheDocument();
      expect(
        vi
          .mocked(apiResponse)
          .mock.calls.filter(
            ([path, init]) =>
              path === '/annotations/project/project-1' &&
              init?.method === 'PATCH',
          ),
      ).toHaveLength(0);
    },
  );

  it('requires an admin reason and sends it on retry', async () => {
    const savedResponse = jsonResponse({
      targetKind: 'project',
      targetId: 'project-1',
      notes: 'saved note with reason',
      externalUrls: ['https://safe.example/path', 'javascript:alert(1)'],
      internalRefs: [
        { kind: 'room_chat', id: 'room-1', label: 'Room One' },
        { kind: 'chat_message', id: 'msg-1', label: 'Chat One' },
      ],
      updatedAt: '2026-03-28T03:00:00.000Z',
      updatedBy: 'admin-1',
    });
    let patchCount = 0;
    vi.mocked(getAuthState).mockReturnValue({
      userId: 'admin-1',
      roles: ['admin'],
    });
    vi.mocked(apiResponse).mockImplementation(async (path: string, init) => {
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      if (
        path === '/annotations/project/project-1' &&
        init?.method === 'PATCH'
      ) {
        patchCount += 1;
        if (patchCount === 1) {
          return jsonResponse(
            { error: 'reason_required' },
            { ok: false, status: 400 },
          );
        }
        return savedResponse;
      }
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByDisplayValue('initial note')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('メモ（Markdown）'), {
      target: { value: 'updated note with reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(
        screen.getByText('管理者更新のため理由の入力が必要です'),
      ).toBeInTheDocument(),
    );

    const reasonInput = screen.getByLabelText('管理者更新理由（必須）');
    fireEvent.change(reasonInput, {
      target: { value: '承認後に補足情報を追記するため' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(screen.getByText('保存しました')).toBeInTheDocument(),
    );
    expect(
      screen.queryByLabelText('管理者更新理由（必須）'),
    ).not.toBeInTheDocument();

    const patchCalls = vi
      .mocked(apiResponse)
      .mock.calls.filter(
        ([path, init]) =>
          path === '/annotations/project/project-1' && init?.method === 'PATCH',
      );
    expect(patchCalls).toHaveLength(2);
    const secondBody = JSON.parse(String(patchCalls[1]?.[1]?.body));
    expect(secondBody).toMatchObject({
      notes: 'updated note with reason',
      reasonText: '承認後に補足情報を追記するため',
    });
  });

  it('shows history load failures and allows retrying the load', async () => {
    let historyCallCount = 0;
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      if (path === '/annotations/project/project-1/history?limit=50') {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          throw new Error('history_failed');
        }
        return jsonResponse({
          items: [
            {
              id: 'hist-1',
              createdAt: '2026-03-28T02:00:00.000Z',
              createdBy: 'admin-2',
              actorRole: 'admin',
              reasonCode: 'admin_override',
              reasonText: '修正',
              notes: 'updated note',
              externalUrls: ['https://safe.example/path'],
              internalRefs: [
                { kind: 'room_chat', id: 'room-1', label: 'Room One' },
              ],
            },
          ],
        });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByText('initial note')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: '履歴を表示' }));

    await waitFor(() =>
      expect(screen.getByText('履歴の取得に失敗しました')).toBeInTheDocument(),
    );

    const historyHeading = screen.getByText('履歴（監査ログ）');
    const historyCard = historyHeading.parentElement?.parentElement;
    expect(historyCard).not.toBeNull();
    fireEvent.click(
      within(historyCard as HTMLElement).getByRole('button', {
        name: '再読込',
      }),
    );

    await waitFor(() =>
      expect(screen.getByText('注釈更新')).toBeInTheDocument(),
    );
    expect(screen.getByText('管理者更新')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, node) => !!node?.textContent && node.textContent.includes('修正'),
      )[0],
    ).toBeInTheDocument();
  });

  it('shows an empty history state when the server returns no entries', async () => {
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/annotations/project/project-1') {
        return makeLoadResponse();
      }
      if (path === '/chat-messages/msg-1') {
        return jsonResponse({ id: 'msg-1' });
      }
      if (path === '/annotations/project/project-1/history?limit=50') {
        return jsonResponse({ items: [] });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    renderCard();

    await waitFor(() =>
      expect(screen.getByText('initial note')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: '履歴を表示' }));

    await waitFor(() =>
      expect(screen.getByText('履歴はありません')).toBeInTheDocument(),
    );
  });
});
