# Google Drive backup secondary 証跡テンプレート

対象: #1979 / #544。repo-side fake testを実Google Driveまたは実restore成功として扱わない。

repositoryへcommitする場合はsanitized summaryだけを記載する。OAuth credential、Shared Drive / folder / file ID、Drive URL、Sakura bucket / endpoint / object key、GPG識別子、VPS / DB識別子、raw provider logはprivate evidenceへ保持する。

## 実行context

- executedAt: YYYY-MM-DDTHH:MM:SSZ
- targetEnvironmentLabel: `<non-secret-label>`
- executionMode: fake|real
- sourceCommit: `<full-sha>`
- operatorRole: `<role-or-team>`
- approverRole: `<role-or-team-or-n/a>`
- privateEvidenceReference: `<controlled-record-reference-or-n/a>`
- summaryStatus: blocked|failed|pass

## 構成境界

- primaryProvider: sakura
- secondaryProvider: gdrive
- dedicatedBackupCredential: yes|no
- sharedDriveSelected: yes|no
- applicationCredentialFallback: disabled|unknown
- hourlyExcluded: yes|no
- plaintextUploadRejected: pass|failed|not-run
- credentialSource: `<secret-resource-reference-no-value>`

## repo-side fake検証

```bash
npm run build --prefix packages/backend
node --test \
  packages/backend/test/backupGoogleDriveCli.test.js \
  packages/backend/test/googleDriveBackupConfig.test.js \
  packages/backend/test/googleDriveSecondaryBackup.test.js \
  packages/backend/test/googleDriveObjectStore.test.js
node --test scripts/backup-s3-profile.test.mjs
make ops-quality
```

- fakeUpload/list/stat/download/trash: pass|failed|not-run
- sameResumableSessionResume: pass|failed|not-run
- primaryBeforeSecondary: pass|failed|not-run
- secondaryFailureState: pass|failed|not-run
- retentionDryRun: pass|failed|not-run
- newestGenerationProtected: pass|failed|not-run
- identifierAndSecretSanitization: pass|failed|not-run

上記はrepo-side実装証跡であり、`executionMode: fake`では`summaryStatus: pass`を使用しない。実環境入力が無ければ`blocked`とし、未検証事項と再開条件を記録する。

## 実Google Drive検証

承認済みprivate envを読み込み、最初にread-onlyで実行する。

```bash
./scripts/backup-gdrive-secondary.sh check-config
./scripts/backup-gdrive-secondary.sh list
./scripts/backup-gdrive-secondary.sh freshness
```

その後、承認済みsynthetic encrypted bundleについてSakura primary成功後の標準経路でuploadし、hash selectorだけを使ってstat/downloadする。Drive単独upload、実DB restore、retention apply、trashは別の明示承認なしに実行しない。

- readOnlyPreflight: pass|failed|not-run
- sakuraPrimaryUpload: pass|failed|not-run
- encryptedSecondaryUpload: pass|failed|not-run
- remoteMetadataAndChecksum: pass|failed|not-run
- resumableRecovery: pass|failed|not-run
- freshness: fresh|stale|unknown|not-run
- quota: `<sanitized-value-or-unknown>`
- downloadAndHandoff: pass|failed|not-run
- isolatedRestore: pass|failed|not-run
- retentionPlanOnly: pass|failed|not-run

`summaryStatus: pass`は、実credential・実Shared Driveでread、Sakura primary後のencrypted upload、stat、download、handoffが成功し、識別子とsecretがsanitizedされている場合だけ使用する。isolated restoreまで含むpassは#544の追加条件を満たす必要がある。

## blocker / 再開

- completedRepoSide:
- unverifiedRealOperation:
- missingInputOrApproval:
- secureInputChannel:
- resumeCommand: `./scripts/backup-gdrive-secondary.sh list`
- firstReadOnlyCheck: Shared Drive scope / folder membership / sanitized inventory
- rollbackProcedure: `BACKUP_SECONDARY_PROVIDER=none`へ戻し、Sakura primaryを維持する
- reasonIssueRemainsOpen:
