# DR計画（RTO/RPO）と復元演習

## 目的

バックアップが存在しても「復元できる」保証が無いと運用上の価値が低い。
本ドキュメントでは、暫定の RTO/RPO と、復元手順/演習を定義する。

## 対象（復旧対象）

### 最小（必須）

- PostgreSQL（業務データ）

### 追加（環境により）

- application artifact（Chat添付、PDF、Evidence archive、Report生成物）
  - Google Drive providerへのrepository-side対応は#1976 / #1977、copy-only cutoverは#1981で扱う
  - local providerの既存recordはprovider切替後もlocal volumeから復元できる状態を維持する
- 設定/シークレット
  - `DATABASE_URL`、JWT/認証設定、Push通知鍵（VAPID）、メール設定、暗号鍵（GPG等）

## RTO/RPO（暫定推奨値）

最終値は業務要件（再入力コスト、法令/監査、月次締め等）に基づき確定する必要がある。
ここでは、初期運用を前提に暫定値を置く。

### 重要データ（例: 工数/経費/請求/承認）

- RPO: **1時間**
- RTO: **4時間**

### 通常データ（例: ログ/一部の補助データ）

- RPO: **24時間**
- RTO: **24時間**

## バックアップ方式

### 検証環境（Podman）

- `scripts/podman-poc.sh backup` / `restore` を使用する（`docs/ops/backup-restore.md`）

### 本番相当（ホスト上のPostgreSQLを想定）

- `scripts/backup-prod.sh` を使用する
  - ローカル保存（`BACKUP_DIR`）
  - 主backupはSakura S3-compatible profile（#1978）
  - S3送信前のOpenPGP client-side encryptionを必須とする
  - Google Driveへの暗号化二次copyは#1979で扱う
  - AWS S3 / SSE profileと別host退避は互換・移行経路として維持する
  - 実bucket / credential / isolated restoreの証跡は#544で確定する

設定例は `docs/requirements/backup-restore.env.example` を参照。

## 復元手順（最小）

### 検証環境（Podman）

1. バックアップ取得（source）
2. 別コンテナへリストア（verify）
3. 整合性チェック実行

復元検証スクリプト:

- `scripts/restore-verify.sh`

### 本番相当（注意）

本番DBへのリストアは破壊的操作になり得るため、原則として「専用の復旧環境」で実施する。
本番環境への直接復元は、影響範囲・切り戻し・個人情報の扱いを含めて判断する。

Sakura backupの復元では、real readiness、verified download、manifest SHA-256、OpenPGP復号、isolated DB restore、件数・金額・参照・file整合性、plaintext cleanupを#544のpass条件とする。fake provider testは復元演習の代替にしない。

復元sourceは次の順で判断する。

1. Sakura primaryの対象世代をinventoryし、artifact / manifest / size / SHA-256 / OpenPGP packetを検証してdownloadする。
2. Sakura primaryが利用不能、credential障害、または対象世代破損の場合だけ、Google Drive secondaryのsanitized inventoryから同一世代をhash selectorで選ぶ。
3. `make backup-gdrive-download`でowner-only scratchへ取得し、size / SHA-256 / MD5、manifest、OpenPGP packet、bundle整合を再検証してrestore handoffを作る。
4. handoffを入力として、承認済みの隔離DBへ復号・restoreする。本番DBへ直接restoreしない。
5. 件数・金額・参照・application file整合、RTO/RPO、plaintext cleanupを確認する。

Google DriveはSakura primaryの代替成功条件ではない。secondaryがfreshでもprimary失敗を隠さず、`partial_failure`として復旧・監視対象にする。Driveからのdownload成功もDB restore成功とは別の証跡であり、#544の隔離restoreを完了するまでreal restore passと記録しない。

### application artifactの復旧確認

PostgreSQLの`StorageArtifact` metadataだけを復元しても、Google Drive object本体の復旧確認にはならない。#1981のcutover後は、DB復元確認に続けて次を行う。

1. 復旧環境へ完全な`ERP4_GDRIVE_*` credential setとcontext別folder IDをsecret storeから注入する。実値は証跡へ転記しない。
2. `gcp-drive-check.sh`を`pdf`、`evidence`、`report`の各有効contextに対してread modeで実行する。
3. 権限を持つERP4 userで、PDF・Evidence archive・Reportの認可済みartifact endpointからsanitized test recordを取得する。
4. endpointがDrive URLやprovider keyを返さず、DB metadataのsize / SHA-256と取得streamが一致することを確認する。
5. local providerの既存recordは、復元したlocal asset volumeと従来endpointから引き続き取得できることを確認する。

credential失効、folder membership不一致、object欠落、checksum不一致は復旧未完了として扱い、`healthz`成功だけでDRをPASSにしない。実Google Driveでの検証はfake testで代替せず、#1981の承認済み復元演習へ記録する。

## 復元演習（定期）

### 方針（暫定）

- まずは **週1回**（検証環境）で実施し、所要時間/失敗要因を記録する
- 本番相当は、実行環境が用意できた時点で定期化（nightly/weekly）
- 少なくとも四半期ごとに、Sakura primary障害を想定したGoogle Drive secondaryからのdownload・handoff・隔離restoreを演習する
- #1981のcopy-only移行中はsourceを削除せず、primary/secondary双方のfreshnessと同一bundle checksumを確認してからcutover判断する

### 記録（テンプレ）

- `docs/test-results/dr-restore-template.md` をコピーし、`docs/test-results/YYYY-MM-DD-dr-restore-rN.md` または `docs/test-results/YYYY-MM-DD-dr-restore-<RUN_LABEL>.md` として保存する
- 補助: `scripts/record-dr-restore.sh` で最新 `tmp/erp4-dr-verify-*.log` から記録ファイルを生成できる
- 過去30日以内の成功記録は リリース判定の restore verification 証跡として参照してよい
- 統合readinessへ渡すprivate JSONは[restore evidence example](examples/restore-evidence.json.example)のschemaを使用し、mode 600、current owner、non-symlinkでrepository外へ保管する。environment / backup IDは比較専用で、sanitized recordへ転記しない
- `make storage-readiness`の`restore_evidence=pass`は証跡のfreshnessと一致を示すだけであり、実restore自体のraw evidenceを代替しない

## 関連

- バックアップ/リストア（Runbook）: `docs/ops/backup-restore.md`
- S3-compatible storage設定決定: `docs/ops/backup-s3-decision-checklist.md`
- Google Drive secondary copy: `docs/ops/backup-restore.md#46-google-drive-secondary-copy`
- 障害対応: `docs/ops/incident-response.md`
- Storage／backup統合readiness: `docs/ops/storage-readiness.md`
