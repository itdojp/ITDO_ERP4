# リリース前チェックリスト

## 0. 標準入口

Repo-side readiness は手順の転記ではなく、次の runner を正本にする。

```bash
RELEASE_E2E_SCOPE=core make release-readiness
RELEASE_E2E_SCOPE=full make release-readiness
RELEASE_E2E_SCOPE=full make release-readiness-record
```

- `make release-readiness` は required check の `PASS` / `FAIL` / `SKIP`、exit code、実行時間、raw log 参照先を `tmp/release-readiness/` に記録する。
- `make release-readiness-record` は clean checkout かつ `RELEASE_E2E_SCOPE=full` の場合のみ `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` を生成する。既定の日付は `RELEASE_TIMEZONE=Asia/Tokyo` のJST基準とする。
- `core` E2E はPR相当の限定確認であり、release Go 用の正式証跡とは扱わない。
- `tmp/release-readiness/*/summary.md` は限定・調査用証跡であり、release Go の正式 repo-side 証跡は `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` のみとする。
- `--allow-dirty` / `RELEASE_ALLOW_DIRTY=1` は調査用の暫定実行だけに使い、正式証跡作成では使用しない。
- runner の `CI job` 欄は GitHub Actions との対応先を示す参照情報であり、GitHub Actions workflow をバイト単位で再実行するものではない。PR/merge判断では GitHub Actions の required checks と Link Check / lychee の実行結果も別途正本として確認する。
- runner が `PASS` でも、対象環境依存の #1426 / #544 / #1432 が未完了なら総合Go判定は `NO-GO` とする。
- #1426 / #544 / #1432 の外部証跡が揃ったことは `make production-readiness-external-evidence-check` で確認し、手順は `docs/ops/production-readiness-external-evidence.md` を正本にする。

## 1. 事前準備

- 変更内容/影響範囲の把握（PR/Issue/リリースノート）
- DBバックアップの取得と復元手順の確認
- 必須環境変数の確認（PDF/メール/認証/外部連携）
- 監視/アラートの通知先確認
- `git status --porcelain` が clean であることを確認（runner は dirty checkout を既定で失敗扱いにする）

## 2. Repo-side readiness

`make release-readiness` は以下を実行し、失敗時に非0で終了する。

- backend/frontend dependency install
- backend/frontend lint / format-check / typecheck / build / test
- backend bounded-context gate
- prisma generate / format / validate
- auth coverage gate
- integrations coverage gate
- blocking data-quality gate
- backend/frontend dependency audit（high/critical）
- docs image/link/index check
- ops docs/scripts check
- OpenAPI snapshot check
- secret scan
- frontend E2E（`RELEASE_E2E_SCOPE=core|full`）

## 3. DB移行

- `prisma migrate deploy` の実行計画を確認
- 事前/事後のスキーマ差分とロールバック手順の確認
- 移行後の整合チェック（件数/合計）を実行

## 4. スモーク/回帰

- QA手順: `docs/requirements/qa-plan.md`
- フロントE2E: `scripts/e2e-frontend.sh`（証跡が不要なら `E2E_CAPTURE=0`）
- バックエンドスモーク: `scripts/smoke-backend.sh`

## 5. Target-environment readiness

Repo-side runner だけでは本番準備完了としない。少なくとも以下の対象環境証跡を別途確認する。

- #1426 ActionPolicy `phase3_strict` 対象環境 trial / cutover / rollback
- #544 S3 バックアップ確定値と実 backup → upload → download → restore 検証
- #1432 給料らくだ・経理上手くんαの現物CSVテンプレート／サンプル回収
- 上記3件が `docs/test-results/` に `pass` 証跡として揃った後、`make production-readiness-external-evidence-check` が exit code 0 であることを確認する

## 6. 監査/運用

- 監査ログの出力確認（検索/エクスポート）
- アラートの通知確認（メール/ダッシュボード）
- バックアップの定期実行設定を確認

## 7. ロールバック

- リリース前のバックアップからリストアできることを確認
- アプリ/DBをリリース前の状態に戻す手順を明記

## 8. 事後確認

- 主要画面の動作確認（ダッシュボード/工数/請求/承認/レポート）
- 重要ログの監視（エラー率/タイムアウト/遅延）
- 問題発生時の連絡/判断フロー確認
