# Bounded-context import direction gate

## 目的

docs/architecture/greenfield-ideal-design.md の「1.1 バウンデッドコンテキスト（モジュール分割）」で定義した境界を、backend の import 方向として CI で検査する。

このゲートは既存の密結合を一度に直すものではなく、既存違反を baseline として固定し、新規違反を PR でブロックするための段階導入である。

## CI gate

- 設定: `packages/backend/dependency-cruiser.config.cjs`
- 既存違反 baseline: `packages/backend/dependency-cruiser-known-violations.json`
- 実行コマンド: `npm run arch:bounded-context --prefix packages/backend`
- CI: `.github/workflows/ci.yml` の `lint` job で実行する

`--ignore-known dependency-cruiser-known-violations.json` により、既存違反は記録済みとして扱う。baseline にない新しい違反は dependency-cruiser が error として検出し、CI を失敗させる。

## 理想設計との対応

| 順位 | 理想設計上の bounded context | 方針                                                                                                                                 |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Identity & Access            | 認証/認可、ユーザ/グループ、SCIM、ポリシー評価。最も基礎的な文脈として上位文脈へ直接依存しない。                                     |
| 2    | Org & Project                | 組織、プロジェクト階層、メンバー。業務文書や workflow へ直接依存しない。                                                             |
| 3    | Master Data                  | 顧客/業者/税率/勘定科目等。取引文書や workflow へ直接依存しない。                                                                    |
| 4    | Documents                    | 見積/請求/発注/仕入/経費/休暇/工数など。workflow / notifications との結合は段階的に application service / event / adapter へ寄せる。 |
| 5    | Workflow                     | 申請/承認/差戻し/ack/ロック。chat / notifications / evidence への直接依存は段階的に adapter 化する。                                 |
| 6    | Evidence & References        | 内部参照/外部URL、証跡パック。chat / notifications / integrations への直接依存を避ける。                                             |
| 7    | Chat                         | ルーム、投稿、メンション、ack。notifications への直接依存は段階的に event 化する。                                                   |
| 8    | Notifications                | App通知、メール、Push、ダイジェスト。integrations / ops への直接依存を避ける。                                                       |
| 9    | Integrations                 | 外部PDF、S3、Slack/Webhook、Google Drive等。ops への直接依存を避ける。                                                               |
| 10   | Ops                          | バッチ、バックアップ、監視、移行。最上位の運用文脈。                                                                                 |

dependency-cruiser 設定では、順位が小さい文脈から順位が大きい文脈への直接 import を禁止する。順位が大きい文脈から基礎文脈への参照、および shared utility / DB / audit など現時点で context 未分類の横断要素への参照は今回の初期 gate では許容する。

## 既存違反 baseline

2026-07-02 時点の既存違反は 37 件。内訳は以下のとおり。

| rule                                      | count |
| ----------------------------------------- | ----: |
| bounded-context-chat-direction            |     5 |
| bounded-context-documents-direction       |    23 |
| bounded-context-identity-access-direction |     2 |
| bounded-context-org-project-direction     |     3 |
| bounded-context-workflow-direction        |     4 |

### 既存違反一覧

