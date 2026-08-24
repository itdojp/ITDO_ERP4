# Issue #2017 Browser Capture extension 検証

## 対象

- baseline: `eae84a84b7fcb2e974218381d234242afccdf9cf`
- pre-merge tested feature commit: `fc2a838dc18de4bb2500b8b6a78a3259479d88d5`
- channel: `browser_extension`
- environment: local repository-side synthetic fixture
- status: Draft／browser runtime evidence未完了

この文書の件数は上記pre-merge feature commitのrepository-side証跡である。base同期後のexact-head gateはDraft PRのcheck／commentへ別途記録し、再実行前の結果を最新headの結果として扱わない。

Review remediationのcode head `e18653cd46391d52222fe93ff425629fbe2bb969`では、extension unit／manifest／static test 27/27とbackend capture／canonical URL focused test 25/25を実行した。scheme-relative backslash userinfo、recordとrecent pointerの非原子的な二重write、stage結果不明中のfield変更を追加修正している。tracked evidence文書を追加するfinal PR headのCI／review completenessはPR #2074を正本とし、この段階ではPENDINGとして扱う。

追加remediation直前のintegration head `cfa8c34eb59ae70a4caf4c376ee95b6839d7d5e3`では、`RELEASE_E2E_SCOPE=core make release-readiness`がexit 0で、backend 2,398/2,398、frontend 969/969、extension 26/26、core E2E 110/110、Playwright Chromium extension E2E、OpenAPI、audit、ops、docs、secret scanをPASSした。この結果は後続`e18653cd...`の修正を含まないため、最終exact-head gateの代替にはしない。

追加review remediationのcode head `945e42b064421f59ba4b9edda8185ecd691a1a9c`では、path prefix後のscheme-relative slash／backslash userinfoと、stage結果不明後のfield再選択／再captureを修正した。extension 27/27を20回反復し、backend capture／canonical URL focused test 25/25、extension／backend lint・format・typecheck／build、`git diff --check`をPASSした。直前のtracked head `0f474357047dce7c2bb9785e28a7b92138fef821`に対するrelease-readinessも38/38、backend 2,398/2,398、frontend 969/969、extension 27/27、core E2E 110/110でPASSしたが、この追加code headを含まないため最終exact-head gateの代替にはしない。

独立reviewで検出した複数marker境界はcode head `7aa5684e4af9b93b9d98a4fc75dc47b2320adbe1`で追加修正した。URL parserは最大32件のabsolute／scheme-relative markerを順番に検査し、先行するparse不能markerで後続credential URLを隠せず、候補超過またはdecode後もparse不能ならfail closedとする。extension unit／manifest／behavior test 28/28を20回反復し、backend focused test 25/25をPASSした。mocked Chrome runtimeを用い、stage response loss後のfield／recapture lock、同一intent retry、stage成功後のhandoff response loss、再stageなしのhandoff retryを実行時に確認した。

## 固定契約

- Manifest V3 permissionは`activeTab|scripting|storage`だけ。`incognito: not_allowed`でprivate browsingを対象外とし、broad host permission、cookie、tabs、history、webRequest、remote codeを使用しない。
- minimum Chromium versionは112。session storage 10 MiB契約に基づき、10件・各128 KiB上限とorganization group最大100件を収容する。
- action user gesture後にmain frameのURL、title、selection、canonical、description、author、published timeだけを取得する。
- ERP4 originはbuild時のsingle exact origin。production実値はcommitしない。
- draftは`chrome.storage.session`へ最大10件、論理read TTL 10分。期限後はreadを拒否し、次のextension実行またはsession終了時に物理削除する。persistent storage、handoff URL、Cache API、logへ本文を保存しない。
- 初回stageの応答が不明でも、同じpopup内の利用者retryは同じopaque draft ID／request key／selected payloadを再利用し、queueへ別draftを追加しない。recordは一回のstorage writeで保存し、popup再open時は最大10件のbounded record setから未claimの最新draftを導出する。独立recent pointerへ依存しない。
- extensionはERP4 API、cookie、token、Authorization、CSRF headerへアクセスしない。認証済みlandingのpreview／confirmだけが既存capture ingressを呼ぶ。
- bridgeはextension ID、exact origin、opaque draft ID、nonce、actor fingerprintを照合し、受信だけではmutationしない。actor fingerprintはsame-origin XSSに対するauthenticationではない。標準frontend imageはself scriptとbuild時exact API originへ制限したresponse CSPを生成するが、targetの実効CSP／XSS防止／locked profileを有効化前提とする。
- result unknownは自動retryせず、same request ledgerのread-only reconcileへ戻す。

