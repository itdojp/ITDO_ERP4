# Issue #2015 Knowledge selective share / Chat card / promote UI 検証

## 対象

- Issue: #2015
- 対象branch: `feat/2015-knowledge-share-promote-ui`
- 対象commit: PRのexact head確定後にPR本文へ記録
- environment: local synthetic E2E（PostgreSQL / backend / frontend / Playwright）
- 実外部接続: なし

## 検証結果

| 項目                                              | 状態 | 証跡                                                                                                                                        |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge shareのfield選択、preview、明示confirm  | PASS | focused UI test、real-backend E2E、[preview画像](./2026-08-10-issue2015-knowledge-share-promote-ui/01-selective-share-preview.png)          |
| Chat room-only card表示とsource-open ACL分離      | PASS | real-backend E2E、[card画像](./2026-08-10-issue2015-knowledge-share-promote-ui/02-chat-share-card.png)                                      |
| 非選択canaryのDB/API/通知/検索/UI非含有           | PASS | backend focused test、frontend normalization test、real-backend E2E                                                                         |
| pending/failed/reconcile/revoke                   | PASS | share panel／API focused test、backend focused test                                                                                         |
| selected replyだけのpromotionとprovenance         | PASS | promotion dialog test、real-backend E2E、[promotion画像](./2026-08-10-issue2015-knowledge-share-promote-ui/03-selected-reply-promotion.png) |
| outsider 404、revoked placeholder、thread履歴保持 | PASS | backend focused test、card test、real-backend E2E                                                                                           |
| keyboard、screen reader label、responsive layout  | PASS | semantic role／labelとmobile classを検証するfocused component test。画像はsanitized component capture                                       |

## 実行した検証

| 分類                                    | 結果                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| backend label/share focused             | 65 tests PASS                                                                                         |
| frontend share/card/promote focused     | 146 tests PASS。最終helper/API調整後の関連79 testsも再実行してPASS                                    |
| backend full (`make test`)              | 2,168 / 2,168 PASS、skip 0                                                                            |
| frontend full (`make test`)             | 101 files、776 / 776 PASS                                                                             |
| real-backend focused E2E                | `frontend-knowledge-share-promote.spec.ts` 1 / 1 PASS                                                 |
| full/extended E2E                       | 154 passed、34 existing environment-conditional skipped、failure 0（3.0分）。#2015 testは実行済みPASS |
| lint / format-check / typecheck / build | PASS                                                                                                  |
| UI core coverage                        | statements 73.44%、branches 66.48%、functions 73.04%、lines 76.23%（全threshold PASS）                |
| frontend build budget                   | entry gzip 14.9 KiB、initial gzip 158.1 KiB、largest chunk gzip 87.1 KiB、PASS                        |
| OpenAPI                                 | snapshot一致、baseとの差分はlabel assignment GETの非破壊的追加のみ                                    |
| dependency audit / ops-quality          | backend・frontend vulnerability 0、ops-quality PASS                                                   |
| `git diff --check`                      | PASS                                                                                                  |

real-backend E2Eでは、実PostgreSQLでshare commitを実行した際に予約語をSQL aliasへ
使用していた問題を検出した。aliasを非予約語へ変更し、backend focused testとE2Eを
再実行してPASSを確認した。

## Synthetic fixture

実利用者、顧客、保存済み記事を使用していない。fixtureは次の分類だけを持つ。

- personal Knowledge itemとready snapshot
- private label canaryとselected label
- private annotation canaryとselected annotation revision
- selected AI turnとunselected AI/System/Tool turn canary
- selected Synthesis versionとunselected version canary
- private-group room、room-only synthetic viewer、outsider
- selected replyとunselected reply canary

ID、request key、preview token、provider情報、raw errorは文書・画像・logへ転記して
いない。

## Screenshot

1. [selective share preview](./2026-08-10-issue2015-knowledge-share-promote-ui/01-selective-share-preview.png)
2. [Chat share cardとthread](./2026-08-10-issue2015-knowledge-share-promote-ui/02-chat-share-card.png)
3. [selected reply promotion preview](./2026-08-10-issue2015-knowledge-share-promote-ui/03-selected-reply-promotion.png)

画像はsynthetic dataのみを表示し、実利用者、実記事、顧客名、メール、内部ID、
credential、request key、provider情報、private URLを含まない。

## 未実施の実環境範囲

- Sakura VPS / live Quadlet / systemd
- Google Drive実credential
- Sakura Object Storage実credential
- production migration / provider cutover / DB restore
- external LLM / 自動要約

これらはIssue #2015のrepository-side UI検証には含めない。

## Rollback

UIと新endpointを無効化しても、additiveなshare／promotion table、immutable snapshot、
posted Chat root、監査履歴は保持する。Chat rootの汎用fallback本文を旧clientで表示でき、
source item、share snapshot、thread、promotion provenanceを物理削除しない。
