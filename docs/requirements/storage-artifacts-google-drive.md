# PDF・Evidence・Report共通ストレージ契約

## 目的と適用範囲

Issue #1977でPDF、Evidence archive、Report生成物をlocalまたはGoogle Driveへ保存するための共通契約を定義する。Chat添付のAPI・監査・`providerKey`互換性は変更しない。実データのcopy/cutoverは#1981で行う。

#1977では、共通artifact lifecycle、context別port、Google Drive object storeの再実行安全性、copy-only helperに加え、各業務service・認可済みdownload endpointへのruntime接続を提供する。repository側の対応完了はproduction cutoverの承認を意味しない。実credential、folder preflight、copy-only照合、rollback windowを確認する#1981までproduction providerを切り替えない。

## contextと設定契約

| context          | runtime provider（最終形）                       | local directory              | Google Drive folder                 |
| ---------------- | ------------------------------------------------ | ---------------------------- | ----------------------------------- |
| PDF              | `PDF_PROVIDER`: local / external / gdrive        | `PDF_STORAGE_DIR`            | `PDF_GDRIVE_FOLDER_ID`              |
| Evidence archive | `EVIDENCE_ARCHIVE_PROVIDER`: local / s3 / gdrive | `EVIDENCE_ARCHIVE_LOCAL_DIR` | `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID` |
| Report output    | `REPORT_PROVIDER`: local / gdrive                | `REPORT_STORAGE_DIR`         | `REPORT_GDRIVE_FOLDER_ID`           |

`PDF_PROVIDER=external`は既存の外部renderer + local保存契約として維持する。`EVIDENCE_ARCHIVE_PROVIDER=s3`も既存互換経路として維持する。gdrive選択時にlocalやS3へ暗黙fallbackしない。

非Chat contextは、完全な次の共通credential setだけを使用する。

- `ERP4_GDRIVE_CLIENT_ID`
- `ERP4_GDRIVE_CLIENT_SECRET`
- `ERP4_GDRIVE_REFRESH_TOKEN`
- `ERP4_GDRIVE_SHARED_DRIVE_ID`（Shared Driveの場合だけ）

旧`CHAT_ATTACHMENT_GDRIVE_*` credentialはChat専用の後方互換fallbackであり、PDF・Evidence・Reportには使用しない。contextごとのfolder ID、Shared Drive ID、credential値はログ、API応答、Issue、PR、repository証跡へ記録しない。

## アーキテクチャ境界

- application側は`ArtifactStoragePort`をcontext別typeとして参照する。
- Google APIの低レベルI/Oは`GoogleDriveObjectStore`へ集約し、PDF・Evidence・ReportからGoogle APIを直接呼ばない。
- `StorageArtifact`は内部metadataを保持し、APIにはartifact UUIDだけを公開する。
- Drive file IDは`providerKey`としてDB内部だけに保持し、Drive URLや直接共有権限を利用者へ返さない。
- 認可、監査、業務状態遷移は各contextの既存application/service層に残す。

## `StorageArtifact` lifecycle

expand-only migrationで次を追跡する。

- context、provider、providerKey
- `pending|ready|failed` status
- idempotency key
- original name、content type、size、SHA-256
- owner type / owner ID、created by
- sanitized failure code、timestamps、logical delete timestamp

保存順序は次のとおり。

1. `pending` rowを作成する。
2. providerへuploadする。
3. providerから内容をstream downloadし、sizeとSHA-256を再計算する。
4. 一致した場合だけ`providerKey`を保存して`ready`へ遷移する。
5. 失敗時はsecretやprovider identifierを含まないfailure codeで`failed`へ遷移する。

同一context/provider/idempotency keyはDBで一意とする。`ready`はmetadata一致時だけ再利用する。`pending`の再要求では、新規uploadを開始せず、localの同一UUID fileまたはGoogle Driveのhashed idempotency metadataをread-onlyで照合する。完成済みobjectを内容まで再検証できた場合だけ、upload完了後・DB更新前に中断したrowを`ready`へ回復する。objectが未確認なら、並行要求として`artifact_store_in_progress`で失敗させる。`failed`は1要求だけが再取得できる。Google Drive側のprivate `appProperties`には、生のidempotency keyではなくSHA-256 digestを保存する。状態更新はcompare-and-swapとし、回復済みの`ready`を元upload処理の失敗処理で上書きしない。

