import { describe, expect, it } from 'vitest';

import { toIsoFromLocalInput, toLocalDateTimeValue } from './datetime';

describe('datetime utils', () => {
  it('formats ISO value for datetime-local input', () => {
    const value = '2026-03-25T12:34:56.000Z';
    const expectedDate = new Date(value);
    const pad = (num: number) => String(num).padStart(2, '0');
    const expected = `${expectedDate.getFullYear()}-${pad(
      expectedDate.getMonth() + 1,
    )}-${pad(expectedDate.getDate())}T${pad(expectedDate.getHours())}:${pad(
      expectedDate.getMinutes(),
    )}`;
    expect(toLocalDateTimeValue(value)).toBe(expected);
  });

  it('returns empty string for invalid input', () => {
    expect(toLocalDateTimeValue('not-a-date')).toBe('');
    expect(toLocalDateTimeValue(null)).toBe('');
  });

  it('converts datetime-local input into ISO string', () => {
    expect(toIsoFromLocalInput('2026-03-25T21:45')).toBe(
      new Date('2026-03-25T21:45').toISOString(),
    );
  });

  it('returns null for invalid local input', () => {
    expect(toIsoFromLocalInput('')).toBeNull();
    expect(toIsoFromLocalInput('invalid')).toBeNull();
  });
});
