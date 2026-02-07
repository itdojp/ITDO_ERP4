import React from 'react';
import { AsyncStatePanel, type AsyncPanelState } from '@itdo/design-system';

export type ListLoadStatus = 'idle' | 'loading' | 'error' | 'success';

export type ListStatePanelProps = {
  status: ListLoadStatus;
  count: number;
  error?: string;
  onRetry?: () => void;
  loadingText?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  errorTitle?: string;
  className?: string;
};

export function resolveListAsyncState(params: {
  status: ListLoadStatus;
  count: number;
}): AsyncPanelState {
  const { status, count } = params;
  if (status === 'idle' || status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (count === 0) return 'empty';
  return 'ready';
}

export const ListStatePanel: React.FC<ListStatePanelProps> = ({
  status,
  count,
  error,
  onRetry,
  loadingText = '読み込み中',
  emptyTitle = 'データがありません',
  emptyDescription = '条件を変更して再度お試しください',
  errorTitle = 'データの取得に失敗しました',
  className,
}) => {
  const state = resolveListAsyncState({ status, count });
  return (
    <AsyncStatePanel
      state={state}
      className={className}
      loadingText={loadingText}
      empty={{
        title: emptyTitle,
        description: emptyDescription,
      }}
      error={{
        title: errorTitle,
        detail: error || '通信環境を確認して再試行してください',
        onRetry: onRetry,
        retryLabel: onRetry ? '再試行' : undefined,
      }}
    >
      {null}
    </AsyncStatePanel>
  );
};
