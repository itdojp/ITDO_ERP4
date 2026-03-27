import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TemplateSettingsCard,
  type TemplateFormValue,
  type TemplateSettingItem,
} from './TemplateSettingsCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const baseForm: TemplateFormValue = {
  kind: 'invoice',
  templateId: 'tpl-1',
  numberRule: 'IYYYY-MM-NNNN',
  layoutConfigJson: '{"columns":2}',
  logoUrl: 'https://cdn.example.test/logo.png',
  signatureText: '経理部',
  isDefault: false,
};

function createItem(
  overrides: Partial<TemplateSettingItem> = {},
): TemplateSettingItem {
  return {
    id: 'setting-1',
    kind: 'invoice',
    templateId: 'tpl-1',
    numberRule: 'IYYYY-MM-NNNN',
    layoutConfig: { columns: 2 },
    logoUrl: 'https://cdn.example.test/logo.png',
    signatureText: '経理部',
    isDefault: false,
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof TemplateSettingsCard>> = {},
) {
  const setTemplateForm = vi.fn();
  const onSubmit = vi.fn();
  const onReset = vi.fn();
  const onReload = vi.fn();
  const onEdit = vi.fn();
  const onSetDefault = vi.fn();

  render(
    <TemplateSettingsCard
      templateForm={baseForm}
      setTemplateForm={setTemplateForm}
      templateKinds={['invoice', 'estimate']}
      templatesForKind={[{ id: 'tpl-1', name: '請求書A' }]}
      editingTemplateId={null}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
      items={[]}
      templateNameMap={new Map([['tpl-1', '請求書A']])}
      onEdit={onEdit}
      onSetDefault={onSetDefault}
      {...overrides}
    />,
  );

  return {
    setTemplateForm,
    onSubmit,
    onReset,
    onReload,
    onEdit,
    onSetDefault,
  };
}

describe('TemplateSettingsCard', () => {
  it('renders empty state and delegates form actions', () => {
    const { setTemplateForm, onSubmit, onReset, onReload } = renderCard({
      templatesForKind: [],
    });

    expect(
      screen.getByText('テンプレ設定（見積/請求/発注）'),
    ).toBeInTheDocument();
    expect(screen.getByText('テンプレなし')).toBeInTheDocument();
    expect(screen.getByText('設定なし')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('種別'), {
      target: { value: 'estimate' },
    });
    expect(setTemplateForm).toHaveBeenCalledWith({
      ...baseForm,
      kind: 'estimate',
    });

    fireEvent.change(screen.getByLabelText('番号ルール'), {
      target: { value: 'EYYYY-MM-NNNN' },
    });
    expect(setTemplateForm).toHaveBeenCalledWith({
      ...baseForm,
      numberRule: 'EYYYY-MM-NNNN',
    });

    fireEvent.change(screen.getByLabelText('ロゴURL'), {
      target: { value: 'https://cdn.example.test/logo-2.png' },
    });
    expect(setTemplateForm).toHaveBeenCalledWith({
      ...baseForm,
      logoUrl: 'https://cdn.example.test/logo-2.png',
    });

    fireEvent.change(screen.getByLabelText('署名テキスト'), {
      target: { value: '代表取締役' },
    });
    expect(setTemplateForm).toHaveBeenCalledWith({
      ...baseForm,
      signatureText: '代表取締役',
    });

    fireEvent.click(screen.getByLabelText('default'));
    expect(setTemplateForm).toHaveBeenCalledWith({
      ...baseForm,
      isDefault: true,
    });

    fireEvent.change(screen.getByLabelText('layoutConfig (JSON)'), {
      target: { value: '{"columns":3}' },
    });
    expect(setTemplateForm).toHaveBeenCalledWith({
      ...baseForm,
      layoutConfigJson: '{"columns":3}',
    });

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('renders item details and delegates edit/default actions', () => {
    const defaultItem = createItem({ id: 'setting-1', isDefault: true });
    const customItem = createItem({
      id: 'setting-2',
      kind: 'estimate',
      templateId: 'tpl-2',
      numberRule: 'EYYYY-MM-NNNN',
      logoUrl: null,
      signatureText: null,
    });
    const { onEdit, onSetDefault } = renderCard({
      items: [defaultItem, customItem],
      editingTemplateId: 'setting-2',
      templateNameMap: new Map([
        ['tpl-1', '請求書A'],
        ['tpl-2', '見積書B'],
      ]),
    });

    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();

    const defaultCard = within(
      screen
        .getAllByText('invoice', { selector: 'strong' })[0]
        .closest('.card') as HTMLElement,
    );
    expect(defaultCard.getByText('default')).toBeInTheDocument();
    expect(defaultCard.getByText(/\(請求書A\)/)).toBeInTheDocument();
    expect(
      defaultCard.getByRole('button', { name: 'デフォルト化' }),
    ).toBeDisabled();

    const estimateCard = within(
      screen
        .getAllByText('estimate', { selector: 'strong' })[0]
        .closest('.card') as HTMLElement,
    );
    expect(estimateCard.getByText('custom')).toBeInTheDocument();
    expect(estimateCard.getByText(/logo: -/)).toBeInTheDocument();
    expect(estimateCard.getByText(/signature: -/)).toBeInTheDocument();

    fireEvent.click(estimateCard.getByRole('button', { name: '編集' }));
    fireEvent.click(estimateCard.getByRole('button', { name: 'デフォルト化' }));

    expect(onEdit).toHaveBeenCalledWith(customItem);
    expect(onSetDefault).toHaveBeenCalledWith('setting-2');
  });
});
