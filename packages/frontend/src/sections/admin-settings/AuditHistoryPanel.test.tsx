import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auditTimelineSpy, diffViewerSpy } = vi.hoisted(() => ({
  auditTimelineSpy: vi.fn(),
  diffViewerSpy: vi.fn(),
}));

vi.mock('../../ui', () => ({
  AuditTimeline: ({
    events,
    selectedEventId,
    onSelectEvent,
  }: {
    events: Array<{
      id: string;
      action: string;
      tone: string;
      summary?: string;
    }>;
    selectedEventId?: string;
    onSelectEvent: (event: { id: string }) => void;
  }) => {
    auditTimelineSpy({ events, selectedEventId, onSelectEvent });
    return (
      <div>
        <div>{`timeline:${selectedEventId ?? '-'}`}</div>
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent({ id: event.id })}
          >
            {event.id}
          </button>
        ))}
      </div>
    );
  },
  DiffViewer: ({
    before,
    after,
    format,
  }: {
    before: unknown;
    after: unknown;
    format: string;
  }) => {
    diffViewerSpy({ before, after, format });
    return <div>{`diff:${format}`}</div>;
  },
}));

import { AuditHistoryPanel, type AuditHistoryLog } from './AuditHistoryPanel';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createLog(overrides: Partial<AuditHistoryLog> = {}): AuditHistoryLog {
  return {
    id: 'log-1',
    action: 'user_create',
    userId: 'user-1',
    actorRole: 'system_admin',
    actorGroupId: 'group-1',
    reasonCode: 'ticket',
    reasonText: 'manual operation',
    targetTable: 'UserAccount',
    targetId: 'target-1',
    createdAt: '2026-03-26T00:00:00.000Z',
    metadata: { before: { active: false }, after: { active: true } },
    ...overrides,
  };
}

describe('AuditHistoryPanel', () => {
  it('renders nothing when logs are empty', () => {
    const { container } = render(
      <AuditHistoryPanel logs={[]} onSelectLog={() => undefined} />,
    );

    expect(container.firstChild).toBeNull();
    expect(auditTimelineSpy).not.toHaveBeenCalled();
  });

  it('maps audit events to timeline tones and delegates selection', () => {
    const onSelectLog = vi.fn();
    const logs: AuditHistoryLog[] = [
      createLog({ id: 'create', action: 'user_create' }),
      createLog({
        id: 'update',
        action: 'profile_update',
        reasonCode: null,
        reasonText: null,
        metadata: { before: { name: 'old' }, after: { name: 'new' } },
      }),
      createLog({ id: 'delete', action: 'account_delete' }),
      createLog({ id: 'fail', action: 'sync_fail' }),
      createLog({ id: 'other', action: 'sync_run' }),
    ];

    render(
      <AuditHistoryPanel
        logs={logs}
        selectedLogId="update"
        onSelectLog={onSelectLog}
      />,
    );

    const timelineCall =
      auditTimelineSpy.mock.calls[auditTimelineSpy.mock.calls.length - 1]?.[0];
    expect(timelineCall.selectedEventId).toBe('update');
    expect(
      timelineCall.events.map((event: { id: string; tone: string }) => [
        event.id,
        event.tone,
      ]),
    ).toEqual([
      ['create', 'success'],
      ['update', 'info'],
      ['delete', 'warning'],
      ['fail', 'error'],
      ['other', 'default'],
    ]);
    expect(
      timelineCall.events.find((event: { id: string }) => event.id === 'create')
        ?.summary,
    ).toBe('reason: ticket / manual operation');
    expect(
      timelineCall.events.find((event: { id: string }) => event.id === 'update')
        ?.summary,
    ).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(onSelectLog).toHaveBeenCalledWith('delete');
  });

  it('renders selected log detail, diff viewer, raw metadata and patch details', () => {
    const selectedLog = createLog({
      id: 'selected',
      action: 'settings_update',
      metadata: {
        before: { enabled: false },
        after: { enabled: true },
        patch: { op: 'replace', path: '/enabled', value: true },
      },
    });
    const rawLog = createLog({
      id: 'raw',
      action: 'sync_run',
      createdAt: 'not-a-date',
      actorRole: null,
      userId: null,
      reasonCode: null,
      reasonText: null,
      metadata: { note: 'raw-only' },
    });

    const { rerender } = render(
      <AuditHistoryPanel
        logs={[selectedLog, rawLog]}
        selectedLogId="selected"
        onSelectLog={() => undefined}
      />,
    );

    expect(screen.getByText(/settings_update/)).toBeInTheDocument();
    expect(
      screen.getByText('reason: ticket / manual operation'),
    ).toBeInTheDocument();
    expect(screen.getByText('diff:json')).toBeInTheDocument();
    expect(diffViewerSpy).toHaveBeenLastCalledWith({
      before: { enabled: false },
      after: { enabled: true },
      format: 'json',
    });
    expect(screen.getByText('patch')).toBeInTheDocument();
    fireEvent.click(screen.getByText('patch'));
    expect(screen.getByText(/"path": "\/enabled"/)).toBeInTheDocument();

    rerender(
      <AuditHistoryPanel
        logs={[selectedLog, rawLog]}
        selectedLogId="raw"
        onSelectLog={() => undefined}
      />,
    );

    expect(
      screen.getByText('not-a-date / sync_run / - / -'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^reason:/)).not.toBeInTheDocument();
    expect(screen.getByText(/"note": "raw-only"/)).toBeInTheDocument();
  });
});
