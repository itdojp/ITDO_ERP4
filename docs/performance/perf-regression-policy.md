# 性能退行検知（運用ポリシー）

## 目的
- 性能改善を一過性にせず、退行（遅くなる変更）を継続的に検知する
- PoC導線の主要APIに対して、比較可能な結果を残す

## 対象シナリオ（暫定: 3本）
PoC導線の代表として、以下を固定します。

- `GET /projects`
- `GET /reports/project-profit/:projectId`
- `GET /reports/project-profit/:projectId/by-user`

前提となる `projectId` は `00000000-0000-0000-0000-000000000001`（seed）を使用します。

## 実行環境
### ローカル（ベースライン作成）
- Podman + PostgreSQL 15（既存の `scripts/perf/run-api-bench.sh`）
- 結果は `docs/test-results/` に md として保存（コミットして履歴を残す）

### CI（継続運用）
- GitHub Actions で schedule / workflow_dispatch を実行
- DB は service container（PostgreSQL 15）
- 結果は artifact として保存（長期保存が必要なら、定期的に `docs/test-results/` へ取り込む）
- workflow: `.github/workflows/perf.yml`

## 結果フォーマット
- JSON（機械可読）: `tmp/perf-ci/result.json`
- Markdown（人間可読）: `tmp/perf-ci/result.md`

## 暫定閾値（段階導入）
以下を「退行候補」として扱います（暫定）。

- `requests.average` が **20% 以上低下**
- `latency.p99` が **25% 以上悪化**
- `non2xx > 0` または `errors > 0` または `timeouts > 0`

初期は「警告（ログ/Issue）」として運用し、安定後に CI fail（ブロック）へ移行します。

## 運用フロー
1. CI（またはローカル）で計測を実行し、結果を保存
2. 退行候補が出た場合は、ローカル（Podman）で再現確認する
3. 再現した場合は Issue 化し、原因調査（SQL/インデックス/実装差分）→対策を実施する

## スクリプト
- ローカル（Podman）: `scripts/perf/run-api-bench.sh`
- CI互換: `scripts/perf/run-api-bench-ci.sh`
- 比較: `scripts/perf/compare-api-bench.mjs`
