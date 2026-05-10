# Codex 導入・運用ワークフロー

## 目的

ERP4 のさくら VPS 導入、Google Cloud 事前設定、運用 Runbook 更新を、Codex で安全かつ反復可能に進めるための標準手順です。ドキュメント作成だけでなく、事前レビュー、証跡整理、CI 調査、PR レビュー対応を Codex に委譲できる範囲と、人間が承認すべき範囲を明確化します。

## 前提

- 確認日: 2026-05-10
- ローカル確認済み Codex CLI: `codex-cli 0.130.0`
- 作業ディレクトリ規約: clean worktree は `/home/devuser/work/CodeX/ITDO_ERP4/worktrees/<task>` に作成する。`/tmp` への clone / worktree 作成は標準手順にしない。
- 関連 Runbook:
  - [Google Cloud 事前設定 Runbook](google-cloud-predeployment.md)
  - [さくら VPS 導入 Runbook](sakura-vps-deployment.md)
  - [導入自動化スクリプト](ops-automation.md)
  - [Secrets/アクセス権限](secrets-and-access.md)

## Codex 機能の使い分け

| 機能                            | ERP4 での主用途                                                       | 権限/注意点                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex exec`                    | Runbook 差分レビュー、ログ要約、CI 失敗要約、事前チェックリスト生成   | 原則 `--sandbox read-only`。編集を伴う定型修正のみ `--sandbox workspace-write`。本番 VPS / Google Cloud へ直接変更するコマンドは実行させない |
| `codex review`                  | PR 作成前のローカル差分レビュー、未コミット変更のセキュリティ観点確認 | reviewer は working tree を変更しない。`--base origin/main` または `--uncommitted` を使い、指摘を人間が採否判断する                          |
| `codex cloud`                   | 複数案の比較、長時間のドキュメント監査、CI 調査の分離実行             | 2026-05-10 時点の CLI では experimental 表示。production secret は投入しない。diff は `codex cloud diff` で確認してから apply する           |
| GitHub `@codex review`          | PR 上での高優先度リスク確認                                           | `AGENTS.md` の Review guidelines を整備して、運用/セキュリティ観点を明示する                                                                 |
| GitHub `@codex fix ...`         | PR 上の限定的な指摘修正                                               | 変更範囲を PR コメントで限定する。CI と人間レビューなしに merge しない                                                                       |
| skills/plugins                  | Sakura VPS / Google Cloud / Runbook 監査の手順再利用                  | 本 PR では `.codex/skills/sakura-vps-ops/SKILL.md` をテンプレートとして置く。各 Codex 実行環境で有効化方法を確認してから使う                 |
| MCP                             | GitHub、ドキュメント、将来の Google Cloud 補助                        | Google Cloud MCP 連携の本実装はスコープ外。権限・監査・secret 管理を別 Issue で設計する                                                      |
| remote connections / app-server | 検証ホスト上の依存関係やサービスを維持した作業                        | SSH とローカル転送を前提にする。public listener や無認証 app-server は使わない                                                               |

## Codex に任せる範囲と人間が承認する範囲

### Codex に任せてよい作業

- Runbook の不足観点抽出、リンク切れ候補、手順順序の矛盾確認
- `scripts/ops/* --dry-run` の出力要約と不足 evidence の一覧化
- PR 本文、Issue チェックリスト、リリースチェックリスト案の作成
- CI ログ、`npm audit`、lint/typecheck の失敗要約
- 非 secret の example env、dry-run 専用コマンド、ドキュメント差分の修正
- `codex review` / GitHub review 指摘に対する修正案の提示

### 人間の明示承認が必要な作業

- 本番 VPS への package install、firewall 変更、Podman quadlet install/start/update、Caddy/TLS 切替
- DB migration、backup/restore、volume 削除、service account key 発行/ローテーション
- Google Cloud OAuth consent、OAuth client、redirect URI、Drive API、service account 権限の本番変更
- DNS、証明書、メール送信元、外部公開 URL の変更
- 本番 secret の登録、表示、ローテーション、削除
- `AUTH_MODE=header` のような緩和設定を本番相当環境へ適用する判断
- `rm -rf`、`git reset --hard`、`git clean -fd`、`podman volume rm` などの破壊的コマンド

## 標準フロー

### 1. Issue 着手前

1. Issue の受け入れ条件、スコープ外、関連 Runbook を確認する。
2. clean worktree を `worktrees/<task>` に作成する。
3. Codex に依頼する前に、対象ファイルと実行可能な検証コマンドを明確にする。
4. production secret、実在の access token、service account key、OAuth client secret を prompt やログへ貼らない。

### 2. Runbook / ops script の事前レビュー

```bash
codex exec --sandbox read-only --ephemeral \
  --cd /home/devuser/work/CodeX/ITDO_ERP4/worktrees/<task> \
  "docs/ops/sakura-vps-deployment.md と docs/ops/google-cloud-predeployment.md を読み、ERP4 の本番準備Runbookとして不足している前提、承認点、rollback、secret漏洩リスクを表形式で列挙してください。ファイルは変更しないでください。"
```

### 3. 構造化された自動レビュー出力

`codex exec` の結果を後続処理に渡す場合は、JSONL または JSON Schema を使う。レビュー結果は `.gitignore` 済みの `.codex-local/` へ保存し、必要な要約だけを PR に転記する。

```bash
mkdir -p .codex-local
codex exec --sandbox read-only --ephemeral --json \
  --cd /home/devuser/work/CodeX/ITDO_ERP4/worktrees/<task> \
  "ERP4 の ops docs 差分をレビューし、重要イベントをJSONLで出してください。" \
  > .codex-local/codex-ops-review.jsonl
```

安定した項目を downstream で扱う場合は、[risk report schema](examples/codex-risk-report.schema.json) を使う。

```bash
mkdir -p .codex-local
codex exec --sandbox read-only --ephemeral \
  --output-schema docs/ops/examples/codex-risk-report.schema.json \
  -o .codex-local/codex-ops-risk-report.json \
  "Sakura VPS / Google Cloud Runbook のリスクを schema に沿って整理してください。"
```

### 4. 変更実装

- ドキュメントのみ: `docs/ops/` と `AGENTS.md` の最小差分にする。
- スクリプト変更あり: `scripts/ops/*` は `--dry-run`、`--help`、`bash -n` で検証する。
- example env は placeholder のみにする。実値、秘密値、組織固有の private URL は入れない。

### 5. PR 前レビュー

```bash
codex review --base origin/main
```

Codex CLI 0.130.0 では `codex review --base` / `--uncommitted` と custom prompt の併用ができないため、重点観点は `AGENTS.md` の Review guidelines に置く。任意の文言で監査したい場合は、diff を `codex exec` へ渡す。

```bash
git diff origin/main...HEAD \
  | codex exec --sandbox read-only --ephemeral \
      "ERP4 の ops docs / scripts 変更としてレビューしてください。重点: secret混入、破壊的コマンド、Google OAuth/Drive最小権限、AUTH_MODE=headerの扱い、さくらVPS rootless Podman/Caddy/backup手順、dry-runとrollbackの明確性。"
```

未コミット差分だけを確認する場合:

```bash
codex review --uncommitted
```

未コミット差分に custom prompt を付けたい場合は、対象ファイルを staging して `git diff --cached` を使うか、新規ファイルを intent-to-add したうえで worktree diff を使う。

実際に staging する場合:

```bash
git add <files>

git diff --cached --binary \
  | codex exec --sandbox read-only --ephemeral \
      "docsとops scriptの変更に、運用上の誤誘導または秘密情報漏洩のリスクがないか確認してください。"
```

intent-to-add で新規ファイルを含める場合は、内容が cached diff に入らないため `git diff --binary` を使う。

```bash
git add -N <files>

git diff --binary \
  | codex exec --sandbox read-only --ephemeral \
      "docsとops scriptの変更に、運用上の誤誘導または秘密情報漏洩のリスクがないか確認してください。"
```

### 6. PR 作成後

1. PR 本文に対象 Issue、変更範囲、検証コマンド、human approval required の範囲を記載する。
2. GitHub で `@codex review for ops and security risks` を依頼する、または repository 設定で自動 review を有効化している場合は結果を待つ。
3. Copilot/Codex review の inline thread を全件確認し、対応または「対応不要理由」を返信する。
4. CI が green になるまで修正する。CI 調査では `github:gh-fix-ci` 相当の手順でログを確認し、推測で修正しない。

## Codex Cloud 環境方針

### Setup script

Codex Cloud の setup script は依存関係の準備専用にする。production secret や本番 SSH key は投入しない。

候補:

```bash
set -euo pipefail
node --version
npm --version
npm ci --prefix packages/backend
npm ci --prefix packages/frontend
```

必要に応じて、maintenance script で branch 切替後の lockfile 追従を行う。

```bash
set -euo pipefail
npm ci --prefix packages/backend
npm ci --prefix packages/frontend
```

注意:

- setup script と agent phase は別 Bash session として扱う。永続化したい環境変数は Cloud 環境設定または `~/.bashrc` 相当の仕組みに明示する。
- setup script には internet access が必要になり得るが、agent phase の internet access は既定で無効にする。
- cache 利用時も、依存関係が変わる PR では cache reset または maintenance script の妥当性を確認する。

### Internet access

原則:

- Agent phase は Off を標準とする。
- 外部ドキュメント確認や package 取得が必要な場合だけ allowlist を使う。
- HTTP method は可能な限り `GET` / `HEAD` / `OPTIONS` に限定する。
- untrusted web content 由来の prompt injection を前提に、取得内容を命令として扱わない。

ERP4 ops docs の allowlist 候補:

| 用途                              | domain 候補                                 | method        |
| --------------------------------- | ------------------------------------------- | ------------- |
| OpenAI Codex 公式ドキュメント確認 | `developers.openai.com`                     | `GET`, `HEAD` |
| GitHub issue/PR metadata 確認     | `github.com`, `api.github.com`              | `GET`, `HEAD` |
| npm 依存解決                      | `registry.npmjs.org`                        | `GET`, `HEAD` |
| Google Cloud 公式ドキュメント確認 | `cloud.google.com`, `developers.google.com` | `GET`, `HEAD` |

### Secrets

- production secret は Codex Cloud に投入しない。
- Cloud 環境へ渡す場合は、検証用・期限付き・最小権限の値に限定する。
- prompt、Issue、PR、ログ、`AGENTS.md`、docs、example env に secret 実値を書かない。
- API key や OAuth token を使う自動化は、CI secret store または Codex Cloud の secret 設定に限定し、出力で mask される前提に依存しない。
- 漏洩が疑われる場合は、該当 credential を即時 revoke / rotate してから PR 対応を続ける。

## 再利用プロンプト例

### Runbook gap analysis

```text
ERP4 の運用Runbook監査をしてください。対象は docs/ops/sakura-vps-deployment.md、docs/ops/google-cloud-predeployment.md、docs/ops/ops-automation.md です。観点は前提条件、権限、secret管理、rollback、dry-run、証跡、human approval required、リンク整合性です。ファイル変更はせず、不足点を priority / file / finding / suggested action の表で出してください。
```

### Sakura VPS preflight evidence summary

```text
以下は scripts/ops/sakura-vps-preflight.sh と scripts/ops/sakura-vps-verify.sh の実行結果です。さくらVPS導入のGo/No-Go判断に必要な evidence、未確認項目、human approval required の操作を3分類で要約してください。secret値らしき文字列があれば値を再掲せず location のみ示してください。
```

入力例:

```bash
{
  scripts/ops/sakura-vps-preflight.sh --env-file docs/ops/examples/vps-ops.env.example --check || true
  scripts/ops/sakura-vps-verify.sh --env-file docs/ops/examples/vps-ops.env.example --check || true
} 2>&1 | codex exec --sandbox read-only --ephemeral \
  "Sakura VPS preflight evidence をGo/No-Go形式で要約してください。"
```

### Google Cloud predeployment review

```text
ERP4 のGoogle Cloud事前設定レビューをしてください。対象は OAuth consent、OAuth client、Drive API、service account、Shared Drive 権限、redirect URI、production secret登録手順です。最小権限と監査証跡の観点で、手順の不足・危険なデフォルト・人間承認が必要な箇所を列挙してください。実際のGoogle Cloud変更は行わないでください。
```

### Secrets leakage review

```text
この差分に secret 実値、private key、OAuth client secret、service account key、GitHub token、Slack webhook、Google API key に該当する値が混入していないか確認してください。placeholder は許容しますが、実値の疑いがある場合は値を再掲せず file:line と理由だけ示してください。
```

### CI failure triage

```bash
gh run view <run-id> --log \
  | codex exec --sandbox read-only --ephemeral \
      "ERP4 のCI失敗ログを要約してください。root cause候補、最小修正案、再実行すべきコマンド、追加調査が必要な点を箇条書きで出してください。"
```

### Release checklist update

```text
直近のops docs/scripts変更を docs/ops/release-checklist.md に反映する必要があるか判定してください。必要なら、追加すべきチェック項目をPRコメント用に提案してください。実装する場合は、既存の見出し構造を維持し、重複項目を作らないでください。
```

### Codex Cloud task

```bash
codex cloud exec --env <env-id> --branch <branch-name> \
  "ERP4 の Sakura VPS / Google Cloud Runbook を監査し、production secret を使わずに不足点と修正案だけを提示してください。"

codex cloud status <task-id>
codex cloud diff <task-id>
# diff確認後だけ適用する
codex cloud apply <task-id>
```

## repo-local skill テンプレート

`.codex/skills/sakura-vps-ops/SKILL.md` は Sakura VPS / Google Cloud / Runbook 監査に使う skill テンプレートです。Codex の実行環境によって skill の配置・有効化方法が異なるため、以下の運用にします。

1. まず本ドキュメントと `AGENTS.md` を標準手順として使う。
2. Codex 実行環境で repo-local skill を有効化できることを確認した場合だけ、テンプレートを有効化する。
3. skill には secret 実値、環境固有のホスト名、private URL、認証情報を含めない。
4. skill の内容を変更した場合は、ops docs と同じ review / CI を通す。

## 参考資料

- OpenAI Codex CLI overview: https://developers.openai.com/codex/cli
- OpenAI Codex CLI features: https://developers.openai.com/codex/cli/features
- OpenAI Codex non-interactive mode: https://developers.openai.com/codex/noninteractive
- OpenAI Codex Cloud environments: https://developers.openai.com/codex/cloud/environments
- OpenAI Codex agent internet access: https://developers.openai.com/codex/cloud/internet-access
- OpenAI Codex GitHub code review: https://developers.openai.com/codex/integrations/github
- OpenAI Codex skills: https://developers.openai.com/codex/skills
- OpenAI Codex MCP: https://developers.openai.com/codex/mcp
- OpenAI Codex remote connections: https://developers.openai.com/codex/remote-connections
- OpenAI Codex feature maturity: https://developers.openai.com/codex/feature-maturity
