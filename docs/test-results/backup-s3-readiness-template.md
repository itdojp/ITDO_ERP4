# S3-compatible backup readiness 記録テンプレート

このtemplateをrepositoryへcommitする場合はsanitized summaryだけを記載する。credential、private endpoint、実bucket名、object key、GPG/KMS識別子、raw provider logはprivate evidenceに保持する。

## 実行context

- executedAt: YYYY-MM-DDTHH:MM:SSZ
- environmentLabel: <non-secret label>
- provider: sakura|aws
- branch: <branch>
- commit: <full-sha>
- operatorRole: <role-or-team>
- privateEvidenceReference: <controlled record reference>
- targetFingerprint: <sanitized SHA-256 fingerprint>

## 入力状態

- S3_EXECUTION_MODE: fake|real
- S3_REAL_RUN_CONFIRM: 0|1
- CHECK_WRITE: 0|1
- STRICT: 0|1
- S3_OPERATOR_EVIDENCE_FILE: missing|private-present
- endpointValidation: pass|fail
- credentialSource: <secret-resource reference; no value>

## 実行コマンド

repo-side fake:

```bash
S3_EXECUTION_MODE=fake \
S3_REAL_RUN_CONFIRM=0 \
CHECK_WRITE=0 \
make backup-s3-readiness-check
```

#544 real evidence（承認・credential・targetが揃った場合のみ）:

```bash
S3_EXECUTION_MODE=real \
S3_REAL_RUN_CONFIRM=1 \
CHECK_WRITE=1 \
RUN_CHECK=1 \
FAIL_ON_CHECK=1 \
make backup-s3-readiness-record
```

## 判定

- summaryStatus: pass|blocked|failed
- executionMode: fake|real
- writeProbe: 0|1
- realRunConfirmed: 0|1
- evidenceBasis: direct-check|external-sanitized-log
- warningCount:
- errorCount:
- notApplicableCount:
- operatorEvidence: present|missing

passは次の全条件を満たす場合だけ使用する。

- summaryStatus: pass
- executionMode: real
- writeProbe: 1
- realRunConfirmed: 1
- evidenceBasis: direct-check
- SakuraではoperatorEvidence: present
- put / head / get / delete round-trip成功

fake runまたはexternal-sanitized-logはblockedとする。

## provider別確認

### 共通

- [ ] profile / endpoint / prefix validation
- [ ] bucket access / list
- [ ] write / head / get / delete probe
- [ ] object size / SHA-256
- [ ] secret-like valueがsummaryにない

### Sakura

- [ ] bucket location / versioning / bucket ACL direct check
- [ ] AWS固有検査はnot_applicableと理由を記録
- [ ] versioningStatus evidence
- [ ] publicAccessStatus evidence
- [ ] accessControlStatus evidence
- [ ] retentionStatus evidence
- [ ] AWS KMSを必須としていない
- [ ] versioning有効時のsynthetic probe versionをversion ID指定でcleanup

### AWS

- [ ] region
- [ ] versioning
- [ ] server-side encryption
- [ ] lifecycle
- [ ] Public Access Block
- [ ] KMS（SSE-KMSの場合）

## blocker / 再開

- completedRepoSide:
- unverifiedRealOperation:
- missingInputOrApproval:
- secureInputChannel:
- resumeCommand:
- firstReadOnlyCheck:
- reasonIssueRemainsOpen:
