const NON_RETRYABLE_ERRORS = new Set([
  'missing_email',
  'missing_recipients',
  'invalid_recipient',
  'missing_attachment',
  'csv_missing',
  'pdf_missing',
  'pdf_template_missing',
  'artifact_not_found',
  'artifact_owner_scope_invalid',
  'report_artifact_size_invalid',
  'google_drive_auth_expired',
  'google_drive_forbidden',
  'google_drive_not_found',
  'google_drive_permanent',
  'unknown_channel',
  'smtp_config_missing',
  'smtp_disabled',
  'smtp_unavailable',
]);

export function parseReportDeliveryTargets(value?: string | null) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isRetryableReportDeliveryError(error?: string | null) {
  if (!error) return true;
  return !NON_RETRYABLE_ERRORS.has(error);
}

export function isRetryableThrownReportDeliveryError(
  error: unknown,
  message: string,
) {
  if (
    error &&
    typeof error === 'object' &&
    'retryable' in error &&
    typeof error.retryable === 'boolean'
  ) {
    return error.retryable;
  }
  return isRetryableReportDeliveryError(message);
}
