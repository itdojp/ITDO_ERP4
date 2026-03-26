import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HelpModal } from './HelpModal';

afterEach(() => {
  cleanup();
});

describe('HelpModal', () => {
  it('renders consultation options and emergency guidance', () => {
    render(<HelpModal onClose={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'ヘルプ / 相談' }),
    ).toBeInTheDocument();
    expect(screen.getByText('上長に相談')).toBeInTheDocument();
    expect(screen.getByText('人事・労務に相談')).toBeInTheDocument();
    expect(screen.getByText('産業医/保健スタッフ')).toBeInTheDocument();
    expect(screen.getByText('社外相談窓口（EAP等）')).toBeInTheDocument();
    expect(
      screen.getByText('緊急の支援が必要かもしれない'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('通知先: manager_group / 目安: 2営業日'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('通知先: public_hotline / 目安: 至急'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '緊急の状態では、ただちに医療機関や公的相談窓口に連絡してください。',
      ),
    ).toBeInTheDocument();
  });

  it('toggles multiple selections independently', () => {
    render(<HelpModal onClose={vi.fn()} />);

    const manager = screen.getByRole('checkbox', { name: /上長に相談/ });
    const health = screen.getByRole('checkbox', {
      name: /産業医\/保健スタッフ/,
    });

    expect(manager).not.toBeChecked();
    expect(health).not.toBeChecked();

    fireEvent.click(manager);
    fireEvent.click(health);

    expect(manager).toBeChecked();
    expect(health).toBeChecked();

    fireEvent.click(manager);

    expect(manager).not.toBeChecked();
    expect(health).toBeChecked();
  });

  it('delegates both close buttons to onClose', () => {
    const onClose = vi.fn();

    render(<HelpModal onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '送信 (Stub)' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
