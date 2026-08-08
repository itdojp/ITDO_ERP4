# Knowledge Hub 保存・annotation・会話・Synthesisガイド

## 目的と対象

Knowledge Hub は、外部情報や手動メモを ERP4 の Inbox 項目として登録し、保存時点の内容を改変しない snapshot として版管理する画面です。選択した項目には、本人annotation、取り込んだ会話、versioned Synthesisを別entityとして追加できます。`user` / `admin` / `mgmt` / `exec` ロールの利用者を対象とします。

MVP で扱う入力は次の4種類です。

- 手動テキスト（UTF-8で最大1 MiB）
- 認証情報を含まない HTTP(S) URL
- PDF（最大10 MiB）
- PNG / JPEG / WebP / GIF 画像（最大10 MiB）

ログイン済みページの自動取得、SNS API巡回、source file削除、Google Driveやオブジェクトストレージへの直接リンク提供は行いません。

## 新しい Inbox 項目へ保存する

1. 左メニューの `ナレッジ` から `Knowledge Hub` を開きます。
2. `保存先` は既定の `新しいInbox項目` を選択します。
3. `保存形式` を選択します。
4. `scope` を確認します。通常は既定の `personal（個人）` を使用します。
5. 必要に応じてタイトルを入力し、本文、URL、PDF、画像のいずれかを指定します。
6. `Inboxへ保存` を選択します。
7. `保存済み`、version、content type、size、取得日時、SHA-256を確認します。

![Knowledge Hub 手動保存](../test-results/2026-08-06-issue2012-knowledge-snapshot-ui/01-knowledge-hub-manual-capture.png)

## 既存項目へ version を追加する

1. `Knowledge Inbox` から対象項目を選択します。
2. `保存先` を `選択中の項目へversion追加` に変更します。
3. 保存形式と内容を指定します。
4. `新しいversionを保存` を選択します。
5. version 履歴に新しい版が追加され、以前の版が更新されていないことを確認します。

確定済み snapshot は画面から上書きしません。内容を訂正する場合も、新しい version として追加します。

## scope と共有範囲

### personal

- 既定値です。
- 通常の UI / API では owner だけが参照できます。
- 会社の運用者、監査、バックアップから独立した私物保管領域ではありません。

### organization

- `共有先グループID` を1件以上入力します。
- 保存前に `組織の共有範囲へ保存することを確認しました` を明示的に選択します。
- role 名だけでは閲覧範囲を拡張せず、対象組織と有効な group grant によって認可されます。
- 保存先が organization の既存項目である場合も、version 追加ごとに確認が必要です。

誤った共有範囲を指定した場合、画面上で scope を変更して再保存するのではなく、組織の運用手順に従って対象項目を確認してください。

## 本人annotationを追加・改訂する

1. `Knowledge Inbox` から対象項目を選択します。
2. `Annotation / 会話 / Synthesis` の `本人annotation` tabを開きます。
3. 種類（本人メモ、質問、仮説、引用、TODO）とorigin（本人、外部情報、AI、System、Tool）を選択します。
4. 本文を入力し、`アノテーションを作成` を選択します。
5. 訂正する場合は対象annotationの`改訂`を選びます。旧本文はrevision履歴に残り、上書き消去されません。
6. 不要になった場合は`削除`を選びます。論理削除のため、再読込後も削除済みであることと履歴を確認できます。

annotation本文は元snapshotへ連結されません。種類とoriginは色だけでなくtext labelでも表示されます。organization項目でも、current item ACLをserver側で再検査します。一覧またはrevision履歴に続きがある場合は`さらに読み込む`操作が表示され、opaque cursorで次ページを取得します。

## 会話をpreviewして取り込む

`会話・取込` tabでは、次の3形式を一件の`KnowledgeConversation`として取り込みます。

- 手動入力: タイトル、role、origin、1 turnの本文を画面で入力する
- JSON: strictな`title`、`provider`、`model`、`turns[]`構造を入力する
- Markdown: 次のversion付き限定文法を入力する

```markdown
# Knowledge Conversation v1

title: 検証会話
provider: other
model: other

## Turn

role: user
origin: user

確認したい内容

## Turn

role: assistant
origin: ai

回答本文
```

Markdownの見出しや引用記号からspeakerを推測しません。raw HTML、script、linkを実行・取得せず、本文はtextとして表示します。

