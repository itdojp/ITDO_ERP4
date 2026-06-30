# UIUX v644 提案成果サマリと採用判断メモ

最終更新: 2026-07-01

## 目的

ERP4 の UIUX を「足し算」と「引き算」の両面から洗練させるため、local-only で作成していた UIUX 提案成果を GitHub 上でレビュー可能な形に要約する。

この文書は **採用判断用の提案サマリ** であり、アプリケーション実装そのものではない。v644 までの成果は有効な判断材料だが、世界トップレベル完了を証明する正式証跡は未完了である。

## 結論

- v640〜v644 の local-only 提案反復では成果が上がっている。
- 最新の採用判断 baseline は `v644-formal-evidence-handoff-v643-answer-calibration-boundary-replay` とする。
- v645 以降を同じ形式で継続しても、正式な完了証跡は増えない。
- 次に必要なのは、提案の追加反復ではなく、採用判断と実証跡収集フェーズへの移行である。

## v644 のステータス

| 項目 | 結果 |
|---|---:|
| Status | `PASS_LOCAL_ONLY_NOT_GOAL_COMPLETE` |
| Manifest / required artifacts | `27075 / 27075` |
| Quality gates | `657` |
| Known non-completion gates | `650` |
| Package verification | `PASS` |
| Package total checks | `666` |
| Package failures / warnings | `0 / 0` |
| Audit | `PASS` |
| Audit failures / warnings | `0 / 0` |
| Dry-run CLI refusal | `95 / 95` |
| Dry-run shell refusal | `95 / 95` |
| Visual evidence | `1200x27223 RGB`, `6451530` bytes |
| GitHub reflection at v644 completion | `none` |
| Goal complete | `false` |
| Residual proof gaps | `6` |

## 成果の要約

### 1. 採用判断用 baseline の確立

v644 では、v643 までの answer calibration を boundary replay し、提案が以下へ誤って昇格しないことを検証した。

- 実装適用
- 採点結果の保存
- answer-key mutation
- decision 記録
- formal proof 受理
- WCP closure
- source patch / mutation
- GitHub reflection
- goal completion

これにより、local-only 提案と正式採用・正式証跡を分離する境界が明確になった。

### 2. 足し算のデザイン

提案品質を高めるため、判断・監査・再現性に必要な情報を追加した。

| 追加領域 | 件数 |
|---|---:|
| Boundary replay catalog | `24` |
| Paraphrase replay probes | `24` |
| Short answer replay probes | `24` |
| Executive summary replay probes | `24` |
| Status memo replay probes | `20` |
| Reviewer objection replay probes | `20` |
| Risk digest replay probes | `20` |
| Locale shift replay probes | `20` |
| No-apply boundary guard | `24` |
| Additive datasets / tables | `44` |

足し算の狙いは、見た目の改善案だけでなく、採用判断、レビュー、反証、境界条件を追跡できる状態にすることである。

### 3. 引き算のデザイン

提案段階で実行すべきでない操作を明示し、dry-run で拒否できることを確認した。

- prohibited operations: `95`
- CLI wrapper refusal: `95 / 95`
- shell wrapper refusal: `95 / 95`
- side effects: `0`

引き算の対象は、未採用の提案が実装適用・証跡受理・完了宣言へ進むことを防ぐ操作である。これにより、提案品質を上げながら運用上の誤適用リスクを下げた。

### 4. 固定点と検証の安定化

v644 は、以下の検証で安定した。

- target audit
- quality gate audit
- adoption rehearsal audit
- completion gap audit
- package verification
- sync verification
- visual precheck / visual inspection
- final verification
- post-final check

package verification は `PASS`、`totalChecks=666`、`failures=0`、`warnings=0` である。

## 現時点で完了していないこと

この文書の対象は提案成果の要約であり、以下は未完了である。

