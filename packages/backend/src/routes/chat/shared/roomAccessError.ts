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
      message: typeof ROOM_ACCESS_FORBIDDEN_MESSAGE;
    };
  };
};

const ROOM_ACCESS_FORBIDDEN_MESSAGE =
  'Access to this room is forbidden' as const;

function assertNever(value: never): never {
  throw new Error(`Unhandled RoomAccessDeniedReason: ${value}`);
}

export function buildRoomAccessErrorResponse(
  reason: RoomAccessDeniedReason,
): RoomAccessErrorResponse {
  switch (reason) {
    case 'not_found':
      return {
        status: 404,
        body: {
          error: {
            code: 'NOT_FOUND',
            message: ROOM_ACCESS_FORBIDDEN_MESSAGE,
          },
        },
      };
    case 'forbidden_project':
      return {
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: ROOM_ACCESS_FORBIDDEN_MESSAGE,
          },
        },
      };
    case 'forbidden_external_room':
      return {
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN_EXTERNAL_ROOM',
            message: ROOM_ACCESS_FORBIDDEN_MESSAGE,
          },
        },
      };
    case 'forbidden_room_member':
      return {
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN_ROOM_MEMBER',
            message: ROOM_ACCESS_FORBIDDEN_MESSAGE,
          },
        },
      };
    default:
      return assertNever(reason);
  }
}
