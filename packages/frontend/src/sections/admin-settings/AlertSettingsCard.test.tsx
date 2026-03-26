import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { wizardSpy } = vi.hoisted(() => ({
  wizardSpy: vi.fn(),
}));

vi.mock('../../ui', () => ({
  FormWizard: (props: Record<string, unknown>) => {
    wizardSpy(props);
    return <div data-testid="form-wizard">wizard</div>;
  },
}));

import {
  AlertSettingsCard,
  type AlertSettingsCardItem,
} from './AlertSettingsCard';

const onValueChange = vi.fn();
const onSubmit = vi.fn();
const onCancel = vi.fn();

const baseWizard: React.ComponentProps<typeof AlertSettingsCard>['wizard'] = {
  steps: [{ id: 'general', title: '一般', content: <div>general</div> }],
  value: 'general',
  onValueChange,
  canSubmit: true,
  isDirty: false,
  labels: { submit: '保存', cancel: 'キャンセル' },
  onSubmit,
  onCancel,
};

const sampleItem: AlertSettingsCardItem = {
  id: 'alert-1',
  type: 'sla_overdue',
  threshold: 4,
  period: 'daily',
  scopeProjectId: 'project-1',
  recipients: {
    emails: ['ops@example.com'],
    slackWebhooks: ['slack://channel'],
    webhooks: ['https://example.com/hook'],
  },
  channels: ['mail', 'slack'],
  remindAfterHours: 12,
  remindMaxCount: 3,
  isEnabled: true,
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  wizardSpy.mockClear();
  onValueChange.mockReset();
  onSubmit.mockReset();
  onCancel.mockReset();
});

describe('AlertSettingsCard', () => {
  it('passes wizard props with protectUnsavedChanges and handles reload', () => {
    const onReload = vi.fn();

    render(
      <AlertSettingsCard
        wizard={baseWizard}
        onReload={onReload}
        items={[]}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('form-wizard')).toBeInTheDocument();
    expect(wizardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ...baseWizard,
        protectUnsavedChanges: true,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no items exist', () => {
    render(
      <AlertSettingsCard
        wizard={baseWizard}
        onReload={vi.fn()}
        items={[]}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText('設定なし')).toBeInTheDocument();
  });

  it('renders alert settings details and delegates toggle and edit', () => {
    const onToggle = vi.fn();
    const onEdit = vi.fn();

    render(
      <AlertSettingsCard
        wizard={baseWizard}
        onReload={vi.fn()}
        items={[
          sampleItem,
          {
            id: 'alert-2',
            type: 'missing_timesheet',
            threshold: 2,
            period: 'weekly',
            recipients: null,
            channels: null,
            remindAfterHours: null,
            remindMaxCount: null,
            isEnabled: false,
          },
        ]}
        onToggle={onToggle}
        onEdit={onEdit}
      />,
    );

    expect(
      screen.getByText((content) => content.includes('sla_overdue')),
    ).toBeInTheDocument();
    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(
      screen.getByText('channels: mail, slack / emails: ops@example.com'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          'Slack: slack://channel / Webhook: https://example.com/hook',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('remindAfterHours: 12 / maxCount: 3'),
    ).toBeInTheDocument();
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByText('channels: - / emails: -')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) => node?.textContent === 'Slack: - / Webhook: -',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('remindAfterHours: - / maxCount: -'),
    ).toBeInTheDocument();

    const toggleButtons = screen.getAllByRole('button', {
      name: /無効化|有効化/,
    });
    fireEvent.click(toggleButtons[0]);
    fireEvent.click(toggleButtons[1]);
    expect(onToggle).toHaveBeenNthCalledWith(1, 'alert-1', true);
    expect(onToggle).toHaveBeenNthCalledWith(2, 'alert-2', false);

    const editButtons = screen.getAllByRole('button', { name: '編集' });
    fireEvent.click(editButtons[0]);
    fireEvent.click(editButtons[1]);
    expect(onEdit).toHaveBeenNthCalledWith(1, sampleItem);
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'alert-2' }),
    );
  });
});
