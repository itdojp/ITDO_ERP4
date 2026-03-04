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
  const roomId = String(options.projectId ?? '').trim();
  if (!roomId) {
    throw new Error(
      `[e2e] project room not found for projectId=${options.projectId}`,
    );
  }
  return roomId;
}
