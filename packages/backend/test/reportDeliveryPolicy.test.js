import assert from 'node:assert/strict';
import test from 'node:test';

import { isRetryableReportDeliveryError } from '../dist/application/reportSubscriptions/reportDeliveryPolicy.js';

test('corrupt or missing ready report artifacts are non-retryable', () => {
  for (const error of [
    'artifact_not_found',
    'artifact_provider_key_invalid',
    'artifact_local_io_failed',
  ]) {
    assert.equal(isRetryableReportDeliveryError(error), false, error);
  }
  assert.equal(isRetryableReportDeliveryError('google_drive_timeout'), true);
});
