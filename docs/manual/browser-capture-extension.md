# Browser Capture拡張運用

## 対象

ERP4 Browser CaptureはChrome／Edge向けManifest V3拡張です。利用者のbrowser action後だけ、表示中ページのURL、title、選択文字列、canonical URL、description、author、published timeを取得します。拡張からERP4 APIへrequestせず、認証済みERP4画面のpreview／confirmを経て保存します。

対象runtimeはChrome／Edge 112以降です。URL fragmentと既知tracking queryはlocal staging前に除去し、credential-like query／path／matrix parameter、署名付きURL、credentialを含むnested URLはdraft全体を拒否します。query／pathの多層encode、`sessionid`／`PHPSESSID`／`sid`／`sessid`等のsession名、nested URLのuserinfo、非canonical slash／backslash表記も拒否対象です。

## Build

実production URLをrepositoryへ保存せず、配布環境ごとにexact HTTPS originを指定します。

```bash
npm ci --prefix packages/browser-capture-extension
ERP4_CAPTURE_ORIGIN=https://erp4.example.invalid \
  npm run build --prefix packages/browser-capture-extension
```

生成先は`packages/browser-capture-extension/dist`です。buildはuserinfo、path、query、fragment、wildcard、通常のHTTPを拒否します。localhost HTTPはtest専用flagを明示した場合だけ許可します。

## Unpacked install

### Chrome

1. `chrome://extensions`を開く。
2. Developer modeを有効にする。
3. `Load unpacked`で生成済み`packages/browser-capture-extension/dist`を選択する。
4. permission表示が`activeTab`、`scripting`、`storage`の範囲で、broad site access、cookie、historyがないことを確認する。生成manifestが`incognito: not_allowed`であり、シークレットモードで有効化できないことも確認する。

### Edge

1. `edge://extensions`を開く。
2. Developer modeを有効にする。
3. `Load unpacked`で同じ生成済みdirectoryを選択する。
4. permission表示とsite accessがChromeと同じ最小範囲であることを確認し、InPrivateで有効化できないことを確認する。

## Browser runtime確認

実利用者データではなく、synthetic HTMLとtest ERP4 originを使用します。通常利用中のbrowser profileを証跡取得へ流用せず、synthetic fixture専用の新規profileへunpacked extensionを導入してください。

1. synthetic pageを表示し、本文の一部だけを選択する。
2. extension actionを操作する。action操作前にpopup／capture／background送信がないことを確認する。
3. popupでtitle、現在URL、selection、allowlist metadataだけが表示されることを確認する。password input、script、unknown meta、DOM HTMLがないことを確認する。
4. `ERP4で確認`を選び、URLには`browserCapture`のopaque IDだけがあることを確認する。
5. ERP4のserver-confirmed login後にdraftを読み、personal scope、field preview、明示confirmを確認する。
6. 同じdraftを再読込しても新しいKnowledge item／snapshotが増えず、結果不明では自動retryされないことを確認する。保存結果確定後にtombstone書込みが失敗した場合はsession内本文の消去済みを主張せず、current URLからhandoff IDを外して本文消去だけを明示再試行することを確認する。物理削除だけが失敗した場合は、本文を含まないcleanup表示だけが復元され、明示削除retry以外の操作がないことを確認する。
7. offline／unavailableではsession draftを保持し、利用者が再試行するまでhandoffしないことを確認する。
8. browser名、完全version、permission画面、popup、handoff、duplicate、offline、disable rollbackをsanitized evidenceへ記録する。
9. target ERP4 responseの実効CSPを確認する。標準frontend imageはbuild時に`VITE_API_BASE`のexact originを`connect-src`へ束縛したresponse CSPを生成するが、配備先proxyを通過した`/`、SPA route、`/sw.js`、`/share-target-sw.js`、`/assets/*`の最終response headerを必ず再確認する。各responseでCSP、`Referrer-Policy`、`X-Content-Type-Options`が有効であることを確認する。CSP証跡がなく、exact origin application JavaScriptを信頼できない環境ではextensionを有効化しない。

Chromium E2Eやstatic manifest reviewをChrome／Edge実runtime evidenceとして扱いません。対象browser executableへアクセスできない場合は、そのbrowserを成功と記録せずDraft PRとIssueへblockerを残します。browserを自動installしません。

## Security boundary

- Manifest V3、extension CSP、remote codeなし
- permissionは`activeTab|scripting|storage`だけ
- `incognito: not_allowed`でシークレットモード／InPrivateを対象外にする
- main frame、allowlist metadata、plain-text表示
- exact ERP4 originの生成content scriptだけ
- `chrome.storage.session`最大10件、論理read TTL 10分（期限後の物理削除は次のextension実行またはbrowser session終了時）
- one-time nonce、opaque draft ID、actor fingerprint
- actor fingerprintはserver-confirmed認証後のactor切替／claim整合用であり、server署名されたattestationではない。ERP4 exact originのapplication JavaScript、target環境で検証済みのCSP、XSS防止、locked browser profileを信頼境界とし、CSP証跡がないdeploymentではextensionを有効化しない
- cookie、token、CSRF header、localStorage、persistent extension storageを取得しない
- ERP4 APIへ直接fetchせず、認証済み画面の既存CSRF／ACL／preview tokenへ委譲

詳細は[Browser Capture脅威モデル](../security/knowledge-browser-capture-threat-model.md)を参照してください。

## Rollback

1. 対象browserの拡張管理画面でERP4 Browser Captureをdisableまたはuninstallする。
2. 必要に応じてbrowser sessionを終了し、session draftを破棄する。
3. frontend側のbrowser capture landingを無効化したprevious application imageへ戻す。

rollbackでKnowledge source、capture ledger、item、snapshot、browser cookie／sessionを削除しません。production extension store公開、signing、automatic updateは本Issueの対象外です。
