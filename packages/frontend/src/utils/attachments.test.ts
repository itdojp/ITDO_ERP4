import { describe, expect, it } from 'vitest';

import { resolveAttachmentKind } from './attachments';

describe('resolveAttachmentKind', () => {
  it('resolves image mime types', () => {
    expect(resolveAttachmentKind('image/png')).toBe('image');
    expect(resolveAttachmentKind('IMAGE/JPEG')).toBe('image');
  });

  it('resolves pdf mime types', () => {
    expect(resolveAttachmentKind('application/pdf')).toBe('pdf');
  });

  it('falls back to file for unknown or missing mime types', () => {
    expect(resolveAttachmentKind('text/plain')).toBe('file');
    expect(resolveAttachmentKind(undefined)).toBe('file');
    expect(resolveAttachmentKind(null)).toBe('file');
  });
});
