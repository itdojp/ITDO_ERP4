# UI/UX visual regression 運用

## 目的

Phase 1〜12 の UX/UI screenshot evidence を、手動確認用の画像だけでなく、意図しないレイアウト崩れを検出する回帰テストとして利用する。

## 対象画面

初期 baseline は、Phase 1〜12 から各 1 画面を代表として選定する。全画面を一度に厳格比較すると、テスト時間と false positive が増えるため、まずは横断 primitive / token / lazy loading の影響を受けやすい代表画面を固定する。

| Phase | 代表画面                | Navigation label          | Snapshot                          |
| ----- | ----------------------- | ------------------------- | --------------------------------- |
| 1     | 日報 + ウェルビーイング | `日報 + ウェルビーイング` | `phase-01-daily-report.png`       |
| 2     | 請求                    | `請求`                    | `phase-02-invoices.png`           |
| 3     | 承認一覧                | `承認`                    | `phase-03-approvals.png`          |
| 4     | Reports                 | `レポート`                | `phase-04-reports.png`            |
| 5     | ルームチャット          | `ルームチャット`          | `phase-05-room-chat.png`          |
| 6     | 顧客/業者マスタ         | `マスタ管理`              | `phase-06-master-data.png`        |
| 7     | Settings                | `設定`                    | `phase-07-admin-settings.png`     |
| 8     | PDFファイル一覧         | `PDF管理`                 | `phase-08-pdf-files.png`          |
| 9     | アクセス棚卸し          | `アクセスレビュー`        | `phase-09-access-reviews.png`     |
| 10    | ドキュメント送信ログ    | `送信ログ`                | `phase-10-document-send-logs.png` |
| 11    | 期間締め                | `期間締め`                | `phase-11-period-locks.png`       |
| 12    | Dashboard               | `ホーム`                  | `phase-12-dashboard.png`          |

## Baseline の場所

Playwright の screenshot snapshot を利用する。baseline は以下にコミットする。

```text
packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/
```

テスト本体は以下。

```text
packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts
```

## ローカル実行

比較のみ:

```bash
make ui-visual-regression
```

baseline 更新:

```bash
make ui-visual-regression-update
```

`make` を使わない場合:

```bash
./scripts/e2e-uiux-visual-regression.sh
./scripts/e2e-uiux-visual-regression.sh --update-snapshots
```

Podman DB のポート競合時は、既存 E2E と同様に `E2E_PODMAN_HOST_PORT` を指定する。

```bash
E2E_PODMAN_HOST_PORT=55463 make ui-visual-regression
```

## 安定化方針

- `UIUX_VISUAL_REGRESSION=1` の明示時のみ比較する。通常の `E2E_SCOPE=core/full` では visual spec は実行対象外、または skip される。
- browser clock を `2026-07-02T09:00:00+09:00` に固定し、日付表示差分を抑制する。
- Playwright context は `locale=ja-JP`、`timezoneId=Asia/Tokyo`、`viewport=1280x720`、`colorScheme=light` に固定する。
- screenshot 取得時は animation / transition / caret を無効化する。
- 初期比較許容値は `maxDiffPixelRatio=0.02`、`threshold=0.2` とし、pixel-level rendering 差分を吸収する。
- Phase 8 / PDF管理はファイルID・更新時刻を含む一覧行が backend seed / 実行時刻に依存するため、`tbody` を mask し、サマリー・検索条件・一覧レイアウト枠を比較対象にする。
- Phase 10 / 11 では visual regression 用にデータ作成を行わず、安定した summary / list 初期状態を対象にする。

## CI 運用

GitHub Actions には手動実行用 workflow を追加している。

```text
.github/workflows/uiux-visual-regression.yml
```

運用方針:

- PR 必須 gate にはしない。画像比較はブラウザ/フォント/OS 差分に敏感なため、最初から required check 化しない。
- UI primitive、layout、navigation、theme、workflowUx、bundle/lazy loading など visual impact が大きい変更では、reviewer が必要に応じて `UIUX Visual Regression` workflow を手動実行する。
- failure 時は `packages/frontend/test-results/**` と E2E backend/frontend log を artifact として確認する。
- 差分が意図した変更であれば、ローカルで `make ui-visual-regression-update` を実行して baseline を更新し、PR に含める。

## Baseline 更新レビュー基準

baseline PNG の変更は、以下を PR 本文またはコメントに記録する。

1. 変更対象画面と変更理由。
2. 差分が仕様変更・UI改善として意図したものか。
3. `make ui-visual-regression` または同等コマンドの pass 結果。
4. 既存の `docs/test-results/` 証跡更新要否。

## トラブルシュート

- snapshot が存在しない: `make ui-visual-regression-update` で生成する。
- 画像差分が OS / font 差分に見える: artifact の `expected/actual/diff` を確認し、必要なら tolerance または mask 対象を限定的に追加する。
- 動的テキストが差分になる: browser clock 固定で吸収できない backend 由来の日時・ID は、対象画面の初期状態化または locator mask を検討する。
- default E2E で visual spec が邪魔になる: `UIUX_VISUAL_REGRESSION=1` を設定しない限り skip される設計を維持する。
