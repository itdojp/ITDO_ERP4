import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from './clipboard';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('returns false for empty values', async () => {
    await expect(copyToClipboard('')).resolves.toBe(false);
  });

  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await expect(copyToClipboard('copied-value')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('copied-value');
  });

  it('falls back to execCommand when clipboard api fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard('fallback-copy')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('returns false when fallback copy fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    await expect(copyToClipboard('cannot-copy')).resolves.toBe(false);
  });
});
