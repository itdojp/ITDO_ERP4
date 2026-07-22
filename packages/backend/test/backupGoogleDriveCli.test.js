import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseBackupGoogleDriveArgs } from '../dist/cli/backupGoogleDriveSecondary.js';

async function scratch() {
  const root = path.resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, 'backup-gdrive-cli-'));
}

test('CLI parser accepts operational selectors but has no credential arguments', () => {
  assert.deepEqual(
    parseBackupGoogleDriveArgs([
      'download',
      '--backup-digest',
      'a'.repeat(64),
      '--destination-dir',
      '.codex-local/secure/download',
      '--handoff-file',
      '.codex-local/secure/download/handoff.json',
    ]),
    {
      apply: false,
      backupDigest: 'a'.repeat(64),
      command: 'download',
      destinationDir: path.resolve('.codex-local/secure/download'),
      handoffFile: path.resolve('.codex-local/secure/download/handoff.json'),
    },
  );
  assert.throws(
    () =>
      parseBackupGoogleDriveArgs([
        'upload',
        '--client-secret',
        'must-not-be-an-argument',
      ]),
    { message: 'backup_google_drive_arguments_invalid' },
  );
});

test('CLI parser rejects missing, irrelevant, and misplaced destructive options', () => {
  for (const argv of [
    ['upload'],
    ['list', '--backup-digest', 'a'.repeat(64)],
    ['download', '--backup-digest', 'a'.repeat(64)],
    ['check-config', '--apply'],
    ['trash', '--backup-digest', 'a'.repeat(64), '--apply'],
    ['prune', '--request-file', 'request.json'],
  ]) {
    assert.throws(() => parseBackupGoogleDriveArgs(argv), {
      message: 'backup_google_drive_arguments_invalid',
    });
  }
  assert.deepEqual(parseBackupGoogleDriveArgs(['prune', '--apply']), {
    apply: true,
    command: 'prune',
  });
});

test('CLI config check keeps disabled mode backward compatible', () => {
  const result = spawnSync(
    process.execPath,
    ['dist/cli/backupGoogleDriveSecondary.js', 'check-config'],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    provider: 'none',
    status: 'valid',
  });
  assert.equal(result.stderr, '');
});

test('CLI rejects unsafe upload request files without exposing their path', async () => {
  const directory = await scratch();
  const requestFile = path.join(directory, 'request.json');
  const privateRequestFile = path.join(directory, 'private-request.json');
  const linkedRequestFile = path.join(directory, 'linked-request.json');
  try {
    await writeFile(requestFile, '{"artifacts":[]}', { mode: 0o644 });
    await chmod(requestFile, 0o644);
    await writeFile(privateRequestFile, '{"artifacts":[]}', { mode: 0o600 });
    await symlink(privateRequestFile, linkedRequestFile);
    for (const candidate of [requestFile, linkedRequestFile]) {
      const result = spawnSync(
        process.execPath,
        [
          'dist/cli/backupGoogleDriveSecondary.js',
          'upload',
          '--request-file',
          candidate,
        ],
        {
          cwd: path.resolve(import.meta.dirname, '..'),
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            BACKUP_SECONDARY_PROVIDER: 'gdrive',
            BACKUP_GDRIVE_CLIENT_ID: 'client-placeholder',
            BACKUP_GDRIVE_CLIENT_SECRET: 'secret-placeholder',
            BACKUP_GDRIVE_REFRESH_TOKEN: 'refresh-placeholder',
            BACKUP_GDRIVE_SHARED_DRIVE_ID: 'drive-placeholder',
            BACKUP_GDRIVE_FOLDER_ID: 'folder-placeholder',
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.equal(result.stderr, 'backup_google_drive_request_file_unsafe\n');
      assert.doesNotMatch(
        `${result.stdout}${result.stderr}`,
        /secret-placeholder|refresh-placeholder|backup-gdrive-cli-/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
