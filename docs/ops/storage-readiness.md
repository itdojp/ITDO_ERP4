# ストレージ／バックアップ統合readiness Runbook

## 目的と安全境界

Google Driveのapplication storage、VPS local backup、さくらオブジェクトストレージのprimary backup、Google Driveのsecondary backup、隔離restore証跡を1コマンドでread-only確認する。

本checkは監視専用であり、次を行わない。

- DB restore
- backup生成または再upload
- retention prune / Drive trash
- provider設定、共有権限、bucket policyの変更
- credentialや実identifierのsummary出力

`--write-probe`だけは明示的なoperator操作であり、application用Drive folderへsynthetic objectを1件作成し、確認後にtrashする。定期timerは常にread-onlyで、`--write-probe`を使用しない。

## 監視component

| Component                 | 対象                          | 主な判定                                                    |
| ------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `app_gdrive_chat`         | Chat attachment Drive folder  | OAuth、folder/Shared Drive、permission、read、quota         |
| `app_gdrive_pdf`          | PDF Drive folder              | 同上                                                        |
| `app_gdrive_evidence`     | Evidence archive Drive folder | 同上                                                        |
| `app_gdrive_report`       | Report Drive folder           | 同上                                                        |
| `backup_local`            | VPS local OpenPGP backup      | hourly freshness、世代、manifest、SHA-256                   |
| `backup_sakura_primary`   | Sakura S3-compatible primary  | hourly freshness、世代、manifest、HEAD metadata SHA-256     |
| `backup_gdrive_secondary` | Drive secondary               | daily freshness、世代、metadata/checksum、dry-run candidate |
| `restore_evidence`        | private restore evidence JSON | 30日、environment、backup ID、結果、検証項目                |

各componentのstatusは`pass | warn | fail | unknown | not_configured`である。全体statusとexit codeは次で固定する。

| Exit | Overall                      | 意味                                                                |
| ---: | ---------------------------- | ------------------------------------------------------------------- |
|    0 | `pass`                       | 全componentが正常                                                   |
|    1 | `warn`                       | Drive quotaがwarning閾値以上など、要対応だがcritical未満            |
|    2 | `fail`                       | 恒久error、critical、freshness超過、integrity/retention/restore違反 |
|    3 | `unknown` / `not_configured` | quota取得不能、retryable error、または未設定を含み完全判定不能      |
|   64 | JSONなし                     | 引数または閾値設定が不正                                            |

優先順位は`fail > unknown/not_configured > warn > pass`である。primaryとsecondaryの片方だけが正常な場合は`backup_partial_failure`を返し、全体をpassにしない。

## 既定閾値

| 判定                    | 既定値 | env                                        |
| ----------------------- | -----: | ------------------------------------------ |
| Drive warning           |    70% | `STORAGE_READINESS_DRIVE_WARNING_PERCENT`  |
| Drive critical          |    80% | `STORAGE_READINESS_DRIVE_CRITICAL_PERCENT` |
| local hourly最大経過    |  2時間 | `STORAGE_READINESS_LOCAL_MAX_AGE_HOURS`    |
| Sakura hourly最大経過   |  2時間 | `STORAGE_READINESS_SAKURA_MAX_AGE_HOURS`   |
| Sakura API timeout      |   30秒 | `STORAGE_READINESS_S3_TIMEOUT_MS`          |
| Drive daily最大経過     | 30時間 | `STORAGE_READINESS_GDRIVE_MAX_AGE_HOURS`   |
| restore成功証跡最大経過 |   30日 | `STORAGE_READINESS_RESTORE_MAX_AGE_DAYS`   |
| hourly最低世代          |     48 | `STORAGE_READINESS_MIN_HOURLY`             |
| daily最低世代           |     30 | `STORAGE_READINESS_MIN_DAILY`              |
| weekly最低世代          |     12 | `STORAGE_READINESS_MIN_WEEKLY`             |
| monthly最低世代         |     13 | `STORAGE_READINESS_MIN_MONTHLY`            |

local/Sakura freshnessはhourly classの最新時刻、Drive secondaryはdaily classの最新時刻で判定する。別classの新しい世代でfreshness違反を隠さない。各classの最古・最新UTCと世代数をsummaryへ含め、canonical UTCでない時刻と将来時刻を拒否する。

この最低世代数はmonitorとdry-run candidate計算の安全側既定値である。既存のS3 prune applyで必要な`RETENTION_MIN_*`、review済みplan SHA、人間承認は置き換えない。capacity criticalでもmonitorは削除を実行しない。

## Google Drive quotaの意味

