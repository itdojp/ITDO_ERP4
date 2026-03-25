import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type SavedViewBarProps = {
  views: Array<{
    id: string;
    payload: { search: string; status: string };
  }>;
  activeViewId: string | null;
  onSelectView: (viewId: string) => void;
  onSaveAs: (name: string) => void;
  onUpdateView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onShareView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  labels: {
    title: string;
    saveAsPlaceholder: string;
    saveAsButton: string;
    update: string;
    duplicate: string;
    share: string;
    delete: string;
    active: string;
  };
};

const savedViewBarSpy = vi.hoisted(() =>
  vi.fn<(props: SavedViewBarProps) => void>(),
);

vi.mock('../../ui', () => ({
  SavedViewBar: (props: SavedViewBarProps) => {
    savedViewBarSpy(props);
    return (
      <div>
        <div>{props.labels.title}</div>
        <div>{`${props.labels.active}: ${props.activeViewId}`}</div>
        <button type="button" onClick={() => props.onSelectView('view-1')}>
          select view-1
        </button>
        <button
          type="button"
          onClick={() => props.onSelectView('missing-view')}
        >
          select missing
        </button>
        <button type="button" onClick={() => props.onSaveAs('新規ビュー')}>
          save as
        </button>
        <button type="button" onClick={() => props.onUpdateView('view-1')}>
          update view-1
        </button>
        <button type="button" onClick={() => props.onDuplicateView('view-1')}>
          duplicate view-1
        </button>
        <button type="button" onClick={() => props.onShareView('view-1')}>
          share view-1
        </button>
        <button type="button" onClick={() => props.onDeleteView('view-1')}>
          delete view-1
        </button>
      </div>
    );
  },
}));

import { VendorInvoiceSavedViewBar } from './VendorInvoiceSavedViewBar';

afterEach(() => {
  cleanup();
  savedViewBarSpy.mockClear();
});

type SavedViewsProp = React.ComponentProps<
  typeof VendorInvoiceSavedViewBar
>['savedViews'];

function createSavedViews(): SavedViewsProp {
  return {
    views: [
      {
        id: 'view-1',
        name: '承認済み',
        payload: { search: 'alpha', status: 'approved' },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ],
    activeViewId: 'default',
    selectView: vi.fn(),
    createView: vi.fn(),
    updateView: vi.fn(),
    duplicateView: vi.fn(),
    toggleShared: vi.fn(),
    deleteView: vi.fn(),
    getShareLink: vi.fn((viewId: string) => `/saved-views/${viewId}`),
  };
}

function renderComponent(
  overrides: Partial<
    React.ComponentProps<typeof VendorInvoiceSavedViewBar>
  > = {},
) {
  const savedViews = createSavedViews();
  const onChangeInvoiceSearch = vi.fn();
  const onChangeInvoiceStatusFilter = vi.fn();
  const normalizeInvoiceStatusFilter = vi.fn(
    (value: string, options: string[]) => `${value}:${options.join(',')}`,
  );

  render(
    <VendorInvoiceSavedViewBar
      savedViews={savedViews}
      invoiceSearch="needle"
      invoiceStatusFilter="draft"
      invoiceStatusOptions={['all', 'draft', 'approved']}
      onChangeInvoiceSearch={onChangeInvoiceSearch}
      onChangeInvoiceStatusFilter={onChangeInvoiceStatusFilter}
      normalizeInvoiceStatusFilter={normalizeInvoiceStatusFilter}
      {...overrides}
    />,
  );

  return {
    savedViews,
    onChangeInvoiceSearch,
    onChangeInvoiceStatusFilter,
    normalizeInvoiceStatusFilter,
  };
}

describe('VendorInvoiceSavedViewBar', () => {
  it('maps select view to filter updates', () => {
    const {
      savedViews,
      onChangeInvoiceSearch,
      onChangeInvoiceStatusFilter,
      normalizeInvoiceStatusFilter,
    } = renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'select view-1' }));

    expect(savedViews.selectView).toHaveBeenCalledWith('view-1');
    expect(onChangeInvoiceSearch).toHaveBeenCalledWith('alpha');
    expect(normalizeInvoiceStatusFilter).toHaveBeenCalledWith('approved', [
      'all',
      'draft',
      'approved',
    ]);
    expect(onChangeInvoiceStatusFilter).toHaveBeenCalledWith(
      'approved:all,draft,approved',
    );
    expect(screen.getByText('仕入請求フィルタ保存')).toBeInTheDocument();
    expect(screen.getByText('現在のビュー: default')).toBeInTheDocument();
  });

  it('does not update filters when the selected view is missing', () => {
    const {
      savedViews,
      onChangeInvoiceSearch,
      onChangeInvoiceStatusFilter,
      normalizeInvoiceStatusFilter,
    } = renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'select missing' }));

    expect(savedViews.selectView).toHaveBeenCalledWith('missing-view');
    expect(onChangeInvoiceSearch).not.toHaveBeenCalled();
    expect(onChangeInvoiceStatusFilter).not.toHaveBeenCalled();
    expect(normalizeInvoiceStatusFilter).not.toHaveBeenCalled();
  });

  it('delegates save, update, duplicate, share, and delete actions', () => {
    const { savedViews, normalizeInvoiceStatusFilter } = renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'save as' }));
    fireEvent.click(screen.getByRole('button', { name: 'update view-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'duplicate view-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'share view-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete view-1' }));

    expect(normalizeInvoiceStatusFilter).toHaveBeenNthCalledWith(1, 'draft', [
      'all',
      'draft',
      'approved',
    ]);
    expect(savedViews.createView).toHaveBeenCalledWith('新規ビュー', {
      search: 'needle',
      status: 'draft:all,draft,approved',
    });
    expect(savedViews.updateView).toHaveBeenCalledWith('view-1', {
      payload: {
        search: 'needle',
        status: 'draft:all,draft,approved',
      },
    });
    expect(savedViews.duplicateView).toHaveBeenCalledWith('view-1');
    expect(savedViews.toggleShared).toHaveBeenCalledWith('view-1', true);
    expect(savedViews.deleteView).toHaveBeenCalledWith('view-1');
    expect(savedViewBarSpy).toHaveBeenCalled();
  });
});
