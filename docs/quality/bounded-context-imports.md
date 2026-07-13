# Bounded-context import direction gate

## 目的

docs/architecture/greenfield-ideal-design.md の「1.1 バウンデッドコンテキスト（モジュール分割）」で定義した境界を、backend の import 方向として CI で検査する。

このゲートは既存の密結合を一度に直すものではなく、既存違反を baseline として固定し、新規違反を PR でブロックするための段階導入である。

## CI gate

- 分類正本: `packages/backend/bounded-context-registry.cjs`
- import方向設定: `packages/backend/dependency-cruiser.config.cjs`
- 既存違反 baseline: `packages/backend/dependency-cruiser-known-violations.json`
- 方向検査コマンド: `npm run arch:bounded-context --prefix packages/backend`
- 分類coverage検査コマンド: `make bounded-context-coverage-check` または `npm run arch:bounded-context:coverage --prefix packages/backend`
- CI: `.github/workflows/ci.yml` の `lint` job で両方を実行する

`--ignore-known dependency-cruiser-known-violations.json` により、既存違反は記録済みとして扱う。baseline にない新しい違反は dependency-cruiser が error として検出し、CI を失敗させる。

分類coverage検査は `packages/backend/src/routes/**/*.ts`、`packages/backend/src/services/**/*.ts`、`packages/backend/src/application/**/*.ts` を対象に、次を非0終了で検出する。

- bounded context / application orchestration / shared-kernel / infrastructure / generated / explicit exclusion のいずれにも属さないファイル
- 複数の bounded context に一致するファイル
- bounded context と layer/exclusion の重複分類
- 現在存在する `src/**/*.ts` に一致しない stale pattern
- `generated` / `excluded` entry に理由がない分類

出力は通常の安定text形式に加え、`--format json` で機械処理可能なJSONを出力できる。

## 理想設計との対応

| 順位 | 理想設計上の bounded context | 方針                                                                                                                                                                            |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Identity & Access            | 認証/認可、ユーザ/グループ、SCIM、ポリシー評価。最も基礎的な文脈として上位文脈へ直接依存しない。                                                                                |
| 2    | Org & Project                | 組織、プロジェクト階層、メンバー。業務文書や workflow へ直接依存しない。                                                                                                        |
| 3    | Master Data                  | 顧客/業者/税率/勘定科目等。取引文書や workflow へ直接依存しない。                                                                                                               |
| 4    | Documents                    | 見積/請求/発注/仕入/経費/休暇/工数など。workflow / notifications との結合は段階的に application service / event / adapter へ寄せる。                                            |
| 5    | Workflow                     | 申請/承認/差戻し/ack/ロック。chat / notifications / evidence への直接依存は段階的に adapter 化する。                                                                            |
| 6    | Evidence & References        | 内部参照/外部URL、証跡パック。chat / notifications / integrations への直接依存を避ける。                                                                                        |
| 7    | Chat                         | ルーム、投稿、メンション、ack。notifications への直接依存は段階的に event 化する。                                                                                              |
| 8    | Notifications                | App通知、メール、Push、ダイジェスト。integrations / ops への直接依存を避ける。                                                                                                  |
| 9    | Integrations                 | 外部システムとのデータ連携: 会計ICSエクスポート、勤怠締め、統合調整、法定給与実績など。外部トランスポート(S3/outbound通知)は `infrastructure` layer。ops への直接依存を避ける。 |
| 10   | Ops                          | バッチ、バックアップ、監視、移行。最上位の運用文脈。                                                                                                                            |

dependency-cruiser 設定では、順位が小さい文脈から順位が大きい文脈への直接 import を禁止する。順位が大きい文脈から基礎文脈への参照は許容する。shared utility / DB / audit など横断要素は `bounded-context-registry.cjs` の layer として明示分類し、分類漏れをcoverage gateで検知する。

## 分類の追加・変更手順

1. 新規 `routes/**/*.ts` / `services/**/*.ts` / `application/**/*.ts` を追加する場合、同じPRで `packages/backend/bounded-context-registry.cjs` へ分類を追加する。
2. 既存patternを削除・変更した場合、`make bounded-context-coverage-check` で stale / 未分類 / 重複がないことを確認する。
3. `generated` または `excluded` として分類する場合、`reason` を必須とし、なぜ bounded context / layer ではないかを説明する。
4. dependency-cruiser baseline を追加する条件は、分類で新たに顕在化した方向違反が小規模PRで安全に解消できず、個別Issueで解消方針・件数・理由が追跡される場合に限る。baseline への一括追加だけで完了扱いにしない。
5. baseline を削減したPRでは、対象importを解消した後に `npx depcruise-baseline --config dependency-cruiser.config.cjs --output-to dependency-cruiser-known-violations.json src` を `packages/backend` で再実行し、削除差分のみをレビューする。

