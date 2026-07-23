import type { FastifyInstance } from 'fastify';
import { BackendResourceCleanupError } from './backendResources.js';
import { startServer } from './server.js';

export const BACKEND_SHUTDOWN_TIMEOUT_MS = 8000;
export const BACKEND_SUCCESS_EXIT_CODE = 0;
export const BACKEND_FAILURE_EXIT_CODE = 1;

type GracefulSignal = 'SIGINT' | 'SIGTERM';

type LifecycleLogger = {
  info: (details: Record<string, unknown>, message: string) => void;
  warn: (details: Record<string, unknown>, message: string) => void;
  error: (details: Record<string, unknown>, message: string) => void;
};

type SignalSource = {
  on: (signal: GracefulSignal, listener: () => void) => unknown;
  off: (signal: GracefulSignal, listener: () => void) => unknown;
};

type LifecycleServer = Pick<FastifyInstance, 'close' | 'log'>;

type RunApplicationOptions = {
  start?: () => Promise<LifecycleServer>;
  signalSource?: SignalSource;
  fallbackLogger?: LifecycleLogger;
  shutdownTimeoutMs?: number;
  forceExit?: (code: number) => void;
};

const GRACEFUL_SIGNALS: GracefulSignal[] = ['SIGTERM', 'SIGINT'];
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

function consoleLifecycleLogger(): LifecycleLogger {
  return {
    info: (details, message) => console.info(message, details),
    warn: (details, message) => console.warn(message, details),
    error: (details, message) => console.error(message, details),
  };
}

function serverLifecycleLogger(server: LifecycleServer): LifecycleLogger {
  return {
    info: (details, message) => server.log.info(details, message),
    warn: (details, message) => server.log.warn(details, message),
    error: (details, message) => server.log.error(details, message),
  };
}

function safeErrorDetails(err: unknown) {
  const codeRaw =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  return {
    errorName: err instanceof Error ? err.name : 'UnknownError',
    errorCode:
      codeRaw && SAFE_ERROR_CODE_PATTERN.test(codeRaw) ? codeRaw : undefined,
    failedResources:
      err instanceof BackendResourceCleanupError ? err.resources : undefined,
  };
}

export async function runApplication(
  options: RunApplicationOptions = {},
): Promise<number> {
  const start = options.start ?? startServer;
  const signalSource = options.signalSource ?? process;
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? BACKEND_SHUTDOWN_TIMEOUT_MS;
  const forceExit = options.forceExit ?? ((code: number) => process.exit(code));
  let logger = options.fallbackLogger ?? consoleLifecycleLogger();
  let server: LifecycleServer | null = null;
  let firstSignal: GracefulSignal | null = null;
  let closeStarted = false;
  let finished = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveCompletion: (exitCode: number) => void = () => {};
  const completion = new Promise<number>((resolve) => {
    resolveCompletion = resolve;
  });

  const handlers = new Map<GracefulSignal, () => void>();

  const removeSignalHandlers = () => {
    for (const [signal, handler] of handlers) {
      signalSource.off(signal, handler);
    }
    handlers.clear();
  };

  const finish = (exitCode: number) => {
    if (finished) return;
    finished = true;
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    removeSignalHandlers();
    resolveCompletion(exitCode);
  };

  const forceFailureExit = (
    details: Record<string, unknown>,
    message: string,
  ) => {
    if (finished) return;
    logger.error(details, message);
    finish(BACKEND_FAILURE_EXIT_CODE);
    forceExit(BACKEND_FAILURE_EXIT_CODE);
  };

  const closeServer = () => {
    if (!server || closeStarted || finished) return;
    closeStarted = true;
    void server
      .close()
      .then(() => {
        if (finished) return;
        logger.info(
          { phase: 'shutdown', signal: firstSignal },
          'backend shutdown completed',
        );
        finish(BACKEND_SUCCESS_EXIT_CODE);
      })
      .catch((err: unknown) => {
        if (finished) return;
        forceFailureExit(
          {
            phase: 'shutdown',
            signal: firstSignal,
            ...safeErrorDetails(err),
          },
          'backend shutdown failed',
        );
      });
  };

  const handleSignal = (signal: GracefulSignal) => {
    if (finished) return;
    if (firstSignal) {
      forceFailureExit(
        { phase: 'shutdown', firstSignal, signal },
        'backend shutdown forced by second signal',
      );
      return;
    }

    firstSignal = signal;
    logger.info({ phase: 'shutdown', signal }, 'backend shutdown started');
    shutdownTimer = setTimeout(() => {
      forceFailureExit(
        { phase: 'shutdown', signal, timeoutMs: shutdownTimeoutMs },
        'backend shutdown timed out',
      );
    }, shutdownTimeoutMs);
    closeServer();
  };

  for (const signal of GRACEFUL_SIGNALS) {
    const handler = () => handleSignal(signal);
    handlers.set(signal, handler);
    // Keep both handlers installed until shutdown finishes so a second signal,
    // including a repeated signal of the same kind, follows the explicit
    // failure contract instead of falling through to Node's default action.
    signalSource.on(signal, handler);
  }

  try {
    server = await start();
    logger = serverLifecycleLogger(server);
  } catch (err) {
    if (!finished) {
      logger.error(
        { phase: 'startup', ...safeErrorDetails(err) },
        'backend startup failed',
      );
      finish(BACKEND_FAILURE_EXIT_CODE);
    }
    return completion;
  }

  if (firstSignal) {
    closeServer();
  }

  return completion;
}
