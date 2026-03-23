import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiResponse } from '../../api';
import {
  toIsoFromLocalInput,
  toLocalDateTimeValue,
} from '../../utils/datetime';

type UserIdentityItem = {
  identityId: string;
  userAccountId: string;
  userName?: string;
  displayName?: string | null;
  userActive: boolean;
  userDeletedAt?: string | null;
  providerType: 'google_oidc' | 'local_password';
  issuer: string;
  providerSubject: string;
  emailSnapshot?: string | null;
  status: 'active' | 'disabled';
  lastAuthenticatedAt?: string | null;
  linkedAt: string;
  effectiveUntil?: string | null;
  rollbackWindowUntil?: string | null;
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

type UserIdentityListResponse = {
  limit: number;
  offset: number;
  items: UserIdentityItem[];
};

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

type AuthIdentityMigrationCardProps = {
  formatDateTime: (value?: string | null) => string;
};

type GoogleLinkForm = {
  userAccountId: string;
  issuer: string;
  providerSubject: string;
  emailSnapshot: string;
  effectiveUntil: string;
  rollbackWindowUntil: string;
  note: string;
  ticketId: string;
  reasonCode: string;
  reasonText: string;
};

type LocalLinkForm = {
  userAccountId: string;
  loginId: string;
  password: string;
  effectiveUntil: string;
  rollbackWindowUntil: string;
  note: string;
  ticketId: string;
  reasonCode: string;
  reasonText: string;
};

type IdentityUpdateForm = {
  status: 'active' | 'disabled';
  effectiveUntil: string;
  rollbackWindowUntil: string;
  note: string;
  ticketId: string;
  reasonCode: string;
  reasonText: string;
};

const defaultGoogleLinkForm = (): GoogleLinkForm => ({
  userAccountId: '',
  issuer: 'https://accounts.google.com',
  providerSubject: '',
  emailSnapshot: '',
  effectiveUntil: '',
  rollbackWindowUntil: '',
  note: '',
  ticketId: '',
  reasonCode: '',
  reasonText: '',
});

const defaultLocalLinkForm = (): LocalLinkForm => ({
  userAccountId: '',
  loginId: '',
  password: '',
  effectiveUntil: '',
  rollbackWindowUntil: '',
  note: '',
  ticketId: '',
  reasonCode: '',
  reasonText: '',
});

const defaultIdentityUpdateForm = (
  item?: UserIdentityItem | null,
): IdentityUpdateForm => ({
  status: item?.status || 'active',
  effectiveUntil: toLocalDateTimeValue(item?.effectiveUntil),
  rollbackWindowUntil: toLocalDateTimeValue(item?.rollbackWindowUntil),
  note: item?.note || '',
  ticketId: '',
  reasonCode: '',
  reasonText: '',
});

async function readApiErrorResponse(res: Response): Promise<ApiErrorResponse> {
  try {
    return (await res.json()) as ApiErrorResponse;
  } catch {
    return {};
  }
}

function normalizeOptionalString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function maskProviderSubject(item: UserIdentityItem) {
  if (item.providerType !== 'google_oidc') return item.providerSubject;
  if (item.providerSubject.length <= 8) return item.providerSubject;
  return `${item.providerSubject.slice(0, 4)}...${item.providerSubject.slice(-4)}`;
}

function normalizeLimit(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function normalizeOffset(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export const AuthIdentityMigrationCard = ({
  formatDateTime,
}: AuthIdentityMigrationCardProps) => {
  const initialQueryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '20');
    params.set('offset', '0');
    return params.toString();
  }, []);
  const [userAccountIdFilter, setUserAccountIdFilter] = useState('');
  const [providerTypeFilter, setProviderTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<UserIdentityItem[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [googleLinkForm, setGoogleLinkForm] = useState(defaultGoogleLinkForm);
  const [localLinkForm, setLocalLinkForm] = useState(defaultLocalLinkForm);
  const [editingIdentity, setEditingIdentity] =
    useState<UserIdentityItem | null>(null);
  const [identityUpdateForm, setIdentityUpdateForm] =
    useState<IdentityUpdateForm>(defaultIdentityUpdateForm);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (userAccountIdFilter.trim()) {
      params.set('userAccountId', userAccountIdFilter.trim());
    }
    if (providerTypeFilter) params.set('providerType', providerTypeFilter);
    if (statusFilter) params.set('status', statusFilter);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return params.toString();
  }, [limit, offset, providerTypeFilter, statusFilter, userAccountIdFilter]);

  const loadItems = useCallback(async (targetQueryString: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await api<UserIdentityListResponse>(
        `/auth/user-identities?${targetQueryString}`,
      );
      setItems(Array.isArray(response.items) ? response.items : []);
      setMessage('認証主体一覧を取得しました');
    } catch (err) {
      setError('認証主体一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(initialQueryString);
  }, [initialQueryString, loadItems]);

  const submitGoogleLink = useCallback(async () => {
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const res = await apiResponse('/auth/user-identities/google-link', {
        method: 'POST',
        body: JSON.stringify({
          userAccountId: googleLinkForm.userAccountId.trim(),
          issuer: googleLinkForm.issuer.trim(),
          providerSubject: googleLinkForm.providerSubject.trim(),
          emailSnapshot: normalizeOptionalString(googleLinkForm.emailSnapshot),
          effectiveUntil: toIsoFromLocalInput(googleLinkForm.effectiveUntil),
          rollbackWindowUntil: toIsoFromLocalInput(
            googleLinkForm.rollbackWindowUntil,
          ),
          note: normalizeOptionalString(googleLinkForm.note),
          ticketId: googleLinkForm.ticketId.trim(),
          reasonCode: googleLinkForm.reasonCode.trim(),
          reasonText: normalizeOptionalString(googleLinkForm.reasonText),
        }),
      });
      if (!res.ok) {
        const payload = await readApiErrorResponse(res);
        setError(
          payload.error?.message || 'Google 認証主体の追加に失敗しました',
        );
        return;
      }
      setGoogleLinkForm(defaultGoogleLinkForm());
      await loadItems(queryString);
      setMessage('Google 認証主体を追加しました');
    } catch (err) {
      setError('Google 認証主体の追加に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [googleLinkForm, loadItems, queryString]);

  const submitLocalLink = useCallback(async () => {
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const res = await apiResponse('/auth/user-identities/local-link', {
        method: 'POST',
        body: JSON.stringify({
          userAccountId: localLinkForm.userAccountId.trim(),
          loginId: localLinkForm.loginId.trim(),
          password: localLinkForm.password,
          effectiveUntil: toIsoFromLocalInput(localLinkForm.effectiveUntil),
          rollbackWindowUntil: toIsoFromLocalInput(
            localLinkForm.rollbackWindowUntil,
          ),
          note: normalizeOptionalString(localLinkForm.note),
          ticketId: localLinkForm.ticketId.trim(),
          reasonCode: localLinkForm.reasonCode.trim(),
          reasonText: normalizeOptionalString(localLinkForm.reasonText),
        }),
      });
      if (!res.ok) {
        const payload = await readApiErrorResponse(res);
        setError(
          payload.error?.message || 'ローカル認証主体の追加に失敗しました',
        );
        return;
      }
      setLocalLinkForm(defaultLocalLinkForm());
      await loadItems(queryString);
      setMessage('ローカル認証主体を追加しました');
    } catch (err) {
      setError('ローカル認証主体の追加に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [localLinkForm, loadItems, queryString]);

  const startEdit = useCallback((item: UserIdentityItem) => {
    setEditingIdentity(item);
    setIdentityUpdateForm(defaultIdentityUpdateForm(item));
    setError('');
    setMessage('');
  }, []);

  const submitIdentityUpdate = useCallback(async () => {
    if (!editingIdentity) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const res = await apiResponse(
        `/auth/user-identities/${encodeURIComponent(editingIdentity.identityId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: identityUpdateForm.status,
            effectiveUntil: toIsoFromLocalInput(
              identityUpdateForm.effectiveUntil,
            ),
            rollbackWindowUntil: toIsoFromLocalInput(
              identityUpdateForm.rollbackWindowUntil,
            ),
            note: normalizeOptionalString(identityUpdateForm.note),
            ticketId: identityUpdateForm.ticketId.trim(),
            reasonCode: identityUpdateForm.reasonCode.trim(),
            reasonText: normalizeOptionalString(identityUpdateForm.reasonText),
          }),
        },
      );
      if (!res.ok) {
        const payload = await readApiErrorResponse(res);
        setError(payload.error?.message || '認証主体の更新に失敗しました');
        return;
      }
      const updated = (await res.json()) as UserIdentityItem;
      await loadItems(queryString);
      setEditingIdentity(updated);
      setIdentityUpdateForm(defaultIdentityUpdateForm(updated));
      setMessage('認証主体を更新しました');
    } catch (err) {
      setError('認証主体の更新に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [editingIdentity, identityUpdateForm, loadItems, queryString]);

  const providerOptions = [
    { value: '', label: 'すべて' },
    { value: 'google_oidc', label: 'google_oidc' },
    { value: 'local_password', label: 'local_password' },
  ];
  const statusOptions = [
    { value: '', label: 'すべて' },
    { value: 'active', label: 'active' },
    { value: 'disabled', label: 'disabled' },
  ];

  return (
    <div
      className="card"
      style={{ padding: 12 }}
      data-testid="auth-identity-migration-card"
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>認証方式移行</strong>
        <span className="badge">
          {loading || submitting ? 'loading' : 'ready'}
        </span>
      </div>
      {message && (
        <div style={{ color: '#16a34a', marginTop: 8 }}>{message}</div>
      )}
      {error && <div style={{ color: '#dc2626', marginTop: 8 }}>{error}</div>}

      <div className="list" style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        <div className="card" style={{ padding: 12 }}>
          <strong>認証主体一覧</strong>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              userAccountId
              <input
                aria-label="認証主体userAccountId filter"
                data-testid="auth-identities-filter-user-account-id"
                type="text"
                value={userAccountIdFilter}
                onChange={(event) => setUserAccountIdFilter(event.target.value)}
              />
            </label>
            <label>
              providerType
              <select
                aria-label="認証主体providerType filter"
                data-testid="auth-identities-filter-provider-type"
                value={providerTypeFilter}
                onChange={(event) => setProviderTypeFilter(event.target.value)}
              >
                {providerOptions.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              status
              <select
                aria-label="認証主体status filter"
                data-testid="auth-identities-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {statusOptions.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              limit
              <input
                aria-label="認証主体limit"
                data-testid="auth-identities-filter-limit"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(event) =>
                  setLimit(normalizeLimit(event.target.value, limit))
                }
              />
            </label>
            <label>
              offset
              <input
                aria-label="認証主体offset"
                data-testid="auth-identities-filter-offset"
                type="number"
                min={0}
                value={offset}
                onChange={(event) =>
                  setOffset(normalizeOffset(event.target.value, offset))
                }
              />
            </label>
            <button
              className="button"
              data-testid="auth-identities-load"
              onClick={() => {
                void loadItems(queryString);
              }}
              disabled={loading || submitting}
            >
              認証主体一覧を取得
            </button>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {items.length === 0 && (
              <div style={{ color: '#6b7280' }}>認証主体はありません</div>
            )}
            {items.map((item) => (
              <div
                key={item.identityId}
                className="card"
                style={{ padding: 12 }}
                data-testid={`auth-identity-item-${item.identityId}`}
              >
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <strong>
                    {item.displayName || item.userName || item.userAccountId}
                  </strong>
                  <span className="badge">{item.status}</span>
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  <div>UserAccount: {item.userAccountId}</div>
                  <div>providerType: {item.providerType}</div>
                  <div>issuer: {item.issuer}</div>
                  <div>providerSubject: {maskProviderSubject(item)}</div>
                  <div>linkedAt: {formatDateTime(item.linkedAt)}</div>
                  <div>
                    effectiveUntil:{' '}
                    {formatDateTime(item.effectiveUntil || null)}
                  </div>
                  <div>
                    rollbackWindowUntil:{' '}
                    {formatDateTime(item.rollbackWindowUntil || null)}
                  </div>
                  <div>
                    lastAuthenticatedAt:{' '}
                    {formatDateTime(item.lastAuthenticatedAt || null)}
                  </div>
                  {item.localCredential && (
                    <>
                      <div>loginId: {item.localCredential.loginId}</div>
                      <div>
                        MFA:{' '}
                        {item.localCredential.mfaRequired
                          ? 'required'
                          : 'not required'}
                      </div>
                      <div>
                        mustRotatePassword:{' '}
                        {item.localCredential.mustRotatePassword
                          ? 'true'
                          : 'false'}
                      </div>
                      <div>
                        lockedUntil:{' '}
                        {formatDateTime(
                          item.localCredential.lockedUntil || null,
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <button
                    className="button secondary"
                    data-testid={`auth-identity-edit-${item.identityId}`}
                    onClick={() => startEdit(item)}
                  >
                    編集
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>Google 認証主体追加</strong>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              userAccountId
              <input
                aria-label="Google認証主体userAccountId"
                data-testid="google-link-user-account-id"
                type="text"
                value={googleLinkForm.userAccountId}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    userAccountId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              issuer
              <input
                aria-label="Google認証主体issuer"
                data-testid="google-link-issuer"
                type="text"
                value={googleLinkForm.issuer}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    issuer: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              providerSubject
              <input
                aria-label="Google認証主体providerSubject"
                data-testid="google-link-provider-subject"
                type="text"
                value={googleLinkForm.providerSubject}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    providerSubject: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              emailSnapshot
              <input
                aria-label="Google認証主体emailSnapshot"
                data-testid="google-link-email-snapshot"
                type="email"
                value={googleLinkForm.emailSnapshot}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    emailSnapshot: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              effectiveUntil
              <input
                aria-label="Google認証主体effectiveUntil"
                data-testid="google-link-effective-until"
                type="datetime-local"
                value={googleLinkForm.effectiveUntil}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    effectiveUntil: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              rollbackWindowUntil
              <input
                aria-label="Google認証主体rollbackWindowUntil"
                data-testid="google-link-rollback-window-until"
                type="datetime-local"
                value={googleLinkForm.rollbackWindowUntil}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    rollbackWindowUntil: event.target.value,
                  }))
                }
              />
            </label>
            <label style={{ minWidth: 320 }}>
              note
              <input
                aria-label="Google認証主体note"
                data-testid="google-link-note"
                type="text"
                value={googleLinkForm.note}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              ticketId
              <input
                aria-label="Google認証主体ticketId"
                data-testid="google-link-ticket-id"
                type="text"
                value={googleLinkForm.ticketId}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    ticketId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              reasonCode
              <input
                aria-label="Google認証主体reasonCode"
                data-testid="google-link-reason-code"
                type="text"
                value={googleLinkForm.reasonCode}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    reasonCode: event.target.value,
                  }))
                }
              />
            </label>
            <label style={{ minWidth: 320 }}>
              reasonText
              <input
                aria-label="Google認証主体reasonText"
                data-testid="google-link-reason-text"
                type="text"
                value={googleLinkForm.reasonText}
                onChange={(event) =>
                  setGoogleLinkForm((current) => ({
                    ...current,
                    reasonText: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="button"
              data-testid="google-link-submit"
              onClick={() => {
                void submitGoogleLink();
              }}
              disabled={submitting}
            >
              Google 認証主体を追加
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>ローカル認証主体追加</strong>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              userAccountId
              <input
                aria-label="ローカル認証主体userAccountId"
                data-testid="local-link-user-account-id"
                type="text"
                value={localLinkForm.userAccountId}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    userAccountId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              loginId
              <input
                aria-label="ローカル認証主体loginId"
                data-testid="local-link-login-id"
                type="text"
                value={localLinkForm.loginId}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    loginId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              password
              <input
                aria-label="ローカル認証主体password"
                data-testid="local-link-password"
                type="password"
                value={localLinkForm.password}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                autoComplete="new-password"
              />
            </label>
            <label>
              effectiveUntil
              <input
                aria-label="ローカル認証主体effectiveUntil"
                data-testid="local-link-effective-until"
                type="datetime-local"
                value={localLinkForm.effectiveUntil}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    effectiveUntil: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              rollbackWindowUntil
              <input
                aria-label="ローカル認証主体rollbackWindowUntil"
                data-testid="local-link-rollback-window-until"
                type="datetime-local"
                value={localLinkForm.rollbackWindowUntil}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    rollbackWindowUntil: event.target.value,
                  }))
                }
              />
            </label>
            <label style={{ minWidth: 320 }}>
              note
              <input
                aria-label="ローカル認証主体note"
                data-testid="local-link-note"
                type="text"
                value={localLinkForm.note}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              ticketId
              <input
                aria-label="ローカル認証主体ticketId"
                data-testid="local-link-ticket-id"
                type="text"
                value={localLinkForm.ticketId}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    ticketId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              reasonCode
              <input
                aria-label="ローカル認証主体reasonCode"
                data-testid="local-link-reason-code"
                type="text"
                value={localLinkForm.reasonCode}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    reasonCode: event.target.value,
                  }))
                }
              />
            </label>
            <label style={{ minWidth: 320 }}>
              reasonText
              <input
                aria-label="ローカル認証主体reasonText"
                data-testid="local-link-reason-text"
                type="text"
                value={localLinkForm.reasonText}
                onChange={(event) =>
                  setLocalLinkForm((current) => ({
                    ...current,
                    reasonText: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="button"
              data-testid="local-link-submit"
              onClick={() => {
                void submitLocalLink();
              }}
              disabled={submitting}
            >
              ローカル認証主体を追加
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>認証主体更新</strong>
          {!editingIdentity ? (
            <div style={{ color: '#6b7280', marginTop: 8 }}>
              一覧から編集対象を選択してください
            </div>
          ) : (
            <div
              className="row"
              style={{ marginTop: 8, flexWrap: 'wrap' }}
              data-testid="auth-identity-edit-form"
            >
              <div style={{ minWidth: 280 }}>
                対象:{' '}
                {editingIdentity.displayName ||
                  editingIdentity.userName ||
                  editingIdentity.userAccountId}{' '}
                / {editingIdentity.providerType}
              </div>
              <label>
                status
                <select
                  aria-label="認証主体更新status"
                  data-testid="identity-update-status"
                  value={identityUpdateForm.status}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      status: event.target.value as 'active' | 'disabled',
                    }))
                  }
                >
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label>
                effectiveUntil
                <input
                  aria-label="認証主体更新effectiveUntil"
                  data-testid="identity-update-effective-until"
                  type="datetime-local"
                  value={identityUpdateForm.effectiveUntil}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      effectiveUntil: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                rollbackWindowUntil
                <input
                  aria-label="認証主体更新rollbackWindowUntil"
                  data-testid="identity-update-rollback-window-until"
                  type="datetime-local"
                  value={identityUpdateForm.rollbackWindowUntil}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      rollbackWindowUntil: event.target.value,
                    }))
                  }
                />
              </label>
              <label style={{ minWidth: 320 }}>
                note
                <input
                  aria-label="認証主体更新note"
                  data-testid="identity-update-note"
                  type="text"
                  value={identityUpdateForm.note}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                ticketId
                <input
                  aria-label="認証主体更新ticketId"
                  data-testid="identity-update-ticket-id"
                  type="text"
                  value={identityUpdateForm.ticketId}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      ticketId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                reasonCode
                <input
                  aria-label="認証主体更新reasonCode"
                  data-testid="identity-update-reason-code"
                  type="text"
                  value={identityUpdateForm.reasonCode}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      reasonCode: event.target.value,
                    }))
                  }
                />
              </label>
              <label style={{ minWidth: 320 }}>
                reasonText
                <input
                  aria-label="認証主体更新reasonText"
                  data-testid="identity-update-reason-text"
                  type="text"
                  value={identityUpdateForm.reasonText}
                  onChange={(event) =>
                    setIdentityUpdateForm((current) => ({
                      ...current,
                      reasonText: event.target.value,
                    }))
                  }
                />
              </label>
              <button
                className="button"
                data-testid="identity-update-submit"
                onClick={() => {
                  void submitIdentityUpdate();
                }}
                disabled={submitting}
              >
                認証主体を更新
              </button>
              <button
                className="button secondary"
                data-testid="identity-update-reset"
                onClick={() => {
                  setEditingIdentity(null);
                  setIdentityUpdateForm(defaultIdentityUpdateForm());
                }}
                disabled={submitting}
              >
                編集をやめる
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
