import { ChatThreadCursorError } from './chatThreadCursor.js';
import {
  chatThreadLimits,
  type ChatThreadActor,
  type ChatThreadCursorCodec,
  type ChatThreadRepository,
  type ChatThreadSnapshot,
} from './chatThreadPorts.js';

export type ChatThreadResult =
  | {
      ok: true;
      value: ChatThreadSnapshot & { nextCursor: string | null };
    }
  | { ok: false; reason: 'not_found' | 'invalid_cursor' };

function canonicalActor(actor: ChatThreadActor): ChatThreadActor | null {
  const userId = actor.userId.trim();
  if (!userId) return null;
  const normalize = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return {
    userId,
    roles: normalize(actor.roles),
    projectIds: normalize(actor.projectIds),
    groupIds: normalize(actor.groupIds),
    groupAccountIds: normalize(actor.groupAccountIds),
  };
}

export function createChatThreadService(dependencies: {
  repository: ChatThreadRepository;
  cursorCodec: ChatThreadCursorCodec;
}) {
  return {
    async getThread(input: {
      actor: ChatThreadActor;
      messageId: string;
      limit?: number;
      cursor?: string;
    }): Promise<ChatThreadResult> {
      const actor = canonicalActor(input.actor);
      const messageId = input.messageId.trim();
      if (
        !actor ||
        messageId.length === 0 ||
        messageId.length > chatThreadLimits.id
      ) {
        return { ok: false, reason: 'not_found' };
      }
      const limit = Math.min(
        Math.max(Math.trunc(input.limit ?? chatThreadLimits.pageDefault), 1),
        chatThreadLimits.pageMax,
      );

      return dependencies.repository.withReadSnapshot(async (repository) => {
        const identity = await repository.resolveMessage(messageId);
        if (!identity) return { ok: false, reason: 'not_found' } as const;
        const rootMessageId = identity.threadRootId ?? identity.id;
        if (
          (identity.parentMessageId === null) !==
            (identity.threadRootId === null) ||
          (identity.parentMessageId !== null &&
            identity.parentMessageId !== identity.threadRootId)
        ) {
          return { ok: false, reason: 'not_found' } as const;
        }
        if (!(await repository.canReadRoom(identity.roomId, actor))) {
          return { ok: false, reason: 'not_found' } as const;
        }

        let boundary;
        try {
          boundary = input.cursor
            ? dependencies.cursorCodec.decode({
                actor,
                rootMessageId,
                cursor: input.cursor,
              })
            : undefined;
        } catch (error) {
          if (error instanceof ChatThreadCursorError) {
            return { ok: false, reason: 'invalid_cursor' } as const;
          }
          throw error;
        }

        const snapshot = await repository.readThread({
          roomId: identity.roomId,
          rootMessageId,
          boundary,
          limit,
        });
        if (!snapshot) return { ok: false, reason: 'not_found' } as const;
        const last = snapshot.replies[snapshot.replies.length - 1];
        const nextCursor =
          snapshot.hasMore && last
            ? dependencies.cursorCodec.encode({
                actor,
                rootMessageId,
                boundary: { createdAt: last.createdAt, id: last.id },
              })
            : null;
        return {
          ok: true,
          value: { ...snapshot, nextCursor },
        } as const;
      });
    },
  };
}
