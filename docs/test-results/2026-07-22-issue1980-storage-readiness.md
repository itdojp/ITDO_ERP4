# Issue #1980 Storage／backup統合readiness repo-side検証

## 判定

- repoSideStatus: PASS
- targetEnvironmentStatus: BLOCKED
- blockedReason: 実Google Drive／さくらオブジェクトストレージcredential、承認済み対象環境、実backup世代、実restore証跡を本検証では使用していない
- issueScope: Drive容量・OAuth・backup freshness・retention・restore evidenceの統合監視
- branch: `feat/1980-storage-backup-monitoring`
- baseCommit: `256727de2a8c55f57ecb1ac6c8f1fcc8dce489ee`
- executionDate: 2026-07-22 JST

fake、synthetic manifest、local owner-only fileだけを使用したrepo-side検証である。実Google Workspace、実さくらオブジェクトストレージ、実VPS、production credential、DB restore、retention apply、Drive write probe、service／timer有効化は使用していない。この記録を実環境のreadiness成功証跡として扱わない。

## 実装境界

- 8個の固定componentを統合するread-only既定のCLI／shell wrapperを追加した。
  - `app_gdrive_chat`
  - `app_gdrive_pdf`
  - `app_gdrive_evidence`
  - `app_gdrive_report`
  - `backup_local`
  - `backup_sakura_primary`
  - `backup_gdrive_secondary`
  - `restore_evidence`
- component statusを`pass`、`warn`、`fail`、`unknown`、`not_configured`へ正規化し、全体判定を`fail > unknown/not_configured > warn > pass`の順で決定する。
- exit codeを`0=pass`、`1=warn`、`2=fail`、`3=unknown/not_configured`、`64=引数／設定エラー`として固定した。
- JSON／Markdown出力を固定allowlistから生成し、credential、Drive／folder／file ID、Drive URL、S3 endpoint／bucket／prefix／object key、backup ID、restore先を出力しない。
- Google Driveは既存の共通adapterを使用し、Shared Drive／folder metadata、permission、list、OAuth error、quotaを検査する。quota上限または使用量を取得できない場合はpassにせず`unknown`とする。
- `--write-probe`は手動指定時だけ有効であり、既定timerはread-onlyである。probe objectは成功時にtrashするが、partial failure時に推測で再試行または完全削除しない。
- local backup manifestはowner-only、non-symlink、regular fileを`O_NOFOLLOW`でpinし、同じfile descriptorからhashを計算して検査前後のidentity／size／mtime不変を確認する。
- Sakura primaryはS3 List V2をpaginationし、manifestとHEAD metadataのSHA-256を照合する。定期監視ではciphertext全量downloadを行わず、実upload／download／restore側のfull-byte検証を維持する。
- backup manifestはbackup ID／生成日時、OpenPGP、environment、artifact size／SHA-256、retention class、Sakura key layoutを検証する。
- freshnessはlocal／Sakuraの`hourly`とDrive secondaryの`daily`を厳密に評価し、別classの新しい世代で欠落を隠さない。classごとのoldest／latestをcanonical UTCで記録する。
- retention monitorは既定の最小保護数を保持し、candidate数だけを報告する。retention apply／prune／trashは実行しない。
- restore evidenceはowner-only、non-symlink、最大64 KiBのsanitized JSONだけを受理し、実restore未実施をpassへ変換しない。
- sanitized reportをGitHub管理可能なMarkdownへ変換するrecord wrapperと、Quadlet oneshot service／timerを追加した。recordはfull commit SHAと非secret environment labelを必須とし、既存fileを上書きしない。

## 検証結果

| 検証                                                     | 結果 | 詳細                                                                           |
| -------------------------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| storage readiness focused backend tests                  | PASS | 11 files／113 tests                                                            |
| focused changed-source coverage                          | PASS | statements/lines 87.88%、branches 81.95%、functions 93.61%。閾値低下／除外なし |
| Sakura backup profile tests                              | PASS | 22 tests                                                                       |
| storage readiness recorder tests                         | PASS | 2 tests                                                                        |
| `make lint`                                              | PASS | backend／frontend                                                              |
| `make format-check`                                      | PASS | backend／frontend                                                              |
| `make typecheck`                                         | PASS | backend／frontend                                                              |
| `make build`                                             | PASS | backend／frontend                                                              |
| `make test`                                              | PASS | backend 1,472 tests、frontend 82 files／468 tests                              |
| `make ops-quality`                                       | PASS | ops docs／scripts、Quadlet profile、S3 profile、recorderを含む                 |
| `npm run arch:bounded-context --prefix packages/backend` | PASS | 268 modules／1,036 dependencies、違反なし                                      |
| bounded-context coverage                                 | PASS | source 253、unclassified／stale／duplicate／ambiguous 0                        |
| docs test-results index／image links                     | PASS | index up-to-date、115 image links／342 Markdown files                          |
| `git diff --check`                                       | PASS | whitespace errorなし                                                           |