## Synthetic fixture

別originのsynthetic pageにtitle、選択文字列、canonical URL、allowlist metadataと、password／script／unknown metadata canaryを配置した。browser actionをOS-level keyboard gestureで開き、allowlist fieldだけがpopupとexact-origin handoffへ届くこと、canaryが届かないこと、URLがopaque draft IDだけを運ぶこと、同じdraftの明示再読込が新しいstaging／mutationを作らないことを確認した。synthetic bridgeでは`staged → pending → staged → cleanup_pending → delete`、content-free tombstone化と物理削除それぞれのresponse lossに対するidempotent再試行、delete後get拒否も確認した。

証跡:

- [extension popup](2026-08-14-issue2017-browser-capture/01-extension-popup.png)
- [exact-origin handoff](2026-08-14-issue2017-browser-capture/02-extension-handoff.png)
- [sanitized Chromium runtime summary](2026-08-14-issue2017-browser-capture/chromium-runtime-summary.json)

## Pre-merge feature commitの検証結果

- extension unit／manifest／static security checks: 24/24 PASS
- frontend bridge／authenticated landing／capture ingress focused tests: PASS。organization group 21／100件を受理し101件を拒否するbridge response normalizationを含む
- backend full: 2,397/2,397 PASS
- frontend full: 969/969 PASS
- frontend core coverage: statements 73.68%、branches 66.68%、functions 73.30%、lines 76.44%。threshold gateもPASS
- full E2E: 160 PASS／34既存条件付きSKIP／0 FAIL
- Playwright Chromium 151 persistent-context unpacked extension E2E: PASS。空の専用Playwright browser cacheからruntime installを行う公式Make targetもPASS
- real frontend/backend bridge-protocol E2E: authenticated landing → exact preview → explicit commit → item/snapshot作成 → terminal extension draft deleteをPASS
- unit/static境界（`fc2a838d...`）: permission allowlist、invalid/build-code-injection origin、credential query/fragment/path/matrix/nested URL、nested URL内の多層encode path/matrix、二重encode query／path、`PHPSESSID`／`sid`／`sessid`等のsession名、nested userinfo、zero/one/two-slash／backslash URL、malicious payload、NUL/control、oversize、unknown metadata、session logical TTL／queue、nonce replay、wrong origin／draft／actor、terminal cleanup response-loss、organization group 21／100／101件境界: PASS

## Review remediationのfocused検証結果

- latest code head: `7aa5684e4af9b93b9d98a4fc75dc47b2320adbe1`
- extension unit／manifest／static／popup behavior security checks: 28/28 PASS
- extension focused repetition: 20/20 PASS
- backend capture draft／Knowledge item canonical URL focused tests: 25/25 PASS
- 追加fixture: credential/session名付きslash path、percent decode後のASCII TAB／LF／CR scheme分割、queryおよびpath prefix後のscheme-relative `\\`／`\/`／`//` userinfoと多層encode、先行parse不能marker＋後続credential URL、32件のcandidate上限、initial stage response loss、popup再open、recent pointer非依存、stage結果不明中のcheckbox／recapture freezeと同一intent retry
- popup behavior test: mocked `chrome.runtime.sendMessage`／`chrome.tabs.create`でstage／handoff response lossを発生させ、同一draft ID／request key／payload、field lock、再capture拒否、stage増殖なしを確認
- extension／backendのformatter、extension lint／typecheck／build、backend build、`git diff --check`: PASS
- final tracked-evidence headのCI、Copilot、独立correctness/security review、review completeness: PENDING（PR #2074へ記録）
- server-side canonical URL境界も同じnested path/matrix/session検査を行い、extension/PWA入力がlocal検査を迂回してもcapture draft commit前に拒否するfocused testをPASS
- frontend response CSP renderer: exact API origin binding、Google Identity script/style allowlist、active／credentialed／injected origin拒否、service-worker／asset locationでのsecurity header継承、template fail-closedをPASS。target response headerは未検証
- Chromium synthetic browser境界: action gesture、popup、exact-origin handoff、canary非漏えい、pending/staged/content-free cleanup/delete/idempotent delete: PASS

