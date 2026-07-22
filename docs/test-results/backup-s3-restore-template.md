# S3-compatible backup/restore 実証跡テンプレート

対象: #544 / #1875。#1978のfake testを実restore成功として扱わない。

このfileをrepositoryへcommitする場合はsanitized summaryのみとする。実bucket、private endpoint、credential、GPG/KMS識別子、VPS/DB識別子、raw logはprivate evidenceへ保管する。

## 実行context

- executedAt: YYYY-MM-DDTHH:MM:SSZ
- targetEnvironmentLabel: <non-secret label>
- provider: sakura|aws
- operatorRole: <role-or-team>
- approverRole: <role-or-team>
- sourceCommit: <full-sha>
- applicationVersion:
- schemaVersion:
- databaseVersion:
- targetFingerprint: <sanitized SHA-256 fingerprint>
- privateEvidenceReference: <controlled record reference>
- restoreStatus: blocked|failed|pass

## 暗号化

- clientEncryption: openpgp|required-for-sakura
- providerEncryption: n/a|SSE-KMS|SSE-S3|provider-managed
- gpgRecipientReference: <controlled catalog reference; no real identifier>
- decryptCustodianRole:
- plaintextCleanupStatus: pending|pass|failed
- decryptedScratchCleanupStatus: pending|pass|failed
- manifestAuthenticityControl: <bucket-writer trust/audit control>

## readiness

- readinessRecordReference:
- summaryStatus: pass|blocked|failed
- executionMode: real
- writeProbe: 1
- realRunConfirmed: 1
- evidenceBasis: direct-check
- operatorEvidence: present|missing

## 実行結果

- backupLogReference:
- uploadLogReference:
- downloadLogReference:
- restoreLogReference:
- integrityReportReference:
- artifactManifestMatch: pass|failed
- downloadedSha256Match: pass|failed
- countsMatch: true|false
- amountsMatch: true|false
- referencesMatch: true|false
- filesMatch: true|false
- rollbackReady: true|false

## pass条件

- [ ] 対象commit / app / schema / DB version固定
- [ ] direct real readiness pass
- [ ] write/delete probe成功
- [ ] Sakura artifactがOpenPGP暗号化済み
- [ ] backup成功
- [ ] immutable upload成功
- [ ] artifact / manifest downloadとSHA-256検証成功
- [ ] isolated DBへのrestore成功
- [ ] counts / amounts / references / files一致
- [ ] plaintext / decrypted scratch cleanup完了
- [ ] rollback経路確認
- [ ] raw secret / target identifierをrepositoryへ記録していない

上記の1つでも未実施ならrestoreStatus: passを使用せず、#544をcloseしない。

## 実行コマンド境界

private decision recordとreal readiness recordを揃えた後、承認済みisolated環境でのみ実行する。

```bash
make backup-s3-backup
make backup-s3-download

RESTORE_CONFIRM=1 ./scripts/backup-prod.sh restore
```

scripts/record-backup-s3-restore.shを使用する場合、出力先はprivate operator evidence directoryを指定する。repositoryへはこのsanitized templateに要約して転記する。

## blocker / 再開

- completedRepoSide:
- unverifiedRealOperation:
- missingInputOrApproval:
- secureInputChannel:
- resumeCommand:
- firstReadOnlyCheck:
- rollbackProcedure:
- reasonIssueRemainsOpen:
