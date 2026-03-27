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
  AlertSettingsCard,
  type AlertSettingsCardItem,
} from './AlertSettingsCard';

const formWizardSpy = vi.fn();

vi.mock('../../ui', () => ({
  FormWizard: (props: {
    steps: Array<{ id: string; title: string }>;
    value?: string;
    onValueChange?: (stepId: string) => void;
    canSubmit?: boolean;
    isDirty?: boolean;
    autosave?: { status: 'idle' | 'saving' | 'saved' | 'error' };
    labels?: Record<string, string>;
    onSubmit?: () => void;
    onCancel?: () => void;
    protectUnsavedChanges?: boolean;
  }) => {
    formWizardSpy(props);
    return (
      <div data-testid="mock-form-wizard">
        <div>{props.protectUnsavedChanges ? 'protected' : 'unprotected'}</div>
        <button
          type="button"
          onClick={() => props.onValueChange?.('threshold')}
        >
          wizard-change
        </button>
        <button type="button" onClick={() => props.onSubmit?.()}>
          wizard-submit
        </button>
        <button type="button" onClick={() => props.onCancel?.()}>
          wizard-cancel
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createItem(
  overrides: Partial<AlertSettingsCardItem> = {},
): AlertSettingsCardItem {
  return {
    id: 'alert-1',
    type: 'invoice_overdue',
    threshold: 5,
    period: '24h',
    channels: ['email', 'slack'],
    recipients: {
      emails: ['ops@example.com'],
      slackWebhooks: ['https://hooks.slack.test/1'],
      webhooks: ['https://hooks.example.test/notify'],
    },
    remindAfterHours: 12,
    remindMaxCount: 3,
    isEnabled: true,
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof AlertSettingsCard>> = {},
) {
  const onValueChange = vi.fn();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onReload = vi.fn();
  const onToggle = vi.fn();
  const onEdit = vi.fn();

  render(
    <AlertSettingsCard
      wizard={{
        steps: [
          { id: 'details', title: 'details', content: <div>details</div> },
        ],
        value: 'details',
        onValueChange,
        canSubmit: true,
        isDirty: true,
        autosave: { status: 'idle' },
        labels: { submit: '保存' },
        onSubmit,
        onCancel,
      }}
      onReload={onReload}
      items={[]}
      onToggle={onToggle}
      onEdit={onEdit}
      {...overrides}
    />,
  );

  return { onValueChange, onSubmit, onCancel, onReload, onToggle, onEdit };
}

describe('AlertSettingsCard', () => {
  it('renders form wizard with protectUnsavedChanges and delegates wizard/reload actions', () => {
    const { onValueChange, onSubmit, onCancel, onReload } = renderCard();

    expect(screen.getByText('アラート設定（簡易モック）')).toBeInTheDocument();
    expect(screen.getByText('protected')).toBeInTheDocument();
    expect(screen.getByText('設定なし')).toBeInTheDocument();
    expect(formWizardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ protectUnsavedChanges: true, canSubmit: true }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'wizard-change' }));
    fireEvent.click(screen.getByRole('button', { name: 'wizard-submit' }));
    fireEvent.click(screen.getByRole('button', { name: 'wizard-cancel' }));
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    expect(onValueChange).toHaveBeenCalledWith('threshold');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('renders alert items with fallbacks and delegates toggle/edit actions', () => {
    const enabledItem = createItem();
    const disabledItem = createItem({
      id: 'alert-2',
      type: 'chat_break_glass',
      channels: [],
      recipients: {},
      remindAfterHours: null,
      remindMaxCount: null,
      isEnabled: false,
    });
    const { onToggle, onEdit } = renderCard({
      items: [enabledItem, disabledItem],
    });

    const enabledCard = within(
      screen.getByText('invoice_overdue').closest('.card') as HTMLElement,
    );
    expect(enabledCard.getByText('enabled')).toBeInTheDocument();
    expect(enabledCard.getByText(/channels: email, slack/)).toBeInTheDocument();
    expect(
      enabledCard.getByText(/emails: ops@example.com/),
    ).toBeInTheDocument();
    expect(enabledCard.getByText(/remindAfterHours: 12/)).toBeInTheDocument();
    expect(enabledCard.getByText(/maxCount: 3/)).toBeInTheDocument();
    expect(
      enabledCard.getByText(/Slack: https:\/\/hooks\.slack\.test\/1/),
    ).toBeInTheDocument();
    expect(
      enabledCard.getByText(/Webhook: https:\/\/hooks\.example\.test\/notify/),
    ).toBeInTheDocument();

    fireEvent.click(enabledCard.getByRole('button', { name: '無効化' }));
    fireEvent.click(enabledCard.getByRole('button', { name: '編集' }));

    expect(onToggle).toHaveBeenCalledWith('alert-1', true);
    expect(onEdit).toHaveBeenCalledWith(enabledItem);

    const disabledCard = within(
      screen.getByText('chat_break_glass').closest('.card') as HTMLElement,
    );
    expect(disabledCard.getByText('disabled')).toBeInTheDocument();
    expect(disabledCard.getByText(/channels: -/)).toBeInTheDocument();
    expect(disabledCard.getByText(/emails: -/)).toBeInTheDocument();
    expect(disabledCard.getByText(/remindAfterHours: -/)).toBeInTheDocument();
    expect(disabledCard.getByText(/maxCount: -/)).toBeInTheDocument();
    expect(disabledCard.getByText(/Slack: -/)).toBeInTheDocument();
    expect(disabledCard.getByText(/Webhook: -/)).toBeInTheDocument();

    fireEvent.click(disabledCard.getByRole('button', { name: '有効化' }));
    expect(onToggle).toHaveBeenCalledWith('alert-2', false);
  });
});