## Final CI remediation

- PR CIのfrontend jobで、web capture回帰testが新規snapshotの一時描画とselected item変更後の履歴reloadの間にDOM要素を取得し、その要素がmatcher実行前にdetachされる非同期競合を1回検出した。同一exact headのpush CIはPASSし、focused test 20/20もPASSしたが、再実行だけでは解消扱いにしなかった。
- assertionを固定sleep／timeout延長へ変更せず、現在のDOMに対して`waitFor`でURL表示を確認するよう修正した。productのURL、provider field非表示、privacy契約は変更していない。
- 次のexact headではcoverage instrumentation時に、annotation履歴regionの外枠だけを待って内容を同期取得する既存test raceを検出した。履歴内容自体を非同期待機するよう修正し、固定sleep、timeout延長、coverage scope／threshold変更は行っていない。
- remediation後はKnowledge Hub focused test 20/20、annotation focused coverage test 20/20、frontend full／UI core coverage 969/969、extension 28/28、frontend lint／format／typecheck、`git diff --check`をPASSした。UI core coverageはstatements 73.68%、branches 66.68%、functions 73.30%、lines 76.44%。最終exact headのfull gate、CI、独立reviewはPR #2074を正本とし、以前のheadの結果を再利用しない。

## Final security review remediation

- 独立security reviewで、文字列全体のUnicode lowercase結果のindexを元文字列へ流用すると、U+0130 `İ`のcase-fold展開により後続HTTP(S) markerの開始位置がずれることを検出した。scannerをUTF-16 indexを保持するASCII code-unit比較へ変更し、U+0130が1個／複数個、zero／one／two-slash userinfoをextensionとbackendの両境界で拒否する。
- nested URL parseには、一回のtop-level URL正規化全体で共有する128回のoperation budgetを追加した。decode layerまたは再帰をまたいで上限を超えた場合はfail closedとし、単独では上限内となる2個のsibling query valueが合計で上限を超えるfixtureで共有budgetを決定的に固定した。U+0130を含むcredential非保持URLのpositive fixtureも保持する。
- extension 30/30とbackend capture／canonical URL focused test 27/27をPASSした。以前のsecurity remediation headではextension／backend focused testを各20回反復済みだが、correctness remediation後の新exact headでは反復、full gate、CI、独立reviewを再実行し、以前の結果を最終結果として再利用しない。

## Final correctness review remediation

- extension session draftの受理済みnonceを末尾31件へ切り詰める実装では、古いnonceがTTL内に履歴から脱落した後で遅延commandとして再受理され得た。受理済みnonceを最大32件までevictせず保持し、上限到達後はcontent-bearing commandを`state_conflict`へfail closed化した。terminal cleanupは本文／request key／pending intentを持たない`cleanup_pending` tombstoneへ一回のstorage writeで置換してから物理削除し、各response lossへidempotentに収束する。32件到達、最初のnonce再送拒否、content-free terminal cleanupを決定的testで固定した。
- Knowledge HubのURL capture testはoptimistic snapshot描画だけで成功し得たため、snapshot history requestをdeferredにし、authoritative reload後の別SHA-256を確認してからURL表示とprovider field非表示を検査するよう変更した。product表示、timeout、coverage scope、privacy契約は変更していない。
- Copilot遅延reviewで、認証喪失によりlive actor stateを消去した後、claim済みsession draftのexpiry／terminal cleanupもactor keyを失って次回worker pruneまで残存し得ることを検出した。live認証とDOM本文は従来どおり即時purgeし、最後にverifiedかつclaim成功したactor keyだけをcomponent memoryへcleanup capabilityとして保持する。これはdraft read／API mutationに再利用せず、TTL expiryまたはterminal result後のtombstone化／idempotent deleteだけに使用し、delete成功時に消去する。auth loss後のterminal resultとfake timerによるTTL expiry cleanupをそれぞれ決定的testで固定した。
- 続くexact-head独立reviewでは、物理削除失敗後のpage reloadがcomponent-memoryのterminal stateを失い、未削除の本文を再表示し得る点を検出した。terminal result時はDOMをpurgeし、content-free tombstoneを永続化してから物理削除する二段階cleanupへ変更した。tombstone化／deleteのresponse loss、物理削除失敗後のremount、auth／network喪失、明示delete-only retryを検証し、本文、request key、preview／commit操作が復元されないことを固定した。
- 同reviewでserver-side credential query tokenの`policy`欠落とextension compact markerの`pwd`欠落も修正し、`upload_policy`と`clientpwd`のdirect／nested canaryを両境界で拒否した。release-readinessにはfrontend response-CSP／build security testを実行する`frontend-quality-gates`をrequired checkとして追加した。
- 上記remediation treeのfocused結果はextension 31/31とBrowser Capture bridge／landing 18/18を各20/20反復、backend capture／canonical URL 27/27、frontend quality gates 21/21、Playwright Chromium synthetic extension lifecycleがPASS。新exact head確定後にfull gate、CI、独立reviewを再実行し、以前のheadの結果を最終結果として再利用しない。

