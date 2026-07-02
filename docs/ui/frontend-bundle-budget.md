# Frontend bundle split and size budget

## 目的

- UX/UI baseline の画面数増加後も、初期表示で不要な画面コードを一括配信しない。
- Vite の large chunk warning を単に `chunkSizeWarningLimit` で隠さず、実際の chunk 分割と予算で管理する。
- 画面追加・大きな依存追加時に、PRレビューで確認できる再現可能な基準を残す。

## 分割方針

1. `packages/frontend/src/pages/App.tsx` のナビゲーション構造は維持し、各画面 section は `React.lazy` の dynamic import で遅延読み込みする。
2. 表示中 section の読み込み中は `role="status"` / `aria-live="polite"` の fallback を表示する。
3. dynamic import 失敗時は section 単位の error boundary で警告を表示し、別 section へ移動した場合は error state を解除する。
4. `packages/frontend/vite.config.ts` では、Vite 8 / Rolldown の `build.rolldownOptions.output.manualChunks` により主要 vendor を以下へ分離する。
   - `react-vendor`
   - `design-system`
   - `tanstack-vendor`
   - `markdown-vendor`
   - その他 `vendor`
5. 画面別 chunk は、初期画面以外では該当 section を開いた時点で取得する。

## Size budget

`npm run build --prefix packages/frontend` の後に、以下を実行する。

```bash
npm run build:budget --prefix packages/frontend
```

現行の budget は `packages/frontend/scripts/check-build-budget.cjs` で管理する。

| 項目                                          |    上限 | 目的                                         |
| --------------------------------------------- | ------: | -------------------------------------------- |
| Entry JS (`index-*.js`)                       | 100 KiB | App shell が再肥大化していないことを検知する |
| Initial JS total (`script` + `modulepreload`) | 650 KiB | 初期表示で必要な JS 総量を管理する           |
| Initial JS gzip total                         | 220 KiB | ネットワーク転送量の回帰を検知する           |
| Individual JS chunk                           | 500 KiB | Vite large chunk warning の再発を検知する    |

## 2026-07-02 baseline

Issue #1849 の実装時点では、分割前の `dist/assets/index-*.js` は 1,300,008 bytes（gzip 346,942 bytes）だった。

分割後は以下になった。

| 指標                     |                               Before |                              After |
| ------------------------ | -----------------------------------: | ---------------------------------: |
| Entry JS                 | 1,300,008 bytes / gzip 346,942 bytes |   53,150 bytes / gzip 15,966 bytes |
| Initial JS total         | 1,300,008 bytes / gzip 346,942 bytes | 528,750 bytes / gzip 160,520 bytes |
| Largest JS chunk         |                      1,300,008 bytes |                      296,583 bytes |
| Vite large chunk warning |                                 発生 |                               解消 |

詳細な build asset 一覧は `docs/test-results/2026-07-02-uiux-followup-bundle-chunk/` を参照する。

## レビュー時チェック

- 新規画面 section を `App.tsx` に追加する場合、原則として eager import ではなく `React.lazy` / dynamic import で追加する。
- 新規の大きな npm dependency を追加した場合、`vite.config.ts` の manual chunk 分類と `build:budget` の結果を確認する。
- `chunkSizeWarningLimit` を上げるだけの変更は原則禁止とする。上げる場合は、代替策と残余リスクを PR に明記する。
- `build:budget` が失敗する場合は、失敗項目を解消するか、Issueで合意した予算変更を同一PRに含める。
