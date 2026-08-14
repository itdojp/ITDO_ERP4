# Issue #2017 PWA Web Share Target 検証

## 対象

- baseline: `1f51d5875d43c1986c7acf40ec0a7c18b789f074`
- validated implementation head: `788838103b84f3b1053e510a4a4fabf12556b1f1`
- channel: `pwa_share_target`
- environment: local repository-side synthetic fixture

## 固定契約

- manifest: `POST /share-target`、`multipart/form-data`、`title|text|url`のみ
- service worker: exact action POST、explicit cross-site拒否、headerless Chromium互換はlocal staging限定、raw 128 KiB、fatal UTF-8、file/unknown/duplicate拒否
- local draft: IndexedDB最大10件、TTL 60分、各gesture独立ID、URL非露出request key、既存draft自動evictionなし
- landing: opaque 128-bit IDだけを含む303、`no-store`
- auth/offline: cached auth fallbackなし、first-actor atomic claim／actor-gated delete、auth/draft generation分離、再検証中handoff非表示、actor非含有cross-tab session-generation通知、preview前後・commit/reconcile直前のcanonical actor再検証、別tab logout・offline・server session失効・canonical actor変更・absolute TTLでDOM purge、online再検証後も自動mutationなし
- lifecycle: commit I/O前にbackend正規化済みexact draftとintentを`pending`として同時に永続化し、reloadは編集後payloadから二重commitせずread-only reconcileへ復帰。同一tabは共有BroadcastChannel objectで自己通知を受けず、別tabの`pending|staged`だけをexact recordから再読込する。terminal時はcontent-free tombstoneを先に保存してからopaque lifecycleだけをbroadcast
- cleanup: commit/discard時だけlocal draft削除。tombstone書込みと物理削除のretry phaseを分離し、削除失敗でもDOMを先にpurgeしてURL維持で再試行、pending/result unknownは保持。blocked open後のlate connectionはcloseする。期限切れは表示中でも即時purgeし次のbrowser実行機会に物理削除
- deployment auth: private-smokeはfrontend/backendともheaderを明示、production／https-trialと公式release artifactはjwt_bffを明示。全buildでshare-target modeを固定し、`decommission` bridgeはmanifest／POST intakeを停止してcleanupを維持

## Synthetic security fixture

テストではsynthetic title、`.invalid` URL、scriptに見えるplain text、private canary文字列を使用する。HTMLとして実行せず、URL、Cache API、log、error、capture APIへ受信だけで複製されないことを検証する。実利用者、実記事、credential、cookie、token、request keyは使用しない。

## 検証結果

- focused frontend lifecycle/unit: landing／queue 40/40 PASS、build/config契約5/5 PASS。実IndexedDB transactionを使うunauthenticated discard／actor claim競合、認証済みtombstone → broadcast → physical delete順序、tombstone失敗時のbroadcast 0件を固定し、race focused testは20/20反復PASS
- focused backend actor binding: 86/86 PASS。actor Aのpreview tokenをactor Bのcommit／reconcileへ渡すと、store／ledger mutation／reconcile side effect前に`preview_token_invalid`となる
- focused real-browser PWA: 4/4 PASS。最初の完全一致anchor指定は結合済みPlaywright titleと一致せず`No tests found`となったため、4件の固有titleだけに一致する正規表現へ訂正して再実行した
- frontend full: 954/954 PASS
- backend full: 2397/2397 PASS（canonical actor binding回帰testを含む）
- core E2E: 109/109 PASS
- full E2E: 159 PASS / 34既存条件付きSKIP / 0 FAIL
- UI core coverage: statements 73.70%、branches 66.71%、functions 73.31%、lines 76.46%（表示丸め前のthreshold判定もPASS、threshold変更なし）
- frontend build budget: PASS（entry gzip 22.8 KiB、initial gzip 166.4 KiB、largest gzip 87.1 KiB）
- auth coverage: statements/lines 90.47%、branches 71.64%、functions 98.69%。integrations coverage: statements/lines 91.13%、branches 72.71%、functions 97.09%。全既定thresholdを維持してPASS
- enabled／decommission実build artifact、worker intake gate、no-cache helper、profile伝播: PASS
- `RELEASE_E2E_SCOPE=core make release-readiness`: repo-side 29/29 PASS（外部Go依存 #1426／#544／#1432は本Issueのrepo-side証跡ではないためoverall判定はNO-GOのまま）
- lint／format-check／typecheck／build／audit／ops-quality／profile test／docs index・image link／secret scan／`git diff --check`: PASS

独立reviewで検出された同一tab lifecycle自己通知、編集後exact draft非永続化、terminal failed cleanup、profile auth不一致、IndexedDB teardown／late connection、公式release gate迂回、auth/lifecycle generation競合、tombstone retry phase、同一legacy userIdでのcanonical BFF actor切替TOCTOU、pending IndexedDB transaction中のpurge／unmount競合、cross-tab pending CAS loserによるowner状態の上書き、`enabled + service worker無効`artifactの可能性は修正済みである。決定的結合testはcommit signalがabortされないこと、pending rowが編集後draftを保持すること、reload後のpreview／reconcileが同じrequest keyとpayloadを使うこと、二度目のcommitを送らないこと、canonical actor変更結果がremote lifecycleで破棄されないこと、別tab session-generation通知で旧actor payloadを即時purgeすること、operation境界のactor不一致ではpreview結果を採用せずcommit／reconcileを呼ばないこと、deferred pending書込中にpurge／unmountしてもCAS winnerだけが自身のoperation IDを使って`staged`へ補償し、loserはownerのpending rowを変更・通知・再送しないことを検証する。server側のactor-bound preview token testはfrontend再検証後のsession切替もside effect前に拒否することを固定する。

