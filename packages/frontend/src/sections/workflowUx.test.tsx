import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  WorkflowMetricGrid,
  WorkflowPageHeader,
  WorkflowPanel,
  workflowUxTokens,
} from './workflowUx';

describe('workflowUx', () => {
  it('keeps design-system token fallbacks in one exported contract', () => {
    expect(workflowUxTokens.color.textPrimary).toBe(
      'var(--color-text-primary, #0f172a)',
    );
    expect(workflowUxTokens.color.borderDefault).toBe(
      'var(--color-border-default, #e2e8f0)',
    );
    expect(workflowUxTokens.space.md).toBe('var(--space-12, 12px)');
    expect(workflowUxTokens.radius.panel).toBe('var(--radius-lg, 12px)');
    expect(workflowUxTokens.shadow.metric).toBe(
      'var(--shadow-xs, 0 1px 2px rgba(15, 23, 42, 0.05))',
    );
  });

  it('renders a page header with the existing level-2 heading contract', () => {
    render(
      <section>
        <WorkflowPageHeader
          title="工数入力"
          description="案件・タスク・日付を確認しながら工数を登録します。"
          actions={<button type="button">日報を開く</button>}
        />
      </section>,
    );

    expect(
      screen.getByRole('heading', { name: '工数入力', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '工数入力', level: 2 }),
    ).toHaveAccessibleDescription(
      '案件・タスク・日付を確認しながら工数を登録します。',
    );
    expect(
      screen.getByText('案件・タスク・日付を確認しながら工数を登録します。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '日報を開く' })).toBeVisible();
  });

  it('renders metric summaries and panel descriptions for workflow guidance', () => {
    render(
      <>
        <WorkflowMetricGrid
          ariaLabel="案件サマリー"
          items={[
            { label: '案件数', value: '2件', helper: '進行中 1件' },
            { label: '顧客', value: '2社', tone: 'success' },
          ]}
        />
        <WorkflowPanel title="入力" description="必須項目から順に登録します。">
          <button type="button">追加</button>
        </WorkflowPanel>
      </>,
    );

    expect(screen.getByLabelText('案件サマリー')).toBeInTheDocument();
    expect(screen.getAllByRole('term')[0]).toHaveTextContent('案件数');
    expect(screen.getByText('案件数')).toBeInTheDocument();
    expect(screen.getByText('2件')).toBeInTheDocument();
    expect(screen.getByText('進行中 1件')).toBeInTheDocument();
    expect(screen.getAllByRole('term')[1]).toHaveTextContent('顧客');
    expect(screen.getByText('顧客')).toBeInTheDocument();
    expect(screen.getByText('2社')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '入力', level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: '入力' }),
    ).toHaveAccessibleDescription('必須項目から順に登録します。');
    expect(screen.getByRole('button', { name: '追加' })).toBeVisible();
  });
});
