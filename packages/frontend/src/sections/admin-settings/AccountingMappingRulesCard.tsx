import React from 'react';

export type AccountingMappingRuleItem = {
  id: string;
  mappingKey: string;
  debitAccountCode: string;
  debitSubaccountCode?: string | null;
  requireDebitSubaccountCode?: boolean;
  creditAccountCode: string;
  creditSubaccountCode?: string | null;
  requireCreditSubaccountCode?: boolean;
  departmentCode?: string | null;
  requireDepartmentCode?: boolean;
  taxCode: string;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AccountingMappingRuleFormState = {
  mappingKey: string;
  debitAccountCode: string;
  debitSubaccountCode: string;
  requireDebitSubaccountCode: boolean;
  creditAccountCode: string;
  creditSubaccountCode: string;
  requireCreditSubaccountCode: boolean;
  departmentCode: string;
  requireDepartmentCode: boolean;
  taxCode: string;
  isActive: boolean;
};

export type AccountingMappingRuleReapplyResult = {
  processedCount: number;
  updatedCount: number;
  readyCount: number;
  pendingMappingCount: number;
  blockedCount: number;
};

type AccountingMappingRulesCardProps = {
  mappingKeyFilter: string;
  setMappingKeyFilter: React.Dispatch<React.SetStateAction<string>>;
  isActiveFilter: string;
  setIsActiveFilter: React.Dispatch<React.SetStateAction<string>>;
  limit: number;
  setLimit: React.Dispatch<React.SetStateAction<number>>;
  offset: number;
  setOffset: React.Dispatch<React.SetStateAction<number>>;
  loading: boolean;
  items: AccountingMappingRuleItem[];
  form: AccountingMappingRuleFormState;
  setForm: React.Dispatch<React.SetStateAction<AccountingMappingRuleFormState>>;
  editingId: string | null;
  onSubmit: () => void;
  onReset: () => void;
  onLoad: () => void;
  onEdit: (item: AccountingMappingRuleItem) => void;
  reapplyPeriodKey: string;
  setReapplyPeriodKey: React.Dispatch<React.SetStateAction<string>>;
  reapplyMappingKey: string;
  setReapplyMappingKey: React.Dispatch<React.SetStateAction<string>>;
  reapplyLimit: number;
  setReapplyLimit: React.Dispatch<React.SetStateAction<number>>;
  reapplyOffset: number;
  setReapplyOffset: React.Dispatch<React.SetStateAction<number>>;
  reapplying: boolean;
  onReapply: () => void;
  reapplyResult: AccountingMappingRuleReapplyResult | null;
  formatDateTime: (value?: string | null) => string;
};

const isActiveOptions = [
  { value: '', label: 'すべて' },
  { value: 'true', label: 'active' },
  { value: 'false', label: 'inactive' },
];

function normalizePositiveInteger(
  value: string,
  fallback: number,
  max?: number,
) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (typeof max === 'number') return Math.min(parsed, max);
  return parsed;
}

function normalizeNonNegativeInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export const AccountingMappingRulesCard = ({
  mappingKeyFilter,
  setMappingKeyFilter,
  isActiveFilter,
  setIsActiveFilter,
  limit,
  setLimit,
  offset,
  setOffset,
  loading,
  items,
  form,
  setForm,
  editingId,
  onSubmit,
  onReset,
  onLoad,
  onEdit,
  reapplyPeriodKey,
  setReapplyPeriodKey,
  reapplyMappingKey,
  setReapplyMappingKey,
  reapplyLimit,
  setReapplyLimit,
  reapplyOffset,
  setReapplyOffset,
  reapplying,
  onReapply,
  reapplyResult,
  formatDateTime,
}: AccountingMappingRulesCardProps) => (
  <div
    className="card"
    style={{ padding: 12 }}
    data-testid="accounting-mapping-rules-card"
  >
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <strong>会計マッピングルール</strong>
      <span className="badge">{loading ? 'loading' : 'ready'}</span>
    </div>

    <div className="list" style={{ display: 'grid', gap: 12, marginTop: 8 }}>
      <div className="card" style={{ padding: 12 }}>
        <strong>{editingId ? 'ルール編集' : 'ルール作成'}</strong>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <label>
            mappingKey
            <input
              aria-label="会計ルールmappingKey"
              data-testid="accounting-mapping-rule-mapping-key"
              type="text"
              value={form.mappingKey}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  mappingKey: event.target.value,
                }))
              }
              placeholder="invoice_approved:default"
            />
          </label>
          <label>
            debitAccountCode
            <input
              aria-label="会計ルール借方科目"
              data-testid="accounting-mapping-rule-debit-account"
              type="text"
              value={form.debitAccountCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  debitAccountCode: event.target.value,
                }))
              }
            />
          </label>
          <label>
            debitSubaccountCode
            <input
              aria-label="会計ルール借方枝番"
              data-testid="accounting-mapping-rule-debit-subaccount"
              type="text"
              value={form.debitSubaccountCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  debitSubaccountCode: event.target.value,
                }))
              }
            />
          </label>
          <label className="badge" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={form.requireDebitSubaccountCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requireDebitSubaccountCode: event.target.checked,
                }))
              }
              style={{ marginRight: 6 }}
            />
            借方枝番必須
          </label>
          <label>
            creditAccountCode
            <input
              aria-label="会計ルール貸方科目"
              data-testid="accounting-mapping-rule-credit-account"
              type="text"
              value={form.creditAccountCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  creditAccountCode: event.target.value,
                }))
              }
            />
          </label>
          <label>
            creditSubaccountCode
            <input
              aria-label="会計ルール貸方枝番"
              data-testid="accounting-mapping-rule-credit-subaccount"
              type="text"
              value={form.creditSubaccountCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  creditSubaccountCode: event.target.value,
                }))
              }
            />
          </label>
          <label className="badge" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={form.requireCreditSubaccountCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requireCreditSubaccountCode: event.target.checked,
                }))
              }
              style={{ marginRight: 6 }}
            />
            貸方枝番必須
          </label>
          <label>
            departmentCode
            <input
              aria-label="会計ルール部門コード"
              data-testid="accounting-mapping-rule-department-code"
              type="text"
              value={form.departmentCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  departmentCode: event.target.value,
                }))
              }
            />
          </label>
          <label className="badge" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={form.requireDepartmentCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requireDepartmentCode: event.target.checked,
                }))
              }
              style={{ marginRight: 6 }}
            />
            部門コード必須
          </label>
          <label>
            taxCode
            <input
              aria-label="会計ルール税区分"
              data-testid="accounting-mapping-rule-tax-code"
              type="text"
              value={form.taxCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taxCode: event.target.value,
                }))
              }
            />
          </label>
          <label className="badge" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
              style={{ marginRight: 6 }}
            />
            active
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="button secondary"
            type="button"
            onClick={onSubmit}
            data-testid="accounting-mapping-rule-submit"
          >
            {editingId ? '更新' : '作成'}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={onReset}
            data-testid="accounting-mapping-rule-reset"
          >
            {editingId ? '編集解除' : 'クリア'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <strong>再適用</strong>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <label>
            periodKey
            <input
              aria-label="会計ルール再適用periodKey"
              data-testid="accounting-mapping-rule-reapply-period-key"
              type="month"
              value={reapplyPeriodKey}
              onChange={(event) => setReapplyPeriodKey(event.target.value)}
            />
          </label>
          <label>
            mappingKey
            <input
              aria-label="会計ルール再適用mappingKey"
              data-testid="accounting-mapping-rule-reapply-mapping-key"
              type="text"
              value={reapplyMappingKey}
              onChange={(event) => setReapplyMappingKey(event.target.value)}
              placeholder="invoice_approved:default"
            />
          </label>
          <label>
            limit
            <input
              aria-label="会計ルール再適用limit"
              data-testid="accounting-mapping-rule-reapply-limit"
              type="number"
              min={1}
              max={2000}
              value={reapplyLimit}
              onChange={(event) =>
                setReapplyLimit(
                  normalizePositiveInteger(
                    event.target.value,
                    reapplyLimit,
                    2000,
                  ),
                )
              }
            />
          </label>
          <label>
            offset
            <input
              aria-label="会計ルール再適用offset"
              data-testid="accounting-mapping-rule-reapply-offset"
              type="number"
              min={0}
              value={reapplyOffset}
              onChange={(event) =>
                setReapplyOffset(
                  normalizeNonNegativeInteger(
                    event.target.value,
                    reapplyOffset,
                  ),
                )
              }
            />
          </label>
          <button
            className="button secondary"
            type="button"
            onClick={onReapply}
            disabled={reapplying}
            data-testid="accounting-mapping-rule-reapply"
          >
            {reapplying ? '再適用中...' : '再適用'}
          </button>
        </div>
        {reapplyResult && (
          <div
            className="card"
            style={{
              marginTop: 8,
              padding: 12,
              fontSize: 12,
              color: '#475569',
            }}
          >
            processed={reapplyResult.processedCount} / updated=
            {reapplyResult.updatedCount} / ready={reapplyResult.readyCount} /
            pending_mapping={reapplyResult.pendingMappingCount} / blocked=
            {reapplyResult.blockedCount}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 12 }}>
        <strong>ルール一覧</strong>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <label>
            mappingKey
            <input
              aria-label="会計ルール検索mappingKey"
              data-testid="accounting-mapping-rules-filter-mapping-key"
              type="text"
              value={mappingKeyFilter}
              onChange={(event) => setMappingKeyFilter(event.target.value)}
            />
          </label>
          <label>
            isActive
            <select
              aria-label="会計ルール検索isActive"
              data-testid="accounting-mapping-rules-filter-is-active"
              value={isActiveFilter}
              onChange={(event) => setIsActiveFilter(event.target.value)}
            >
              {isActiveOptions.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            limit
            <input
              aria-label="会計ルール検索limit"
              data-testid="accounting-mapping-rules-limit"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) =>
                setLimit(
                  normalizePositiveInteger(event.target.value, limit, 100),
                )
              }
            />
          </label>
          <label>
            offset
            <input
              aria-label="会計ルール検索offset"
              data-testid="accounting-mapping-rules-offset"
              type="number"
              min={0}
              value={offset}
              onChange={(event) =>
                setOffset(
                  normalizeNonNegativeInteger(event.target.value, offset),
                )
              }
            />
          </label>
          <button
            className="button secondary"
            type="button"
            onClick={onLoad}
            data-testid="accounting-mapping-rules-load"
          >
            一覧取得
          </button>
        </div>
        <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {items.length === 0 && (
            <div className="card" style={{ padding: 12 }}>
              ルールなし
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="card"
              style={{ padding: 12 }}
              data-testid={`accounting-mapping-rule-${item.id}`}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{item.mappingKey}</strong>
                <span className="badge">
                  {item.isActive ? 'active' : 'inactive'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                借方: {item.debitAccountCode}
                {item.debitSubaccountCode
                  ? `-${item.debitSubaccountCode}`
                  : ''}{' '}
                / 貸方: {item.creditAccountCode}
                {item.creditSubaccountCode
                  ? `-${item.creditSubaccountCode}`
                  : ''}
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                部門: {item.departmentCode || '-'} / 税区分: {item.taxCode}
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                <div
                  className="row"
                  style={{
                    gap: 6,
                    flexWrap: 'wrap',
                    justifyContent: 'flex-start',
                  }}
                >
                  <span
                    className="badge"
                    data-testid="accounting-mapping-rule-require-debit-subaccount"
                  >
                    借方枝番:{' '}
                    {item.requireDebitSubaccountCode ? '必須' : '任意'}
                  </span>
                  <span
                    className="badge"
                    data-testid="accounting-mapping-rule-require-credit-subaccount"
                  >
                    貸方枝番:{' '}
                    {item.requireCreditSubaccountCode ? '必須' : '任意'}
                  </span>
                  <span
                    className="badge"
                    data-testid="accounting-mapping-rule-require-department"
                  >
                    部門コード: {item.requireDepartmentCode ? '必須' : '任意'}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                createdAt: {formatDateTime(item.createdAt)} / updatedAt:{' '}
                {formatDateTime(item.updatedAt)}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onEdit(item)}
                  data-testid={`accounting-mapping-rule-edit-${item.id}`}
                >
                  編集
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);
