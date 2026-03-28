import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../api', () => ({ api }));
vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button type="button" aria-busy={loading ? 'true' : 'false'} {...props}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}));

import { ScimSettingsCard } from './ScimSettingsCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  api.mockReset();
});

describe('ScimSettingsCard', () => {
  it('loads configured status and shows base URL', async () => {
    api.mockResolvedValueOnce({ configured: true, pageMax: 150 });

    render(<ScimSettingsCard />);

    await waitFor(() => {
      expect(screen.getByText('有効')).toBeInTheDocument();
    });

    expect(screen.getByText(/最大取得件数:\s*150/)).toBeInTheDocument();
    expect(
      screen.getByText(`${window.location.origin}/scim/v2`),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'SCIM_BEARER_TOKEN を設定し、バックエンドを再起動してください。',
      ),
    ).not.toBeInTheDocument();
  });

  it('shows error state and warning when status is unavailable', async () => {
    api
      .mockRejectedValueOnce(new Error('status failed'))
      .mockResolvedValueOnce({ configured: false, pageMax: 50 });

    render(<ScimSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByText('SCIM状態の取得に失敗しました'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await waitFor(() => {
      expect(screen.getByText('未設定')).toBeInTheDocument();
    });

    expect(screen.getByText(/最大取得件数:\s*50/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'SCIM_BEARER_TOKEN を設定し、バックエンドを再起動してください。',
      ),
    ).toBeInTheDocument();
  });

  it('falls back to a relative base URL when URL resolution fails', async () => {
    vi.stubGlobal(
      'URL',
      class BrokenURL {
        constructor() {
          throw new Error('URL resolution failed');
        }
      } as unknown as typeof URL,
    );
    api.mockResolvedValueOnce({ configured: false, pageMax: 25 });

    render(<ScimSettingsCard />);

    await waitFor(() => {
      expect(screen.getByText('未設定')).toBeInTheDocument();
    });

    expect(screen.getByText('/scim/v2')).toBeInTheDocument();
  });
});
