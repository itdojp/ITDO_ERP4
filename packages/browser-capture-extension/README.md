# ERP4 Browser Capture Extension

Chrome／Edge向けManifest V3拡張です。表示中ページの許可済みfieldを、利用者の
extension action操作後だけ取得します。拡張機能はERP4 API、cookie、session、
Authorization header、CSRF tokenへアクセスせず、認証済みERP4画面へ論理read TTL
10分の`chrome.storage.session` draftを引き渡します。期限後のreadは拒否され、recordは
次のextension実行時またはbrowser session終了時に物理削除されます。保存はERP4画面上の
previewと明示確定後だけ実行されます。

## Build

production originはrepositoryへ保存せず、build時に単一のexact originを指定します。

```bash
ERP4_CAPTURE_ORIGIN=https://erp4.example.invalid npm run build
```

HTTPはlocal testに限り、次の明示flagとlocalhost系originだけで使用できます。

```bash
ERP4_CAPTURE_ORIGIN=http://127.0.0.1:5173 \
ERP4_CAPTURE_ALLOW_INSECURE_LOCALHOST=1 \
npm run build
```

生成先は`dist/`です。生成manifestはChrome／Edge 112以降を対象とし、`activeTab`、
`scripting`、`storage`だけを要求します。ERP4 content scriptは指定したexact originだけへ
登録します。

## Test

```bash
npm run test
npm run lint
npm run typecheck
npm run format:check
xvfb-run -a npm run test:chromium
```

`test:chromium`は別originのsynthetic pageとERP4 landingを使い、実API、cookie、token、
credentialへ接続しません。Playwright Chromiumの結果はGoogle Chrome／Microsoft Edge
実runtime evidenceの代用ではありません。browser別unpacked手順は
`docs/manual/browser-capture-extension.md`を参照してください。

page bridgeのactor fingerprintは、server-confirmed認証後のactor切替とdraft claimの
整合性確認用です。server署名されたactor attestationではなく、exact ERP4 originの
application JavaScript、target環境で検証済みのCSP、XSS防止、locked browser profileを
信頼境界とします。これらのtarget環境条件を満たさないdeploymentは有効化対象外です。

## Rollback

browserの拡張管理画面でdisableまたはuninstallします。session draftはdisable、reload、
update、browser restartで消去されます。ERP4 cookie/sessionや保存済みKnowledgeは変更・
削除しません。
