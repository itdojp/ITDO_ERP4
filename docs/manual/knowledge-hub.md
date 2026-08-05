# Knowledge Hub 手動保存ガイド

## 目的と対象

Knowledge Hub は、外部情報や手動メモを ERP4 の Inbox 項目として登録し、保存時点の内容を改変しない snapshot として版管理する画面です。`user` / `admin` / `mgmt` / `exec` ロールの利用者を対象とします。

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