## local providerの安全条件

- provider keyは生成したUUIDだけを許可する。
- 保存先directoryとfileのsymlinkを拒否し、directoryは実行user所有かつgroup/other permissionなし（通常`0700`）、fileは実行user所有かつ`0600`を要求する。
- local file I/OはLinuxの`/proc/self/fd`を介して検証済みdirectory file descriptorへ固定し、directory path差し替えを検出してfail closedとする。
- 新規fileはexclusive create、mode `0600`とする。
- 保存直後とopen前にsize・SHA-256を検証する。
- current providerを切り替えた後もrow単位のproviderで既存local recordを解決する。

既存`/pdf-files/<filename>`、Evidenceのlocal/S3 object key、ReportのCSV/`filePath` payload readerを維持する。これらへDrive file IDを格納しない。

## context別runtime契約

- PDFは`PDF_PROVIDER=local|external`で従来どおりlocal fileを生成する。`gdrive`ではBufferを共通adapterへ保存し、`/pdf-files/artifacts/<artifact UUID>`だけを`pdfUrl`へ格納する。document送信時は同じBufferをSMTP/SendGrid attachmentへ渡し、local fileを暗黙生成しない。
- Evidence archiveは`local|s3`の既存content/metadata sidecar契約を維持する。`gdrive`ではcontentとmetadataを別contextのartifactとして保存し、approval instanceをownerに設定する。download時は既存のapproval閲覧判定とartifact ownerを再検証する。
- Reportは`REPORT_PROVIDER=local`で既存CSV/PDF payloadとlocal path readerを維持する。`gdrive`ではdelivery row作成前に出力を1回だけ保存し、artifact UUIDをpayloadへ固定する。再送は同じartifactをopenし、再生成・再uploadしない。
- dry-runはproviderに関係なくartifact upload、local output write、PDF render、delivery row作成を行わない。
- gdriveの保存失敗時は業務成功statusへ遷移せず、local/S3へ暗黙fallbackしない。

認可済みdownload endpointは次のとおり。provider key、folder ID、Drive URLは応答・監査metadataへ出さない。

| context  | endpoint                                                     | 認可                                     |
| -------- | ------------------------------------------------------------ | ---------------------------------------- |
| PDF      | `/pdf-files/artifacts/:artifactId`                           | `admin` / `mgmt`                         |
| Evidence | `/approval-instances/:id/evidence-pack/archives/:artifactId` | role + approval閲覧判定 + artifact owner |
| Report   | `/report-outputs/:artifactId`                                | `admin` / `mgmt`                         |

## Google Drive errorとretry

共通adapterは`auth_expired`、`forbidden`、`not_found`、`quota`、`retryable`、`timeout`、`permanent`へ正規化する。idempotentなlist/get/stat/trashだけを上限付きで再試行し、結果不明のfresh createを繰り返さない。Shared Driveでは`supportsAllDrives=true`を使い、idempotency lookupでは`includeItemsFromAllDrives=true`と`corpora=drive`/`driveId`を指定する。

provider readinessは通常のprocess healthzと分離する。credential、folder scope、容量、OAuth失効の運用監視は#1980で実装し、fake testを実Google Driveの成功証跡として扱わない。

## migrationとrollback

copy-only helperは[storage-artifact-migration Runbook](../ops/storage-artifact-migration.md)を使用する。既定はdry-runであり、source削除、Drive完全削除、provider切替を行わない。

DB migrationのrollbackは既存recordを変更しないため、application rollbackでは新tableを残して旧versionへ戻す。migration file自体を巻き戻したり、本番でtableを即時dropしたりしない。不要と確定した場合は、参照状況とbackupを確認した別のcontract migrationで削除する。

## 未検証範囲

- 実Google Workspace membership / OAuth scope / folder permission
- 実Drive upload/downloadと容量
- production provider切替
- 既存local recordの実データcopy/cutover
- source削除（本Epicではhelperへ実装しない）
