import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ListStatePanel, resolveListAsyncState } from './listStatePanel';

describe('resolveListAsyncState', () => {
  it('maps loading-like states to loading', () => {
    expect(resolveListAsyncState({ status: 'idle', count: 0 })).toBe('loading');
    expect(resolveListAsyncState({ status: 'loading', count: 1 })).toBe(
      'loading',
    );
  });

  it('maps error, empty, ready states deterministically', () => {
    expect(resolveListAsyncState({ status: 'error', count: 10 })).toBe('error');
    expect(resolveListAsyncState({ status: 'success', count: 0 })).toBe(
      'empty',
    );
    expect(resolveListAsyncState({ status: 'success', count: 2 })).toBe(
      'ready',
    );
  });
});

describe('ListStatePanel', () => {
  it('renders empty state copy', () => {
    render(<ListStatePanel status="success" count={0} />);
    expect(screen.getByText('データがありません')).toBeInTheDocument();
    expect(
      screen.getByText('条件を変更して再度お試しください'),
    ).toBeInTheDocument();
  });

  it('renders error state and retry action', () => {
    render(
      <ListStatePanel
        status="error"
        count={0}
        error="API failure"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText('データの取得に失敗しました')).toBeInTheDocument();
    expect(screen.getByText('API failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
  });
});
