import { describe, expect, it } from 'vitest';

import {
  buildDisplayedRooms,
  formatRoomLabel,
  toAttachmentRecord,
  transformLinkUri,
  type ChatRoom,
} from './roomChatModel';

describe('roomChatModel', () => {
  it('formats direct-message labels for the current user', () => {
    const room: ChatRoom = {
      id: 'dm-1',
      type: 'dm',
      name: 'dm:alice:bob',
    };

    expect(formatRoomLabel(room, 'alice')).toBe('bob');
    expect(formatRoomLabel(room, 'charlie')).toBe('alice / bob');
  });

  it('filters displayed rooms by GA personal scope and query', () => {
    const rooms: ChatRoom[] = [
      {
        id: 'pga_1',
        type: 'private_group',
        name: '総務個別',
        isOfficial: true,
      },
      {
        id: 'private_1',
        type: 'private_group',
        name: '任意グループ',
        isOfficial: false,
      },
      {
        id: 'project-1',
        type: 'project',
        name: 'project room',
        projectCode: 'P-001',
        projectName: 'Alpha',
      },
    ];

    expect(buildDisplayedRooms(rooms, 'alice', 'ga_personal', '総務')).toEqual([
      expect.objectContaining({
        id: 'pga_1',
        label: 'private_group: 総務個別',
      }),
    ]);
    expect(buildDisplayedRooms(rooms, 'alice', 'all', 'alpha')).toEqual([
      expect.objectContaining({
        id: 'project-1',
        label: 'project: P-001 / Alpha',
      }),
    ]);
  });

  it('allows safe markdown links and rejects javascript URLs', () => {
    expect(transformLinkUri('/internal')).toBe('/internal');
    expect(transformLinkUri('https://example.com')).toBe('https://example.com');
    expect(transformLinkUri('mailto:hello@example.com')).toBe(
      'mailto:hello@example.com',
    );
    expect(transformLinkUri('javascript:alert(1)')).toBe('');
  });

  it('normalizes attachment records for the shared attachment field', () => {
    expect(
      toAttachmentRecord({
        id: 'att-1',
        originalName: 'evidence.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'att-1',
        name: 'evidence.pdf',
        size: 123,
        mimeType: 'application/pdf',
        status: 'uploaded',
      }),
    );
  });
});
