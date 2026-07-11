# データ品質チェック スクリプト

目的: 主要なデータ不整合を、PRでブロックする決定的検査と、業務判断を含む警告へ分離して検出する。

## 実体

- runner: `scripts/data-quality-check.mjs`
- 正常 fixture: `scripts/fixtures/data-quality-valid.json`
- blocking 負例 fixture: `scripts/fixtures/data-quality-invalid.json`
- advisory 警告 fixture: `scripts/fixtures/data-quality-advisory-warning.json`

## 通常実行

```bash
npm run data-quality:test --prefix packages/backend
npm run data-quality:blocking --prefix packages/backend
npm run data-quality:advisory --prefix packages/backend
```

出力先:

- `tmp/data-quality-blocking.json`
- `tmp/data-quality-blocking.md`
- `tmp/data-quality-advisory.json`
- `tmp/data-quality-advisory.md`

## 負例実行

```bash
node scripts/data-quality-check.mjs \
  --mode=blocking \
  --fixture scripts/fixtures/data-quality-invalid.json \
  --output tmp/data-quality-invalid.json \
  --summary tmp/data-quality-invalid.md
```

期待値: blocking finding を検出し、終了コード 1。

```bash
node scripts/data-quality-check.mjs \
  --mode=advisory \
  --fixture scripts/fixtures/data-quality-advisory-warning.json \
  --output tmp/data-quality-advisory-warning.json \
  --summary tmp/data-quality-advisory-warning.md
```

期待値: advisory warning を記録し、終了コード 0。

## 旧SQL雛形からの変更点

旧雛形は PoC 初期の手動実行想定で、旧テーブル名SQLと `/tmp/data-quality-report.csv` 出力を前提としていた。現行CIでは以下へ変更する。

- CI は production DB へ接続しない。
- 合成 fixture を使い、決定的に再現できる正常系・不正系を自動検証する。
- `/tmp` ではなくリポジトリ配下の `tmp/` へ report/summary を出力する。
- blocking runner は finding 検出時に非0終了し、`CI / data-quality` を失敗させる。
- advisory runner は warning を JSON / Markdown に残すが、warning のみでは非0終了しない。

## 出力項目

JSON report と Markdown summary には、少なくとも以下を含める。

- check名
- severity（blocking/advisory）
- status（pass/fail/warning）
- 件数
- 主要識別子サンプル
- 再現方法

## 今後の拡張

DB接続型の定期監視を追加する場合も、本runnerの分類表と出力形式を維持する。production data をCI fixtureとしてコミットしない。
