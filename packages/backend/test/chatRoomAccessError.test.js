import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRoomAccessErrorResponse } from '../dist/routes/chat/shared/roomAccessError.js';

test('buildRoomAccessErrorResponse maps not_found to 404/NOT_FOUND', () => {
  const result = buildRoomAccessErrorResponse('not_found');
  assert.deepEqual(result, {
    status: 404,
    body: {
      error: {
        code: 'NOT_FOUND',
        message: 'Access to this room is forbidden',
      },
    },
  });
});

test('buildRoomAccessErrorResponse maps forbidden reasons to 403 codes', () => {
  const cases = [
    {
      reason: 'forbidden_project',
      code: 'FORBIDDEN_PROJECT',
    },
    {
      reason: 'forbidden_external_room',
      code: 'FORBIDDEN_EXTERNAL_ROOM',
    },
    {
      reason: 'forbidden_room_member',
      code: 'FORBIDDEN_ROOM_MEMBER',
    },
  ];

  for (const { reason, code } of cases) {
    const result = buildRoomAccessErrorResponse(reason);
    assert.deepEqual(result, {
      status: 403,
      body: {
        error: {
          code,
          message: 'Access to this room is forbidden',
        },
      },
    });
  }
});
