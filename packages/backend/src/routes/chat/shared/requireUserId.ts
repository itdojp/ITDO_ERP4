type ReplyLike = {
  status: (statusCode: number) => {
    send: (payload: unknown) => unknown;
  };
};

export function requireUserId(
  reply: ReplyLike,
  userId: string | null | undefined,
) {
  if (userId) return userId;
  reply.status(400).send({
    error: { code: 'MISSING_USER_ID', message: 'user id is required' },
  });
  return null;
}
