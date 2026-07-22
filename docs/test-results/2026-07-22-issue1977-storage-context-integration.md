# Issue #1977 Storage context runtime integration verification

- 実施日: 2026-07-22 JST
- branch: `feat/1977-storage-context-integration`
- base: `origin/main` `e267dab03c74cc4c046584c45289baefdd0259b3`
- 対象: #1977 final runtime integration（`Closes #1977`予定）
- 検証種別: repository-side / fake provider。実Google Drive・production provider切替・実データ移行ではない

## 実装範囲

- PDF、Evidence archive、Report生成物をcontext別portから共通`StorageArtifact` adapterへ接続
- PDFをmemory renderし、gdrive保存完了後だけERP4 artifact URLを返す。文書送信は同じBufferを添付し、local fileを暗黙生成しない
- Evidence content / metadataを別artifactとして保存し、approval閲覧権限とowner scopeをdownload時に再検証
- Report出力をdelivery作成前に1回だけ保存し、retryは同じartifactをopenして再生成・再uploadしない
- PDF / Evidence / Reportの認可済みdownload endpointを追加し、Drive URL、folder ID、provider keyを応答・監査metadataへ露出しない
- gdrive障害時のlocal / S3暗黙fallbackを禁止し、Report artifact取得のretryable / permanent failureを既存delivery状態へ反映
- `PDF_PROVIDER`、`EVIDENCE_ARCHIVE_PROVIDER`、`REPORT_PROVIDER`とcontext別folderをbackend / Quadletでfail-closed検証
- local provider、external PDF、Evidence S3、既存local record readerを後方互換経路として維持
- Google Cloud事前設定、さくらVPS導入、DR、backup / restore、copy-only cutover Runbookを更新

## 設計上の確認

- 3 contextはGoogle APIを直接呼ばず、#1976の`GoogleDriveObjectStore`を利用する共通artifact adapterへ依存する。
- gdrive object名はUUIDまたはSHA-256由来とし、個人名・メールアドレス・顧客名を使用しない。
- `REPORT_PROVIDER=local`と`PDF_PROVIDER=gdrive`を同時に設定しても、Report PDFはPDF用Drive contextへ誤保存しない。
- 直接Report PDF APIはartifact/local保存が失敗したstub結果を成功応答に変換しない。
- Prisma schema / migrationはfoundation PR #1990から追加変更していない。

## Local verification

| Command                                                           | Result | Notes                                                                            |
| ----------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| focused storage / PDF / Evidence / Report / env tests             | PASS   | 10 files / 126 tests（最終分割・直接Report PDF failure test追加後）              |
| `npm run coverage:storage:check --prefix packages/backend`        | PASS   | 32 tests。statements/lines 91.29%、branches 76.16%、functions 100%。閾値変更なし |
| `make lint`                                                       | PASS   | backend / frontend                                                               |
| `make format-check`                                               | PASS   | backend / frontend                                                               |
| `make typecheck`                                                  | PASS   | backend / frontend                                                               |
| `make build`                                                      | PASS   | backend / frontend                                                               |
| `make test`                                                       | PASS   | backend 1,417 tests、frontend 82 files / 468 tests                               |
| `make audit`                                                      | PASS   | backend / frontendともhigh以上0                                                  |
| `make ops-quality`                                                | PASS   | ops docs/scripts、Quadlet profile、S3 backup profile 19 tests                    |
| `npm run arch:bounded-context --prefix packages/backend`          | PASS   | 278 modules / 1,189 dependencies、違反なし                                       |
| `npm run arch:bounded-context:coverage --prefix packages/backend` | PASS   | source 243、target 211、unclassified / stale / duplicate / ambiguous 0           |
| OpenAPI exportと`docs/api/openapi.json`のdiff                     | PASS   | Evidence provider enumと3つのartifact download endpointを同期                    |
| `./scripts/secret-scan.sh`                                        | PASS   | tracked files 1,797、match 0                                                     |
| `git diff --check`                                                | PASS   | whitespace errorなし                                                             |

`make test`中、local PostgreSQLを起動していない既存のvendor invoice監査testで非致命的なPrisma `P1001` warningが出力されたが、test suiteは全件成功した。

## Security / privacy

- fixtureはsynthetic placeholderだけを使用した。
- credential、refresh token、実folder / Shared Drive ID、Drive file ID、Drive URL、個人情報をrepository証跡へ記録していない。
- error応答とlogは正規化済みerror codeだけを公開し、provider detailを返さない。
- source local file削除、Drive trash / 完全削除、production provider切替、DB restoreを実行していない。

## 未実施

- 実Google Workspace membership / OAuth scope / folder permission / quota
- 実Drive upload / download / retry / OAuth失効
- production provider切替
- 実local artifactのcopy-only apply / count / size / SHA-256照合
- 実Drive objectを使うDR / rollback演習
- `RELEASE_E2E_SCOPE=core make release-readiness`

release E2Eは、現在のWSL2が他開発と共有されておりPodman DB・port・serviceへ影響し得るためローカルでは実行していない。PRの隔離GitHub Actions runnerでE2Eを確認し、実provider検証とcutoverは#1981の承認済み対象環境で行う。

## Rollback

applicationを直前versionへ戻し、production providerを切り替えていない場合は現行local / external / S3経路を継続する。provider切替後のrollbackはcontextごとにlocalへ戻すが、copy済みDrive object、`StorageArtifact` row、source local fileは削除しない。schemaの逆migrationは行わず、必要な場合は別のforward-fixで扱う。
