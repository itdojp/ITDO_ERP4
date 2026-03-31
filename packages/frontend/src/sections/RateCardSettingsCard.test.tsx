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

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../api', () => ({ api }));

vi.mock('../ui', () => ({
  ConfirmActionDialog: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        {description ? <div>{description}</div> : null}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    ) : null,
}));

import { RateCardSettingsCard } from './RateCardSettingsCard';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

type RateCard = {
  id: string;
  projectId?: string | null;
  role: string;
  workType?: string | null;
  unitPrice: number | string;
  validFrom: string;
  validTo?: string | null;
  currency: string;
};

const projects: ProjectOption[] = [
  { id: 'project-1', code: 'PRJ-1', name: 'Project One' },
  { id: 'project-2', code: 'PRJ-2', name: 'Project Two' },
];

const rateCardItem: RateCard = {
  id: 'rate-card-1',
  projectId: 'project-1',
  role: 'consultant',
  workType: '通常',
  unitPrice: 6000,
  validFrom: '2026-03-01',
  validTo: '2026-12-31',
  currency: 'JPY',
};

function setupApi(options?: {
  projectItems?: ProjectOption[];
  rateCardResponses?: Array<RateCard[] | Error>;
  createResult?: Record<string, unknown>;
  createError?: Error;
  disableResult?: Record<string, unknown>;
  disableError?: Error;
}) {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const rateCardResponses = options?.rateCardResponses ?? [[]];
  let rateCardIndex = 0;

  vi.mocked(api).mockImplementation(async (path, requestOptions = {}) => {
    calls.push({ path, options: requestOptions });

    if (path === '/projects') {
      return { items: options?.projectItems ?? projects };
    }

    if (typeof path === 'string' && path.startsWith('/rate-cards?')) {
      const response =
        rateCardResponses[
          Math.min(rateCardIndex, rateCardResponses.length - 1)
        ];
      rateCardIndex += 1;
      if (response instanceof Error) {
        throw response;
      }
      return { items: response };
    }

    if (path === '/rate-cards' && requestOptions.method === 'POST') {
      if (options?.createError) {
        throw options.createError;
      }
      return options?.createResult ?? { id: 'rate-card-created' };
    }

    if (
      path === '/rate-cards/rate-card-1/disable' &&
      requestOptions.method === 'POST'
    ) {
      if (options?.disableError) {
        throw options.disableError;
      }
      return options?.disableResult ?? { ok: true };
    }

    throw new Error(`Unhandled api call: ${String(path)}`);
  });

  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-28T00:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RateCardSettingsCard', () => {
  it('shows empty state before any rate card is loaded', async () => {
    const calls = setupApi();

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('option', { name: 'PRJ-1 / Project One' }),
      ).toHaveLength(2);
    });

    expect(screen.getByText('データなし')).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual(['/projects']);
  });

  it('loads rate cards and renders the resolved project label', async () => {
    const calls = setupApi({ rateCardResponses: [[rateCardItem]] });

    render(<RateCardSettingsCard />);
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      const list = screen.getByRole('list');
      expect(screen.getByText('取得しました')).toBeInTheDocument();
      expect(within(list).getByText('PRJ-1 / Project One')).toBeInTheDocument();
      expect(within(list).getByText('consultant')).toBeInTheDocument();
      expect(within(list).getByText(/6000 JPY/)).toBeInTheDocument();
    });

    expect(calls.map((call) => call.path)).toContain(
      '/rate-cards?includeGlobal=1&active=1',
    );
  });

  it('validates required role and positive unitPrice before create', async () => {
    setupApi();

    render(<RateCardSettingsCard />);

    fireEvent.change(screen.getByLabelText('role'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByText('role は必須です')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('role'), {
      target: { value: 'consultant' },
    });
    fireEvent.change(screen.getByLabelText('unitPrice'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(
      screen.getByText('unitPrice は 1 以上で入力してください'),
    ).toBeInTheDocument();
  });

  it('creates a rate card and reloads the list', async () => {
    const calls = setupApi({
      rateCardResponses: [
        [
          {
            ...rateCardItem,
            id: 'rate-card-created',
            role: 'architect',
            workType: '設計',
            unitPrice: 7500,
            currency: 'USD',
          },
        ],
      ],
    });

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('option', { name: 'PRJ-1 / Project One' }),
      ).toHaveLength(2);
    });

    fireEvent.change(screen.getByLabelText('案件'), {
      target: { value: 'project-1' },
    });
    fireEvent.change(screen.getByLabelText('role'), {
      target: { value: 'architect' },
    });
    fireEvent.change(screen.getByLabelText('workType'), {
      target: { value: '設計' },
    });
    fireEvent.change(screen.getByLabelText('unitPrice'), {
      target: { value: '7500' },
    });
    fireEvent.change(screen.getByLabelText('currency'), {
      target: { value: 'USD' },
    });
    fireEvent.change(screen.getByLabelText('validTo'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      const list = screen.getByRole('list');
      expect(screen.getByText('取得しました')).toBeInTheDocument();
      expect(within(list).getByText('architect')).toBeInTheDocument();
    });

    const createCall = calls.find(
      (call) => call.path === '/rate-cards' && call.options?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.options?.body))).toEqual({
      projectId: 'project-1',
      role: 'architect',
      workType: '設計',
      unitPrice: 7500,
      currency: 'USD',
      validFrom: '2026-03-28',
      validTo: '2026-12-31',
    });

    expect(calls.map((call) => call.path)).toContain(
      '/rate-cards?includeGlobal=1&active=1',
    );
  });

  it('applies all filters to the rate card query', async () => {
    const calls = setupApi({ rateCardResponses: [[rateCardItem]] });

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('option', { name: 'PRJ-2 / Project Two' }),
      ).toHaveLength(2);
    });

    fireEvent.change(screen.getByLabelText('案件フィルタ'), {
      target: { value: 'project-2' },
    });
    fireEvent.click(screen.getByLabelText('global を含む'));
    fireEvent.click(screen.getByLabelText('有効のみ'));
    fireEvent.change(screen.getByLabelText('workTypeフィルタ'), {
      target: { value: '設計' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      expect(calls.map((call) => call.path)).toContain(
        '/rate-cards?projectId=project-2&includeGlobal=0&active=0&workType=%E8%A8%AD%E8%A8%88',
      );
    });
  });

  it('falls back to the raw project id when the project option is missing', async () => {
    setupApi({
      rateCardResponses: [[{ ...rateCardItem, projectId: 'project-missing' }]],
    });

    render(<RateCardSettingsCard />);
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      const list = screen.getByRole('list');
      expect(within(list).getByText('project-missing')).toBeInTheDocument();
    });
  });

  it('closes the disable dialog without posting when the user cancels', async () => {
    const calls = setupApi({ rateCardResponses: [[rateCardItem]] });

    render(<RateCardSettingsCard />);
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    const list = await screen.findByRole('list');
    fireEvent.click(within(list).getByRole('button', { name: '無効化' }));

    const dialog = screen.getByText('この単価を無効化しますか？')
      .parentElement as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));

    expect(
      screen.queryByText('この単価を無効化しますか？'),
    ).not.toBeInTheDocument();
    expect(calls).not.toContainEqual(
      expect.objectContaining({
        path: '/rate-cards/rate-card-1/disable',
      }),
    );
  });

  it('shows a disable failure message and keeps the item when disable fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const calls = setupApi({
      rateCardResponses: [[rateCardItem]],
      disableError: new Error('boom'),
    });

    try {
      render(<RateCardSettingsCard />);
      fireEvent.click(screen.getByRole('button', { name: '取得' }));

      const list = await screen.findByRole('list');
      fireEvent.click(within(list).getByRole('button', { name: '無効化' }));

      const dialog = screen.getByText('この単価を無効化しますか？')
        .parentElement as HTMLElement;
      fireEvent.click(within(dialog).getByRole('button', { name: '無効化' }));

      await waitFor(() => {
        expect(screen.getByText('無効化に失敗しました')).toBeInTheDocument();
        expect(calls).toContainEqual(
          expect.objectContaining({
            path: '/rate-cards/rate-card-1/disable',
            options: expect.objectContaining({ method: 'POST' }),
          }),
        );
        expect(
          within(screen.getByRole('list')).getByText('PRJ-1 / Project One'),
        ).toBeInTheDocument();
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('opens disable confirmation and disables the selected item', async () => {
    const calls = setupApi({
      rateCardResponses: [[rateCardItem], []],
    });

    render(<RateCardSettingsCard />);
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      const list = screen.getByRole('list');
      expect(within(list).getByText('PRJ-1 / Project One')).toBeInTheDocument();
    });

    const list = screen.getByRole('list');
    fireEvent.click(within(list).getByRole('button', { name: '無効化' }));
    const dialog = screen.getByText('この単価を無効化しますか？')
      .parentElement as HTMLElement;
    expect(
      within(dialog).getByText(/PRJ-1 \/ Project One/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '無効化' }));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === '/rate-cards/rate-card-1/disable' &&
            call.options?.method === 'POST',
        ),
      ).toBe(true);
    });
  });

  it('shows a load failure message when the list request fails', async () => {
    setupApi({ rateCardResponses: [new Error('boom')] });

    render(<RateCardSettingsCard />);
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      expect(screen.getByText('取得に失敗しました')).toBeInTheDocument();
    });
    expect(screen.getByText('データなし')).toBeInTheDocument();
  });
});
