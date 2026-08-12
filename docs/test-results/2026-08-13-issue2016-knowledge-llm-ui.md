# Issue #2016 Knowledge external LLM UI / E2E 検証

## 対象

- Issue: #2016
- 対象branch: `feat/2016-knowledge-llm-ui`
- 対象commit: PRのexact head確定後にPR本文へ記録
- environment: local synthetic E2E（ephemeral PostgreSQL / backend / frontend / Playwright）
- provider: 明示有効化したin-process stubだけ
- 実外部接続／実API key: なし
- E2E process isolation: Chat providerは固定stub、Chat／Knowledgeの外部destination・credential環境変数はbackend子processから除去

## 検証対象

| 項目 | 状態 | 証跡 |
| --- | --- | --- |
| default-disabledとprovider request 0件 | PASS | disabled構成のfocused real-backend E2E |
| allowlisted provider/model、最小context既定値 | PASS | frontend model/API/component test、focused E2E |
| 全5 source種別のserver-side候補取得とページング | PASS | backend route/adapter、101 page／cursor-cycle component test、focused E2E |
| synthesis／promotionを含むselected item集計と10 item上限 | PASS | 実Prisma adapter unit（重複排除、3 item集計、11 item拒否） |
| exact preview、明示confirm、integer最大予約額 | PASS | focused E2E、[preview画像](./2026-08-13-issue2016-knowledge-llm-ui/02-selected-context-preview.png) |
| selected sourceだけの外部送信境界 | PASS | selected snapshotと非選択canaryを使うfocused E2E |
| actual usage settlementとconversation provenance | PASS | stub reported-usage flow、backend PR B/C integration |
| usage unknown／result unknown／held maximum | PASS | allowlisted専用stub modelとauthenticated budget test hook、[usage unknown画像](./2026-08-13-issue2016-knowledge-llm-ui/03-budget-usage-unknown.png) |
| no automatic retry／no provider fallback | PASS | UI state、single-dispatch backend契約、focused E2E |
| 同一itemの親画面再読込中もin-flight runを保持 | PASS | deterministic component test |
| read-only reconciliation | PASS | 保存済みoutcomeだけを照合するfocused E2E |
| hard limit blockとprovider request 0件 | PASS | synthetic user policy fixture |
| outsider 404とresponse allowlist | PASS | direct API negative E2E、frontend normalization test |
| 375px responsive layout／semantic label | PASS | component test、sanitized screenshot |

## Synthetic fixture

実利用者、顧客、保存済み記事を使用していない。fixtureはpersonal Knowledge item、ready snapshot 2 versions、annotation revision、assistant／system／tool conversation turns、Synthesis versionを作成する。最新snapshotだけを既定選択し、次の文字列を非選択canaryとして保持する。

- 旧snapshot本文
- annotation本文
- 非選択assistant／system／tool turn本文
- Synthesis本文／未解決事項

候補APIは選択中itemのACLを先に検証し、snapshot、annotation revision、user/assistant conversation turn、synthesis version、thread promotion messageを種別ごとに安定ページングする。最大32件は選択上限であり、候補一覧の切り捨てには使用しない。system/tool turnと再帰的LLM由来sourceは候補から除外する。

canaryはexact preview、provider request、run response、画面、監査／application logへ含まれないことを検証する。内部ID、preview token、request key、provider request ID、API key、base URL、raw errorは文書・画像へ転記しない。

## 実行した検証

| 分類 | 結果 |
| --- | --- |
| focused backend stub/test-hook/route/候補／run adapter | 70 / 70 PASS |
| focused frontend model/API/component | 40 / 40 PASS |
| focused real-backend E2E（stub） | 1 / 1 PASS |
| focused real-backend E2E（disabled） | 1 / 1 PASS |
| focused real-backend E2E（JWT canonical identity + stub） | 1 / 1 PASS |
| ambient external-provider設定を注入したprocess isolation E2E | Knowledge + Chat summary 2 / 2 PASS、外部request 0件、canary log非含有 |
| backend full | 2,343 / 2,343 PASS |
| frontend full | 820 / 820 PASS |
| full E2E | 155 PASS / 34既存条件付きskip / failure 0 |
| UI core coverage | statements 73.63%、branches 66.65%、functions 73.28%、lines 76.39%（全threshold PASS） |
| frontend build budget | PASS（initial JS gzip 158.4 KiB） |
| lint／format／typecheck／build／audit／ops-quality | PASS |
| bounded-context dependency／coverage | PASS |
| OpenAPI snapshot／docs image・index／secret scan／`git diff --check` | PASS |
| core release-readiness | clean exact head確定後に実行しPR本文へ記録 |

## Screenshot

1. [default-disabled](./2026-08-13-issue2016-knowledge-llm-ui/01-provider-disabled.png)
2. [selected-context exact preview](./2026-08-13-issue2016-knowledge-llm-ui/02-selected-context-preview.png)
3. [usage unknown／maximum hold](./2026-08-13-issue2016-knowledge-llm-ui/03-budget-usage-unknown.png)
4. [hard-limit block（375px）](./2026-08-13-issue2016-knowledge-llm-ui/04-hard-limit-mobile-375.png)

画像はsynthetic dataだけを表示する。実利用者、顧客、メール、内部ID、credential、request key、provider endpointは含めない。

## 未実施の実環境範囲

- 実OpenAI-compatible provider request／実API key
- provider billing artifactの真正性照合
- production provider enablement／cutover
- Sakura VPS / live Quadlet / systemd
- Google Drive／Sakura Object Storage実credential
- production migration／DB restore

stub/fake成功を実provider成功とは扱わない。

## Rollback

Knowledge LLM providerを`disabled`へ戻し、Knowledge Hubの外部LLM tabを無効化する。expand-only migrationで追加済みのrun、reservation、context、outcome、conversation provenance、mandatory auditは保持し、providerへ自動再送しない。Chat summaryの既存設定／画面／API契約は変更しない。
