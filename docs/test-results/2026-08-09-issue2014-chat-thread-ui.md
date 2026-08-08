# Issue #2014 Chat thread UI / E2E verification（PR C）

## 対象

- Issue: #2014 `feat(chat): backward-compatible thread and reply foundation`
- Parent: #2003 Workstream 06
- Phase: PR C（frontend thread UI / E2E / manual / evidence）
- Baseline: PR A #2047、PR B #2048 merge後の `origin/main`
- Fixture: synthetic private-group room / root / user / assistantではなく、Chatのroot/reply/mention/ack/reaction/deletionデータのみ

## 実装境界

- 既存 `RoomChat` の親timelineへreply count / last activity / thread open導線を追加。
- thread panelは既存backend APIを使用し、返信pagination、通常返信、確認依頼付き返信、mention、reaction、ack、logical deleteを扱う。
- room timelineにreplyを重複表示しない。
- replyの横断検索結果は親threadへ解決する。
- API responseはallowlist normalizerで再構築し、unknown/provider/internal fieldをstateへ保持しない。
- thread/search/reply responseは期待room・root・relationへbindし、不整合responseをstate/read mutationへ反映しない。
- Chat API境界はshared clientの診断Errorを固定文言へ変換し、添付取得失敗はstatusだけを保持する。raw response bodyやrequest pathをbrowser console/E2E logへ複製しない。
- logical delete後は本文、tag、mention、reaction、ack、attachmentを表示しない。
- timeline/threadとも、表示済みの最新 `(createdAt, messageId)` だけをroom read boundaryとして送信する。
- global searchはserverの `(nextBefore, nextBeforeId)` を使い、stale requestをabort/破棄する。

## 自動テスト

未実行項目を成功として扱わない。`release-readiness` はclean checkoutを要求するため、commit後のexact headで実行し、結果はPR本文へ追記する。

| 検証                                     | 結果   | 証跡／補足                                                                         |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| focused frontend unit                    | PASS   | 6 files / 44 tests                                                                 |
| frontend full                            | PASS   | 92 files / 583 tests                                                               |
| UI core coverage                         | PASS   | statements 70.65%、branches 63.81%、functions 69.95%、lines 73.10%（閾値変更なし） |
| frontend build budget                    | PASS   | initial JS 516.3 KiB / gzip 157.8 KiB                                              |
| backend full                             | PASS   | 2,040 tests                                                                        |
| focused real-backend E2E                 | PASS   | `frontend-chat-thread.spec.ts` 1/1（core/full両scopeで成功）                       |
| core E2E                                 | PASS   | 107 passed                                                                         |
| full E2E                                 | PASS   | 153 passed / 34 expected conditional skips                                         |
| PostgreSQL 15 integration                | PASS   | reply pagination、ACL、search、unread、ack、logical delete、raceを含む             |
| old-application compatibility            | PASS   | baseline `4b3196a...`、old response/write/data保持                                 |
| OpenAPI export / breaking diff           | PASS   | checked-in OpenAPIとの差分なし                                                     |
| bounded-context / docs / image links     | PASS   | dependency 0 violation、coverage PASS、130 image links                             |
| audit / secret scan                      | PASS   | npm audit high/critical 0、tracked-file secret scan 0（最終標準gateでも再確認）    |
| lint / format / typecheck / build / test | PASS   | backend 2,040 / frontend 583、全標準gate成功                                       |
| release-readiness core                   | 未実行 | clean exact headで実行しPR本文へ記録                                               |

## Real-backend E2E matrix

`packages/frontend/e2e/frontend-chat-thread.spec.ts` はsynthetic fixtureだけで次を検証する。

1. private-group roomと旧互換root messageを作成
2. UIからthreadを開き通常replyを投稿
3. reply count / last activityを更新
4. reply mentionとnotificationを確認
5. 確認依頼付きreplyを投稿してack
6. reply reactionを追加
7. global searchのreply結果からthreadを開く
8. room-level unreadへreplyが反映されることを確認
9. outsider thread accessが404であることを確認
10. replyをlogical deleteし、本文非表示placeholderを確認
11. room root timelineへreplyが重複しないことを確認
12. 375 x 667 viewportで横overflowがないことを確認

## Screenshot

![Synthetic chat thread at 375px](2026-08-09-issue2014-chat-thread-ui/01-chat-thread-mobile.png)

スクリーンショットはsynthetic fixtureだけを使用し、実ユーザ、実メール、顧客、credential、provider ID/URL、request keyを含めない。

## Security / privacy

- room ACL、project alias、mention/notification/reaction/search/unread/ackのserver契約はPR A/Bの正本を維持する。
- unauthorizedとmissingの外部表示を区別しない。
- raw backend error body、parser stack、provider URL/key、unknown response fieldをUIへ表示しない。
- mutation成功後のrefresh failureでは読み込み済みstateを保持し、「再送せず再読み込み」を表示する。
- 後続pageのreaction/ackはmutation responseを対象messageへ局所適用し、先頭page refreshでstale化させない。
- root削除成功時はrefresh失敗時も親timelineへcontent-freeな削除済み状態を通知する。
- panel close/unmount後は完了したmutationから旧threadのrefresh/read副作用を開始しない。
- deleted message contentをclient state/renderから除去する。
- 新規dependencyなし。外部API・credential・provider cutoverなし。

## 未実施の実環境範囲

- Sakura VPS、live Quadlet/systemd、production migration、production credential
- Google Drive / Sakura Object Storage
- external LLM / ChatGPT session / X・Threads API

## Rollback

- frontend commitをrevertしてthread panel導線を外す。
- PR A/Bのadditive schema/API/dataは保持する。DB table/column/drop、replyデータ削除、counter再計算は行わない。
- 旧clientは引き続きroot-only timelineを利用できる。