Drive API `about.get(fields=storageQuota(limit,usage))`で`limit`と`usage`がともに妥当な場合だけ利用率を計算する。`limit`が返らない、取得不能、または意味を確定できない場合は`unknown`であり、容量正常として扱わない。

Google公式仕様では、無制限の場合に`storageQuota.limit`が存在しないことがあり、組織poolの値は組織全体を表す。したがって本checkの割合は専用folderのbyte使用量ではない。

- [Drive API `about` resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/about)
- [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)

Shared Driveのfolder metadata、permission、list、write/trashには既存adapterの`supportsAllDrives=true`等を使用する。Drive URL、folder/file/Shared Drive ID、OAuth値はsummaryへ含めない。

## backup integrityの範囲

### local

ownerが管理し、group/world writableでないregular fileだけを対象とする。symlinkを拒否し、open済みfile descriptorとpathのdevice/inode/size/mtimeが検査前後で同一であることを確認してSHA-256を計算する。

### Sakura primary

configured prefixをpaginated listし、次を確認する。

1回のAPI呼出しは既定30秒で中断し、inventoryは20,000 entryを上限とする。上限超過は正常扱いせず、private inventoryの分割またはretention運用を確認する。

- Sakura key layoutのretention class、UTC date、backup ID、artifact type
- artifactと`.manifest.json`のpair
- OpenPGP manifest契約
- environment、backup ID時刻、retention class
- 0-byte、duplicate、orphan、不完全generation
- S3 `HeadObject`のsizeと`x-amz-meta-sha256`相当metadataがmanifestと一致すること

定期checkで全ciphertextをdownloadして再hashしない。これはprovider負荷と転送量を抑えるためであり、S3上のbyte-level再検証を意味しない。full contentの検証は`S3_VERIFY_DOWNLOAD=1`のupload検証と隔離restore演習で行う。

さくら公式仕様ではS3互換APIのList Objects V2、GET、HEAD、PUTとユーザー定義object metadataを利用できる。一方、書込時のprovider側整合性検査はchecksum種別に制約があるため、client-side SHA-256 manifestとverified downloadを維持する。

