import type { FastifyRequest } from 'fastify';
import type { UserContext } from '../plugins/auth.js';
import { AppError } from './errors.js';

export function requireUserContext(req: FastifyRequest): UserContext {
  if (req.user) return req.user;
  throw new AppError({
    code: 'unauthorized',
    message: 'Unauthorized',
    httpStatus: 401,
    category: 'auth',
  });
}
