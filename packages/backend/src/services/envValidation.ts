type ValidationIssue = {
  key: string;
  message: string;
};

function addIssue(issues: ValidationIssue[], key: string, message: string) {
  issues.push({ key, message });
}

function normalizeString(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return undefined;
}

function parsePort(value: string | undefined) {
  const normalized = normalizeString(value);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  const port = Math.floor(parsed);
  if (port < 1 || port > 65535) return undefined;
  return port;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRedisUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
}

function isPositiveInteger(value: string | undefined) {
  const normalized = normalizeString(value);
  if (!normalized) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed);
}

function assertPositiveIntegerEnv(
  issues: ValidationIssue[],
  key: string,
  message = '1以上の整数で指定してください',
) {
  const raw = normalizeString(process.env[key]);
  if (raw && !isPositiveInteger(raw)) {
    addIssue(issues, key, message);
  }
}

function assertRequired(
  issues: ValidationIssue[],
  key: string,
  value: string | undefined,
) {
  if (!normalizeString(value)) {
    addIssue(issues, key, '必須です');
  }
}

export function assertValidBackendEnv() {
  const issues: ValidationIssue[] = [];

  const databaseUrl = normalizeString(process.env.DATABASE_URL);
  if (!databaseUrl) {
    addIssue(issues, 'DATABASE_URL', '必須です');
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (
        parsed.protocol !== 'postgresql:' &&
        parsed.protocol !== 'postgres:'
      ) {
        addIssue(
          issues,
          'DATABASE_URL',
          'postgresql:// の形式で指定してください',
        );
      }
    } catch {
      addIssue(issues, 'DATABASE_URL', 'URL形式として不正です');
    }
  }

  const portRaw = normalizeString(process.env.PORT);
  if (portRaw && parsePort(portRaw) === undefined) {
    addIssue(issues, 'PORT', '1-65535 の整数で指定してください');
  }

  const allowedOriginsRaw = normalizeString(process.env.ALLOWED_ORIGINS);
  if (allowedOriginsRaw) {
    const origins = allowedOriginsRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    for (const origin of origins) {
      if (!isHttpUrl(origin)) {
        addIssue(
          issues,
          'ALLOWED_ORIGINS',
          'http(s) URL のカンマ区切りで指定してください',
        );
        break;
      }
    }
  }

  const rateLimitRedisUrl = normalizeString(process.env.RATE_LIMIT_REDIS_URL);
  if (rateLimitRedisUrl && !isRedisUrl(rateLimitRedisUrl)) {
    addIssue(issues, 'RATE_LIMIT_REDIS_URL', 'redis(s) URL を指定してください');
  }
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_MAX');
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS');
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_SEARCH_MAX');
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_AI_SUMMARY_MAX');
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_ATTACHMENT_UPLOAD_MAX');
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_DOC_SEND_MAX');
  assertPositiveIntegerEnv(issues, 'RATE_LIMIT_DOC_SEND_RETRY_MAX');

  const authMode = (process.env.AUTH_MODE || 'header').trim().toLowerCase();
  const allowedAuthModes = new Set(['header', 'jwt', 'hybrid']);
  if (!allowedAuthModes.has(authMode)) {
    addIssue(
      issues,
      'AUTH_MODE',
      'header|jwt|hybrid のいずれかを指定してください',
    );
  }
  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  const allowHeaderFallbackRaw = normalizeString(
    process.env.AUTH_ALLOW_HEADER_FALLBACK_IN_PROD,
  );
  const allowHeaderFallback =
    parseBoolean(process.env.AUTH_ALLOW_HEADER_FALLBACK_IN_PROD) === true;
  if (
    allowHeaderFallbackRaw &&
    parseBoolean(process.env.AUTH_ALLOW_HEADER_FALLBACK_IN_PROD) === undefined
  ) {
    addIssue(
      issues,
      'AUTH_ALLOW_HEADER_FALLBACK_IN_PROD',
      'true|false|1|0 のいずれかを指定してください',
    );
  }
  if (
    nodeEnv === 'production' &&
    authMode === 'header' &&
    !allowHeaderFallback
  ) {
    addIssue(
      issues,
      'AUTH_MODE',
      'production では AUTH_MODE=header は使用できません（必要時のみ AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=true で明示的に許可）',
    );
  }

  if (authMode === 'jwt' || authMode === 'hybrid') {
    assertRequired(issues, 'JWT_ISSUER', process.env.JWT_ISSUER);
    assertRequired(issues, 'JWT_AUDIENCE', process.env.JWT_AUDIENCE);

    const jwksUrl = normalizeString(process.env.JWT_JWKS_URL);
    const publicKey = normalizeString(process.env.JWT_PUBLIC_KEY);
    if (!jwksUrl && !publicKey) {
      addIssue(
        issues,
        'JWT_JWKS_URL/JWT_PUBLIC_KEY',
        'いずれかが必須です（JWT署名鍵の取得方法）',
      );
    }
    if (jwksUrl && !isHttpUrl(jwksUrl)) {
      addIssue(issues, 'JWT_JWKS_URL', 'http(s) URL を指定してください');
    }
  }

  const attachmentProvider = (process.env.CHAT_ATTACHMENT_PROVIDER || 'local')
    .trim()
    .toLowerCase();
  const allowedAttachmentProviders = new Set(['local', 'gdrive']);
  if (!allowedAttachmentProviders.has(attachmentProvider)) {
    addIssue(
      issues,
      'CHAT_ATTACHMENT_PROVIDER',
      'local|gdrive のいずれかを指定してください',
    );
  }
  if (attachmentProvider === 'gdrive') {
    assertRequired(
      issues,
      'CHAT_ATTACHMENT_GDRIVE_CLIENT_ID',
      process.env.CHAT_ATTACHMENT_GDRIVE_CLIENT_ID,
    );
    assertRequired(
      issues,
      'CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET',
      process.env.CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET,
    );
    assertRequired(
      issues,
      'CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN',
      process.env.CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN,
    );
    assertRequired(
      issues,
      'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID',
      process.env.CHAT_ATTACHMENT_GDRIVE_FOLDER_ID,
    );
  }

  const mailTransport = (process.env.MAIL_TRANSPORT || 'stub')
    .trim()
    .toLowerCase();
  const allowedMailTransports = new Set(['stub', 'smtp', 'sendgrid']);
  if (!allowedMailTransports.has(mailTransport)) {
    addIssue(
      issues,
      'MAIL_TRANSPORT',
      'stub|smtp|sendgrid のいずれかを指定してください',
    );
  }
  if (mailTransport === 'sendgrid') {
    assertRequired(issues, 'SENDGRID_API_KEY', process.env.SENDGRID_API_KEY);
    const baseUrl = normalizeString(process.env.SENDGRID_BASE_URL);
    if (baseUrl && !isHttpUrl(baseUrl)) {
      addIssue(issues, 'SENDGRID_BASE_URL', 'http(s) URL を指定してください');
    }
  }
  if (mailTransport === 'smtp') {
    assertRequired(issues, 'SMTP_HOST', process.env.SMTP_HOST);
    const smtpPort = parsePort(process.env.SMTP_PORT);
    if (smtpPort === undefined) {
      addIssue(issues, 'SMTP_PORT', '1-65535 の整数で指定してください');
    }
    const secureRaw = normalizeString(process.env.SMTP_SECURE);
    if (secureRaw && parseBoolean(secureRaw) === undefined) {
      addIssue(
        issues,
        'SMTP_SECURE',
        'true|false|1|0 のいずれかを指定してください',
      );
    }
  }

  const pdfProvider = (process.env.PDF_PROVIDER || 'local')
    .trim()
    .toLowerCase();
  const allowedPdfProviders = new Set(['local', 'external']);
  if (!allowedPdfProviders.has(pdfProvider)) {
    addIssue(
      issues,
      'PDF_PROVIDER',
      'local|external のいずれかを指定してください',
    );
  }
  if (pdfProvider === 'external') {
    assertRequired(issues, 'PDF_EXTERNAL_URL', process.env.PDF_EXTERNAL_URL);
    const url = normalizeString(process.env.PDF_EXTERNAL_URL);
    if (url && !isHttpUrl(url)) {
      addIssue(issues, 'PDF_EXTERNAL_URL', 'http(s) URL を指定してください');
    }
  }

  const evidenceArchiveProvider = (
    process.env.EVIDENCE_ARCHIVE_PROVIDER || 'local'
  )
    .trim()
    .toLowerCase();
  const allowedEvidenceArchiveProviders = new Set(['local', 's3']);
  if (!allowedEvidenceArchiveProviders.has(evidenceArchiveProvider)) {
    addIssue(
      issues,
      'EVIDENCE_ARCHIVE_PROVIDER',
      'local|s3 のいずれかを指定してください',
    );
  }
  if (evidenceArchiveProvider === 's3') {
    assertRequired(
      issues,
      'EVIDENCE_ARCHIVE_S3_BUCKET',
      process.env.EVIDENCE_ARCHIVE_S3_BUCKET,
    );
    const region =
      normalizeString(process.env.EVIDENCE_ARCHIVE_S3_REGION) ||
      normalizeString(process.env.AWS_REGION) ||
      normalizeString(process.env.AWS_DEFAULT_REGION);
    if (!region) {
      addIssue(
        issues,
        'EVIDENCE_ARCHIVE_S3_REGION/AWS_REGION',
        'いずれかを指定してください',
      );
    }

    const endpoint = normalizeString(
      process.env.EVIDENCE_ARCHIVE_S3_ENDPOINT_URL,
    );
    if (endpoint && !isHttpUrl(endpoint)) {
      addIssue(
        issues,
        'EVIDENCE_ARCHIVE_S3_ENDPOINT_URL',
        'http(s) URL を指定してください',
      );
    }

    const forcePathStyleRaw = normalizeString(
      process.env.EVIDENCE_ARCHIVE_S3_FORCE_PATH_STYLE,
    );
    if (forcePathStyleRaw && parseBoolean(forcePathStyleRaw) === undefined) {
      addIssue(
        issues,
        'EVIDENCE_ARCHIVE_S3_FORCE_PATH_STYLE',
        'true|false|1|0 のいずれかを指定してください',
      );
    }

    const sse = normalizeString(process.env.EVIDENCE_ARCHIVE_S3_SSE);
    if (sse && sse !== 'AES256' && sse !== 'aws:kms') {
      addIssue(
        issues,
        'EVIDENCE_ARCHIVE_S3_SSE',
        'AES256|aws:kms のいずれかを指定してください',
      );
    }
    if (sse === 'aws:kms') {
      assertRequired(
        issues,
        'EVIDENCE_ARCHIVE_S3_KMS_KEY_ID',
        process.env.EVIDENCE_ARCHIVE_S3_KMS_KEY_ID,
      );
    }
  }

  const externalLlmProvider = (
    process.env.CHAT_EXTERNAL_LLM_PROVIDER || 'disabled'
  )
    .trim()
    .toLowerCase();
  const allowedLlmProviders = new Set(['disabled', 'stub', 'openai']);
  if (!allowedLlmProviders.has(externalLlmProvider)) {
    addIssue(
      issues,
      'CHAT_EXTERNAL_LLM_PROVIDER',
      'disabled|stub|openai のいずれかを指定してください',
    );
  }
  if (externalLlmProvider === 'openai') {
    assertRequired(
      issues,
      'CHAT_EXTERNAL_LLM_OPENAI_API_KEY',
      process.env.CHAT_EXTERNAL_LLM_OPENAI_API_KEY,
    );
    const baseUrl = normalizeString(
      process.env.CHAT_EXTERNAL_LLM_OPENAI_BASE_URL,
    );
    if (baseUrl && !isHttpUrl(baseUrl)) {
      addIssue(
        issues,
        'CHAT_EXTERNAL_LLM_OPENAI_BASE_URL',
        'http(s) URL を指定してください',
      );
    }
  }

  if (issues.length > 0) {
    const lines = issues
      .map((issue) => `- ${issue.key}: ${issue.message}`)
      .join('\n');
    throw new Error(`環境変数の設定が不正です:\n${lines}`);
  }
}