## Terminal cleanup／private browsing review remediation

- code head `6b3e0ba3f60faa7d75e0d4b376eb7e5de196a565`の独立correctness reviewとcore E2Eは、real-backend bridge fixtureが`cleanup` commandを実装せず、terminal結果後に本文を含むrecordを返すため、page URLからhandoff IDが消えない問題を検出した。product timeoutを延長せず、fixtureを`staged → pending → cleanup_pending → delete`へ合わせ、cleanup responseがschema、ID、lifecycle、created／expires timeだけを含むことを固定した。
- tombstone write failureとtombstone確定後の物理delete failureを別phaseにした。terminal結果時はcurrent addressからopaque handoff parameterを先に外し、前者ではbrowser session内本文の消去済みを主張せずcontent-free化から明示再試行する。後者だけがcontent-free下書きの物理削除を再試行する。auth revalidation／offlineでもphaseを昇格させない。
- page bridgeはsuccess responseの`transitioned`、record有無、command別lifecycleを検証し、意味的に不整合な`get|pending|staged|cleanup|delete` responseをfail closedで拒否する。
- 生成manifestへ`incognito: not_allowed`を固定し、Chromeのシークレットモード／Edge InPrivateをcapture対象外にした。vendor browser UIによる確認は未実施であり、repository-side manifest testだけを実browser証跡として扱わない。
- remediation treeではextension unit／manifest／static 31/31、Browser Capture bridge／landing 20/20、frontend quality gates 21/21、frontend typecheck、Playwright Chromium synthetic extension E2E、修正対象のreal-backend bridge E2E 1/1をPASSした。extension unitとBrowser Capture bridge／landingはそれぞれ20回反復した。最終exact headのfull gate、CI、独立reviewはPR #2074を正本とし、この節の結果だけでmerge可能とは扱わない。

## Cross-tab terminal／pending response-loss review remediation

- terminal結果をstorage消去済みの`cleanup_pending`とは分離したcontent-freeなlocal `terminal` lifecycleで他tabへ先行通知する。他tabはtombstone書込みの成否を待たずDOMとhandoff addressをpurgeし、最後に検証済みのcleanup actorによる`cleanup_required`だけを残す。tombstone失敗を注入した複数tab相当のcomponent testで、本文とaddressが復元されず、明示cleanupだけが再試行されることを固定した。
- pending session write後のbridge response lossでは、exact preview、request key、actor、draft IDへ束縛したoperation IDをcomponent memoryに保持する。自動retryは行わず、利用者の明示retryだけが同じoperation／intent／draftで所有権を回復できる。別operationは従来どおりCAS loser、同じoperationの異なるpayloadはfail closedである。
- bridge responseは`pendingOperationId`をallowlist fieldとして正規化し、新規遷移時はrequested operation／intent／draftとの完全一致を要求する。response-loss component testは最初のbridge結果不明時にAPI commit 0件、明示retry後に同じoperationでAPI commit 1件へ収束した。
- real-backend E2Eは最初のpending responseだけを喪失させ、preview POST 1件、response-loss中のcommit 0件、明示retry後のcommit POST合計1件、reconcile 0件、mutation bridge command順`pending → pending → cleanup → delete`を確認した。固定sleep、timeout延長、skip、coverage scope／threshold変更は行っていない。
- remediation treeのfocused結果はextension 31/31、frontend bridge／queue／landing／ingress 65/65、frontend typecheck、real-backend E2E 1/1、`git diff --check`がPASSした。最終exact headのfull gate、CI、独立reviewはPR #2074を正本とし、以前のheadの結果を再利用しない。