- [さくらのオブジェクトストレージAPI](https://manual.sakura.ad.jp/cloud/objectstorage/api.html)

### Drive secondary

#1979のinventory、private appProperties、Drive checksum、complete generation判定、trash-only retention planを再利用する。daily/weekly/monthly最低世代を保護したread-only candidate件数だけを表示し、monitorからtrashを実行しない。

## private env

Quadlet installerは次のexampleをowner-only fileとして配置する。

```text
deploy/quadlet/env/erp4-storage-readiness.env.example
  -> ~/.config/containers/systemd/erp4-storage-readiness.env
```

実値は承認済みsecret delivery pathから入力する。repository、Issue、PR、shell historyへ記載しない。application用provider/folder/共通Drive credentialは`erp4-backend.env`、監視閾値・backup provider・restore evidence pathは`erp4-storage-readiness.env`から読み込む。

```bash
chmod 600 ~/.config/containers/systemd/erp4-storage-readiness.env
test ! -L ~/.config/containers/systemd/erp4-storage-readiness.env
test "$(stat -c %u ~/.config/containers/systemd/erp4-storage-readiness.env)" = "$(id -u)"
```

Sakura credentialはAWS SDK標準credential chainを使用する。`AWS_PROFILE`とowner-only `AWS_SHARED_CREDENTIALS_FILE`、または承認済みsecret injectionを指定する。access key、secret key、private endpoint、bucket/prefix実値をevidenceへ転記しない。

## restore evidence

実restore完了後、providerやrepositoryの外にowner-only JSONを作る。構造例は[restore-evidence.json.example](examples/restore-evidence.json.example)を参照する。exampleは意図的に`blocked`かつ期限切れであり、そのままpassにはならない。

passに必要な条件:

- schema `erp4.restore.evidence.v1`
- `completedAt`がcanonical UTC、将来でなく、既定30日以内
- private envのexpected environment / backup IDと一致
- `result=pass`
- counts / amounts / references / filesがすべて`true`
- input fileがcurrent owner、mode 600、regular file、non-symlink

実environmentとbackup IDは比較にだけ使用し、summaryへ返さない。

## 手動実行

backend CLIを先にbuildする。

```bash
make build
make storage-readiness
```

Markdown表示:

```bash
./scripts/storage-readiness.sh --format markdown
```

read-onlyが既定である。Driveへの変更が承認されたmaintenance windowでだけ次を実行する。

```bash
./scripts/storage-readiness.sh --format json --write-probe
```

write probeが途中失敗した場合、自動retryや完全削除を推測実行しない。private Drive inventoryでsynthetic object状態を確認し、保護されたreconciliation手順で処理する。

## sanitized記録

テンプレートは[storage-readiness-template](../test-results/storage-readiness-template.md)を使用する。wrapperはcomponent/status、allowlist reason、件数、割合、時刻だけをMarkdownへ保存し、既存fileを上書きしない。

repo-side fake/synthetic結果:

```bash
EVIDENCE_BASIS=repo-side RUN_LABEL=r1 make storage-readiness-record
```

承認済みtarget environmentの直接check結果:

```bash
EVIDENCE_BASIS=target-environment \
ENVIRONMENT_LABEL=trial-a \
RUN_LABEL=r1 \
make storage-readiness-record
```

exit 1/2/3でもsanitized recordは生成され、そのexit codeを呼出元へ返す。recordは対象commitと実行codeの不一致を避けるためclean repositoryを必須とする。raw provider errorとprivate inventoryはrepository外へ保管する。

## timerの導入

repo-side作業ではenable/startしない。対象VPSでenvと手動read-only checkを確認し、人間承認後に実行する。

```bash
./scripts/quadlet/install-user-units.sh
systemctl --user daemon-reload
systemd-analyze --user verify \
  ~/.config/containers/systemd/erp4-storage-readiness.service \
  ~/.config/containers/systemd/erp4-storage-readiness.timer
systemctl --user start erp4-storage-readiness.service
systemctl --user status erp4-storage-readiness.service --no-pager
```

手動checkのsanitized JSONとexitを確認した後だけtimerを有効化する。

```bash
systemctl --user enable --now erp4-storage-readiness.timer
systemctl --user list-timers erp4-storage-readiness.timer --all
```

oneshotの`SyslogIdentifier`は`erp4-storage-readiness`である。warning/fail/unknownはnon-zeroとなり、journalとunit resultを既存メール、Webhook、外部監視へ接続できる。

```bash
journalctl --user -u erp4-storage-readiness.service --since today --no-pager
systemctl --user show erp4-storage-readiness.service \
  -p Result -p ExecMainCode -p ExecMainStatus
```

## disable / rollback

監視障害はapplication/backup自体の停止理由ではないが、未監視状態として扱う。timerだけを停止し、backup timer、source data、provider objectを変更しない。

```bash
systemctl --user disable --now erp4-storage-readiness.timer
systemctl --user reset-failed erp4-storage-readiness.service
```

rollbackは該当commit以前のservice/timer/env exampleとCLIへ戻して再installする。private envは削除せず、owner-only backupを作成してから別管理する。rollback時もrestore/prune/provider object削除は実行しない。

## status別対応

| Status/reason                            | 初動                                          | 再開条件                                       |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `drive_auth_expired`                     | private token rotation手順を実施              | read-only folder/quota check成功               |
| `drive_forbidden` / `drive_not_found`    | principal membershipとfolder対象をprivate確認 | Shared Drive/folder metadata取得成功           |
| `drive_quota_unknown`                    | Workspace管理者とquota意味を確認              | `limit`/`usage`取得またはunknown受容の運用判断 |
| `drive_quota_warning/critical`           | 組織poolと他service使用量を確認               | 閾値未満または承認済みcapacity対応             |
| `backup_freshness_exceeded`              | 該当backup jobのprivate logを調査             | 新規complete generation確認                    |
| `backup_*mismatch` / orphan / incomplete | upload停止、private inventoryを別担当者review | 新backup IDでcomplete bundle生成、source保持   |
| `retention_*_insufficient`               | prune applyを停止                             | 最低世代を満たすまで成功backupを蓄積           |
| `restore_*`                              | 隔離restore計画とprivate証跡を確認            | 30日以内の一致するpass evidence                |
| `provider_not_configured`                | cutover段階とenvを確認                        | 対象外の正式判断またはprivate config完了       |

## 実環境検証の再開条件

実provider checkには次が必要である。

1. trial/production対象が識別されたVPSとhuman approval
2. application用Drive OAuth、Shared Drive/folder設定
3. Sakura read-only inventory principalとcredential chain
4. backup専用Drive OAuth/folder設定
5. owner-only restore evidence、expected environment、expected backup ID
6. raw logとidentifierを公開しないprivate evidence保管先

private envを読み込んだ最初の再開commandは次である。

```bash
set +x
set -a
. "$PRIVATE_STORAGE_READINESS_ENV_FILE"
set +a
./scripts/storage-readiness.sh --format json
```

実credentialがないrepo-side testやfake結果をtarget-environment successとして記録しない。
