# ERP4 マニュアル（運用/利用者向け）

## 目的
- PoC/段階導入の範囲で「誰が」「何を」「どう操作するか」を追跡可能にする
- 画面操作（UI）と運用手順（Ops）を分離し、更新漏れを減らす

## 対象読者
- 利用者（社員/外部チャットユーザ）
- 管理者（admin/mgmt/exec/hr）
- 案件リーダー/管理部（承認・請求・運用ジョブ等）

## マニュアル構成
### UI操作（ロール別）
- 入口（分冊）: [ui-manual](ui-manual.md)
- 利用者: [ui-manual-user](ui-manual-user.md)
- 管理者: [ui-manual-admin](ui-manual-admin.md)

### 共通ガイド
- 権限/ロールと可視範囲: [role-permissions](role-permissions.md)
- 初回利用・共通操作: [user-onboarding](user-onboarding.md)
- トラブルシュート: [troubleshooting](troubleshooting.md)

### 業務別ガイド
- 案件リーダー運用: [project-leader-guide](project-leader-guide.md)
- 見積/請求/発注/仕入（経理・管理部）: [accounting-guide](accounting-guide.md)
- 承認運用（ルール/遅延/監査）: [approval-operations](approval-operations.md)
- レポート/アラート運用: [reporting-guide](reporting-guide.md)
- チャット運用（ルーム/既読/メンション/添付/監査）: [chat-guide](chat-guide.md)
- 人事運用（ウェルビーイング/HR分析）: [hr-guide](hr-guide.md)

### QA/証跡
- 手動確認チェックリスト: [manual-test-checklist](manual-test-checklist.md)
- E2E（Playwright）と証跡（画面キャプチャ）: [e2e-evidence-howto](e2e-evidence-howto.md)
- UI 画面カバレッジ（マニュアル/証跡）: [screen-coverage](screen-coverage.md)

## 更新ルール（最小）
- **仕様の決定**は `docs/requirements/`、**操作/運用**は `docs/manual/` に記載する
- UI 変更を伴う PR では、関連する `docs/manual/ui-manual-*.md` の更新要否を確認する
- 画面キャプチャ（証跡）を更新した場合は、参照先（`docs/test-results/...`）を更新する
