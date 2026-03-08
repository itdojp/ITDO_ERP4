# Dependabot alerts 監視記録テンプレート

- executedAt: YYYY-MM-DDTHH:MM:SSZ
- operator: <name>
- branch: `<branch>`
- commit: `<short-sha>`

## 実行コマンド

```bash
make dependabot-alerts-check
```

```bash
# 判定を採取しつつ docs/test-results へ記録
RUN_CHECK=1 FAIL_ON_CHECK=1 make dependabot-alerts-record
```

## 判定

- summaryStatus: pass|fail
- actionRequired: true|false
- checkExitCode:

## Alert 状態

- alertLowState:
- alertLowGhsa:
- alertHighState:
- alertHighGhsa:

## 依存解決状態

- googleapisCurrent:
- googleapisLatest:
- googleapisCommonCurrent:
- googleapisCommonLatest:
- qsResolvedVersion:
- qsPatched:
- fastXmlResolvedVersion:
- fastXmlPatched:
- upstreamUpdated:

## ログ（抜粋）

```text
<check-dependabot-alerts output>
```

## 対応メモ

-