backend full test中に、local PostgreSQLを起動していない既存vendor invoice監査testの非致命的なPrisma warningが出力されたが、suiteは1,472件すべて成功した。今回の監視pathはDBへ接続しない。

依存packageは変更していない。`npm ci`時のaudit結果はbackend／frontendともvulnerability 0だったが、実装差分に依存更新がないため`make audit`の追加実行は省略した。

## 検証したfailure semantics

- componentに必要なprovider設定がない場合は`not_configured`とし、実環境成功として扱わない。
- provider名が不正な場合は設定不備として`fail`にし、`not_configured`へ黙って縮退しない。
- OAuth期限切れ、forbidden、not found、quota、retryable、permanent、timeoutをsanitized reasonへ正規化する。
- Drive folder metadata取得が成功しても、folder accessibleがfalseなら`drive_folder_unavailable`で失敗する。
- Drive quotaのlimit／usageの一方でも取得できない場合は`unknown`とし、割合を推測しない。
- folder／OAuth check成功後にquota APIだけが失敗した場合も、folder結果を保持して`drive_quota_unknown`とする。
- S3のunknown provider、認証失敗、forbidden、not found、quota、network／timeoutを分離する。
- S3 pagination、manifest数、object key、relative keyをboundedかつfail-closedで検証する。
- manifest改ざん、checksum不一致、0-byte、不完全bundle、retention class／key layout不一致をfresh／readyとして数えない。
- `hourly`または`daily`の必須classが欠落した場合、他classの新しい世代でpassへ昇格しない。
- local manifestのsymlink、所有者違反、group／world書込可能、identity変更、検査中の変更を拒否する。
- restore evidenceのsymlink、所有者／mode違反、過大file、不正JSON、未許可fieldを拒否する。
- recorderは未許可field、重複component、全体status不整合、短縮commit SHA、unsafe environment label、既存file上書きを拒否する。
- recorderはbasis point由来の2桁小数を浮動小数点誤差込みで受理し、3桁以上の割合は拒否する。
- CLIの未知引数は引数値をerrorへ反射せず、secret-likeな値を露出しない。

## Security／privacy

- fixtureにはsynthetic placeholderだけを使用した。
- OAuth client secret、refresh token、service account key、S3 access key／secret、実folder／Shared Drive ID、実endpoint／bucket／object key、VPS／DB識別子、個人情報をrepository証跡へ記録していない。
- credentialをCLI引数へ追加していない。
- 通常outputは固定component、status、allowlist reason、件数、時刻、割合だけに制限した。
- Google Driveの直接URLまたは共有権限を利用者へ返さない既存契約を維持した。
- Prisma schema、migration、HTTP API response、既存Chat attachment providerKeyを変更していない。
- Drive完全削除、source file削除、retention apply、DB restore、service restart、VPS reboot、production timer有効化を実行していない。

## 実環境未検証と再開条件

未検証:

- 実Shared Drive membership／OAuth scope／folder permission／quota表示
- 実OAuth refresh／revoke／rotationとretryable API failure
- 実Drive read-only inventoryおよび承認済みmanual write probe
- 実Sakura List／HEAD metadata、freshness、retention candidate
- 実local backup manifestとSakura／Drive secondaryの世代一致
- 実restore演習後のsanitized evidence取込み
- Quadlet timerの対象VPSでの定期実行、通知連携、運用者確認
- `RELEASE_E2E_SCOPE=core make release-readiness`

release E2Eは、現在のWSL2が他開発と共有されておりPodman DB／port／serviceへ影響し得るためローカルでは実行していない。PRの隔離GitHub Actions runnerでE2Eを確認する。

必要入力:

- context別Google Drive provider設定と、承認済みsecret storeから注入する共通OAuth credential
- backup専用Google Drive Shared Drive／folderのprivate identifier
- Sakura S3-compatible read権限credential、private endpoint、bucket／prefix
- 承認済み対象VPSと、実backup／restore rehearsalのsanitized evidence
- write probe、retention apply、restoreを行う場合の個別人間承認

secretやprivate identifierはIssue／PRへ貼らず、対象VPSのmode `0600` runtime envまたは承認済みsecret storeから注入する。

最初の再開command:

```bash
./scripts/storage-readiness.sh --format json
```

最初はread-onlyで8 componentの状態とexit codeを確認する。`--write-probe`、retention apply、restoreは同じ手順へ自動的に含めず、それぞれ明示承認後に実施する。

## Rollback

Quadlet timer／serviceを未有効のままapplicationを直前versionへ戻せば、既存backup、Google Drive adapter、artifact providerの動作は変わらない。timerを有効化済みの場合は、監視unitだけをdisableして生成済みsanitized evidenceを保持する。rollbackでDrive object、S3 object、local backup、restore evidenceを削除しない。
