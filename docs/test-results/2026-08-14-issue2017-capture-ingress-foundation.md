# Issue #2017 capture ingress foundation 検証

## 対象

- Issue: #2017 / PR A
- branch: `feat/2017-knowledge-capture-ingress`
- baseline: `63351daafeba589fca402edb8ebae451256d6dae`
- environment: local synthetic tests / ephemeral PostgreSQL 15
- 実browser share、実extension、production credential: 未使用

## 固定した境界

- PWA／extension inputはKnowledge APIを直接mutationせず、allowlist済みcanonical draftとして既存Knowledge Hubの確認画面へ渡す。
- title 500 code point、URL 4,096 UTF-8 bytes、selected text 64 KiB、description 16 KiB、author 500 code point、日時200 bytes、raw draft合計128 KiB、preview token 4 KiB、request key 200 code point、preview TTL 10分を上限とする。
- HTTP(S)以外、credential URL、不正UTF-8由来のreplacement character、NUL、不要なcontrol、bidi control、ill-formed Unicode、nested object、prototype key、over-size payloadを保存前に拒否する。
- scopeはpersonalが既定で、organizationは有効groupの再検査と追加confirmを必須とする。
- preview tokenはactor、channel、capturedAt、選択field／payload、scope／organization／group、source type、purpose、expiryをdomain-separated HMACへ束縛する。本文とraw identifierはtokenへ格納しない。
- opaque draft IDをserver-sideでactor-scoped HMAC化し、同じkey／payloadと同時replayを同じitem／snapshotへ収束させる。結果不明はpendingで保持し、自動再送せず既存artifactだけをreconcileする。
- JWT BFF mutationはcookie／header double-submit CSRFを要求する。frontendはsame-originまたは設定済みAPI originだけへCSRF headerを付与する。

## 検証結果

| 分類 | 結果 |
| --- | --- |
| focused backend draft／token／use case／route／schema／CSRF | PASS |
| focused frontend model／API／component／BFF CSRF | PASS |
| PostgreSQL 15 migration／idempotency／audit rollback／immutable trigger | PASS |
| old-application実row read/write、health／ready | PASS |
| OpenAPI export／non-breaking diff | PASS |
| backend／frontend lint、format、typecheck、build | PASS |
| backend full coverage | 2,377 / 2,377 PASS、statements 75.60%、branches 72.21%、functions 85.55%、lines 75.60% |
| frontend full／UI core coverage | 858 / 858 PASS、statements 73.65%、branches 66.68%、functions 73.27%、lines 76.40% |
| core E2E | 109 / 109 PASS |
| full E2E | 155 PASS／34既存条件付きskip／failure 0 |
| lint／format／typecheck／build／audit／ops-quality | PASS |
| bounded-context dependency／coverage、frontend build budget | PASS |
| docs index／image links、secret scan、`git diff --check` | PASS |
| `RELEASE_E2E_SCOPE=core make release-readiness` | PASS（core E2E 109 / 109） |

PostgreSQL fixtureはcapture 1件、item 1件、snapshot 1件へ収束し、同時replayで増殖しないこと、mandatory audit failure時にbusiness mutationがrollbackすること、terminal ledgerのupdate／deleteをDBが拒否すること、非選択canaryがsnapshotへ存在しないことを検証した。

## 未実施範囲

- PWA `share_target`／service worker／IndexedDB runtime（PR B）
- Chrome／Edge MV3 extension runtime（PR C）
- OS share picker
- extension store公開／署名
- production URL／credential／migration
- external page fetch、file／image／PDF capture

## Rollback

capture routeと既存Knowledge Hub内のingress panelを無効化し、previous application imageへ戻す。expand-only ledger、KnowledgeItem、KnowledgeSnapshot、artifact、audit historyは保持し、table drop、source delete、自動副作用retryを行わない。
