export type AttachmentKind = 'image' | 'pdf' | 'file';

export function resolveAttachmentKind(
  mimeType: string | null | undefined,
): AttachmentKind {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized === 'application/pdf') return 'pdf';
  return 'file';
}
