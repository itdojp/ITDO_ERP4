import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoogleDriveBackupConfigurationError,
  resolveGoogleDriveBackupConfig,
} from '../dist/infrastructure/backup/googleDriveBackupConfig.js';

const enabled = {
  BACKUP_SECONDARY_PROVIDER: 'gdrive',
  BACKUP_GDRIVE_CLIENT_ID: 'client-placeholder',
  BACKUP_GDRIVE_CLIENT_SECRET: 'secret-placeholder',
  BACKUP_GDRIVE_REFRESH_TOKEN: 'refresh-placeholder',
  BACKUP_GDRIVE_SHARED_DRIVE_ID: 'drive-placeholder',
  BACKUP_GDRIVE_FOLDER_ID: 'folder-placeholder',
  BACKUP_DIR: '.codex-local/secure/backups',
};

test('backup Google Drive is disabled by default without reading credentials', () => {
  assert.deepEqual(
    resolveGoogleDriveBackupConfig({
      ERP4_GDRIVE_CLIENT_ID: 'application-credential-must-not-be-used',
    }),
    { provider: 'none' },
  );
});

test('backup Google Drive requires a complete dedicated Shared Drive credential set', () => {
  assert.throws(
    () =>
      resolveGoogleDriveBackupConfig({
        BACKUP_SECONDARY_PROVIDER: 'gdrive',
        ERP4_GDRIVE_CLIENT_ID: 'application-client',
        ERP4_GDRIVE_CLIENT_SECRET: 'application-secret',
        ERP4_GDRIVE_REFRESH_TOKEN: 'application-refresh',
      }),
    (error) => {
      assert.ok(error instanceof GoogleDriveBackupConfigurationError);
      assert.deepEqual(error.keys, [
        'BACKUP_GDRIVE_CLIENT_ID',
        'BACKUP_GDRIVE_CLIENT_SECRET',
        'BACKUP_GDRIVE_FOLDER_ID',
        'BACKUP_GDRIVE_REFRESH_TOKEN',
        'BACKUP_GDRIVE_SHARED_DRIVE_ID',
      ]);
      assert.doesNotMatch(JSON.stringify(error), /application-|secret-/);
      return true;
    },
  );
});

test('backup Google Drive resolves bounded tuning and a private state location', () => {
  const config = resolveGoogleDriveBackupConfig({
    ...enabled,
    BACKUP_GDRIVE_UPLOAD_TIMEOUT_SEC: '600',
    BACKUP_GDRIVE_RETRY_MAX: '5',
    BACKUP_GDRIVE_VERIFY_DOWNLOAD: '1',
  });
  assert.equal(config.provider, 'gdrive');
  assert.equal(config.tuning.timeoutMs, 600_000);
  assert.equal(config.tuning.maxRetries, 5);
  assert.equal(config.verifyDownload, true);
  assert.match(config.stateDir, /\.gdrive-state$/);
  assert.equal(config.credentials.clientId, 'client-placeholder');
  assert.equal(config.credentials.deprecatedAliasesPresent.length, 0);
});

test('backup Google Drive rejects invalid provider and tuning values', () => {
  for (const env of [
    { BACKUP_SECONDARY_PROVIDER: 'drive' },
    { ...enabled, BACKUP_GDRIVE_UPLOAD_TIMEOUT_SEC: '0' },
    { ...enabled, BACKUP_GDRIVE_RETRY_MAX: '11' },
    { ...enabled, BACKUP_GDRIVE_VERIFY_DOWNLOAD: 'yes' },
  ]) {
    assert.throws(
      () => resolveGoogleDriveBackupConfig(env),
      GoogleDriveBackupConfigurationError,
    );
  }
});
