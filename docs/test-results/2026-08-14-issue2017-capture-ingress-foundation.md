# Issue #2017 capture ingress foundation 検証

## 対象

- Issue: #2017 / PR A
- branch: `feat/2017-knowledge-capture-ingress`
- baseline: `63351daafeba589fca402edb8ebae451256d6dae`
- environment: local synthetic tests / ephemeral PostgreSQL 15
- 実browser share、実extension、production credential: 未使用

## 固定した境界

- PWA／extension inputはKnowledge APIを直接mutationせず、allowlist済みcanonical draftとして既存Knowledge Hubの確認画面へ渡す。
- title 500 code point、URL 4,096 UTF-8 bytes、selected text 64 KiB、description 16 KiB、author 500 code point、日時200 bytes、canonical draft合計128 KiB、JSON HTTP envelope 288 KiB、preview token 4 KiB、request key 200 code point、preview TTL 10分を上限とする。
- HTTP(S)以外、credential URL、raw HTTP bodyの不正UTF-8、NUL、C0/C1 control、全`Bidi_Control`、ill-formed Unicode、nested object、prototype key、over-size payloadを保存前に拒否する。drop対象のunknown key/valueも同じUnicode検査を先に受ける。
- scopeはpersonalが既定で、organizationはactor userのactive／非削除、current organization、previewへ束縛した全groupのlive membership／grantを同一transactionでlock・再検査し、追加confirmを必須とする。
- preview tokenはactor、channel、capturedAt、選択field／payload、scope／organization／group、source type、opaque request keyのsecret-derived fingerprint、purpose、expiryをdomain-separated HMACへ束縛する。本文とraw identifierはtokenへ格納しない。
- opaque draft IDをserver-sideでactor-scoped HMAC化し、同じkey／payloadと同時replayを同じitem／snapshotへ収束させる。request keyはASCII英数字と`._-`だけを許可する。ledger HMACはcursor rotationから独立したproduction専用stable secretを使う。item／snapshot intentはartifact I/O前にcontent type、selected text、SHA-256、sizeを保持する。結果不明はpendingで保持し、自動再送せず、署名済みpreview intentと同じrequest keyから既存ledger captureを解決して既存artifactだけをreconcileする。pending回復では署名済みtokenのexpiryだけを無視するが、actor／request key／exact payload／ACL bindingは再検証する。frontendはnetwork、HTTP 5xx、invalid 2xx responseをresult-unknownとして同じpreview intent／request keyへlockし、responseのrequest preview IDを照合する。exact previewは全selected値を表示し、commit/reconcile開始前に親navigation lockを同期取得する。
- JWT BFF mutationはcookie／header double-submit CSRFを要求する。frontendはsame-originまたは設定済みAPI originだけへCSRF headerを付与する。

## 検証結果

| 分類                                                                    | 結果                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| focused backend draft／token／use case／route／schema／CSRF             | 36 / 36 PASS                                                                            |
| focused frontend model／API／component／BFF CSRF                        | 34 / 34 PASS                                                                            |
| PostgreSQL 15 migration／idempotency／audit rollback／immutable trigger | PASS                                                                                   |
| old-application実row read/write、health／ready                          | PASS                                                                                   |
| OpenAPI export／non-breaking diff                                       | PASS                                                                                   |
| backend／frontend lint、format、typecheck、build                        | PASS                                                                                   |
| backend full coverage                                                   | 2,394 / 2,394 PASS、statements 75.54%、branches 72.27%、functions 85.67%、lines 75.54% |
| frontend full／UI core coverage                                         | 872 / 872 PASS、statements 73.67%、branches 66.69%、functions 73.29%、lines 76.43%     |
| core E2E                                                                | 109 / 109 PASS                                                                         |
| full E2E                                                                | 155 PASS／34既存条件付きskip／failure 0                                                |
| lint／format／typecheck／build／audit／ops-quality                      | PASS                                                                                   |
| bounded-context dependency／coverage、frontend build budget             | PASS                                                                                   |
| docs index／image links、secret scan、`git diff --check`                | PASS                                                                                   |
| `RELEASE_E2E_SCOPE=core make release-readiness`                         | PASS（core E2E 109 / 109）                                                             |

PostgreSQL fixtureはcapture 1件、item 1件、snapshot 1件へ収束し、同時replayで増殖しないこと、real local artifact adapterで`ready`になること、store後のunknown outcomeを新規storeなしでreconcileできること、artifact I/O前にpending intentのmaterialization metadataが永続化されること、artifact store中のitem logical delete後はfinalizationとreconcileが404でfail closedとなりprovider再照合を行わないこと、organization groupの現行membership失効またはactor organization変更後はpreview／同一key replayが404でfail closedになること、intent transactionがmembership rowを共有lockして同時revocationをcommit後まで待機させ、その後のexact ACL再検査で404になること、mandatory audit failure時にbusiness mutationがrollbackすること、terminal ledgerのupdate／deleteをDBが拒否すること、非選択canaryがsnapshotへ存在しないことを検証した。Prisma adapterの`P2010`で内包されたSQLSTATE `40001|40P01`も最大3 attemptのbounded retry対象として固定し、枯渇時はsanitized conflictへ正規化した。

## 未実施範囲

- PWA `share_target`／service worker／IndexedDB runtime（PR B）
- Chrome／Edge MV3 extension runtime（PR C）
- OS share picker
- extension store公開／署名
- production URL／credential／migration
- external page fetch、file／image／PDF capture

## Rollback

capture routeと既存Knowledge Hub内のingress panelを無効化し、previous application imageへ戻す。expand-only ledger、KnowledgeItem、KnowledgeSnapshot、artifact、audit historyは保持し、table drop、source delete、自動副作用retryを行わない。
