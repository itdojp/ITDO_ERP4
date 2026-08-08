import type { FastifyReply, FastifyRequest } from 'fastify';

import { parseDateParam } from '../../../utils/date.js';

export async function normalizeBodylessChatReadState(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (request.body === undefined) request.body = {};
  if (
    request.body &&
    typeof request.body === 'object' &&
    !Array.isArray(request.body) &&
    Object.keys(request.body).some(
      (key) => key !== 'through' && key !== 'throughMessageId',
    )
  ) {
    return reply.status(400).send({
      error: { code: 'INVALID_DATE', message: 'Invalid read state input' },
    });
  }
}

export function parseChatReadStateInput(
  value: unknown,
): { ok: true; through?: Date; throughMessageId?: string } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false };
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => key !== 'through' && key !== 'throughMessageId',
    )
  ) {
    return { ok: false };
  }
  if (input.through === undefined) {
    return input.throughMessageId === undefined ? { ok: true } : { ok: false };
  }
  if (typeof input.through !== 'string') return { ok: false };
  const through = parseDateParam(input.through);
  if (!through) return { ok: false };
  if (input.throughMessageId === undefined) return { ok: true, through };
  if (typeof input.throughMessageId !== 'string') return { ok: false };
  const throughMessageId = input.throughMessageId.trim();
  if (!throughMessageId || throughMessageId.length > 200) return { ok: false };
  return { ok: true, through, throughMessageId };
}
