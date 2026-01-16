# テスト戦略（Test Strategy）

## 目的
本リポジトリにおけるテストの役割分担（unit / integration / e2e）と、運用上の原則（flaky回避、証跡、実行環境）を明文化する。

## 基本方針
- まずは「壊していない」ことを継続的に検知できる状態を優先する（高カバレッジは後回し）
- 重要フローは E2E で担保し、仕様分岐や境界条件は unit/integration で早期に検知する
- 手動確認は `docs/test-results/` に記録し、後で比較できる形にする

## テスト種別と役割
### unit（副作用なし）
対象
- 入力バリデーション、変換、判定ロジック（承認条件、RBAC判定、期日計算など）

目的
- 仕様の境界条件を低コストで検知する
- DB/外部I/Fの揺れや起動コストを排除する

実装方針
- Node の test runner（`node --test`）を利用する
- テスト対象モジュールは DB 接続（Prisma）などの副作用を import 時に起こさない設計にする
  - backend の unit テスト配置: `packages/backend/test/*.test.js`

### integration（境界あり / 副作用あり）
対象
- DB（PostgreSQL）を使うリポジトリ層やトランザクションの整合性
- 外部I/F（Drive/AV等）は stub/疑似実装で境界の契約を確認

目的
- DBスキーマ変更やクエリ変更での破綻を検知する

実装方針
- CI: GitHub Actions の `postgres:15` service（direct接続）
- ローカル: Podman DB を基本とする（`scripts/podman-poc.sh`）

### e2e（PoC導線の最小本数）
対象
- 画面操作を伴う PoC 導線（UI→API→DB）を、最小の本数で回帰検知する

目的
- リリース前に「実際に使える」状態であることを保証する

実装方針
- Playwright（`packages/frontend/e2e/*.spec.ts`）
- CI: PR は `E2E_SCOPE=core`、main/schedule は `E2E_SCOPE=full`（`docs/quality/quality-gates.md`）
- 証跡（画面キャプチャ等）は CI では出力しない（`E2E_CAPTURE=0`）
- 証跡が必要な検証はローカルで実施し、`docs/test-results/` に保存する

## flaky 回避（必須）
- 時刻依存を作らない（Clock 注入、固定日付、`Date.now()` を直接使わない）
- 乱数依存を作らない（seed固定）
- 外部ネットワークに依存しない（外部APIは stub/疑似）
- リトライで誤魔化さない（原因を除去する）

## 実行方法（入口）
詳細は `docs/quality/quality-gates.md` を参照。
- unit: `npm run test --prefix packages/backend`
- e2e: `scripts/e2e-frontend.sh`
- smoke（任意）: `scripts/smoke-backend.sh` / `scripts/smoke-chat-attachments-av.sh`
