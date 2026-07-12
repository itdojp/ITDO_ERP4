# リファクタリング計画（段階案）

## 目的

- 変更容易性（保守性）を下げている原因を整理し、段階的に改善する
- 既存PoCの挙動を維持したまま、安全に構造を整える

## 参照

- 品質目標: `docs/quality/quality-goals.md`
- 品質ゲート: `docs/quality/quality-gates.md`
- Hotspots: `docs/quality/refactoring-hotspots.md`
- Frontend server-state decision: `docs/architecture/frontend-server-state.md`

## 現状の課題（要約）

1. **責務の混在**
   - ルートやスクリプトに「I/O + ドメイン + ユーティリティ」が混在しやすい
2. **横断関心事の入口が分散**
   - 認可/入力検証/エラー整形/ログがルート内で重複しがち
3. **検証コストの高さ**
   - 影響範囲が大きい箇所（projects/migrate）が肥大化しやすい

## 段階計画

### Phase 0（低リスク・小さく始める）

目的: 共通化の入口を作り、変更の“軸”を揃える。

- 認証/ユーザ取得の入口を共通化（`requireUserContext`）
- 共通処理の場所を `services/` に集約
- 影響範囲を限定し、**数ファイルの置換に留める**
- bounded-context 分類正本（`packages/backend/bounded-context-registry.cjs`）と `make bounded-context-coverage-check` を維持し、新規route/serviceの未分類・重複分類・stale patternをCIでブロックする
- contextではない横断要素は `application-orchestration` / `shared-kernel` / `infrastructure` / 明示除外として理由付きで分類し、`shared` や `excluded` への大量退避でdirection gateを形骸化しない
- Documents route が Workflow / Notifications 等へ直接依存する場合は、`src/application/<domain>/` の Fastify非依存 use case に orchestration を集約し、routeはHTTP境界、applicationはtransaction/port順序、adapterは既存service呼び出しを担う。`src/application/**` は bounded-context coverage gate の対象とする

### Phase 1（ホットスポットの分割）

目的: 大きな責務を「純粋関数」と「I/O」に分離する。

- `routes/projects.ts` のドメインロジックを `services/` へ抽出
- `scripts/migrate-po.ts` の変換/パース処理を `src/migration/` へ分割
- `routes/integrations.ts` と `routes/auth.ts` は service / route 分割後に default 1500行 gate へ統合済みのため、今後は `docs/quality/refactoring-hotspots.md` の残責務を service / adapter 単位で継続分割する。`routes/auth.ts` は #1908 で coverage scope completeness と baseline 閾値を固定済み。`routes/chatRooms.ts` は同ドキュメントの `Route max-lines gate` allowlist cap を下げながら、機能単位の service / adapter へ抽出する
- `routes/validators.ts` は barrel に留め、TypeBox schema は `routes/validators/*.ts` のドメイン別ファイルへ追加する
- frontend は `AdminSettings.tsx` / `RoomChat.tsx` を責務単位へ分割し、`docs/architecture/frontend-server-state.md` の server-state 導入判断に沿って hook/query 境界を段階抽出する

### Phase 2（横断関心事の統一）

目的: 認可/入力検証/監査ログの統一と再利用性向上。

- 認可の入口（RBAC/ABAC）を一箇所に寄せる
- バリデーションの共通ユーティリティ化（TypeBox/スキーマの統一）
- 監査ログイベントスキーマの統一

## 完了条件（Phase 0）

- `requireUserContext` などの共通入口が導入され、複数ルートで利用されている
- 既存の PoC/CI/E2E が破綻しない

- 2026-07-12: `routes/expenses.ts` の submit / mark-paid / unmark-paid / reassign orchestration を `application/expenses/useCases.ts` へ抽出し、ActionPolicy/Approval/Notification/PeriodLock/Reassignment の直接import 7件を bounded-context baseline から削除。route allowlist cap から `expenses.ts` を除外（Issue #1905）
- 2026-07-13: auth route modules をdefault 1500行gate内に保ち、`coverage:auth:check` のscope completeness/stale entry検出とbaseline閾値（statements/lines 89.7%、branches 70.5%、functions 97.9%）を固定（Issue #1908）

## 今回のP0実装（Issue #643）

- `packages/backend/src/services/authContext.ts` を追加し、ユーザ取得/401 の入口を共通化
- `routes/search.ts`, `routes/notifications.ts`, `routes/push.ts` で共通化を適用
