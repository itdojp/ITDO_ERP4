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

import { AuthIdentityMigrationCard } from './AuthIdentityMigrationCard';

const { api, apiResponse } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
}));

vi.mock('../../api', () => ({ api, apiResponse }));

type UserIdentityItem = {
  identityId: string;
  userAccountId: string;
  userName?: string;
  displayName?: string | null;
  userActive: boolean;
  providerType: 'google_oidc' | 'local_password';
  issuer: string;
  providerSubject: string;
  status: 'active' | 'disabled';
  linkedAt: string;
  effectiveUntil?: string | null;
  rollbackWindowUntil?: string | null;
  lastAuthenticatedAt?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  localCredential?: {
    loginId: string;
    passwordAlgo: string;
    mfaRequired: boolean;
    mfaSecretConfigured: boolean;
    mustRotatePassword: boolean;
    failedAttempts: number;
    lockedUntil?: string | null;
    passwordChangedAt?: string | null;
  } | null;
};

const formatDateTime = vi.fn((value?: string | null) =>
  value ? `dt:${value}` : '-',
);

const googleIdentity: UserIdentityItem = {
  identityId: 'identity-google',
  userAccountId: 'user-1',
  userName: 'jane',
  displayName: 'Jane Admin',
  userActive: true,
  providerType: 'google_oidc',
  issuer: 'https://accounts.google.com',
  providerSubject: '12345678901234567890',
  status: 'active',
  linkedAt: '2026-03-28T00:00:00.000Z',
  effectiveUntil: '2026-03-30T09:00:00.000Z',
  rollbackWindowUntil: '2026-03-31T09:00:00.000Z',
  lastAuthenticatedAt: '2026-03-28T10:00:00.000Z',
  note: 'initial note',
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
};

