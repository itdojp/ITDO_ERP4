# Issue #1977 Storage artifact foundation verification

- 実施日: 2026-07-22 JST
- branch: `feat/1977-storage-artifact-foundation`
- base: `origin/main` `21b6738cd667b1be9f1dfcc4e2f8c89f9a47df88`
- 対象: foundation PR（`Refs #1977`）
- 検証種別: repository-side / fake provider。実Google Drive・実データ移行ではない

## 実装範囲

- expand-only `StorageArtifact` metadata（`pending / ready / failed`）とcontext別storage port
- #1976の共通`GoogleDriveObjectStore`を利用するlocal / gdrive共通artifact adapter
- Drive private `appProperties`へhash化idempotency keyを保存する再実行安全性
- upload完了後のDB更新失敗を、remoteのhash化idempotency keyまたは既存local UUID fileの全量checksumでread-only復旧する。欠落local directoryは作成せず`artifact_store_in_progress`を維持
- dry-run既定、source削除なし、count / size / aggregate SHA-256を照合するcopy-only migration helper
- inventory時に`O_NOFOLLOW`で開いたfile handleをupload完了まで保持し、path差し替え後も検証済みinodeだけをstreamするTOCTOU対策
- Chat / PDF / Evidence / Report別folderのprovision・read/write preflight
- migration Runbook、Google Cloud事前設定、さくらVPS設定一覧、backup対象契約

PDF / Evidence archive / Reportのruntime provider接続、認可済みdownload endpoint、既存local record reader、Report email retryは#1977の最終PRで実装する。foundationだけではruntime providerを`gdrive`へ切り替えない。

## Schema / env / API契約

- schema: 新規`StorageArtifact` tableと一意・検索indexを追加。既存table/columnは変更していない
- env: 空値sampleとして`PDF_GDRIVE_FOLDER_ID`、`EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID`、`REPORT_GDRIVE_FOLDER_ID`を追加
- credential: 非Chat contextは完全な`ERP4_GDRIVE_*` setだけを使用し、旧Chat aliasへfallbackしない
- API: 既存HTTP APIのrequest / response / authorization / audit契約は変更していない
- secret / identifier: Drive URL、Drive file ID、folder ID、credential値をAPI応答・repository証跡へ出さない

## Local verification

| Command                                                           | Result | Notes                                                                                            |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| focused storage / Google Drive tests                              | PASS   | 最終review修正後のartifact adapter targeted test 21 tests                                        |
| `npm run coverage:storage:check --prefix packages/backend`        | PASS   | 29 tests。statements/lines 90.58%、branches 74.83%、functions 100%。既存閾値は変更なし            |
| `npm run coverage:chat:check --prefix packages/backend`           | PASS   | 199 tests。scoped statements/lines 59.15%、branches 64.66%、functions 75.73%。既存閾値は変更なし |
| `make lint`                                                       | PASS   | backend / frontend                                                                               |
| `make format-check`                                               | PASS   | backend / frontend                                                                               |
| `make typecheck`                                                  | PASS   | backend / frontend                                                                               |
| `make build`                                                      | PASS   | backend / frontend                                                                               |
| `make test`                                                       | PASS   | 最終review修正後 backend 1,393 tests、frontend 468 tests                                         |
| `make ops-quality`                                                | PASS   | ops script checks、Quadlet profile tests、S3 backup profile 19 tests                             |
| `npm run arch:bounded-context --prefix packages/backend`          | PASS   | 252 modules / 966 dependencies、違反なし                                                         |
| `npm run arch:bounded-context:coverage --prefix packages/backend` | PASS   | source 239、target 209、unclassified / stale / duplicate / ambiguous 0                           |
| `prisma format` / `prisma validate`                               | PASS   | expand-only migrationとschema整合                                                                |
| `make docs-test-results-index-check`                              | PASS   | 実行時点のindex整合                                                                              |
| `make docs-image-links-check`                                     | PASS   | image link整合                                                                                   |
| `git diff --check`                                                | PASS   | whitespace errorなし                                                                             |

`make test`中、local PostgreSQLを起動していない既存のvendor invoice監査testで非致命的なPrisma `P1001` warningが出力されたが、test suiteは全件成功した。

## 未実施

- 実Google Drive OAuth / Shared Drive membership / folder permission / quota
- 実Google Drive upload / download / trash / idempotent rerun
- production provider切替
- 実local artifactのinventory / copy / cutover
- `RELEASE_E2E_SCOPE=core make release-readiness`

release E2Eは、現在のWSL2が他開発と共有されておりPodman DB・port・serviceへ影響し得るためローカルでは実行していない。CIの隔離runnerで必須checkを確認し、実provider検証は承認済み対象環境でRunbookに従って別途行う。

## Rollback

application rollbackでは新tableとcopy済みobjectを残したまま旧versionへ戻す。migrationを逆適用してtableをdropせず、source local fileも削除しない。不要と確定した場合だけ別のcontract migrationで削除する。
