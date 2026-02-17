export type RoomAccessDeniedReason =
  | 'not_found'
  | 'forbidden_project'
  | 'forbidden_external_room'
  | 'forbidden_room_member';

type RoomAccessErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN_PROJECT'
  | 'FORBIDDEN_EXTERNAL_ROOM'
  | 'FORBIDDEN_ROOM_MEMBER';

type RoomAccessErrorResponse = {
  status: 404 | 403;
  body: {
    error: {
      code: RoomAccessErrorCode;
      message: 'Access to this room is forbidden';
    };
  };
};

export function buildRoomAccessErrorResponse(
  reason: RoomAccessDeniedReason,
): RoomAccessErrorResponse {
  if (reason === 'not_found') {
    return {
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: 'Access to this room is forbidden',
        },
      },
    };
  }
  if (reason === 'forbidden_project') {
    return {
      status: 403,
      body: {
        error: {
          code: 'FORBIDDEN_PROJECT',
          message: 'Access to this room is forbidden',
        },
      },
    };
  }
  if (reason === 'forbidden_external_room') {
    return {
      status: 403,
      body: {
        error: {
          code: 'FORBIDDEN_EXTERNAL_ROOM',
          message: 'Access to this room is forbidden',
        },
      },
    };
  }
  return {
    status: 403,
    body: {
      error: {
        code: 'FORBIDDEN_ROOM_MEMBER',
        message: 'Access to this room is forbidden',
      },
    },
  };
}
