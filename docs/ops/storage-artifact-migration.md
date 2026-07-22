# Storage artifact copy-only migration Runbook

## 目的

PDF、Evidence archive、Reportの既存local fileをinventoryし、Google Driveへcopy-onlyで移行する。実cutoverは#1981で行い、このRunbookの実Google Drive `--apply`、runtime provider切替、source削除は人間承認なしに実施しない。

## 安全契約

- `--dry-run`が既定。
- `--apply`を明示した場合だけDB row作成とDrive uploadを行う。
- sourceを変更・削除するoptionは存在しない。
- symlink、特殊file、空sourceを既定で拒否する。
- target filenameはcontextとhash由来で、元filenameをDrive nameへ含めない。
- private Drive `appProperties`には生のidempotency keyを保存しない。
- JSONにはlocal relative pathを含むためprivate evidenceとして扱い、repositoryへraw出力をcommitしない。
- Markdown summaryにはrelative path、Drive ID、folder ID、credentialを含めない。
- output fileはmode `0600`で新規作成し、既存fileやsymlinkを上書きしない。再実行時は新しいoutput pathを指定する。
- stdoutはcount/byte/statusだけのsanitized summaryとし、relative pathやartifact IDを出さない。

## 事前条件

repo-side dry-run:

- 対象commitをcheckout済み
- backend dependenciesとPrisma Clientを準備済み
- 読取専用のsource directory
- 新local artifact directoryを使う場合はowner-only（通常`0700`）。既存source inventoryのpermission変更はこのhelperでは行わない

実Google Drive applyでは追加で次が必要。

- 承認済み対象環境とoperator承認
- DB migration適用済み
- mode `0600`の保護済みenv fileに`DATABASE_URL`、完全な`ERP4_GDRIVE_*` credential、対象contextのfolder ID
- Shared Driveの場合は`ERP4_GDRIVE_SHARED_DRIVE_ID`
- 対象folderのread/write operator preflight成功

credential、folder ID、Drive IDはshell引数へ直接書かず、保護済みenv fileまたは承認済みsecret injectionから渡す。

## context対応表

| context             | source例                            | 必須folder env                      |
| ------------------- | ----------------------------------- | ----------------------------------- |
| `pdf`               | `PDF_STORAGE_DIR`                   | `PDF_GDRIVE_FOLDER_ID`              |
| `evidence`          | Evidence content directory          | `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID` |
| `evidence_metadata` | Evidence metadata sidecar directory | `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID` |
| `report`            | `REPORT_STORAGE_DIR`                | `REPORT_GDRIVE_FOLDER_ID`           |

Evidence contentとmetadataを別directoryで管理する環境では、contextを分けて実行する。同じfolderを使ってもtarget nameとidempotency keyはcontextで分離される。

## dry-run

build済みartifactを使う場合:

```bash
node packages/backend/dist/cli/storageArtifactMigration.js \
  --context pdf \
  --source-dir /var/lib/erp4/pdfs \
  --dry-run \
  --json-output .codex-local/secure/pdf-migration-dry-run.json \
  --markdown-output .codex-local/secure/pdf-migration-dry-run.md
```

repository checkoutでbuildを含める場合:

```bash
DATABASE_URL='postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public' \
npm run storage-artifacts:migrate --prefix packages/backend -- \
  --context pdf \
  --source-dir /var/lib/erp4/pdfs \
  --dry-run \
  --json-output .codex-local/secure/pdf-migration-dry-run.json \
  --markdown-output .codex-local/secure/pdf-migration-dry-run.md
```

後者の`DATABASE_URL`はPrisma Client生成用であり、dry-runはDBやGoogle Driveへ接続しない。実credentialを例示値へ置換しない。

確認項目:

- source count / total size / aggregate digest
- 全fileが`planned`
- symlink・特殊file・空directoryでfail closed
- JSON/Markdown outputがmode `0600`
- stdoutを公開ログへ保存していない

## apply

承認後、保護済みenvを値を表示せず読み込む。

```bash
set -a
. .codex-local/secure/storage-migration.env
set +a

node packages/backend/dist/cli/storageArtifactMigration.js \
  --context pdf \
  --source-dir /var/lib/erp4/pdfs \
  --apply \
  --json-output .codex-local/secure/pdf-migration-apply.json \
  --markdown-output .codex-local/secure/pdf-migration-apply.md
```

PASS条件:

- exit code 0
- `verified=true`
- source/targetのcount、size、aggregate digestが一致
- 全fileが`verified`
- DBの対象`StorageArtifact`が`ready`
- 同じcommandの再実行で同じartifact IDを再利用し、Drive上に重複を作らない

失敗時はruntime providerを切り替えない。`failed` rowのsanitized failure codeを確認し、OAuth/folder/quota/readinessを解消して同じcommandを再実行する。upload完了後・DBの`ready`更新前に中断した`pending` rowは、再実行時にhashed idempotency metadataでDrive objectをread-only照合し、内容を再検証できた場合だけ同じrowを`ready`へ回復する。objectが確認できない`pending` rowでは新規uploadを開始せず、`artifact_store_in_progress`で停止する。remote object作成後に検証が失敗した場合も自動trashしない。Drive IDを公開せず、保護されたoperator inventoryで既存objectを照合する。

## cutoverとrollback

このhelperはcopyまでで停止する。#1981では次を別承認で行う。

1. copy結果と既存local readerを確認する。
2. maintenance/cutover windowを開始する。
3. contextのruntime providerをgdriveへ変更する。
4. 認可済みERP4 endpointから新旧recordをreadする。
5. rollback時はprovider設定をlocalへ戻す。copy済みDrive objectと`StorageArtifact` rowは削除しない。

source local fileの削除は本helperにもrollback手順にも含めない。retentionはcutover後の別承認事項とする。

## 証跡

[storage artifact migration evidence template](../test-results/storage-artifact-migration-template.md)へsanitized summaryだけを記録する。実値、raw JSON、raw logはprivate evidence保管先へ置き、repositoryにはcommit SHA、実行時刻、context、件数、byte数、PASS/BLOCKED/FAIL、private evidence referenceだけを残す。
