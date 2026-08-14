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

- Manifest V3 permissionは`activeTab|scripting|storage`だけ。broad host permission、cookie、tabs、history、webRequest、remote codeを使用しない。
- minimum Chromium versionは112。session storage 10 MiB契約に基づき、10件・各128 KiB上限とorganization group最大100件を収容する。
- action user gesture後にmain frameのURL、title、selection、canonical、description、author、published timeだけを取得する。
- ERP4 originはbuild時のsingle exact origin。production実値はcommitしない。
- draftは`chrome.storage.session`へ最大10件、論理read TTL 10分。期限後はreadを拒否し、次のextension実行またはsession終了時に物理削除する。persistent storage、handoff URL、Cache API、logへ本文を保存しない。
- 初回stageの応答が不明でも、同じpopup内の利用者retryは同じopaque draft ID／request key／selected payloadを再利用し、queueへ別draftを追加しない。recordは一回のstorage writeで保存し、popup再open時は最大10件のbounded record setから未claimの最新draftを導出する。独立recent pointerへ依存しない。
- extensionはERP4 API、cookie、token、Authorization、CSRF headerへアクセスしない。認証済みlandingのpreview／confirmだけが既存capture ingressを呼ぶ。
- bridgeはextension ID、exact origin、opaque draft ID、nonce、actor fingerprintを照合し、受信だけではmutationしない。actor fingerprintはsame-origin XSSに対するauthenticationではない。標準frontend imageはself scriptとbuild時exact API originへ制限したresponse CSPを生成するが、targetの実効CSP／XSS防止／locked profileを有効化前提とする。
- result unknownは自動retryせず、same request ledgerのread-only reconcileへ戻す。

## Synthetic fixture

別originのsynthetic pageにtitle、選択文字列、canonical URL、allowlist metadataと、password／script／unknown metadata canaryを配置した。browser actionをOS-level keyboard gestureで開き、allowlist fieldだけがpopupとexact-origin handoffへ届くこと、canaryが届かないこと、URLがopaque draft IDだけを運ぶこと、同じdraftの明示再読込が新しいstaging／mutationを作らないことを確認した。synthetic bridgeでは`staged → pending → staged → delete`、response loss相当のidempotent second delete、delete後get拒否も確認した。

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
- Chromium synthetic browser境界: action gesture、popup、exact-origin handoff、canary非漏えい、pending/staged/delete/idempotent delete: PASS

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
