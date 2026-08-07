# Issue #2013 bounded conversation import verification（PR B）

## Scope

- Baseline: `fb10a4df864299d55afcad1985c4996d65e3cd16`（merged PR #2037）
- Branch: `feat/2013-knowledge-conversation-import`
- Issue: `#2013`（PR Bは`Refs #2013`。UI/E2E未完了のためIssueをcloseしない）
- Environment: local repository tests and ephemeral PostgreSQL 15
- Fixtures: synthetic actor/item/conversation/turn data only

本記録はmanual／JSON／限定Markdown importのrepository-side証跡である。production
migration、external LLM、Sakura VPS、Google Drive、Sakura Object Storage、実credentialの
検証結果ではない。

## Implemented contract

- `POST /knowledge/conversations/import/preview`はmutationせず、strict parser、current actor、
  linked item ACLを検査して10分間有効なopaque preview tokenを返す。
- `POST /knowledge/conversations/import/commit`は同じ入力を再parseし、token bindingとcurrent ACLを
  再検査してからconversation、turn、item relation、request ledger、mandatory auditを一つの
  Serializable transactionで確定する。
- manualとJSONは同じstrict structured grammar、Markdownは
  `# Knowledge Conversation v1`／`## Turn`からなる限定role-block grammarを使用する。
  全形式はcanonical unpadded base64urlとfatal UTF-8を要求する。URL/network fetch、HTML実行、
  添付展開、provider APIは行わない。
- raw/canonical各512 KiB、1 turn 64 KiB、turn 200件、linked item 20件、JSON depth 12、
  container node 5,000、Markdown 5,000行、metadata 1 KiB、title 500 code point、公開label／
  request key 200 code pointに制限する。
- tokenは既存Knowledge signing secretから用途別に導出したHMACでactor、format、payload、item集合、
  purpose、version、有効期限を束縛する。本文、raw hash、request key、item IDをtokenへ格納しない。
- linked itemはID順で`FOR UPDATE`し、owner、logical delete、current ACLをcommit時に全件再検査する。
  権限外、存在しないitem、cross-ownerは同じ`not_found`へ正規化する。
- request ledgerはownerとopaque operation keyのdomain-separated SHA-256だけを保存する。同じ
  key+payloadと同じpayload+別keyは既存結果を返し、同じkey+別payloadはsanitized 409とする。
  transaction conflictは最大3 attemptで再評価し、無制限retryを行わない。
- audit metadataはformat、件数、結果code等のallowlistだけを保存する。本文、payload hash、raw
  request key、linked item ID、preview token、parser stackを保存しない。必須audit失敗時は業務mutationも
  rollbackする。
- preview／commit responseはserializerへ依存せずroute mapperがallowlist fieldだけで新規objectを
  構築する。内部hash、request key、item detailはmapper出力へ含めない。
- `RATE_LIMIT_KNOWLEDGE_IMPORT_MAX`は他のroute別上限と同様、起動時に正の整数だけを受理する。
- migrationはowner-scoped ledger table、複合FK、unique／CHECK、immutable triggerと既存公開label列の
  allowlist CHECKだけを追加するexpand-only変更である。turn nameはallowlistだけでなく`tool` roleへ
  DB制約で束縛する。

## Focused tests

| Verification | Result | Evidence |
| --- | --- | --- |
| parser / token / use case / adapter / route | PASS | 37/37、fail/skip/todo 0 |
| provenance schema / migration / OpenAPI contract | PASS | 10/10、fail/skip/todo 0 |
| focused coverage | PASS | statements/lines 85.00%、branches 74.21%、functions 93.50%。threshold/scope変更なし |

Focused coverageはimport parser、port、token、use case、Prisma adapter、routeを対象にした。
Prisma adapter単体のstatements/linesは52.15%だが、実transaction／constraint経路は後述の
PostgreSQL 15 integrationで検証した。

## PostgreSQL 15 migration / integration

Command:

```bash
make knowledge-conversation-import-postgres
```

Result: **PASS**

- manual／JSON／Markdown preview/commit
- same key+same payloadのreplay convergenceとturn非増殖
- same key+different payloadの並行conflict
- preview後のACL失効、cross-owner relationのfail closed
- mandatory audit failure rollback
- owner composite FK、createdBy/owner、hash、unique、tool name/role CHECK、ledger immutable triggerの
  negative insert拒否
- audit metadata redaction
- migration deploy/statusとschema drift

## Old-application compatibility

Command:

```bash
make knowledge-provenance-old-app
```

Result: **PASS**

- exact baseline `fb10a4df864299d55afcad1985c4996d65e3cd16` applicationをpost-migration DBへ接続した。
- import済みconversation／turnをPR A applicationでreadできた。
- PR Bの公開provider/model/tool labelは旧application responseで`null`へredactされた。
- 既存Knowledge item CRUDと旧conversation create/appendを継続できた。
- `/healthz`と`/readyz`は200だった。
- migration countは98から99へ増加し、既存rowを変更・削除しなかった。

## Repository quality gates

| Gate | Result | Notes |
| --- | --- | --- |
| Prisma generate | PASS | Prisma 7.9.1 |
| backend lint / format / typecheck / build | PASS | source format、ESLint、TypeScript build |
| backend full test | PASS | 1,922/1,922、fail/skip/todo 0 |
| frontend full test | PASS | 85 files / 495 tests、fail 0 |
| OpenAPI export / breaking diff | PASS | tracked snapshot byte一致、breaking 0、2 operation追加 |
| bounded-context dependency / coverage | PASS | 316 modules / 1,249 dependencies、301 source / 251 target、未分類・重複・曖昧0 |
| `make audit` / `make ops-quality` | PASS | backend/frontend high audit 0 vulnerabilities、S3 profile 22/22、storage readiness 2/2 |
| docs index / image links | PASS | generated index current、118 image links / 352 Markdown files |
| secret scan / `git diff --check` | PASS | intent-to-addした新規fileを含む1,963 filesで0 match、whitespace error 0 |
| independent/Copilot review / CI / cooling | PENDING | Draft PR作成後にexact headで実施する |

## Rollback

- applicationをPR A imageへ戻し、新ledger table、import済みconversation／turn／relation／auditを
  保持する。
- migration逆適用、table drop、import source削除をrollback手順にしない。
- import routesを旧applicationへ戻すことで新規preview/commitを停止できる。既存Knowledge
  annotation／conversation／synthesis API契約は維持する。

## Not verified / out of scope

- Knowledge Hub annotation／conversation／synthesis UI、real-backend E2E、sanitized screenshot（PR C）
- production migration／credential／provider cutover
- external LLM、Google Drive、Sakura Object Storage、Sakura VPS
- Chat thread／share／promote、全account archive／ZIP import