const localIdentity: UserIdentityItem = {
  identityId: 'identity-local',
  userAccountId: 'user-2',
  userName: 'john',
  displayName: 'John Local',
  userActive: true,
  providerType: 'local_password',
  issuer: 'erp4-local',
  providerSubject: 'login-john',
  status: 'active',
  linkedAt: '2026-03-28T00:00:00.000Z',
  effectiveUntil: null,
  rollbackWindowUntil: null,
  lastAuthenticatedAt: null,
  note: null,
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
  localCredential: {
    loginId: 'john@example.com',
    passwordAlgo: 'argon2id',
    mfaRequired: true,
    mfaSecretConfigured: false,
    mustRotatePassword: true,
    failedAttempts: 2,
    lockedUntil: '2026-03-28T12:00:00.000Z',
    passwordChangedAt: '2026-03-20T00:00:00.000Z',
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderCard() {
  return render(<AuthIdentityMigrationCard formatDateTime={formatDateTime} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AuthIdentityMigrationCard', () => {
  it('loads identities on mount and renders google/local details', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      limit: 20,
      offset: 0,
      items: [googleIdentity, localIdentity],
    });

    renderCard();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/auth/user-identities?limit=20&offset=0',
      );
    });

    const googleItem = await screen.findByTestId(
      'auth-identity-item-identity-google',
    );
    expect(within(googleItem).getByText('Jane Admin')).toBeInTheDocument();
    expect(
      within(googleItem).getByText('providerSubject: 1234...7890'),
    ).toBeInTheDocument();
    expect(
      within(googleItem).getByText(
        'effectiveUntil: dt:2026-03-30T09:00:00.000Z',
      ),
    ).toBeInTheDocument();

    const localItem = screen.getByTestId('auth-identity-item-identity-local');
    expect(
      within(localItem).getByText('loginId: john@example.com'),
    ).toBeInTheDocument();
    expect(within(localItem).getByText('MFA: required')).toBeInTheDocument();
    expect(
      within(localItem).getByText('mustRotatePassword: true'),
    ).toBeInTheDocument();
  });

  it('reloads identities with normalized filters', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ limit: 20, offset: 0, items: [] })
      .mockResolvedValueOnce({ limit: 100, offset: 0, items: [] });

    renderCard();

    await screen.findByText('認証主体はありません');

    fireEvent.change(
      screen.getByTestId('auth-identities-filter-user-account-id'),
      {
        target: { value: '  user-1  ' },
      },
    );
    fireEvent.change(
      screen.getByTestId('auth-identities-filter-provider-type'),
      {
        target: { value: 'google_oidc' },
      },
    );
    fireEvent.change(screen.getByTestId('auth-identities-filter-status'), {
      target: { value: 'active' },
    });
    fireEvent.change(screen.getByTestId('auth-identities-filter-limit'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByTestId('auth-identities-filter-offset'), {
      target: { value: '-5' },
    });
    fireEvent.click(screen.getByTestId('auth-identities-load'));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(
        2,
        '/auth/user-identities?userAccountId=user-1&providerType=google_oidc&status=active&limit=100&offset=0',
      );
    });
  });

  it('submits google link and reloads the list', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ limit: 20, offset: 0, items: [] })
      .mockResolvedValueOnce({ limit: 20, offset: 0, items: [googleIdentity] });
    vi.mocked(apiResponse).mockResolvedValueOnce(
      jsonResponse({ ok: true }, 201),
    );

    renderCard();
    await screen.findByText('認証主体はありません');

    fireEvent.change(screen.getByTestId('google-link-user-account-id'), {
      target: { value: ' user-1 ' },
    });
    fireEvent.change(screen.getByTestId('google-link-provider-subject'), {
      target: { value: 'subject-1234567890' },
    });
    fireEvent.change(screen.getByTestId('google-link-email-snapshot'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('google-link-effective-until'), {
      target: { value: '2026-03-30T09:00' },
    });
    fireEvent.change(screen.getByTestId('google-link-rollback-window-until'), {
      target: { value: '2026-03-31T09:00' },
    });
    fireEvent.change(screen.getByTestId('google-link-note'), {
      target: { value: ' migration ' },
    });
    fireEvent.change(screen.getByTestId('google-link-ticket-id'), {
      target: { value: ' TICKET-1 ' },
    });
    fireEvent.change(screen.getByTestId('google-link-reason-code'), {
      target: { value: ' MIGRATE ' },
    });
    fireEvent.change(screen.getByTestId('google-link-reason-text'), {
      target: { value: ' staged migration ' },
    });
    fireEvent.click(screen.getByTestId('google-link-submit'));

    await waitFor(() => {
      expect(
        screen.getByText('Google 認証主体を追加しました'),
      ).toBeInTheDocument();
    });

    const googleLinkCall = vi.mocked(apiResponse).mock.calls[0];
    expect(googleLinkCall?.[0]).toBe('/auth/user-identities/google-link');
    expect(googleLinkCall?.[1]?.method).toBe('POST');
    const googleLinkBody = JSON.parse(String(googleLinkCall?.[1]?.body));
    expect(googleLinkBody).toMatchObject({
      userAccountId: 'user-1',
      issuer: 'https://accounts.google.com',
      providerSubject: 'subject-1234567890',
      emailSnapshot: 'user@example.com',
      note: 'migration',
      ticketId: 'TICKET-1',
      reasonCode: 'MIGRATE',
      reasonText: 'staged migration',
    });
    expect(googleLinkBody.effectiveUntil).toMatch(
      /^2026-03-30T\d{2}:00:00\.000Z$/,
    );
    expect(googleLinkBody.rollbackWindowUntil).toMatch(
      /^2026-03-31T\d{2}:00:00\.000Z$/,
    );
    expect(api).toHaveBeenLastCalledWith(
      '/auth/user-identities?limit=20&offset=0',
    );
    expect(
      (screen.getByTestId('google-link-provider-subject') as HTMLInputElement)
        .value,
    ).toBe('');
  });

  it('shows server error when local link fails', async () => {
    vi.mocked(api).mockResolvedValueOnce({ limit: 20, offset: 0, items: [] });
    vi.mocked(apiResponse).mockResolvedValueOnce(
      jsonResponse(
        { error: { message: 'loginId は既に使用されています' } },
        409,
      ),
    );

    renderCard();
    await screen.findByText('認証主体はありません');

    fireEvent.change(screen.getByTestId('local-link-user-account-id'), {
      target: { value: 'user-2' },
    });
    fireEvent.change(screen.getByTestId('local-link-login-id'), {
      target: { value: 'john@example.com' },
    });
    fireEvent.change(screen.getByTestId('local-link-password'), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByTestId('local-link-ticket-id'), {
      target: { value: 'TICKET-2' },
    });
    fireEvent.change(screen.getByTestId('local-link-reason-code'), {
      target: { value: 'LOCAL_LINK' },
    });
    fireEvent.click(screen.getByTestId('local-link-submit'));

    await waitFor(() => {
      expect(
        screen.getByText('loginId は既に使用されています'),
      ).toBeInTheDocument();
    });
  });

  it('starts edit mode and updates an identity', async () => {
    const updatedIdentity = {
      ...googleIdentity,
      status: 'disabled' as const,
      note: 'rotated',
      effectiveUntil: '2026-04-01T00:00:00.000Z',
    };

    vi.mocked(api)
      .mockResolvedValueOnce({ limit: 20, offset: 0, items: [googleIdentity] })
      .mockResolvedValueOnce({
        limit: 20,
        offset: 0,
        items: [updatedIdentity],
      });
    vi.mocked(apiResponse).mockResolvedValueOnce(jsonResponse(updatedIdentity));

    renderCard();

    const item = await screen.findByTestId(
      'auth-identity-item-identity-google',
    );
    fireEvent.click(
      within(item).getByTestId('auth-identity-edit-identity-google'),
    );

    const form = await screen.findByTestId('auth-identity-edit-form');
    fireEvent.change(within(form).getByTestId('identity-update-status'), {
      target: { value: 'disabled' },
    });
    fireEvent.change(
      within(form).getByTestId('identity-update-effective-until'),
      {
        target: { value: '2026-04-01T00:00' },
      },
    );
    fireEvent.change(within(form).getByTestId('identity-update-note'), {
      target: { value: ' rotated ' },
    });
    fireEvent.change(within(form).getByTestId('identity-update-ticket-id'), {
      target: { value: ' TICKET-3 ' },
    });
    fireEvent.change(within(form).getByTestId('identity-update-reason-code'), {
      target: { value: ' DISABLE ' },
    });
    fireEvent.click(within(form).getByTestId('identity-update-submit'));

    await waitFor(() => {
      expect(screen.getByText('認証主体を更新しました')).toBeInTheDocument();
    });

    const updateCall = vi.mocked(apiResponse).mock.calls[0];
    expect(updateCall?.[0]).toBe('/auth/user-identities/identity-google');
    expect(updateCall?.[1]?.method).toBe('PATCH');
    const updateBody = JSON.parse(String(updateCall?.[1]?.body));
    expect(updateBody).toMatchObject({
      status: 'disabled',
      note: 'rotated',
      ticketId: 'TICKET-3',
      reasonCode: 'DISABLE',
      reasonText: null,
    });
    expect(updateBody.effectiveUntil).toMatch(
      /^2026-03-31T\d{2}:00:00\.000Z$|^2026-04-01T\d{2}:00:00\.000Z$/,
    );
    expect(updateBody.rollbackWindowUntil).toBeTruthy();
    expect(
      (screen.getByTestId('identity-update-note') as HTMLInputElement).value,
    ).toBe('rotated');
  });
});