|   # | rule                                      | from                                   | to                                   |
| --: | ----------------------------------------- | -------------------------------------- | ------------------------------------ |
|   1 | bounded-context-chat-direction            | `src/routes/chat.ts`                   | `src/services/appNotifications.ts`   |
|   2 | bounded-context-chat-direction            | `src/routes/chatRooms.ts`              | `src/services/appNotifications.ts`   |
|   3 | bounded-context-chat-direction            | `src/services/chatAckNotifications.ts` | `src/services/appNotifications.ts`   |
|   4 | bounded-context-chat-direction            | `src/services/chatAckReminders.ts`     | `src/services/appNotifications.ts`   |
|   5 | bounded-context-chat-direction            | `src/services/chatRoomAclAlerts.ts`    | `src/services/appNotifications.ts`   |
|   6 | bounded-context-documents-direction       | `src/routes/dailyReports.ts`           | `src/services/appNotifications.ts`   |
|   7 | bounded-context-documents-direction       | `src/routes/estimates.ts`              | `src/services/actionPolicy.ts`       |
|   8 | bounded-context-documents-direction       | `src/routes/estimates.ts`              | `src/services/actionPolicyAudit.ts`  |
|   9 | bounded-context-documents-direction       | `src/routes/estimates.ts`              | `src/services/actionPolicyErrors.ts` |
|  10 | bounded-context-documents-direction       | `src/routes/estimates.ts`              | `src/services/appNotifications.ts`   |
|  11 | bounded-context-documents-direction       | `src/routes/estimates.ts`              | `src/services/approval.ts`           |
|  12 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/actionPolicy.ts`       |
|  13 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/actionPolicyAudit.ts`  |
|  14 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/actionPolicyErrors.ts` |
|  15 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/appNotifications.ts`   |
|  16 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/approval.ts`           |
|  17 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/periodLock.ts`         |
|  18 | bounded-context-documents-direction       | `src/routes/expenses.ts`               | `src/services/reassignmentLog.ts`    |
|  19 | bounded-context-documents-direction       | `src/routes/invoices.ts`               | `src/services/actionPolicy.ts`       |
|  20 | bounded-context-documents-direction       | `src/routes/invoices.ts`               | `src/services/actionPolicyAudit.ts`  |
|  21 | bounded-context-documents-direction       | `src/routes/invoices.ts`               | `src/services/actionPolicyErrors.ts` |
|  22 | bounded-context-documents-direction       | `src/routes/invoices.ts`               | `src/services/appNotifications.ts`   |
|  23 | bounded-context-documents-direction       | `src/routes/invoices.ts`               | `src/services/approval.ts`           |
|  24 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`         | `src/services/actionPolicy.ts`       |
|  25 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`         | `src/services/actionPolicyAudit.ts`  |
|  26 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`         | `src/services/actionPolicyErrors.ts` |
|  27 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`         | `src/services/appNotifications.ts`   |
|  28 | bounded-context-documents-direction       | `src/routes/purchaseOrders.ts`         | `src/services/approval.ts`           |
|  29 | bounded-context-identity-access-direction | `src/plugins/auth.ts`                  | `src/services/agentRuns.ts`          |
|  30 | bounded-context-identity-access-direction | `src/routes/scim.ts`                   | `src/services/personalGaChatRoom.ts` |
|  31 | bounded-context-org-project-direction     | `src/routes/projects.ts`               | `src/services/appNotifications.ts`   |
|  32 | bounded-context-org-project-direction     | `src/routes/projects.ts`               | `src/services/periodLock.ts`         |
|  33 | bounded-context-org-project-direction     | `src/routes/projects.ts`               | `src/services/reassignmentLog.ts`    |
|  34 | bounded-context-workflow-direction        | `src/routes/approvalRules.ts`          | `src/services/appNotifications.ts`   |
|  35 | bounded-context-workflow-direction        | `src/routes/approvalRules.ts`          | `src/services/chatAckTemplates.ts`   |
|  36 | bounded-context-workflow-direction        | `src/services/actionPolicy.ts`         | `src/services/chatAckLinkTargets.ts` |
|  37 | bounded-context-workflow-direction        | `src/services/approval.ts`             | `src/services/evidenceSnapshot.ts`   |

## 削減方針

1. 新規違反は追加しない。CI の `arch:bounded-context` で baseline 未登録の違反を fail させる。
2. Priority A hotspots と同じ単位で route / service 抽出を進める。
   - `documents -> workflow`: document route から approval/action-policy 呼び出しを application service に集約する。
   - `documents/chat/org-project -> notifications`: 直接通知呼び出しを domain event または notification adapter に置き換える。
   - `identity-access -> ops/chat`: auth/scim から agent-run/chat-room 初期化の副作用を adapter に隔離する。
3. 既存違反を削減した PR では、対象 import を解消したうえで `npx depcruise-baseline --config dependency-cruiser.config.cjs --output-to dependency-cruiser-known-violations.json src` を `packages/backend` で再実行し、baseline から削除する。
4. bounded context ごとの専用フォルダ化が進んだ段階で、正規表現ベースの分類からディレクトリベースの分類へ移行する。
