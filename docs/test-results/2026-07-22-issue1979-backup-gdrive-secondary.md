# Issue #1979 Google Drive backup secondary repo-side検証

## 判定

- repoSideStatus: PASS
- targetEnvironmentStatus: BLOCKED
- blockedReason: 実Google Drive credential、承認済みShared Drive folder、実Sakura primary、隔離restore DBを本検証では使用していない
- issueScope: 暗号化済みSakura backup bundleのGoogle Drive二次copy
- branch: `feat/1979-backup-gdrive-secondary`
- baseCommit: `21b6738cd667b1be9f1dfcc4e2f8c89f9a47df88`
- executionDate: 2026-07-22 JST

fakeとlocal filesystemだけを使用したrepo-side検証である。実Google Workspace、実さくらオブジェクトストレージ、実DB restore、retention apply、trashは実行していない。この記録を実環境成功証跡として扱わない。

## 実装境界

- Sakura S3-compatible profileをprimaryとし、primary bundle全件のupload・検証後だけsecondaryを実行する。secondary有効時は`S3_VERIFY_DOWNLOAD=0`でも全remote manifestを再downloadして送信元とのbyte一致を必須とする。
- `BACKUP_GDRIVE_*`専用credential setを必須とし、`ERP4_GDRIVE_*` / Chat credentialへfallbackしない。
- Shared Driveとbackup専用folderを必須とし、個人My Driveを自動採用しない。
- `.gpg` artifact、OpenPGP packet、manifest、bundle context、ciphertext size / SHA-256を検証し、平文と不完全bundleをremote write前に拒否する。
- Drive private appPropertiesで世代・種類・role・checksumを追跡し、Drive file IDはowner-only local stateにだけ保存する。
- 同一世代のsecondary uploadはowner-only state directoryのexclusive lockで直列化し、競合processを最初のremote write前に拒否する。lockの自動期限切れや複数writer hostは許可しない。
- resumable uploadはsessionを1回だけ開始し、retryable interruption後に同一sessionへstatus queryして確認済みoffsetから再開する。
- list / freshness / stat / download / restore handoff / retention dry-runをsanitized CLIで提供する。
- daily 30日、weekly 12週、monthly 13か月相当を既定とし、各classの最新世代を保護する。duplicate、orphan、0-byte、checksum mismatch、不完全世代があればapplyを拒否する。
- pruneはdry-run既定、明示guard付きtrash-onlyであり、完全削除しない。

## 検証結果

| 検証                                | 結果 | 詳細                                                               |
| ----------------------------------- | ---- | ------------------------------------------------------------------ |
| Google Drive / backup focused tests | PASS | 44 tests                                                           |
| focused coverage                    | PASS | statements 86.59%、branches 79.67%、functions 95.18%、lines 86.59% |
| Sakura backup profile tests         | PASS | 20 tests                                                           |
| `make ops-quality`                  | PASS | docs、shell syntax / guard、Quadlet profile、backup profileを含む  |
| `make lint`                         | PASS | backend / frontend                                                 |
| `make format-check`                 | PASS | backend / frontend                                                 |
| `make typecheck`                    | PASS | backend / frontend                                                 |
| `make build`                        | PASS | backend / frontend                                                 |
| `make test`                         | PASS | backend 1,375 tests、frontend 82 files / 468 tests                 |
| dependency boundary                 | PASS | 248 modules / 956 dependencies、違反0                              |
| bounded-context coverage            | PASS | source 235、未分類 / stale / duplicate / ambiguous 0               |
| docs image links                    | PASS | 115 links / 333 Markdown files                                     |
| test-results index                  | PASS | unit 2 tests、index up-to-date                                     |
| `make audit`                        | PASS | backend / frontend high以上0件                                     |
| `git diff --check`                  | PASS | whitespace errorなし                                               |

backend full test中に、DB未起動による既存の非致命`P1001` audit warningが出力されたが、suiteは1,375件すべて成功した。今回のbackup pathはDBへ接続しない。

最終review修正後もSakura profile 20件、`make ops-quality`、lint / format / typecheck、backend 1,375件は成功した。frontend全体の初回実行では今回未変更の`ProjectMilestones.test.tsx`の非同期表示待ちが1件失敗したが、該当file 5件とfrontend全82 files / 468件の直後の再実行は成功した。失敗をskip、timeout延長、coverage除外では処理していない。

## テストしたfailure semantics

- secondary disabled時は既存backup動作を維持する。
- Sakura primary checksum failure時はsecondary uploadを呼ばない。
- Sakura remote manifestのdownload失敗・byte不一致時はprimary failureとし、secondary uploadを呼ばない。
- primary成功後のsecondary auth失効、quota、retryable 429 / 5xx相当、timeoutをsanitized `partial_failure`かつnon-zeroとして残す。
- hourlyはsecondary credential check / uploadを行わない。
- plaintext、OpenPGPでないartifact、不完全bundle、manifest checksum不一致をremote write前に拒否する。
- resumable session URLを新規作成し直さず、同一sessionの確認済みoffsetから再開する。
- logical duplicateまたは既存object metadata conflictを新規uploadで上書き・複製せずfail closedする。
- 同一state directoryから同じgenerationを並行uploadした場合、第2processは`backup_google_drive_upload_in_progress`で停止し、remote `put`を実行しない。正常終了時はlockを安全に解除する。
- request file、artifact、download先、local stateはnon-symlink / owner-only / no-clobber条件を検証する。
- inventory異常世代はfresh / readyとして集計せず、retention applyを拒否する。
- download後にsize、SHA-256、MD5、manifest、OpenPGP packet、bundle contextを再検証してからowner-only handoffを作る。

## Security / privacy

- credentialをCLI引数へ追加していない。
- 通常summaryへDrive / folder / file ID、Drive URL、session URL、OAuth値、S3識別子を出さない。
- request fileは`O_NOFOLLOW`でopenして同一inodeを読み、mode / owner / source identityを検証する。
- backup sourceは`O_NOFOLLOW`でpinし、検証・hash・uploadを同じfile handleから実行する。
- real credential、個人情報、顧客データ、private endpoint、VPS / DB識別子をfixture、log、docsへ記録していない。
- Prisma schema、HTTP API、既存Chat attachment providerKeyを変更していない。

## 実環境未検証と再開条件

未検証:

- 実Shared Driveのmembership / scope / folder境界
- 実OAuth refresh / revoke / rotation
- 実Drive resumable round-tripとquota表示可否
- 実Sakura primary後のencrypted secondary upload
- 実Drive downloadから#544隔離DBへのrestore
- 実retention planのoperator review。apply / trashは未承認・未実行

必要入力:

- backup専用OAuth client / principal / refresh tokenの承認済みsecret reference
- backup専用Shared Drive / folderのprivate identifier
- trialまたは承認済み対象環境
- synthetic encrypted bundleを保存する実Sakura primary profile
- #544用の隔離restore DBと明示承認

secretはIssue / PRへ貼らず、mode `0600`のVPS runtime envまたは承認済みsecret storeから注入する。

最初の再開command:

```bash
./scripts/backup-gdrive-secondary.sh check-config
./scripts/backup-gdrive-secondary.sh list
./scripts/backup-gdrive-secondary.sh freshness
```

最初の判定はread-only inventoryで行う。実writeはSakura primary成功後のsynthetic encrypted bundleに限定し、Drive-only成功へ切り替えない。rollbackは`BACKUP_SECONDARY_PROVIDER=none`へ戻し、Sakura primaryを維持する。
