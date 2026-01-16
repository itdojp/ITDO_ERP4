import { connect, type Socket } from 'node:net';

export type ChatAttachmentScanProvider =
  | 'disabled'
  | 'stub'
  | 'eicar'
  | 'clamav';

export type ChatAttachmentScanResult = {
  provider: ChatAttachmentScanProvider;
  verdict: 'skipped' | 'clean' | 'infected' | 'error';
  detected?: string;
  error?: string;
};

function normalizeProvider(raw?: string): ChatAttachmentScanProvider {
  const value = (raw || '').trim().toLowerCase();
  if (value === 'clamav') return 'clamav';
  if (value === 'eicar') return 'eicar';
  if (value === 'stub') return 'stub';
  return 'disabled';
}

export function getChatAttachmentScanProvider(): ChatAttachmentScanProvider {
  return normalizeProvider(process.env.CHAT_ATTACHMENT_AV_PROVIDER);
}

const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const CLAMAV_CHUNK_SIZE = 16 * 1024;
const CLAMAV_MAX_RESPONSE_CHARS = 16 * 1024;

type ClamavConfig = {
  host: string;
  port: number;
  timeoutMs: number;
};

function resolveClamavConfig(): ClamavConfig {
  const host = (process.env.CLAMAV_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const portRaw = process.env.CLAMAV_PORT;
  const parsedPort = portRaw ? Number(portRaw) : Number.NaN;
  const port =
    Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
      ? Math.floor(parsedPort)
      : 3310;
  const timeoutRaw = process.env.CLAMAV_TIMEOUT_MS;
  const parsedTimeout = timeoutRaw ? Number(timeoutRaw) : Number.NaN;
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? Math.floor(parsedTimeout)
      : 10000;
  return { host, port, timeoutMs };
}

function writeAsync(socket: Socket, data: string | Buffer) {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function scanWithClamav(
  buffer: Buffer,
): Promise<ChatAttachmentScanResult> {
  const config = resolveClamavConfig();
  const timeoutMs = config.timeoutMs;

  return new Promise<ChatAttachmentScanResult>((resolve) => {
    const socket = connect({ host: config.host, port: config.port });
    let finished = false;
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      finalize({ verdict: 'error', error: 'timeout' });
    }, timeoutMs);

    const finalize = (result: Omit<ChatAttachmentScanResult, 'provider'>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      resolve({ provider: 'clamav', ...result });
    };

    socket.on('error', () =>
      finalize({ verdict: 'error', error: 'connect_failed' }),
    );

    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.length > CLAMAV_MAX_RESPONSE_CHARS) {
        socket.destroy();
        finalize({ verdict: 'error', error: 'response_too_large' });
        return;
      }
      if (response.includes('\n') || response.includes('\0')) {
        socket.destroy();
      }
    });

    socket.on('close', () => {
      if (finished) return;
      const text = response.replace(/\0/g, '').trim();
      if (!text) {
        finalize({ verdict: 'error', error: 'empty_response' });
        return;
      }
      const upper = text.toUpperCase();
      if (upper.endsWith('OK')) {
        finalize({ verdict: 'clean' });
        return;
      }
      if (upper.endsWith('FOUND')) {
        const detected = text
          .replace(/^[^:]*:\s*/, '')
          .replace(/\s*FOUND\s*$/i, '')
          .trim();
        finalize({
          verdict: 'infected',
          detected: detected || 'FOUND',
        });
        return;
      }
      if (upper.endsWith('ERROR')) {
        finalize({ verdict: 'error', error: 'scan_error' });
        return;
      }
      finalize({ verdict: 'error', error: 'unknown_response' });
    });

    socket.on('connect', () => {
      void (async () => {
        try {
          await writeAsync(socket, 'zINSTREAM\0');
          for (
            let offset = 0;
            offset < buffer.length;
            offset += CLAMAV_CHUNK_SIZE
          ) {
            const chunk = buffer.subarray(offset, offset + CLAMAV_CHUNK_SIZE);
            const header = Buffer.alloc(4);
            header.writeUInt32BE(chunk.length, 0);
            await writeAsync(socket, header);
            await writeAsync(socket, chunk);
          }
          await writeAsync(socket, Buffer.alloc(4));
          socket.end();
        } catch {
          socket.destroy();
          finalize({ verdict: 'error', error: 'send_failed' });
        }
      })();
    });
  });
}

export async function scanChatAttachment(options: {
  buffer: Buffer;
  provider?: ChatAttachmentScanProvider;
}): Promise<ChatAttachmentScanResult> {
  const provider =
    options.provider !== undefined
      ? options.provider
      : getChatAttachmentScanProvider();

  if (provider === 'disabled') {
    return { provider, verdict: 'skipped' };
  }

  if (provider === 'stub') {
    return { provider, verdict: 'clean' };
  }

  if (provider === 'clamav') {
    return scanWithClamav(options.buffer);
  }

  const text = options.buffer.toString('ascii');
  if (text.includes(EICAR_SIGNATURE)) {
    return {
      provider,
      verdict: 'infected',
      detected: 'EICAR_TEST_SIGNATURE',
    };
  }

  return { provider, verdict: 'clean' };
}
