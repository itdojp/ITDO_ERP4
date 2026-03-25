import { describe, expect, it, vi } from 'vitest';

import { buildOpenHash, navigateToOpen, parseOpenHash } from './deepLink';

describe('deepLink utils', () => {
  it('builds open hash from kind and id', () => {
    expect(buildOpenHash({ kind: 'project', id: 'PJ-001' })).toBe(
      '#/open?kind=project&id=PJ-001',
    );
  });

  it('parses open hash and trims parameters', () => {
    expect(parseOpenHash('#/open?kind=%20project%20&id=%20PJ-001%20')).toEqual({
      kind: 'project',
      id: 'PJ-001',
    });
  });

  it('returns null for unsupported or incomplete hashes', () => {
    expect(parseOpenHash('')).toBeNull();
    expect(parseOpenHash('#/other?kind=project&id=PJ-001')).toBeNull();
    expect(parseOpenHash('#/open?kind=project')).toBeNull();
    expect(parseOpenHash('#/open?id=PJ-001')).toBeNull();
  });

  it('updates location hash when navigating', () => {
    window.location.hash = '';
    navigateToOpen({ kind: 'invoice', id: 'INV-1' });
    expect(window.location.hash).toBe('#/open?kind=invoice&id=INV-1');
  });
});
