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

import {
  ChatEvidencePicker,
  type ChatEvidenceCandidate,
} from './ChatEvidencePicker';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof ChatEvidencePicker>> = {},
) {
  const props: React.ComponentProps<typeof ChatEvidencePicker> = {
    projectId: 'proj-1',
    onAddCandidate: vi.fn(),
    onInsertCandidate: vi.fn(),
    onCopyCandidate: vi.fn(),
    ...overrides,
  };
  return render(<ChatEvidencePicker {...props} />);
}

const candidate: ChatEvidenceCandidate = {
  id: 'msg-1',
  label: 'chat_message:msg-1',
  url: '',
  roomId: 'room-1',
  roomName: 'ルームA',
  projectLabel: '案件A',
  userId: 'user-1',
  createdAt: 'not-a-date',
  excerpt: '会話の本文',
};

const expectedCandidate: ChatEvidenceCandidate = {
  ...candidate,
  url: '/#/open?kind=chat_message&id=msg-1',
};

beforeEach(() => {
  vi.mocked(apiResponse).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatEvidencePicker', () => {
  it('shows a validation message when projectId is missing', async () => {
    renderPicker({ projectId: undefined });

    fireEvent.change(screen.getByLabelText('キーワード'), {
      target: { value: 'ab' },
    });
    fireEvent.keyDown(screen.getByLabelText('キーワード'), { key: 'Enter' });

    await waitFor(() =>
      expect(
        screen.getByText('案件ID未指定のため候補検索は利用できません'),
      ).toBeInTheDocument(),
    );
    expect(apiResponse).not.toHaveBeenCalled();
  });

  it('shows a validation message when the query is too short', async () => {
    renderPicker();

    fireEvent.change(screen.getByLabelText('キーワード'), {
      target: { value: 'a' },
    });
    fireEvent.keyDown(screen.getByLabelText('キーワード'), { key: 'Enter' });

    await waitFor(() =>
      expect(
        screen.getByText('検索キーワードは2文字以上で入力してください'),
      ).toBeInTheDocument(),
    );
    expect(apiResponse).not.toHaveBeenCalled();
  });

  it('shows the candidate card and delegates actions on success', async () => {
    const onAddCandidate = vi.fn();
    const onInsertCandidate = vi.fn();
    const onCopyCandidate = vi.fn();

    vi.mocked(apiResponse).mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            kind: 'chat_message',
            id: candidate.id,
            label: candidate.label,
            url: '',
            projectLabel: candidate.projectLabel,
            meta: {
              roomId: candidate.roomId,
              roomName: candidate.roomName,
              userId: candidate.userId,
              createdAt: candidate.createdAt,
              excerpt: candidate.excerpt,
            },
          },
        ],
      }),
    );

    renderPicker({ onAddCandidate, onInsertCandidate, onCopyCandidate });

    fireEvent.change(screen.getByLabelText('キーワード'), {
      target: { value: '仕様' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() =>
      expect(screen.getByText('案件A / ルームA')).toBeInTheDocument(),
    );
    expect(screen.getByText('会話の本文')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === '投稿日時: not-a-date / 投稿者: user-1',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'メモへ挿入' }));
    fireEvent.click(screen.getByRole('button', { name: 'URLコピー' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdownコピー' }));

    expect(onAddCandidate).toHaveBeenCalledWith(
      expect.objectContaining(expectedCandidate),
    );
    expect(onInsertCandidate).toHaveBeenCalledWith(
      expect.objectContaining(expectedCandidate),
    );
    expect(onCopyCandidate).toHaveBeenNthCalledWith(
      1,
      'url',
      expect.objectContaining(expectedCandidate),
    );
    expect(onCopyCandidate).toHaveBeenNthCalledWith(
      2,
      'markdown',
      expect.objectContaining(expectedCandidate),
    );
    expect(apiResponse).toHaveBeenCalledWith(
      '/ref-candidates?projectId=proj-1&q=%E4%BB%95%E6%A7%98&limit=20&types=chat_message',
    );
  });

  it('shows the no-match message when search returns no candidates', async () => {
    vi.mocked(apiResponse).mockResolvedValueOnce(
      jsonResponse({
        items: [],
      }),
    );

    renderPicker();

    fireEvent.change(screen.getByLabelText('キーワード'), {
      target: { value: '仕様' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() =>
      expect(
        screen.getByText('「仕様」に一致する候補はありません'),
      ).toBeInTheDocument(),
    );
    expect(apiResponse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['query_too_short', '検索キーワードは2文字以上で入力してください'],
    ['forbidden_project', '案件スコープ外のため候補を取得できません'],
    ['project_not_found', '案件が見つかりません'],
    ['unexpected_error', '候補の取得に失敗しました'],
  ] as const)('shows the %s error message', async (code, message) => {
    vi.mocked(apiResponse).mockResolvedValueOnce(
      jsonResponse({ error: { code } }, { status: 400 }),
    );

    renderPicker();

    fireEvent.change(screen.getByLabelText('キーワード'), {
      target: { value: '仕様' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(apiResponse).toHaveBeenCalledTimes(1);
  });

  it('normalizes candidate fallback fields when the API omits metadata', async () => {
    const onAddCandidate = vi.fn();

    vi.mocked(apiResponse).mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            kind: 'chat_message',
            id: 'chat-2',
            label: '',
            url: 'https://example.test/open?kind=chat_message&id=chat-2',
            projectLabel: '',
            meta: {},
          },
        ],
      }),
    );

    renderPicker({ projectId: 'project-1', onAddCandidate });

    fireEvent.change(screen.getByLabelText('キーワード'), {
      target: { value: '確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      expect(screen.getByText('案件未設定 / -')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        (_, element) => element?.textContent === '投稿日時: - / 投稿者: -',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('(本文なし)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(onAddCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chat-2',
        label: 'chat_message:chat-2',
        url: '/#/open?kind=chat_message&id=chat-2',
        roomId: '',
        roomName: '',
        userId: '',
        createdAt: '',
        excerpt: '',
      }),
    );
  });
});
