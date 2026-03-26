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

const { api, apiResponse, openResponseInNewTab } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  openResponseInNewTab: vi.fn(),
}));

vi.mock('../api', () => ({ api, apiResponse }));
vi.mock('../utils/download', () => ({ openResponseInNewTab }));

vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AsyncStatePanel: ({
    state,
    loadingText,
    error,
    empty,
  }: {
    state: string;
    loadingText?: string;
    error?: {
      title: string;
      detail?: string;
      onRetry?: () => void;
      retryLabel?: string;
    };
    empty?: { title: string; description: string };
  }) => (
    <div>
      <div>{state}</div>
      {loadingText ? <div>{loadingText}</div> : null}
      {error ? (
        <>
          <div>{error.title}</div>
          {error.detail ? <div>{error.detail}</div> : null}
          {error.onRetry ? (
            <button type="button" onClick={error.onRetry}>
              {error.retryLabel ?? '再試行'}
            </button>
          ) : null}
        </>
      ) : null}
      {empty ? (
        <>
          <div>{empty.title}</div>
          <div>{empty.description}</div>
        </>
      ) : null}
    </div>
  ),
  Button: ({
    children,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button type="button" {...props}>
      {loading ? 'loading' : children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CrudList: ({
    title,
    description,
    filters,
    table,
  }: {
    title: string;
    description: string;
    filters: React.ReactNode;
    table: React.ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      <div>{filters}</div>
      <div>{table}</div>
    </section>
  ),
  DataTable: ({
    columns,
    rows,
  }: {
    columns: Array<{
      key: string;
      header: string;
      cell?: (row: Record<string, unknown>) => React.ReactNode;
    }>;
    rows: Array<Record<string, unknown> & { id: string }>;
  }) => (
    <div>
      <div>{columns.map((column) => column.header).join(',')}</div>
      {rows.map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {columns.map((column) => (
            <div key={`${row.id}-${column.key}`}>
              {column.cell ? column.cell(row) : String(row[column.key] ?? '')}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
  FilterBar: ({
    children,
    actions,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div>
      <div>{children}</div>
      <div>{actions}</div>
    </div>
  ),
  Input: ({
    label,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
    <label>
      <span>{label}</span>
      <input aria-label={label} {...props} />
    </label>
  ),
}));

import { PdfFiles } from './PdfFiles';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PdfFiles', () => {
  it('loads rows, trims prefix, and clears the filter', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          filename: 'invoice 1.pdf',
          size: 1536,
          modifiedAt: '2026-03-26T10:00:00.000Z',
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });

    render(<PdfFiles />);

    await screen.findByText('件数: 1件（表示: 100件）');
    expect(api).toHaveBeenNthCalledWith(1, '/pdf-files?limit=100');
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('filename prefix'), {
      target: { value: ' invoice- ' },
    });

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/pdf-files?'),
      );
    });
    const reloadUrl = new URL(
      String(vi.mocked(api).mock.calls[1][0]),
      'http://localhost',
    );
    expect(reloadUrl.searchParams.get('limit')).toBe('100');
    expect(reloadUrl.searchParams.get('prefix')).toBe('invoice-');

    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('/pdf-files?'),
      );
    });
    expect(
      new URL(
        String(vi.mocked(api).mock.calls[2][0]),
        'http://localhost',
      ).searchParams.get('limit'),
    ).toBe('100');
    expect(
      new URL(
        String(vi.mocked(api).mock.calls[2][0]),
        'http://localhost',
      ).searchParams.get('prefix'),
    ).toBeNull();
  });

  it('shows empty state when no pdf files are returned', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    });

    render(<PdfFiles />);

    expect(
      await screen.findByText('PDFファイルがありません'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('検索条件を変更して再試行してください'),
    ).toBeInTheDocument();
  });

  it('shows retry UI when loading fails and reloads successfully', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        items: [
          {
            filename: 'retry.pdf',
            size: 42,
            modifiedAt: '2026-03-26T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      });

    render(<PdfFiles />);

    expect(
      (await screen.findAllByText('PDF一覧の取得に失敗しました')).length,
    ).toBeGreaterThan(0);

    const retryButton = screen.getByRole('button', { name: '再試行' });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);

    expect(await screen.findByText('retry.pdf')).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('opens a pdf file through the encoded download endpoint', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          filename: 'invoice 1.pdf',
          size: 512,
          modifiedAt: '2026-03-26T10:00:00.000Z',
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    vi.mocked(apiResponse).mockResolvedValue({ ok: true } as Response);
    vi.mocked(openResponseInNewTab).mockResolvedValue(undefined);

    render(<PdfFiles />);

    const row = await screen.findByTestId('row-invoice 1.pdf');
    fireEvent.click(within(row).getByRole('button', { name: '開く' }));

    await waitFor(() => {
      expect(apiResponse).toHaveBeenCalledWith('/pdf-files/invoice%201.pdf');
    });
    expect(openResponseInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      'invoice 1.pdf',
    );
  });

  it('shows an error message when opening a pdf fails', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          filename: 'broken.pdf',
          size: 512,
          modifiedAt: '2026-03-26T10:00:00.000Z',
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    vi.mocked(apiResponse).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    render(<PdfFiles />);

    const row = await screen.findByTestId('row-broken.pdf');
    fireEvent.click(within(row).getByRole('button', { name: '開く' }));

    expect(
      await screen.findByText('PDFの取得に失敗しました'),
    ).toBeInTheDocument();
    expect(openResponseInNewTab).not.toHaveBeenCalled();
  });
});
