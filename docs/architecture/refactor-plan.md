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

- `routes/projects.ts` は #1912 で project lifecycle / hierarchy / membership / reassignment orchestration を `application/projects/useCases.ts` へ抽出済み。#1913 で task/WBS/dependency/baseline route を `routes/projects/tasks.ts` へ分離し、DB orchestration を `application/projects/taskUseCases.ts` へ抽出済み。#1914 で milestone/recurring template route を `routes/projects/milestones.ts` / `recurring.ts` へ分離し、DB orchestration を `application/projects/milestoneUseCases.ts` / `recurringTemplateUseCases.ts` へ抽出済み。#1915 で projects coverage最終gateを追加し、後続は残る周辺 route/service 責務を別Issueで扱う
- `scripts/migrate-po.ts` の変換/パース処理を `src/migration/` へ分割
- `routes/integrations.ts` と `routes/auth.ts` は service / route 分割後に default 1500行 gate へ統合済みのため、今後は `docs/quality/refactoring-hotspots.md` の残責務を service / adapter 単位で継続分割する。`routes/auth.ts` は #1908 で coverage scope completeness と baseline 閾値を固定済み。`routes/chatRooms.ts` は #1911 で default 1500行 gate と chat coverage scope に統合済み。`routes/chat.ts` 側は #1958 で ack / attachment route module と attachment application use case へ分割し、default 1500行 gate に統合済み。`routes/reportSubscriptions.ts` は #1959 で schedule正規化 / subscription CRUD / run / delivery retry / history orchestration を Fastify非依存 application service へ移し、backend route temporary max-lines allowlist を空にした
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
- 2026-07-13: `routes/chatRooms.ts` をdefault 1500行gateへ統合し、chat top-level route/route module/service/application/adapter subset の `coverage:chat:check` とscope completeness/stale entry検出を追加。baseline閾値は statements/lines 53.4%、branches 59.4%、functions 70.1%（Issue #1911）
- 2026-07-13: `routes/projects.ts` の project lifecycle / hierarchy / membership / reassignment orchestration を `application/projects/useCases.ts` へ抽出し、Org & Project→Notifications/Workflow 直接import3件を削減。route本体は 2043 行から 1279 行へ縮小しdefault 1500行gateへ統合（Issue #1912）
- 2026-07-13: project task / dependency / baseline routeを `routes/projects/tasks.ts` へ分離し、DB orchestrationを `application/projects/taskUseCases.ts` へ抽出。親子タスクcycle判定をpure helper化し、`routes/projects.ts` を 537 行まで縮小（Issue #1913）
- 2026-07-13: project milestone CRUD / draft invoice sync と recurring template / generation-log listing を `routes/projects/milestones.ts` / `recurring.ts`、`application/projects/milestoneUseCases.ts` / `recurringTemplateUseCases.ts` へ分離。`routes/projects.ts` を 195 行まで縮小し、milestone-billing / template-job 境界を証跡化（Issue #1914）
- 2026-07-13: `coverage:projects:check` を既存必須 `CI / backend` job に追加し、Org & Project context registry、`application/projects/**`、`services/dueDateRule.ts` の coverage scope completeness と baseline閾値（statements/lines 66.2%、branches 59.5%、functions 77.8%）を固定。`projects.ts` は temporary max-lines allowanceなしでdefault 1500行gate内を維持（Issue #1915）
- 2026-07-13: `routes/timeEntries.ts` の patch / submit / reassign における ActionPolicy / Approval / Notification / PeriodLock / Reassignment / Audit orchestration を `application/timeEntries/useCases.ts` へ抽出し、routeから対象cross-context直接import 7件を削除。baselineは45件から38件へ縮小（Issue #1916）
- 2026-07-13: `routes/invoices.ts` の submit / mark-paid における ActionPolicy / Approval / Notification / Audit orchestration を `application/invoices/useCases.ts` へ抽出し、routeから対象cross-context直接import 5件を削除。baselineは38件から33件へ縮小（Issue #1917）
- 2026-07-13: `routes/estimates.ts` の submit における ActionPolicy / Approval / Notification / Audit orchestration を `application/estimates/useCases.ts` へ抽出し、routeから対象cross-context直接import 5件を削除。baselineは33件から28件へ縮小（Issue #1918）
- 2026-07-13: `routes/purchaseOrders.ts` の submit における ActionPolicy / Approval / Notification / Audit orchestration を `application/purchaseOrders/useCases.ts` へ抽出し、routeから対象cross-context直接import 5件を削除。baselineは28件から23件へ縮小（Issue #1919）
- 2026-07-14: `routes/chat.ts` の ack request / attachment route を分割し、attachment scan/store/audit orchestration を `application/chat/chatAttachmentUseCases.ts` へ移動。`routes/chat.ts` は 738 行、temporary max-lines allowanceなし。chat coverage scope completeness と line gate/no-allowance testを更新（Issue #1958）
- 2026-07-14: `routes/reportSubscriptions.ts` の schedule normalize / subscription CRUD / manual run / scheduled run / retry / delivery history orchestration を `application/reportSubscriptions/useCases.ts` へ抽出。routeは HTTP schema / RBAC / DTO / response mapping に限定し、151 行で default 1500行 gate 内。現行の `/jobs/report-subscriptions/run` は schedule/timezone/nextRunAtを解釈せず cron側頻度制御に依存する仕様を維持し、backend route temporary max-lines allowlistを空にした（Issue #1959）
- 2026-07-14: `scripts/migrate-po.ts` の CSV/JSON input parsing、UTF-8 decode boundary、scalar normalization、CSV required-field handling、duplicate detectionを `migration/poInput.ts` へ抽出。既存 `migration/legacyIds.ts` の deterministic UUIDv5 ID生成を固定値testで補強し、pure moduleがFS/Prisma/process/console/clock/randomへ依存しないことをtestで検出（Issue #1961）
- 2026-07-14: `scripts/migrate-po.ts` の entity mapping、pure validation、planned-id generation、summary/error report formattingを `migration/poDomain.ts` へ抽出。script本体は 2764 行から 2282 行へ縮小し、DB依存reference validation / transaction / integrity checkは orchestration 側に維持（Issue #1962）
- 2026-07-14: `scripts/migrate-po.ts` を 18 行のcomposition rootへ縮小し、CLI option/helpを `migration/poCli.ts`、filesystem inputを `migration/poInputReader.ts`、DB import orchestrationを `migration/poImporters*.ts`、pipeline/integrityを `migration/poRunner.ts` に分離。synthetic fixture dry-run/apply commandを追加し、既存 `CI / backend` job内でlocal PostgreSQL serviceを使って検証する（Issue #1963）
- 2026-07-13: `routes/vendorDocs.ts` の vendor invoice update/PO link/submit における ActionPolicy / Approval / Notification orchestration を `application/vendorDocs/useCases.ts` へ抽出し、routeから対象cross-context直接import 5件を削除。`vendorDocs.ts` はdefault 1500行gate内へ戻し、baselineは23件から18件へ縮小（Issue #1920）
- 2026-07-13: `routes/leave.ts` の submit における ActionPolicy / Evidence / Approval / Notification orchestration を `application/leave/useCases.ts` へ抽出し、routeから対象cross-context直接import 6件を削除。個人情報・健康情報 payload を evidence normalization に含めず、baselineは18件から12件へ縮小（Issue #1921）
- 2026-07-13: `routes/send.ts` の invoice / estimate / purchase-order send と document-send retry における ActionPolicy / Evidence gate / send audit orchestration を `application/send/useCases.ts` へ抽出し、routeから対象cross-context直接import 4件を削除。guard→PDF→send→log/audit順序、retry cooldown/idempotency、Message-ID伝播を unit/route tests で固定し、baselineは12件から8件へ縮小（Issue #1922）
- 2026-07-13: `dailyReports` の通知副作用を `application/dailyReports/sideEffects.ts` へ、休暇予定通知ジョブを `application/leave/upcomingNotifications.ts` へ移し、Documents→Notifications の残存2件を削除。`dependency-cruiser-known-violations.json` を空配列にし、空baselineでも新規Documents→Notifications直接importがfailするnegative testを追加（Issue #1928 repo-side）

## 今回のP0実装（Issue #643）

- `packages/backend/src/services/authContext.ts` を追加し、ユーザ取得/401 の入口を共通化
- `routes/search.ts`, `routes/notifications.ts`, `routes/push.ts` で共通化を適用