security reviewで指摘されたinitiator metadata欠落は、両header必須化を一度実装してreal-browser PWA 4件を実行した結果、Chromiumのservice worker Requestでは同一origin POSTでもmetadataが不可視となり3件が拒否される事実を確認した。最終契約はexplicit cross-siteを拒否し、両header欠落だけをlocal IndexedDB stagingに限定して受理する。API mutation、cookie/token読取、自動保存はなく、queue 10件、TTL 60分、認証済みexact preview、明示confirmを防御境界とする。最終focused real-browser PWAは4/4 PASSである。

2026-08-14 JSTにcleanなimplementation head `87dfe2e682271bdff36007c66fdbba3e01850756`でrelease-readiness 29/29、PWA focused 4/4、full E2E 159 PASS／34既存条件付きSKIP／0 FAIL、frontend 954/954、backend 2397/2397、audit、ops-quality、secret scanを再実行した。独立reviewで検出されたglobal mutation中のsingle-delivery handoff消失、unauthenticated discard／actor claim順序、認証済みtombstone cleanup順序、全runbook invocationのprofile continuity、採取証跡とrecord profileの不一致は修正し、negative／concurrency testで固定した。最後のreview remediationでは`update-stack.sh`と`rollback-latest.sh`をprofile continuity gateへ追加し、各コマンドの非束縛呼び出しを拒否する負例を固定した。また、trial recorderのhelpを実際のfail-closed profile契約へ一致させた。

Copilot reviewで、decommission時のexact share-target POSTがservice workerの通常fetch pathへ流れ、request bodyがnetworkへfallbackし得る点を検出した。修正後はsource artifactの既定を`decommission`とし、exact same-origin POSTを常にinterceptして、enabled時だけlocal stagingへ進め、それ以外は`410 share_target_disabled`／`no-store`でworker内終端する。公式buildは`VITE_ENABLE_SW`とshare-target modeの明示設定を必須とし、E2EのVite dev serverだけが`ERP4_DEV_SHARE_TARGET_MODE=enabled`を明示して生成modeを返す。最初のfull E2Eではsource既定のfail-closed化によりPWA 3件が410となる回帰を検出したが、source既定を緩めず、このdev-only明示mode bridgeを追加してfocused 4/4とfull 159/159対象PASSを再確認した。service worker focused 21/21、build/config 5/5、profile missing-env negative testもPASSした。この証跡文書を更新する後続commitは検証済みimplementation treeを変更しないdocs-only commitとする。

最終security reviewでは、`sakura-vps-trial-checklist.md`がops docs formatting／link checkとprofile continuity gateの対象外である点を検出した。`db3f0edb1dead9a0aec21abb07018eda48e5d64c`で同checklistを両gateへ追加し、check-env、build、install、start、readiness、evidence、rollbackの各profile-aware呼出しを`--profile "$PROFILE"`へ固定した。続くcorrectness reviewで、環境変数prefix付きのインライン呼出しを行頭限定matcherが見落とす点を検出したため、`788838103b84f3b1053e510a4a4fabf12556b1f1`で行中の全Quadlet invocationを検査し、prefix付き非束縛buildを拒否するnegative fixtureを追加した。新しいexact implementation headで`make ops-quality`、release-readiness 29/29、core E2E 109/109、full E2E 159 PASS／34既存条件付きSKIP／0 FAIL、secret scan、`git diff --check`を再実行してPASSした。

## Threat model

| 脅威                                           | mitigation                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| malicious share sender／page content injection | strict field allowlist、fatal UTF-8、Unicode/control/size bounds、plain-text rendering                                                        |
| credential URL／scheme confusion               | HTTP(S) only、userinfo拒否、URL fetchなし                                                                                                     |
| CSRF／session theft                            | service workerはAPI/cookie/token/CSRFへアクセスせず、認証済み画面の既存CSRF境界でのみmutation                                                 |
| initiator metadata欠落／cross-site staging     | explicit cross-site拒否。headerless互換はbounded local stagingのみで、認証済みpreview／confirm必須                                            |
| duplicate／offline replay                      | URL非露出request key、server request ledger、明示confirm、no automatic retry                                                                  |
| stale local retention                          | 60-minute read cutoff、次の実行機会の物理purge、最大10件、commit/discard cleanup、明示discard                                                 |
| shared-browser account confusion               | canonical actor、actor非含有tab通知、operation前後のactor再検証、auth/draft generation分離、再検証中非表示、atomic claim、auth loss DOM purge |
| cross-tab replay／terminal cleanup failure     | persisted exact draft＋intent、sender-safe lifecycle、retry phase分離、content-free tombstone                                                 |
| URL／cache／log leakage                        | opaque ID only 303、no-store、Cache API不使用、content-free error                                                                             |
| organization scope escalation                  | personal default、server preview、group ACL再検査、organization追加confirm                                                                    |

## 未実施

- OS share pickerのtarget-environment手動操作
- browser extension、Chrome／Edge runtime（PR C）
- file/image/PDF共有
- production URL、credential、extension store、production migration

これらをPWA repo-side成功として扱わない。