追加の独立reviewで、BroadcastChannel subscribe gap中のreload／後発tab、terminalと並行したin-flight `get`、terminal時localStorage書込み失敗、auth検証中に到着したterminal cleanup actor、response envelope内IDに対するinner record IDの未束縛を検出した。landingはextension contentを要求する前にschema／opaque draft ID／固定expiry／1文字stateだけのcontent-free terminal fenceを独立2 slotへ予約する。active／terminal valueを固定長にし、terminal時は両slotを上書きする。有効なterminal slotが一つでもあれば兄弟slotの欠損／破損より優先し、partial active初期化はterminalと解釈せず本文取得をfail closedにする。terminal slotは物理削除後も最大10分保持し、reloadでactiveへ戻さない。`get` response受領後かつdraft event発行前にもterminalを再検査する。tombstone書込み失敗時はidempotent deleteも試し、両方が失敗した場合だけ明示cleanupを残す。bridgeは`get|pending|staged|cleanup`のnon-null record IDをrequested draft IDへexact bindする。初期fence予約失敗時の`get` 0件、partial active初期化、単一terminal slot書込み失敗、101件超の無関係localStorage key後のexpiry cleanup、deferred `get`のterminal後本文非発行、terminal-before-auth cleanup、tombstone／delete failure組合せを決定的component testで固定した。tombstone失敗中に旧handoff URLを別pageで開くreal-browser testもbridge `get` 0件と本文非表示を固定する。この追加treeのexact-head gateはcommit後に再取得し、以前の結果を再利用しない。

unpacked Chromium E2Eはsynthetic landingによるextension protocolを対象とし、別のreal frontend/backend bridge-protocol E2Eがcapture mutation lifecycleを対象とする。いずれもmulti-tab BroadcastChannel、service-worker強制restart、Chrome／Edge vendor runtime evidence、target proxy通過後のCSP evidenceではない。これらをPASSと過大評価しない。CI/review結果はDraft PRへ記録する。

## Browser evidence status

| Browser             | Detected version    | Result                                                                                                     |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Playwright Chromium | runtime summary参照 | unpacked persistent-context synthetic E2E PASS                                                             |
| Google Chrome       | 140.0.7339.207      | isolated synthetic profileで自動unpacked起動を実行したが、service workerを観測できずFAIL。成功と記録しない |
| Microsoft Edge      | executable未確認    | 未実施。成功と記録しない                                                                                   |

EdgeをOSへ自動installせず、実Edge unpacked install、permission、action、selection、popup、ERP4 handoff、duplicate、disable rollbackの証跡が得られるまでPRをDraft、IssueをOPENに維持する。Google Chromeは`ERP4_CAPTURE_BROWSER_EXECUTABLE=/usr/bin/google-chrome xvfb-run -a npm run test:chromium --prefix packages/browser-capture-extension`で再現し、`unpacked extension service worker did not start`となった。このcommand-line sideload結果はvendor runtime成功証跡として採用しない。原因を推測で断定せず、`chrome://extensions`の`Load unpacked`を利用するmanual手順を完了してから成功と記録する。

## 未実施

- Chrome／Edgeの完全なunpacked runtime evidence
- target proxyを通過したERP4 responseの実効CSP証跡（repository-side template／renderer testはPASS）
- production ERP4 origin、extension store公開／signing／automatic update
- production credential／migration／cutover
- file／image／PDF capture、server-side scraping、browser cookie/history取得

## Rollback

extensionをdisable／uninstallし、browser session draftを破棄する。frontend capture landingを無効化したprevious application imageへ戻せる。capture ledger、Knowledge item／snapshot、auditは保持し、source削除やreverse migrationを行わない。
