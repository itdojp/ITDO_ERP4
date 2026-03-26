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
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: ({ title }: { title: string }) => (
    <div data-testid="annotations-card">{title}</div>
  ),
}));
vi.mock('../ui', () => ({
  Button: ({
    children,
    variant: _variant,
    loading: _loading,
    type = 'button',
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    loading?: boolean;
  }) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Dialog: ({
    open,
    children,
    title,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    title: string;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <div data-testid="dialog">
        <h3>{title}</h3>
        <div>{children}</div>
        {footer}
      </div>
    ) : null,
}));

import { Estimates } from './Estimates';

beforeEach(() => {
  api.mockReset();
  getAuthState.mockReset();
  useProjects.mockReset();
  getAuthState.mockReturnValue({ projectIds: ['project-1'] });
  useProjects.mockReturnValue({
    projects: [
      { id: 'project-1', code: 'P001', name: 'Alpha' },
      { id: 'project-2', code: 'P002', name: 'Beta' },
    ],
    projectMessage: '',
  });
});

afterEach(() => {
  cleanup();
});

describe('Estimates', () => {
  it('creates and loads estimates', async () => {
    api
      .mockResolvedValueOnce({
        number: 'EST-001',
        estimate: {
          id: 'estimate-1',
          estimateNo: 'EST-001',
          projectId: 'project-1',
          totalAmount: 250000,
          currency: 'USD',
          status: 'draft',
          validUntil: '2026-04-01T00:00:00.000Z',
          notes: '初回見積',
          lines: [{ description: '作業費', quantity: 1, unitPrice: 250000 }],
        },
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'estimate-1',
            estimateNo: 'EST-001',
            projectId: 'project-1',
            totalAmount: 250000,
            currency: 'USD',
            status: 'draft',
          },
        ],
      });

    render(<Estimates />);

    fireEvent.change(screen.getByPlaceholderText('金額'), {
      target: { value: '250000' },
    });
    fireEvent.change(screen.getByLabelText('通貨'), {
      target: { value: 'USD' },
    });
    fireEvent.change(screen.getByLabelText('有効期限'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '初回見積' },
    });

    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    expect(await screen.findByText('作成しました')).toBeInTheDocument();
    expect(api).toHaveBeenNthCalledWith(
      1,
      '/projects/project-1/estimates',
      expect.objectContaining({ method: 'POST' }),
    );
    const createPayload = JSON.parse(api.mock.calls[0][1].body as string);
    expect(createPayload).toEqual(
      expect.objectContaining({
        totalAmount: 250000,
        currency: 'USD',
        validUntil: '2026-04-01',
        notes: '初回見積',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '読み込み' }));

    expect(await screen.findByText(/EST-001/)).toBeInTheDocument();
    expect(api).toHaveBeenNthCalledWith(2, '/projects/project-1/estimates');
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes('P001 / Alpha'),
      ),
    ).toBeInTheDocument();
  });

  it('validates project selection before create and load', async () => {
    getAuthState.mockReturnValue({ projectIds: [] });
    useProjects.mockReturnValue({ projects: [], projectMessage: '' });

    render(<Estimates />);

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(
      await screen.findByText('案件を選択してください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '読み込み' }));
    expect(api).not.toHaveBeenCalled();
  });

  it('submits, sends, and opens annotation dialog from detail', async () => {
    api
      .mockResolvedValueOnce({
        items: [
          {
            id: 'estimate-1',
            estimateNo: 'EST-001',
            projectId: 'project-1',
            totalAmount: 100000,
            currency: 'JPY',
            status: 'draft',
          },
          {
            id: 'estimate-2',
            estimateNo: 'EST-002',
            projectId: 'project-1',
            totalAmount: 200000,
            currency: 'JPY',
            status: 'approved',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'estimate-1',
        estimateNo: 'EST-001',
        projectId: 'project-1',
        totalAmount: 100000,
        currency: 'JPY',
        status: 'pending_qa',
      })
      .mockResolvedValueOnce({
        items: [],
      })
      .mockResolvedValueOnce({
        id: 'estimate-2',
        estimateNo: 'EST-002',
        projectId: 'project-1',
        totalAmount: 200000,
        currency: 'JPY',
        status: 'sent',
      });

    render(<Estimates />);

    fireEvent.click(screen.getByRole('button', { name: '読み込み' }));
    expect(await screen.findByText(/EST-001/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '承認依頼' })[0]);
    expect(await screen.findByText('承認依頼しました')).toBeInTheDocument();
    expect(api).toHaveBeenNthCalledWith(2, '/estimates/estimate-1/submit', {
      method: 'POST',
    });

    fireEvent.click(screen.getAllByRole('button', { name: '詳細' })[1]);
    expect(await screen.findByText('見積詳細')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '注釈' }));
    expect(await screen.findByTestId('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('annotations-card')).toHaveTextContent(
      '見積: EST-002',
    );
    const dialog = screen.getByTestId('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await waitFor(() => {
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    const targetItem = screen.getByText(/EST-002/).closest('li');
    expect(targetItem).not.toBeNull();
    fireEvent.click(
      within(targetItem as HTMLLIElement).getByRole('button', {
        name: '送信 (Stub)',
      }),
    );
    expect(await screen.findByText('送信しました')).toBeInTheDocument();
    expect(api).toHaveBeenNthCalledWith(4, '/estimates/estimate-2/send', {
      method: 'POST',
    });
  });
});
