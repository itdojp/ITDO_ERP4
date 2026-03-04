export async function resolveProjectRoomId(options: {
  request: {
    get: (
      url: string,
      init: { headers: Record<string, string> },
    ) => Promise<any>;
  };
  apiBase: string;
  projectId: string;
  headers: Record<string, string>;
}) {
  const roomRes = await options.request.get(`${options.apiBase}/chat-rooms`, {
    headers: options.headers,
  });
  if (!roomRes.ok()) {
    const body = await roomRes.text();
    throw new Error(
      `[e2e] failed to list chat rooms: ${roomRes.status()} ${body}`,
    );
  }
  const payload = await roomRes.json();
  const room = (payload?.items ?? []).find(
    (item: any) =>
      item?.type === 'project' && item?.projectId === options.projectId,
  );
  const roomId = String(room?.id ?? '').trim();
  if (!roomId) {
    throw new Error(
      `[e2e] project room not found for projectId=${options.projectId}`,
    );
  }
  return roomId;
}
