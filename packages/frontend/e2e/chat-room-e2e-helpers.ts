export async function resolveProjectRoomId(options: {
  request?: {
    get: (
      url: string,
      init: { headers: Record<string, string> },
    ) => Promise<any>;
  };
  apiBase?: string;
  projectId: string;
  headers?: Record<string, string>;
}) {
  // project room は roomId == projectId を正規仕様として扱う。
  const projectId = String(options.projectId ?? '').trim();
  if (!projectId) {
    throw new Error(
      `[e2e] project room not found for projectId=${options.projectId}`,
    );
  }

  const request = options.request;
  const apiBase = String(options.apiBase ?? '').trim();
  const headers = options.headers;
  if (request && apiBase && headers) {
    const res = await request.get(`${apiBase}/chat-rooms`, { headers });
    if (typeof res?.ok === 'function' && !res.ok()) {
      throw new Error(
        `[e2e] chat rooms lookup failed: ${res.status()} ${await res.text()}`,
      );
    }
    const payload = (await res.json()) as {
      items?: Array<{
        id?: string | null;
        type?: string | null;
        projectId?: string | null;
      }>;
    };
    const items = Array.isArray(payload.items) ? payload.items : [];
    const room = items.find((item) => {
      const itemId = typeof item?.id === 'string' ? item.id : '';
      const itemType = typeof item?.type === 'string' ? item.type : '';
      const itemProjectId =
        typeof item?.projectId === 'string' ? item.projectId : '';
      return (
        itemType === 'project' &&
        (itemProjectId === projectId || itemId === projectId)
      );
    });
    if (room?.id) return room.id;
    throw new Error(`[e2e] project room missing for projectId=${projectId}`);
  }

  return projectId;
}
