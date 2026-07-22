import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatGoogleDriveLegacyEnvWarning,
  GOOGLE_DRIVE_TUNING_DEFAULTS,
  GoogleDriveConfigurationError,
  resolveGoogleDriveCommonCredentials,
  resolveGoogleDriveCredentials,
  resolveGoogleDriveSharedDriveId,
  resolveGoogleDriveTuningConfig,
} from '../dist/infrastructure/storage/googleDriveConfig.js';

const commonCredentials = {
  ERP4_GDRIVE_CLIENT_ID: 'common-client',
  ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
  ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
};

const legacyCredentials = {
  CHAT_ATTACHMENT_GDRIVE_CLIENT_ID: 'legacy-client',
  CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET: 'legacy-secret',
  CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN: 'legacy-refresh',
};

test('Google Drive credentials accept the common ERP4 keys', () => {
  const config = resolveGoogleDriveCredentials(commonCredentials);

  assert.deepEqual(config, {
    clientId: 'common-client',
    clientSecret: 'common-secret',
    refreshToken: 'common-refresh',
    deprecatedAliasesPresent: [],
  });
});

test('Google Drive credentials keep legacy Chat aliases compatible', () => {
  const config = resolveGoogleDriveCredentials(legacyCredentials);

  assert.equal(config.clientId, 'legacy-client');
  assert.equal(config.clientSecret, 'legacy-secret');
  assert.equal(config.refreshToken, 'legacy-refresh');
  assert.deepEqual(
    config.deprecatedAliasesPresent.sort(),
    Object.keys(legacyCredentials).sort(),
  );
});

test('non-Chat Google Drive credentials require the common ERP4 keys', () => {
  assert.deepEqual(resolveGoogleDriveCommonCredentials(commonCredentials), {
    clientId: 'common-client',
    clientSecret: 'common-secret',
    refreshToken: 'common-refresh',
    deprecatedAliasesPresent: [],
  });
  assert.throws(
    () => resolveGoogleDriveCommonCredentials(legacyCredentials),
    (error) => {
      assert.ok(error instanceof GoogleDriveConfigurationError);
      assert.deepEqual(error.keys, [
        'ERP4_GDRIVE_CLIENT_ID',
        'ERP4_GDRIVE_CLIENT_SECRET',
        'ERP4_GDRIVE_REFRESH_TOKEN',
      ]);
      assert.doesNotMatch(JSON.stringify(error), /legacy-/);
      return true;
    },
  );
});

test('common Google Drive credentials win while legacy keys are reported safely', () => {
  const config = resolveGoogleDriveCredentials({
    ...legacyCredentials,
    ...commonCredentials,
  });
  const warning = formatGoogleDriveLegacyEnvWarning(
    config.deprecatedAliasesPresent,
  );

  assert.equal(config.clientId, 'common-client');
  assert.equal(config.clientSecret, 'common-secret');
  assert.equal(config.refreshToken, 'common-refresh');
  assert.match(warning ?? '', /CHAT_ATTACHMENT_GDRIVE_CLIENT_ID/);
  assert.doesNotMatch(warning ?? '', /common-|legacy-/);
});

test('partial common credentials fail closed instead of mixing with legacy values', () => {
  assert.throws(
    () =>
      resolveGoogleDriveCredentials({
        ...legacyCredentials,
        ERP4_GDRIVE_CLIENT_ID: 'common-client',
      }),
    (error) => {
      assert.ok(error instanceof GoogleDriveConfigurationError);
      assert.deepEqual(error.keys, [
        'ERP4_GDRIVE_CLIENT_SECRET',
        'ERP4_GDRIVE_REFRESH_TOKEN',
      ]);
      return true;
    },
  );
});

test('partial legacy credentials fail closed when common credentials are absent', () => {
  assert.throws(
    () =>
      resolveGoogleDriveCredentials({
        CHAT_ATTACHMENT_GDRIVE_CLIENT_ID: 'legacy-client',
      }),
    (error) => {
      assert.ok(error instanceof GoogleDriveConfigurationError);
      assert.deepEqual(error.keys, [
        'ERP4_GDRIVE_CLIENT_SECRET',
        'ERP4_GDRIVE_REFRESH_TOKEN',
      ]);
      return true;
    },
  );
});

test('missing Google Drive credentials identify only key names', () => {
  assert.throws(
    () =>
      resolveGoogleDriveCredentials({
        ERP4_GDRIVE_CLIENT_ID: 'sensitive-client',
      }),
    (error) => {
      assert.ok(error instanceof GoogleDriveConfigurationError);
      assert.deepEqual(error.keys, [
        'ERP4_GDRIVE_CLIENT_SECRET',
        'ERP4_GDRIVE_REFRESH_TOKEN',
      ]);
      assert.equal(error.message, 'google_drive_configuration_invalid');
      assert.doesNotMatch(JSON.stringify(error), /sensitive-client/);
      return true;
    },
  );
});

test('Google Drive tuning uses bounded defaults and accepts explicit integers', () => {
  assert.deepEqual(
    resolveGoogleDriveTuningConfig({}),
    GOOGLE_DRIVE_TUNING_DEFAULTS,
  );
  assert.deepEqual(
    resolveGoogleDriveTuningConfig({
      ERP4_GDRIVE_TIMEOUT_MS: '12000',
      ERP4_GDRIVE_MAX_RETRIES: '0',
      ERP4_GDRIVE_RETRY_BASE_DELAY_MS: '125',
      ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES: '1048576',
    }),
    {
      timeoutMs: 12000,
      maxRetries: 0,
      retryBaseDelayMs: 125,
      resumableUploadThresholdBytes: 1048576,
    },
  );
});

for (const [key, value] of [
  ['ERP4_GDRIVE_TIMEOUT_MS', '0'],
  ['ERP4_GDRIVE_TIMEOUT_MS', '300001'],
  ['ERP4_GDRIVE_MAX_RETRIES', '-1'],
  ['ERP4_GDRIVE_MAX_RETRIES', '11'],
  ['ERP4_GDRIVE_MAX_RETRIES', '+1'],
  ['ERP4_GDRIVE_MAX_RETRIES', '1e1'],
  ['ERP4_GDRIVE_MAX_RETRIES', '0x1'],
  ['ERP4_GDRIVE_RETRY_BASE_DELAY_MS', '1.5'],
  ['ERP4_GDRIVE_RETRY_BASE_DELAY_MS', '60001'],
  ['ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES', 'not-a-number'],
]) {
  test(`Google Drive tuning rejects invalid ${key}=${value}`, () => {
    assert.throws(
      () => resolveGoogleDriveTuningConfig({ [key]: value }),
      (error) =>
        error instanceof GoogleDriveConfigurationError &&
        error.keys.length === 1 &&
        error.keys[0] === key,
    );
  });
}

test('Shared Drive ID is optional and trimmed', () => {
  assert.equal(resolveGoogleDriveSharedDriveId({}), undefined);
  assert.equal(
    resolveGoogleDriveSharedDriveId({
      ERP4_GDRIVE_SHARED_DRIVE_ID: ' shared-drive ',
    }),
    'shared-drive',
  );
});