## Application orchestration pattern

Documents route が Workflow / Notifications / Evidence など後段 context を直接 import する場合は、route から直接依存を外し、`src/application/<domain>/` 配下の application orchestration use case に集約する。

```text
routes/<domain>.ts
  -> application/<domain>/*UseCase
       -> domain services / repository
       -> WorkflowPort / NotificationPort / AuditPort
       -> default adapter（既存 service 呼び出し）
```

実装ルール:

- route は HTTP schema、preHandler、DTO抽出、`auditContextFromRequest` などHTTP境界に残す。
- application use case は Fastify `request` / `reply` を受け取らず、actor・audit context・DTO・port overridesを受け取る。
- default adapter は既存同期挙動、transaction順序、fail-open/fail-closed方針を維持する。
- test doubleを注入できるportsを用意し、cross-context呼び出し順序とerror mappingをunit/route testで固定する。
- 新しい application file は `application-orchestration` layerとして registry に分類し、coverage gateで未分類を検出する。

#1905 では `src/application/expenses/useCases.ts` を参照実装とし、`submit` / `mark-paid` / `unmark-paid` / `reassign` の ActionPolicy、Approval、Notification、PeriodLock、Reassignment、Audit orchestration をrouteから移した。

## 既存違反 baseline

2026-07-13 時点の既存違反は 28 件。#1905 で `src/routes/expenses.ts` の documents→workflow/notifications 直接依存 7 件を application orchestration へ移し、#1910 で chat→notifications 直接依存 5 件を削減した。#1912 では `src/routes/projects.ts` の Org & Project→Notifications/Workflow 直接依存 3 件（`appNotifications.ts` / `periodLock.ts` / `reassignmentLog.ts`）を `src/application/projects/useCases.ts` へ移し、routeからの直接importを解消した。#1913 では project task/dependency/baseline route submoduleを Org & Project に分類し、task orchestrationを `src/application/projects/taskUseCases.ts` へ移しても既知違反数45件を増やさないことを確認した。#1914 でも milestone/recurring route submoduleを Org & Project、application use caseを application-orchestration layerに分類済みの既存patternでカバーし、既知違反数45件を増やさないことを確認した。#1915 では Org & Project context registry と `coverage:projects` scope の差分を `coverageThresholds.test.js` で検出し、既知違反数45件を増やさずに projects coverage gate を追加した。#1916 では `src/routes/timeEntries.ts` の ActionPolicy / Approval / Notification / PeriodLock / Reassignment orchestration を `src/application/timeEntries/useCases.ts` へ移し、Documents→Workflow/Notifications 直接依存 7 件を baseline から削除した。#1917 では `src/routes/invoices.ts` の ActionPolicy / Approval / Notification orchestration を `src/application/invoices/useCases.ts` へ移し、Documents→Workflow/Notifications 直接依存 5 件を baseline から削除した。#1918 では `src/routes/estimates.ts` の submit-for-approval における ActionPolicy / Approval / Notification orchestration を `src/application/estimates/useCases.ts` へ移し、Documents→Workflow/Notifications 直接依存 5 件を baseline から削除した。

内訳は以下のとおり。

| rule                                      | count |
| ----------------------------------------- | ----: |
| bounded-context-documents-direction       |    22 |
| bounded-context-identity-access-direction |     2 |
| bounded-context-workflow-direction        |     4 |

### 既存違反一覧

