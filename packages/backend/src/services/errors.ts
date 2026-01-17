export type ErrorCategory =
  | 'validation'
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'external'
  | 'internal';

export type ApiError = {
  code: string;
  message: string;
  category?: ErrorCategory;
  details?: unknown;
};

export type ApiErrorResponse = {
  error: ApiError;
};

export type AppErrorOptions = {
  code: string;
  message: string;
  httpStatus: number;
  category: ErrorCategory;
  details?: unknown;
  cause?: unknown;
  isOperational?: boolean;
};

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly category: ErrorCategory;
  readonly details?: unknown;
  readonly isOperational: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message);
    if (options.cause !== undefined) {
      (this as any).cause = options.cause;
    }
    this.name = 'AppError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.category = options.category;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
  }
}

export function createApiErrorResponse(
  code: string,
  message?: string,
  options?: { category?: ErrorCategory; details?: unknown },
): ApiErrorResponse {
  return {
    error: {
      code,
      message: message ?? defaultMessageForCode(code),
      category: options?.category,
      details: options?.details,
    },
  };
}

export function defaultMessageForCode(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Unauthorized';
    case 'forbidden':
      return 'Forbidden';
    case 'forbidden_project':
      return 'Forbidden';
    case 'not_found':
      return 'Not found';
    default:
      return code;
  }
}

export function normalizeLegacyErrorResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) return payload;
  if (keys[0] !== 'error') return payload;
  if (typeof record.error !== 'string') return payload;
  return createApiErrorResponse(record.error);
}

function codeFromStatus(statusCode: number): string {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 413) return 'PAYLOAD_TOO_LARGE';
  if (statusCode === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (statusCode === 429) return 'TOO_MANY_REQUESTS';
  if (statusCode >= 500) return 'INTERNAL_ERROR';
  return 'HTTP_ERROR';
}

export function mapErrorToResponse(
  err: unknown,
  options?: { env?: string },
): { statusCode: number; body: ApiErrorResponse } {
  const env = options?.env ?? process.env.NODE_ENV ?? 'development';

  const anyErr = err as any;
  const statusFromFastify =
    typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : undefined;

  if (anyErr?.validation) {
    const statusCode =
      typeof statusFromFastify === 'number' ? statusFromFastify : 400;
    return {
      statusCode,
      body: createApiErrorResponse('VALIDATION_ERROR', 'Validation failed', {
        category: 'validation',
        details: anyErr.validation,
      }),
    };
  }

  if (err instanceof AppError) {
    return {
      statusCode: err.httpStatus,
      body: createApiErrorResponse(err.code, err.message, {
        category: err.category,
        details: err.details,
      }),
    };
  }

  const statusCode =
    typeof statusFromFastify === 'number' ? statusFromFastify : 500;
  const code = codeFromStatus(statusCode);
  const message =
    statusCode >= 500 && env === 'production'
      ? 'Internal server error'
      : anyErr instanceof Error && typeof anyErr.message === 'string'
        ? anyErr.message
        : defaultMessageForCode(code);
  return {
    statusCode,
    body: createApiErrorResponse(code, message, { category: 'internal' }),
  };
}