1. 形式と内容を指定し、`取込内容をプレビュー`を選択します。
2. title、turn数、role、origin、関連item数、有効期限を確認します。この時点ではDBへ会話を保存しません。
3. 内容を変更した場合は以前のpreviewを使用せず、もう一度previewします。
4. `取込を確定`を明示的に選択します。
5. 同じoperationを再送した場合は`再利用`と表示され、conversationやturnを増殖させません。

上限はraw/canonical各512 KiB、1 turn 64 KiB、turn 200件、linked item 20件、JSON depth 12/node 5,000、Markdown 5,000行です。preview tokenは10分間だけcomponent memoryへ保持し、request keyとともに画面・log・永続storageへ表示・保存しません。

取り込み後のtimelineでは`User`、`AI Assistant`、`System`、`Tool` roleと、本人・外部情報・AI・System・Tool originを別labelで確認できます。provider/modelは固定語彙だけを表示し、provider URL/keyは表示しません。関連会話またはtimelineに続きがある場合は`さらに読み込む`操作で次ページを取得できます。

## Synthesisを作成・version追加する

1. `Synthesis・結論` tabを開きます。
2. タイトル、結論、confidence、未解決事項を入力します。
3. `統合知を作成`を選択します。選択中のKnowledge itemが`主根拠`として明示的に関連付けられます。
4. 結論を更新するときは新しいversionを追加し、version履歴を確認します。

confidenceは0〜100%で入力し、未設定と0%を区別します。未解決事項は結論と分離して表示されます。sourceへのcurrent accessが失効した場合、非公開本文や識別子を展開せず`参照不可（redacted）`として表示します。Synthesis scopeは選択中itemと同じ値に固定され、画面操作だけでpersonalからorganizationへ昇格しません。

Synthesis一覧はcurrent actorが参照可能なglobal一覧です。選択中itemをcurrent versionのaccessibleなitem sourceとして持たないSynthesis、またはcurrent sourceの一部が参照不可のSynthesisは参照専用となり、不完全なprovenanceでversionを置き換える操作はできません。version追加時はcurrent sourceの種類・関係・順序を維持します。一覧またはversion履歴に続きがある場合は`さらに読み込む`操作で次ページを取得します。

![本人annotationの改訂履歴](../test-results/2026-08-08-issue2013-knowledge-provenance-ui/01-annotation-revision-history.png)

![会話のroleとorigin timeline](../test-results/2026-08-08-issue2013-knowledge-provenance-ui/02-conversation-role-timeline.png)

![Synthesisのversionとprovenance](../test-results/2026-08-08-issue2013-knowledge-provenance-ui/03-synthesis-version-provenance.png)

## 保存状態と再照合

| 状態       | 意味                                      | 操作                                                              |
| ---------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `確認中`   | 外部保存結果が確定していない              | 同じブラウザ session に表示される `保存結果を再照合` を実行する   |
| `保存済み` | immutable snapshot と checksum が確定した | provenance を確認し、必要なら認可済み download を実行する         |
| `失敗`     | 検証または保存が確定的に失敗した          | 画面のsanitized案内に従い、入力を確認して新しい操作として保存する |

保存処理の結果が不明な場合、画面は Inbox 項目を保持し、同じ外部 create を自動再送しません。再照合用 request key は現在のブラウザ session 内だけに保持され、画面や log には表示されません。再読込後に再照合ボタンがない場合は、自動再送せず運用担当へ確認してください。

## 認可済み download

- `保存済み` の snapshot だけに download ボタンが表示されます。
- download の直前に ERP4 が item / snapshot / artifact owner の認可と状態を再確認します。
- provider URL、provider key、直接共有権限は利用者へ返しません。
- HTML等の active content を画面内で実行せず、download response は attachment として扱います。

## 入力エラーと安全上の注意

- URL は `http://` または `https://` で始まり、username/passwordを含まないものを指定します。
- server側では redirect、private/loopback address、timeout、content type、宣言sizeと実測sizeを再検証します。
- browser側のファイル拡張子やMIME確認だけを安全性の根拠にしません。
- error response の生本文、provider識別子、secret様値は画面に表示しません。
- 実credential、個人情報、顧客機密をテストや画面証跡へ入力しないでください。

## 関連文書

- [Knowledge Hub 基盤要件](../requirements/knowledge-hub.md)
- [Knowledge Hub 境界 ADR](../architecture/knowledge-hub-boundary.md)
- [Issue #2012 UI/E2E 検証結果](../test-results/2026-08-06-issue2012-knowledge-snapshot-ui.md)
- [Issue #2013 annotation／会話／Synthesis UI検証結果](../test-results/2026-08-08-issue2013-knowledge-provenance-ui.md)
