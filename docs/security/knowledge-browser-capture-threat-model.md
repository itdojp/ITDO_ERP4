# Knowledge Browser Capture脅威モデル

## Scopeと信頼境界

対象はPWA Web Share Target、Chrome／Edge Manifest V3拡張、認証済みERP4 capture landing、既存Knowledge capture ingressです。外部page／share sender、browser-local staging、ERP4 origin、BFF/API、Knowledge DBを別の信頼境界として扱います。外部入力からKnowledge mutationへ直接接続しません。

exact ERP4 originで配信されるapplication JavaScriptは信頼境界内です。landingはBFF/APIによるserver-confirmed認証が完了するまでextensionへ本文を要求しません。actor fingerprintは、その後のactor切替とdraft claimの整合を束縛するものであり、server署名された暗号学的actor attestationではありません。malicious source pageは別originでありERP4 content scriptへ接続できませんが、ERP4 same-origin XSS、DevToolsを操作できるlocal user、またはunlocked ERP4 browser profileはこの信頼境界を侵害できます。

## Assets

- 選択文字列、page URL、title、allowlist metadata
- ERP4 auth session、personal／organization Knowledge ACL
- capture request key、preview token、extension／PWA local draft
- item＋snapshotのidempotency ledgerとmandatory audit

## Threat actors

- malicious／compromised webpageとshare-sender application
- cross-site attacker、origin-confusion attacker、replay attacker
- 同一browser profileへアクセスできるunauthorized local user
- compromised extension dependency／build artifact

## Threats and mitigations

| Threat                                      | Mitigation                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| page content injection／XSS                 | primitive allowlist、plain-text rendering、`innerHTML`／raw HTML／remote code禁止、extension CSP、標準frontend imageのresponse CSP（self scriptとbuild時exact API origin）                                                                                                                                     |
| password／cookie／session theft             | form/password値を読まない、cookie permission/APIなし、ERP4 token／CSRF headerを取得・保存しない                                                                                                                                                                                                                |
| permission overreach／background collection | `activeTab\|scripting\|storage`だけ、browser action user gesture、main frameだけ、content scriptはERP4 exact originだけ                                                                                                                                                                                        |
| malicious metadata／prototype pollution     | fixed field schema、unknown/nested/array/prototype key拒否、provider objectをspreadしない                                                                                                                                                                                                                      |
| oversize／Unicode／encoding attack          | field別／total byte上限、code-point上限、fatal UTF-8、NUL／C0/C1／bidi-control／ill-formed Unicode拒否                                                                                                                                                                                                         |
| URL credential／scheme confusion            | extensionとserver canonical URL境界の双方でexplicit HTTP(S) only、userinfo／credential-like query・path・matrix拒否、query/pathのbounded多層decode、nested URL pathname再検査、opaque session名／nested userinfo／zero/one/two-slash・backslash検査、fragment／tracking query除去、URL fetch／redirect巡回なし |
| origin confusion／message spoofing          | exact build origin、extension ID、`event.source === window`、event origin、draft ID、schema、one-time nonce、server-confirmed actor由来fingerprintを照合。TTL内の受理済みnonceはevictせず、32件到達後はfresh terminal delete以外をfail closedにする。fingerprintをserver署名とは扱わない                               |
| CSRF／session confusion                     | local stagingはmutationなし。server-confirmed actor後だけ既存BFF/CSRF/ACL/preview-confirm境界へ渡し、actor切替時にDOMとintentをpurge                                                                                                                                                                           |
| duplicate／offline replay                   | opaque server-side request-key hash、item＋snapshot ledger、session lifecycle、no automatic retry、read-only reconcile                                                                                                                                                                                         |
| stale／sensitive local retention            | PWA 60分／10件、extension session storage 10件・論理read TTL 10分、terminal cleanup、expiry read拒否、次のextension実行／session終了時の物理削除、persistent extension storageなし                                                                                                                             |
| organization scope escalation               | personal default、server-side current group ACL再検査、audience表示、organization追加confirm                                                                                                                                                                                                                   |
| source spoofing／overcollection             | domainからsource typeを推測せず、選択／省略fieldをexact previewし、非選択fieldをsnapshotへ保存しない                                                                                                                                                                                                           |
| result unknown                              | pendingを通常成功と分離し、同じ操作を自動再送せず既存artifact／ledgerだけをreconcile                                                                                                                                                                                                                           |

## Residual risks

- extension session draftはbrowser session終了、extension reload／updateで失われ得る。機密本文をpersistent storageへ残さないための可用性上の選択である。
- OS/browser profileを共有するlocal userは、未claim PWA draftやunlocked browser sessionへアクセスし得る。共有端末はOS/browser profileを分離し、ERP4 logoutと画面lockを運用要件とする。
- ERP4 same-origin XSSまたはDevToolsを操作できるlocal userは、page/extension bridgeを正規applicationと同じorigin権限で操作し、別originから取得したdraftを読取／削除し得る。これはexact origin、nonce、actor fingerprintによるauthenticationでは防げない。標準frontend imageのresponse CSPはself script、既存Google Identity script/style、build時exact API originへ制限し、service-worker／asset locationでもsecurity headerを明示するが、target proxyを通過した`/`、SPA route、worker、assetの実効headerとXSS防止を別途検証する。trusted deployment、browser profile lockも有効化前提とし、証跡がない環境ではextensionを有効化しない。将来この前提を外す場合はserver署名されたone-time handoff capability等を別設計として導入する。
- Chromium E2EはChrome／Edge vendor runtimeのpermission表示、store policy、enterprise policyを保証しない。各browserのunpacked runtime evidenceを別に必須とする。
- extension store signing、production origin、managed browser policyは未検証であり、target-environment rollout前に別承認と証跡が必要である。

## Rollback

PWAはshare targetをdecommissionしてlocal draft cleanupを維持する。extensionはdisable／uninstallし、必要ならbrowser sessionを終了する。backend／frontendはcapture ingressを無効化したprevious application imageへ戻す。additive ledger、item、snapshot、auditを保持し、source削除やreverse migrationを行わない。
