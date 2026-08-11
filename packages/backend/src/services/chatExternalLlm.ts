import { ExternalLlmProviderError } from '../application/externalLlm/externalLlmPort.js';
import { OpenAiCompatibleTextAdapter } from '../adapters/externalLlm/openAiCompatibleTextAdapter.js';

type ExternalLlmProvider = 'disabled' | 'stub' | 'openai';

type ChatExternalLlmConfig =
  | { provider: 'disabled' }
  | { provider: 'stub'; model: string }
  | {
      provider: 'openai';
      model: string;
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
    };

type ChatExternalLlmRateLimit = {
  userPerHour: number;
  roomPerHour: number;
};

export type ExternalLlmSummaryResult = {
  provider: Exclude<ExternalLlmProvider, 'disabled'>;
  model: string;
  summary: string;
};

function normalizeProvider(raw?: string): ExternalLlmProvider {
  const value = (raw || '').trim().toLowerCase();
  if (value === 'openai') return 'openai';
  if (value === 'stub') return 'stub';
  return 'disabled';
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseAllowedHosts(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getChatExternalLlmConfig(): ChatExternalLlmConfig {
  const provider = normalizeProvider(process.env.CHAT_EXTERNAL_LLM_PROVIDER);
  if (provider === 'stub') {
    return {
      provider: 'stub',
      model: (process.env.CHAT_EXTERNAL_LLM_MODEL || 'stub').trim() || 'stub',
    };
  }
  if (provider === 'openai') {
    const apiKey = process.env.CHAT_EXTERNAL_LLM_OPENAI_API_KEY?.trim();
    if (!apiKey) return { provider: 'disabled' };
    const baseUrl = (
      process.env.CHAT_EXTERNAL_LLM_OPENAI_BASE_URL ||
      'https://api.openai.com/v1'
    )
      .trim()
      .replace(/\/$/, '');
    const model =
      (process.env.CHAT_EXTERNAL_LLM_MODEL || 'gpt-4o-mini').trim() ||
      'gpt-4o-mini';
    const timeoutMs = parsePositiveInt(
      process.env.CHAT_EXTERNAL_LLM_TIMEOUT_MS,
      15_000,
    );
    return { provider: 'openai', model, apiKey, baseUrl, timeoutMs };
  }
  return { provider: 'disabled' };
}

export function getChatExternalLlmRateLimit(): ChatExternalLlmRateLimit {
  return {
    userPerHour: parsePositiveInt(
      process.env.CHAT_EXTERNAL_LLM_RATE_LIMIT_USER_PER_HOUR,
      10,
    ),
    roomPerHour: parsePositiveInt(
      process.env.CHAT_EXTERNAL_LLM_RATE_LIMIT_ROOM_PER_HOUR,
      30,
    ),
  };
}

function buildSummaryPrompt(options: { bodies: string[] }) {
  const lines = options.bodies
    .map((body) => body.replace(/\r\n/g, '\n').trim())
    .filter(Boolean)
    .slice(-200);

  const joined = lines.join('\n\n---\n\n').slice(-40_000);

  const system = [
    'あなたは社内ERPのチャット要約アシスタントです。',
    '入力は複数の発言本文です。個人情報や秘密情報を推測しないでください。',
    '出力は日本語で、Markdownの箇条書き中心で簡潔にまとめてください。',
    '',
    '出力フォーマット:',
    '- 概要:',
    '- 決定事項:',
    '- TODO:',
    '- リスク/懸念:',
  ].join('\n');

  const user = [
    '以下のチャット発言を要約してください。',
    '',
    joined ? joined : '(本文なし)',
  ].join('\n');

  return { system, user };
}

export async function summarizeWithExternalLlm(options: {
  bodies: string[];
}): Promise<ExternalLlmSummaryResult> {
  const config = getChatExternalLlmConfig();
  if (config.provider === 'disabled') {
    throw new Error('external_llm_disabled');
  }

  if (config.provider === 'stub') {
    const count = options.bodies.filter((b) => b.trim()).length;
    return {
      provider: 'stub',
      model: config.model,
      summary: [
        '（外部LLMスタブ）',
        '- 概要:',
        `  - 本文 ${count}件を受領`,
        '- 決定事項:',
        '- TODO:',
        '- リスク/懸念:',
      ].join('\n'),
    };
  }

  const prompt = buildSummaryPrompt({ bodies: options.bodies });
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    allowedHosts: parseAllowedHosts(
      process.env.CHAT_EXTERNAL_LLM_ALLOWED_HOSTS,
    ),
    allowHttp: process.env.CHAT_EXTERNAL_LLM_ALLOW_HTTP === 'true',
    allowPrivateIp: process.env.CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP === 'true',
    // The pre-existing Chat summary contract treats a malformed successful
    // response as an empty summary and does not account provider usage.
    // Knowledge callers keep the adapter defaults (strict/strict).
    malformedSuccessPolicy: 'empty',
    usagePolicy: 'ignore',
  });
  let content: string;
  try {
    const prepared = await adapter.prepare({
      provider: 'openai',
      model: config.model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxOutputTokens: 600,
      temperatureBasisPoints: 2_000,
    });
    const result = await prepared.dispatch();
    content = result.content;
  } catch (error) {
    if (
      error instanceof ExternalLlmProviderError &&
      error.providerStatus !== null
    ) {
      throw new Error(`openai_error_${error.providerStatus}`);
    }
    if (
      error instanceof ExternalLlmProviderError &&
      error.outcome === 'not_dispatched' &&
      error.preDispatchDiagnostic !== null
    ) {
      // Preserve the pre-existing Chat diagnostic code while the shared port
      // keeps a complete provider-neutral certainty classification.
      throw new Error(error.preDispatchDiagnostic);
    }
    throw error;
  }

  return {
    provider: 'openai',
    model: config.model,
    summary: content || '要約の生成に失敗しました（空の応答）',
  };
}
