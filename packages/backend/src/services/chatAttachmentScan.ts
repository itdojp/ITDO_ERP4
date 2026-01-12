export type ChatAttachmentScanProvider = 'disabled' | 'stub' | 'eicar';

export type ChatAttachmentScanResult = {
  provider: ChatAttachmentScanProvider;
  verdict: 'skipped' | 'clean' | 'infected';
  detected?: string;
};

function normalizeProvider(raw?: string): ChatAttachmentScanProvider {
  const value = (raw || '').trim().toLowerCase();
  if (value === 'eicar') return 'eicar';
  if (value === 'stub') return 'stub';
  return 'disabled';
}

export function getChatAttachmentScanProvider(): ChatAttachmentScanProvider {
  return normalizeProvider(process.env.CHAT_ATTACHMENT_AV_PROVIDER);
}

const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

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
