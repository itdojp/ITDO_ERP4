# Issue #2093: dependency audit remediation（2026-10-05）

## 対象と状態

- 対象: [Issue #2093](https://github.com/itdojp/ITDO_ERP4/issues/2093)。請求画面の改善とは別の依存更新。
- baseline: `3054caa2e7837c4f9ff96aa5ccf922881c42879d`。
- branch: `security/2093-dependency-audit-remediation`。
- Node.js **20.19.0** / npm **10.8.2**、Linux/WSL2。公式 Node 配布物の SHA-256 を検証し、task worktree 内の検証専用 toolchain を使用。OS の既定 Node は変更していない。
- ローカル差分の検証記録。PR/remote CI/merge 完了の証跡ではない。
- 10月5日時点では PostgreSQL 実統合・old-application compatibility・実 backend E2E は未実施。10月25日の追加結果は末尾の追補を参照。全 release gate が完了したという記録ではない。
- schema、migration、application API、認証/ACL、container、CI workflow に変更なし。

## Audit と更新方針

devDependencies を含む `npm audit --audit-level=high --json` を package ごとに独立実行した。件数は npm audit の package 集計であり、独立した攻撃経路数ではない。

| Package                                     | 更新前 high / moderate | 更新後 high / moderate | critical   |
| ------------------------------------------- | ---------------------- | ---------------------- | ---------- |
| backend                                     | 11 / 4                 | 0 / 0                  | 前後とも 0 |
| frontend                                    | 4 / 5                  | 0 / 0                  | 前後とも 0 |
| browser extension（別 worktree、read-only） | 0 / 0                  | 0 / 0                  | 前後とも 0 |

extension は main に未収録の PR #2074 worktree（head `740e71c2ea80896068599dfde8243b24fb3cdb93`）を read-only audit した。今回の差分には含めず、PR の再検証や Windows runtime 成功を意味しない。

`npm audit fix --force`、audit allowlist 追加、`--omit=dev`、job/test skip、coverage 引下げは行っていない。lockfile は npm の通常の update/install で生成し、手編集していない。

### 主な依存経路と解消

| 経路/責務                                         | 更新前 → 更新後                                                          | 判断                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Fastify                                           | 5.12.1 → 5.12.5                                                          | 同一 major 内の修正。route/error/shutdown 回帰を確認 |
| Fastify/Ajv → fast-uri                            | 4.1.2 / 3.1.5 → 4.2.1 / 3.1.8                                            | 両 major の脆弱版を排除                              |
| multipart → @fastify/busboy                       | 3.2.0 → 3.2.2                                                            | upload 境界を回帰確認                                |
| googleapis/gaxios → axios                         | 1.18.1 → 1.20.0                                                          | 外部 Google 接続は実行せず、依存を更新               |
| Prisma CLI → mysql2                               | 3.15.3 → 3.24.5                                                          | `prisma` 配下限定 override                           |
| notifier → nodemailer                             | 9.0.5 → 10.0.15                                                          | Node 20 対応の修正版へ更新、loopback SMTP を追加検証 |
| ts-node-dev → chokidar 3 → braces                 | ts-node-dev 2.0.0 / braces 3.0.3 を除去                                  | dev runner を tsx 4.23.15 へ置換                     |
| 両 package の glob/lint tooling → brace-expansion | 5.0.9 → 5.0.12                                                           | 同一 major 内更新                                    |
| 両 package の lint tooling → @humanfs/node        | 0.16.7 → 0.16.8                                                          | Node 20 の既存系列を維持                             |
| 両 package の lint/OpenAPI tooling → js-yaml      | 4.3.1 → 4.3.2                                                            | 同一 major 内更新                                    |
| backend transitive ip-address / qs                | 10.4.0 / 6.15.2 → 10.7.3 / 6.16.0                                        | moderate も除外せず更新                              |
| frontend → Vitest / coverage-v8 / mocker          | 4.1.10 → 4.1.11                                                          | peer の系列を揃える                                  |
| frontend → jsdom → undici                         | 7.29.0 → 7.30.0                                                          | Node 20 対応の 7 系を維持                            |
| frontend browser metadata tooling                 | browserslist 4.28.2 → 4.29.3、baseline-browser-mapping 2.10.38 → 2.11.27 | 対応するデータ依存も npm が更新                      |

主な一次資料:

- [fast-uri advisory](https://github.com/advisories/GHSA-5jgf-p345-68v8)、[mysql2 advisory](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)、[mysql2 3.24.5 release](https://github.com/sidorares/node-mysql2/releases/tag/v3.24.5)。採用版の判定には当日 audit の全 advisory も使用。
- [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): 3.0.3 以下が対象、調査時点で patched version なし。dev-only であることを理由に除外せず、依存経路を除去。
- [Nodemailer advisory](https://github.com/advisories/GHSA-v53p-9fqp-m79j): 10.0.5 以下が対象、10.0.6 以上が修正版。[10.0.15 release](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.15) と package engines を確認して選択。

### Prisma と Node の互換性

- Prisma / @prisma/client / @prisma/adapter-pg / @prisma/config は **7.9.1** のまま。調査時点の Prisma 7.10.0 も mysql2 3.15.3 を固定しており、Prisma 一部だけの更新では解消しない。
- `overrides.prisma.mysql2 = "3.24.5"` として scope を限定した。既存 deepmerge-ts override は保持。
- 実 application DB は PostgreSQL/PrismaPg。mysql2 は Prisma CLI 側の経路であり、本番到達性や exploit 成功は未実証。ただし audit 対象からは外していない。
- argon2 0.44.0 を維持。Node 24 移行、Prisma 8、Dependabot の無関係な更新は含めない。
- 既存 `@prisma/streams-local@0.1.11` の Node >=22 engines 宣言は baseline と同一の devOptional 経路である。今回の変更で新たな Node 20 不適合 package は追加していない。全依存が Node 20 対応であるとは主張しない。

### 開発 runner の変更

`ts-node-dev` から `tsx watch --no-cache --clear-screen=false` へ変更する。新規 devDependency の理由は未修正 braces 経路の除去。新しい esbuild とその optional platform packages が lockfile に入る。

tsx は型検査しないため、既存の `npm run typecheck` / build gate を維持する。本番は従来どおり build 後の `node dist/index.js`。watch の TypeScript/ESM 実行、fixture 更新による再起動、SIGTERM 終了、実 `src/index.ts` 起動と `/healthz` 200、graceful shutdown を確認した。

独立レビューで残存する SMTP 手順を確認し、backend README / secrets runbook を install 済み tsx の明示実行へ更新した。また、既存の移行/ClamAV スクリプトが参照する `ts-node@10.9.2` は直接 devDependency として維持する。脆弱経路は `ts-node-dev` の別依存 chokidar 3 / braces であり、`ts-node` 単体の維持では復活しない。移行/運用 CLI をこの依存更新で全面改修しない。

独立 security review で共有 TMPDIR 内の tsx 変換キャッシュを他のローカル利用者が先行作成/差替えできる条件付きリスクを確認したため、新しい dev/SMTP 呼出しは `--no-cache` を指定する。別 UID 間の実攻撃や本番侵害を確認したものではない。ディスク上の変換結果を再利用しない対処であり、IPC 等の一時ファイル全般を無効化するものではない。

## 実施済み検証

| 検証                                                 | 結果                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| backend/frontend clean `npm ci`                      | 成功、各 audit 0 件                                                                                          |
| focused backend                                      | **54/54 pass、skip 0**（SMTP/SendGrid cleanup、local login、safe HTTP、multipart、shutdown subprocess）      |
| backend 全テスト                                     | **2,398/2,398 pass、skip 0**、test concurrency 2                                                             |
| frontend 全テスト                                    | **114 files / 954 tests pass**、maxWorkers 2                                                                 |
| frontend UI-core coverage 再実行                     | 全 954 tests pass。statements 73.61%、branches 66.67%、functions 73.14%、lines 76.38%、既存 threshold 全通過 |
| backend/frontend lint / format / typecheck / build   | 成功。frontend は既存 `VITE_PWA_SHARE_TARGET_MODE=decommission` で build                                     |
| frontend quality gate self-tests / build budget      | 成功。initial JS gzip 166.4 KiB                                                                              |
| Prisma generate / validate / format                  | 成功。format は schema の一時コピーで実行し、元 schema と byte 比較一致                                      |
| OpenAPI export                                       | 成功、`docs/api/openapi.json` と byte 比較一致（breaking/nonbreaking 差分ともなし）                          |
| `npm ls`                                             | Prisma 7.9.1 整合、mysql2 3.24.5、Vitest 4.1.11 整合、旧 ts-node-dev / braces なし                           |
| backend/frontend/extension audit、`make audit`       | 成功。moderate/low も 0                                                                                      |
| `make ops-quality`                                   | 成功（repo-side のみ、live systemd/Podman 操作なし）                                                         |
| bounded-context dependency / classification coverage | 成功、unclassified/ambiguous/invalid 0                                                                       |

追加 `notifierSmtpTransport.test.js` は 127.0.0.1 の ephemeral fake SMTP sink を使用する。実 Nodemailer の recipient 正規化、本文/MIME attachment、複数回 cleanup、再送時の cache 再作成を検証する。外部 SMTP/provider、実メール、credential は使用しない。TLS/SMTP AUTH の実運用検証ではない。

review 修正後の clean install に対し、標準 `npm run test --prefix packages/backend -- --test-concurrency=2`（Prisma generate/build を含む）も再実行し、2,398/2,398 pass、fail/skip 0 を確認した。独立 correctness/security review は下記の2件を修正・再確認後、未解決の要対応指摘 0。docs index/image links、tracked/new text の secret scan、変更文書/test の format、`git diff --check` も成功。GitHub PR review completeness の完了を意味しない。

一時検証の注意:

- host npm 10.9.7 で Vitest peer 更新時に Arborist エラーが発生。repository CI と同じ Node 20.19.0/npm 10.8.2 で通常 install/ci をやり直し解消。force / legacy-peer-deps は使用していない。
- tsx watch の初回 smoke は深い TMPDIR で Unix socket path が 108 bytes を超え EADDRINUSE。task 配下の短い `tmp/` に限定して再実行し通過。application source の失敗を隠す retry ではなく、検証環境の path を修正した。恒久的な OS 設定変更なし。
- review 後の focused test を手動 `node --test` で再実行した際、一つの route test の module load が `DATABASE_URL is required` で失敗。既存 `scripts/run-tests.js` 経由の synthetic DB 設定に戻し、54/54 pass を再確認した。source の修正、timeout 延長、skip は行っていない。
- 最終 dev smoke は manifest のコマンドから引数を取得し、watch child の `TSX_DISABLE_CACHE=1` を確認した。SMTP の `--no-cache` 手順は stub/設定不備の 3 cases pass。既存 `ts-node` executable は offline resolution で 10.9.2 を確認した。

## 未実施 gate と再開条件

read-only `podman ps -a` は `invalid internal status` / pause process missing で失敗。PID 1 は systemd ではない。既存 rootless state に対して migrate/reset/restart はしていない。

次は **未実施**:

- PostgreSQL 15 への migration deploy、DB 制約/Prisma 実統合、旧 application と新 DB/依存の互換検証。
- core/full real-backend E2E、`RELEASE_E2E_SCOPE=core make release-readiness`。
- GitHub exact-head CI、Copilot、review completeness、冷却、merge。
- 本番 SMTP、Google、S3、Sakura、production DB、Windows Chrome/Edge。

安全な ephemeral DB を利用できる環境を別の運用範囲で確立してから、既存 integration/old-app harness と E2E を実行する。既存 erp4trial resource は使わない。未実施を pass や merge-ready と解釈しない。

検証コマンドの入口（task worktree で、当該 toolchain が保存されている場合）:

```bash
export PATH="$PWD/.codex-local/tools/node-v20.19.0-linux-x64/bin:$PATH"
export NPM_CONFIG_CACHE="$PWD/.codex-local/npm-cache"
export TMPDIR="$PWD/tmp"
export XDG_CACHE_HOME="$PWD/.codex-local/cache"
npm run test --prefix packages/backend -- --test-concurrency=2
npm run test --prefix packages/frontend -- --maxWorkers=2
make audit
```

DB 検証の再開は、下記「2026-10-25」の専用 wrapper 確認手順を使用する。上記の Node PATH だけでは既定 Podman を隔離できない。E2E / release-readiness は共有 WSL 上で直接起動しない。

詳細 log/audit JSON は ignored `.codex-local/verification/` に保存。独立レビューと docs/secret/diff の最終検証結果はローカル台帳へ記録する。

## Rollback / 残存リスク

- application rollback は従来の image/commit に戻す。schema/data 変更なし、down migration やデータ削除は不要。
- dependency rollback が必要なら manifest と lockfile を対で戻し clean install する。ただし既知脆弱性が復活するため、セキュリティ解消済みとは扱わず再修正版を用意する。
- 開発 runner の rollback も未修正 braces を復活させる。typecheck を省略する運用には変更しない。
- scoped mysql2 override は Prisma 上流が修正版を採用した時点で削除可否を再評価する。
- 新規 SMTP major と Prisma CLI transitive override の実環境互換性は残課題。ローカル pass だけでは production readiness を主張しない。
- 本差分は PR #2074 や既存請求 UI worktree へ未同期。Dependabot PR の自動 close、Issue #2018 着手は行わない。

## 2026-10-25 再監査・検証再開

上記は **2026-10-05 時点**の結果。以下の再監査で新しい advisory を検出したため、過去の audit 0 件・テスト結果を更新後の依存へ流用しない。base は引き続き `3054caa2e7837c4f9ff96aa5ccf922881c42879d`。この追補は検証時点の task worktree 差分に対する記録であり、main の修正完了や PR の merge readiness を意味しない。

### 当日の依存監査

| 対象                                           | backend                     | frontend            |
| ---------------------------------------------- | --------------------------- | ------------------- |
| main の manifest/lockfile を独立コピーして監査 | High 9 / Moderate 4         | High 7 / Moderate 5 |
| 10月5日の修正案を再監査                        | High 1 / Moderate 3 / Low 1 | High 4 / Moderate 3 |
| 下記の追加更新後                               | 全 severity 0               | 全 severity 0       |

`npm audit --audit-level=high` は devDependency を含めて実施。除外、force、threshold 変更は行っていない。

| 追加更新                      | 10月5日修正案 → 10月25日修正案 |
| ----------------------------- | ------------------------------ |
| Fastify                       | 5.12.5 → 5.12.6                |
| Nodemailer                    | 10.0.15 → 10.1.4               |
| fast-uri                      | 3.1.8 / 4.2.1 → 3.1.9 / 4.2.3  |
| follow-redirects              | 1.16.0 → 1.16.1                |
| ip-address                    | 10.7.3 → 10.7.5                |
| Vite                          | 8.2.0 → 8.2.4                  |
| Vitest / coverage-v8 / mocker | 4.1.11 → 4.1.12                |
| source-map-js                 | 1.2.1 → 1.2.2                  |
| undici                        | 7.30.0 → 7.30.1                |
| Zod（lint tooling 経由）      | 4.3.5 → 4.6.7                  |

追加根拠: [follow-redirects advisory](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)、[Fastify release](https://github.com/fastify/fastify/releases/tag/v5.12.6)、[Nodemailer release](https://github.com/nodemailer/nodemailer/releases/tag/v10.1.4)、[Vite advisory](https://github.com/advisories/GHSA-698v-4r3x-3vcv)、[Vitest release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.12)、[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[undici release](https://github.com/nodejs/undici/releases/tag/v7.30.1)、[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。

通常の `npm install --package-lock-only` / package 名を指定した `npm update --package-lock-only` で解決し、その後 clean `npm ci` を実行した。lockfile は手編集していない。Vite の依存再解決に伴う Rolldown/platform binding、PostCSS 等も lockfile に含む。Prisma 7.9.1 群、argon2 0.44、既存 scoped override は維持し、Node 24 移行は混在させない。検証は repository CI と同じ task-local Node 20.19.0 / npm 10.8.2 で実施する。Node 20 の継続運用を推奨するものではなく、runtime 更新は #2008 の独立作業。

### PostgreSQL 検証環境の分離

既存 Podman state の migrate/reset や erp4trial の変更を行わず、新規の task 専用 graphRoot/runRoot/runtime/config/auth を作成した。既定の UID 共通 SHM lock を避け、専用 `containers.conf` に `lock_type="file"` を指定する。全呼出しは `env -i` と同じ専用 wrapper を使用し、remote 接続設定や既存 credential を継承しない。

- rootless=true。固定 image は repository の PostgreSQL 15 digest `sha256:6ab12ad4395ee49ab49fe19530f7e183c5a9c97fc47cf687b3e281bec5f91ee4`。
- 実行した server version: PostgreSQL **15.18**。
- synthetic DB、tmpfs、動的な `127.0.0.1` 公開 port のみ。新規 DB に限り cgroups disabled を使用し、host の systemd/cgroup 設定は変更しない。
- 初回 `info` は runRoot が 50 文字を超えたため失敗。repository 内の短い ignored runtime path へ変更して成功した。既定 runtime を修復したものではない。
- smoke の readiness と SQL version 取得は成功し、作成した smoke container は停止・自動回収済み。
- 同一 UID 内の状態分離であり、別ユーザー/VM 相当のセキュリティ分離や VPS 運用証跡とは主張しない。

標準 `scripts/e2e-frontend.sh` には、全 interface 待受と port 番号による PID cleanup がある。共有 WSL でそのまま実行せず、今回の DB 分離を E2E 全体の安全性と同一視しない。E2E は専用 runner/network と所有 process だけの cleanup を確保してから実行する。

PG-only 検証の再開コマンド（task worktree 内、今回生成した専用 wrapper が残っている場合のみ）:

```bash
ISO=/home/devuser/work/CodeX/ITDO_ERP4/.codex-local/p2093
test -x "$ISO/bin/podman" || exit 1
export PATH="$ISO/bin:$PWD/.codex-local/tools/node-v20.19.0-linux-x64/bin:$PATH"
export NPM_CONFIG_CACHE="$PWD/.codex-local/npm-cache"
export TMPDIR="$PWD/tmp"
export XDG_CACHE_HOME="$PWD/.codex-local/cache"
test "$(command -v podman)" = "$ISO/bin/podman" || exit 1
test "$(podman info --format '{{.Store.GraphRoot}}')" = "$ISO/storage" || exit 1
# wrapper は run に cgroups=disabled / slirp4netns を付加する。
# 下記は専用名、新規 tmpfs DB、127.0.0.1 の動的 port のみを使う。
make knowledge-provenance-postgres
make knowledge-provenance-old-app
make knowledge-llm-budget-postgres
make knowledge-llm-old-app
```

wrapper は固定 PG ハーネス向けのローカル補助であり、任意コマンドに対する認可境界ではない。既存 store を参照する global option の追加や system/migrate/reset/prune は行わない。wrapper がない場合は、単に PATH guard を外さず分離条件を再構築・再確認する。

### 追加 gate の状況

| 10月25日の検証                                     | 結果                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| clean `npm ci` / `npm ls --all`                    | backend/frontend 成功                                                                                                                          |
| 更新後 audit / `make audit`                        | backend/frontend 全 severity 0。別 worktree の extension は manifest/lock の独立コピーによる監査で 0、元ファイルは変更なし                     |
| focused backend                                    | 54 pass / 0 fail / 0 skip                                                                                                                      |
| backend standard full                              | 2,398 pass / 0 fail / 0 skip                                                                                                                   |
| frontend full + UI-core coverage                   | 114 files / 954 tests pass。既存 threshold すべて通過                                                                                          |
| UI-core coverage                                   | 集計 checker の丸め値: statements 73.61%、branches 66.67%、functions 73.14%、lines 76.38%                                                      |
| backend/frontend lint / format / typecheck / build | 成功                                                                                                                                           |
| Prisma generate / validate / format                | 成功。format はコピーのみ、元 schema と byte 一致                                                                                              |
| OpenAPI export                                     | ignored output へ `--out` 指定、既存 OpenAPI と byte 一致                                                                                      |
| frontend quality gates / build budget              | 成功。initial JS gzip 166.0 KiB                                                                                                                |
| bounded-context dependency / classification        | 成功、違反・未分類・曖昧分類 0                                                                                                                 |
| `make ops-quality` / docs index / image links      | 成功                                                                                                                                           |
| PostgreSQL provenance integration                  | 107 migrations deploy、対象 schema drift なし。ACL、version race、immutable history、mandatory audit rollback の実 DB 検証成功                 |
| provenance old-app                                 | 固定 baseline `fb10a4df864299d55afcad1985c4996d65e3cd16`、98 → 107 migrations、既存 data 保持・旧アプリ CRUD・redaction・health/readiness 成功 |
| PostgreSQL LLM budget/run integration              | 成功。budget/rate race、replay、settlement、held maximum、reconciliation、audit rollback 等の実 DB 検証                                        |
| LLM old-app                                        | 固定 baseline `e6d49dd3d2eda7a41001835b0b776bce4350b486`、旧 seed → 現行 migration/row → 旧アプリ読み取り成功                                  |

provenance integration は既に成功した current build を共有し、generate/build の同時書込みを避けて、既存ハーネスと同じ migrate deploy/diff → integration script → migrate status を実行した。他の3つの DB gate は上記の標準 make target を専用 Podman wrapper 経由で実行した。旧アプリ baseline はハーネスの固定値を維持しており、直前 main の全機能を実行したとの意味ではない。新規 DB コンテナは各検証の終了時に停止・自動回収され、残存コンテナは 0。

独立 correctness review に修正必須指摘はなく、security review の PG 起動条件・古い検証結果の分離・安全な再開コマンドの3指摘は修正後に再確認済み。SMTP 拒否/途中切断、日本語 MIME、TLS/AUTH の追加実 transport 検証は未実施であり、既存正常系・mock 検証から実運用完了とは判断しない。

検証実行時の不成立も保持した。初回 generate/build の複合ログは generate 成功後の build 終了コードが取得できず、成功扱いにせず standalone build を一度再実行して exit 0 を確認した。また、追補を手動で二重登録した docs index check は失敗し、既存の index generator で再生成した後に check を通した。coverage 表示の小数点差（Vitest の切捨てと threshold checker の四捨五入）は同じ新規生成 JSON の分子・分母で確認しており、古い coverage 結果は使用していない。

core/full E2E、release-readiness、GitHub exact-head CI/Copilot/review completeness/cooling は、このローカル検証記録では未完了。共有 WSL の既存プロセスを危険にさらして E2E を起動せず、独立 Draft PR の専用 CI runner 等で追加検証する。確認前に main の脆弱性解消、merge-ready、実環境互換を主張しない。

当日の詳細は ignored `.codex-local/verification/2026-10-25/`。無関係な請求 UI worktree、正本 checkout、PR #2074、既存 container/image metadata の比較結果も同ディレクトリへ保存する。実 credential、実 provider、Sakura、Windows browser 証跡、#2018 は対象外。
