# 依存関係更新の運用ルール

## 目的

依存関係の更新を「安全に・継続的に」実施するための基準を定める。

## 適用範囲

- Backend: `packages/backend`
- Frontend: `packages/frontend`
- CI/Workflow: `.github/workflows/*`

## 分類

- 種別: `runtime` / `dev`
- 重大度: `patch` / `minor` / `major`
- 影響: `低`（互換性維持が想定）/ `中` / `高`（破壊的変更）

## 対応原則

1. **小さく頻繁に**：patch/minor を優先して継続的に取り込む。
2. **統合アップグレードが必要なものは分割しない**（例: Prisma CLI と Client）。
3. **破壊的更新（major）は段階導入**：別Issueで設計/検証を行う。

## 自動マージの基準（原則）

以下を満たす場合は自動マージ対象とする。

- GitHub Actions / CI ツールの `patch/minor`
- `devDependencies` の `patch/minor`
- すべての必須CIが成功

※ 実際の自動化（bot/設定）は別Issueで導入する。

## 手動レビューが必要なケース

- `runtime` 依存の `minor/major`
- Prisma/DB/認証/暗号化/ファイル処理など基盤系
- セキュリティ修正を含む更新（差分確認と影響範囲の記録）

## 運用フロー（標準）

1. Dependabot PR を確認
2. 変更影響の分類（上記の分類）
3. CI 結果確認（`docs/quality/quality-gates.md` に準拠）
4. 必要なら検証結果を `docs/test-results/` に記録
5. マージ（必要に応じてロールバック手順を記載）

## lockfile 更新と CI install 方針

- CI は `npm install` ではなく `npm ci` を使用し、`package-lock.json` と一致しない依存解決を fail させる。
- lockfile 更新が必要な依存更新 PR では、対象 package 配下で `npm install --package-lock-only` または通常の `npm install <package>` を実行し、`package.json` と `package-lock.json` を同一 PR に含める。
- Backend は `packages/backend/package-lock.json`、Frontend は `packages/frontend/package-lock.json` を正とする。
- workflow 側は `actions/setup-node` の `cache: npm` と `cache-dependency-path` で両 lockfile を参照し、lockfile 変更時に cache key が更新されるようにする。
- 依存更新 PR で `npm ci` が fail した場合は、lockfile 不整合として扱い、CIを迂回せず lockfile を再生成して再実行する。

## 例外

- 重大な脆弱性は **即時対応**（緊急Issue作成→最短で対応）
- CI が落ちる場合は **原因を明記**して保留し、別Issueに切り出す

## 関連

- `docs/quality/quality-gates.md`
- Issue #650