|   # | rule                                      | from                                         | to                                     |
| --: | ----------------------------------------- | -------------------------------------------- | -------------------------------------- |
|   1 | bounded-context-documents-direction       | `src/routes/dailyReports.ts`                 | `src/services/appNotifications.ts`     |
|   2 | bounded-context-documents-direction       | `src/routes/estimates.ts`                    | `src/services/actionPolicy.ts`         |
|   3 | bounded-context-documents-direction       | `src/routes/estimates.ts`                    | `src/services/actionPolicyAudit.ts`    |
|   4 | bounded-context-documents-direction       | `src/routes/estimates.ts`                    | `src/services/actionPolicyErrors.ts`   |
|   5 | bounded-context-documents-direction       | `src/routes/estimates.ts`                    | `src/services/appNotifications.ts`     |
|   6 | bounded-context-documents-direction       | `src/routes/estimates.ts`                    | `src/services/approval.ts`             |
|   7 | bounded-context-documents-direction       | `src/routes/leave.ts`                        | `src/services/actionPolicy.ts`         |
|   8 | bounded-context-documents-direction       | `src/routes/leave.ts`                        | `src/services/actionPolicyAudit.ts`    |
|   9 | bounded-context-documents-direction       | `src/routes/leave.ts`                        | `src/services/actionPolicyErrors.ts`   |
|  10 | bounded-context-documents-direction       | `src/routes/leave.ts`                        | `src/services/annotationReferences.ts` |
|  11 | bounded-context-documents-direction       | `src/routes/leave.ts`                        | `src/services/appNotifications.ts`     |
|  12 | bounded-context-documents-direction       | `src/routes/leave.ts`                        | `src/services/approval.ts`             |
|  13 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`               | `src/services/actionPolicy.ts`         |
|  14 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`               | `src/services/actionPolicyAudit.ts`    |
|  15 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`               | `src/services/actionPolicyErrors.ts`   |
|  16 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`               | `src/services/appNotifications.ts`     |
|  17 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`               | `src/services/approval.ts`             |
|  18 | bounded-context-documents-direction       | `src/routes/send.ts`                         | `src/services/actionPolicy.ts`         |
|  19 | bounded-context-documents-direction       | `src/routes/send.ts`                         | `src/services/actionPolicyAudit.ts`    |
|  20 | bounded-context-documents-direction       | `src/routes/send.ts`                         | `src/services/actionPolicyErrors.ts`   |
|  21 | bounded-context-documents-direction       | `src/routes/send.ts`                         | `src/services/approvalEvidenceGate.ts` |
|  22 | bounded-context-documents-direction       | `src/routes/vendorDocs.ts`                   | `src/services/actionPolicy.ts`         |
|  23 | bounded-context-documents-direction       | `src/routes/vendorDocs.ts`                   | `src/services/actionPolicyAudit.ts`    |
|  24 | bounded-context-documents-direction       | `src/routes/vendorDocs.ts`                   | `src/services/actionPolicyErrors.ts`   |
|  25 | bounded-context-documents-direction       | `src/routes/vendorDocs.ts`                   | `src/services/appNotifications.ts`     |
|  26 | bounded-context-documents-direction       | `src/routes/vendorDocs.ts`                   | `src/services/approval.ts`             |
|  27 | bounded-context-documents-direction       | `src/services/leaveUpcomingNotifications.ts` | `src/services/appNotifications.ts`     |
|  28 | bounded-context-identity-access-direction | `src/plugins/auth.ts`                        | `src/services/agentRuns.ts`            |
|  29 | bounded-context-identity-access-direction | `src/routes/scim.ts`                         | `src/services/personalGaChatRoom.ts`   |
|  30 | bounded-context-workflow-direction        | `src/routes/approvalRules.ts`                | `src/services/appNotifications.ts`     |
|  31 | bounded-context-workflow-direction        | `src/routes/approvalRules.ts`                | `src/services/chatAckTemplates.ts`     |
|  32 | bounded-context-workflow-direction        | `src/services/actionPolicy.ts`               | `src/services/chatAckLinkTargets.ts`   |
|  33 | bounded-context-workflow-direction        | `src/services/approval.ts`                   | `src/services/evidenceSnapshot.ts`     |

## 削減方針

1. 新規違反は追加しない。CI の `arch:bounded-context` で baseline 未登録の違反を fail させる。
2. Priority A hotspots と同じ単位で route / service 抽出を進める。
   - `documents -> workflow`: document route から approval/action-policy 呼び出しを application service に集約する。
   - `documents/chat/org-project -> notifications`: 直接通知呼び出しを domain event または notification adapter に置き換える。
   - `identity-access -> ops/chat`: auth/scim から agent-run/chat-room 初期化の副作用を adapter に隔離する。
3. 既存違反を削減した PR では、対象 import を解消したうえで `npx depcruise-baseline --config dependency-cruiser.config.cjs --output-to dependency-cruiser-known-violations.json src` を `packages/backend` で再実行し、baseline から削除する。
4. bounded context ごとの専用フォルダ化が進んだ段階で、正規表現ベースの分類からディレクトリベースの分類へ移行する。
