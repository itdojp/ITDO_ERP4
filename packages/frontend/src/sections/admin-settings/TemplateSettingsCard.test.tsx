import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TemplateSettingsCard,
  type TemplateFormValue,
  type TemplateSettingItem,
} from './TemplateSettingsCard';

const baseForm: TemplateFormValue = {
  kind: 'invoice',
  templateId: 'tpl-invoice',
  numberRule: 'INV-YYYY-MM-NNNN',
  layoutConfigJson: '{"paperSize":"A4"}',
  logoUrl: 'https://example.com/logo.png',
  signatureText: '代表取締役',
  isDefault: false,
};

const templateKinds = ['invoice', 'quote', 'purchase_order'] as const;

function getBadge(text: string) {
  return screen.getByText(
    (_, node) =>
      node?.tagName === 'SPAN' &&
      node.classList.contains('badge') &&
      node.textContent === text,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('TemplateSettingsCard', () => {
  it('updates form fields and delegates actions in create mode', () => {
    const setTemplateForm = vi.fn();
    const onSubmit = vi.fn();
    const onReset = vi.fn();
    const onReload = vi.fn();

    render(
      <TemplateSettingsCard
        templateForm={baseForm}
        setTemplateForm={setTemplateForm}
        templateKinds={templateKinds}
        templatesForKind={[
          { id: 'tpl-invoice', name: '請求書A' },
          { id: 'tpl-quote', name: '見積書B' },
        ]}
        editingTemplateId={null}
        onSubmit={onSubmit}
        onReset={onReset}
        onReload={onReload}
        items={[]}
        templateNameMap={new Map()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('種別'), {
      target: { value: 'quote' },
    });
    expect(setTemplateForm).toHaveBeenNthCalledWith(1, {
      ...baseForm,
      kind: 'quote',
    });

    fireEvent.change(screen.getByLabelText('テンプレ'), {
      target: { value: 'tpl-quote' },
    });
    expect(setTemplateForm).toHaveBeenNthCalledWith(2, {
      ...baseForm,
      templateId: 'tpl-quote',
    });

    fireEvent.change(screen.getByLabelText('番号ルール'), {
      target: { value: 'Q-YYYY-NNN' },
    });
    expect(setTemplateForm).toHaveBeenNthCalledWith(3, {
      ...baseForm,
      numberRule: 'Q-YYYY-NNN',
    });

    fireEvent.change(screen.getByLabelText('ロゴURL'), {
      target: { value: 'https://cdn.example.com/logo.svg' },
    });
    expect(setTemplateForm).toHaveBeenNthCalledWith(4, {
      ...baseForm,
      logoUrl: 'https://cdn.example.com/logo.svg',
    });

    fireEvent.change(screen.getByLabelText('署名テキスト'), {
      target: { value: '営業部長' },
    });
    expect(setTemplateForm).toHaveBeenNthCalledWith(5, {
      ...baseForm,
      signatureText: '営業部長',
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'default' }));
    expect(setTemplateForm).toHaveBeenNthCalledWith(6, {
      ...baseForm,
      isDefault: true,
    });

    fireEvent.change(screen.getByLabelText('layoutConfig (JSON)'), {
      target: { value: '{"paperSize":"Letter"}' },
    });
    expect(setTemplateForm).toHaveBeenNthCalledWith(7, {
      ...baseForm,
      layoutConfigJson: '{"paperSize":"Letter"}',
    });

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('shows empty template fallback and empty settings state', () => {
    render(
      <TemplateSettingsCard
        templateForm={baseForm}
        setTemplateForm={vi.fn()}
        templateKinds={templateKinds}
        templatesForKind={[]}
        editingTemplateId={null}
        onSubmit={vi.fn()}
        onReset={vi.fn()}
        onReload={vi.fn()}
        items={[]}
        templateNameMap={new Map()}
        onEdit={vi.fn()}
        onSetDefault={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('option', { name: 'テンプレなし' }),
    ).toBeInTheDocument();
    expect(screen.getByText('設定なし')).toBeInTheDocument();
  });

  it('renders items, resolves template names, and delegates edit/default actions', () => {
    const onEdit = vi.fn();
    const onSetDefault = vi.fn();
    const items: TemplateSettingItem[] = [
      {
        id: 'setting-1',
        kind: 'invoice',
        templateId: 'tpl-invoice',
        numberRule: 'INV-YYYY',
        logoUrl: 'https://example.com/logo.png',
        signatureText: '代表取締役',
        isDefault: true,
      },
      {
        id: 'setting-2',
        kind: 'quote',
        templateId: 'tpl-missing',
        numberRule: 'Q-YYYY',
        logoUrl: null,
        signatureText: null,
        isDefault: false,
      },
    ];

    render(
      <TemplateSettingsCard
        templateForm={baseForm}
        setTemplateForm={vi.fn()}
        templateKinds={templateKinds}
        templatesForKind={[{ id: 'tpl-invoice', name: '請求書A' }]}
        editingTemplateId="setting-1"
        onSubmit={vi.fn()}
        onReset={vi.fn()}
        onReload={vi.fn()}
        items={items}
        templateNameMap={new Map([['tpl-invoice', '請求書A']])}
        onEdit={onEdit}
        onSetDefault={onSetDefault}
      />,
    );

    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, node) =>
          node?.textContent === 'invoice / tpl-invoice (請求書A) / INV-YYYY',
      )[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, node) => node?.textContent === 'quote / tpl-missing / Q-YYYY',
      )[0],
    ).toBeInTheDocument();
    expect(getBadge('default')).toBeInTheDocument();
    expect(getBadge('custom')).toBeInTheDocument();
    expect(
      screen.getByText(
        'logo: https://example.com/logo.png / signature: 代表取締役',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('logo: - / signature: -')).toBeInTheDocument();

    const editButtons = screen.getAllByRole('button', { name: '編集' });
    fireEvent.click(editButtons[0]);
    fireEvent.click(editButtons[1]);
    expect(onEdit).toHaveBeenNthCalledWith(1, items[0]);
    expect(onEdit).toHaveBeenNthCalledWith(2, items[1]);

    const defaultButtons = screen.getAllByRole('button', {
      name: 'デフォルト化',
    });
    expect(defaultButtons[0]).toBeDisabled();
    fireEvent.click(defaultButtons[1]);
    expect(onSetDefault).toHaveBeenCalledWith('setting-2');
  });
});