1. 採用判断後の実装 ref 確定
2. 採用/merge 済み実装 ref での core/full E2E pass 証跡
3. 採用/merge 済み実装 ref での正式 WCAG 2.2 AA 再監査
4. NVDA / JAWS / VoiceOver / TalkBack 実機セッション、blocker 0、匿名化 defect close evidence
5. 実 DB/API で 50/100/500 件投入したデータ密度検証
6. 主要 6 タスクについて最低 5 名の実ユーザー Before/After 測定

上記 6 点は、local-only 提案書の追加反復だけでは解消できない。採用判断、実装対象 ref、検証環境、支援技術実機、実データ、実ユーザー協力が必要である。

## 採用判断の選択肢

| 選択肢 | 判断 | 次アクション |
|---|---|---|
| Adopt | v644 を提案 baseline として採用 | implementation ref を確定し、WCP-01〜WCP-06 の実証跡収集へ移行する |
| Hold | 修正要求あり | 修正要求を具体化し、該当 delta のみ提案書を更新する |
| Do not adopt | 採用しない | v644 を提案証跡として保管し、同型反復を停止する |

## Adopt 時の実証跡収集計画

### WCP-01: 採用 implementation ref の確定

- 対象ブランチ、commit SHA、差分範囲を確定する。
- 提案 baseline と実装対象の対応表を作成する。
- 未採用要素を明示し、scope creep を防ぐ。

### WCP-02: E2E 検証

- 採用/merge 済み ref で `E2E_SCOPE=core` を通す。
- main 相当では `E2E_SCOPE=full` を通す。
- 失敗時はスクリーンショット、trace、ログを保存し、再実行条件を明示する。

### WCP-03: WCAG 2.2 AA 監査

- 採用/merge 済み ref で正式監査を行う。
- キーボード操作、フォーカス可視性、ラベル、エラー伝達、コントラストを確認する。
- blocker / major / minor を分類し、blocker は 0 にする。

### WCP-04: 支援技術実機検証

- NVDA
- JAWS
- VoiceOver
- TalkBack

各セッションで、主要導線が操作可能であること、blocker が 0 であること、匿名化された defect closure evidence があることを確認する。

### WCP-05: データ密度検証

- 実 DB/API に対して 50 / 100 / 500 件のデータを投入する。
- 一覧、検索、フィルタ、詳細、更新導線で表示崩れ、過密、応答性劣化を確認する。
- UI 密度だけでなく、API 応答とローディング状態も確認対象に含める。

### WCP-06: 実ユーザー Before/After 測定

- 主要 6 タスクを定義する。
- 最低 5 名の実ユーザーで Before/After を測定する。
- 測定項目は、完了時間、エラー回数、迷い、再試行、主観負荷、完了率を含める。

## GitHub 反映方針

この文書化 PR では、以下のみを反映する。

- v644 までの成果サマリ
- 採用判断の選択肢
- 未完了証跡の明確化
- Adopt 時の WCP-01〜WCP-06 実証跡収集計画

この文書化 PR では、以下を行わない。

- アプリケーションコード変更
- テストコード変更
- UI 実装の適用
- `.codex-local` 成果物一式の追加
- `goalComplete=true` 相当の完了宣言

## 参照元

本サマリは、ローカルの v644 final summary と stop decision brief を元に作成した。ローカル証跡は GitHub へ直接追加しない。

- `.codex-local/tmp/latest-uiux-v644-final-summary.txt`
- `.codex-local/tmp/latest-uiux-v644-final-summary.json`
- `.codex-local/tmp/uiux-v644-stop-decision-brief-20260701-072337.md`
- `.codex-local/tmp/uiux-v644-stop-decision-brief-20260701-072337.json`

## 次の意思決定

この文書をレビューしたうえで、以下を決める。

1. v644 を採用 baseline とするか。
2. 採用する場合、implementation ref はどれか。
3. WCP-01〜WCP-06 をどの順序・担当・環境で実施するか。
4. 保留または不採用の場合、どの差分だけを再検討するか。
