# ESLint10 readiness 記録テンプレート

- executedAt: YYYY-MM-DDTHH:MM:SSZ
- operator: <name>
- branch: `<branch>`
- commit: `<short-sha>`

## 実行コマンド

```bash
make eslint10-readiness-check
```

```bash
# 判定を採取しつつ docs/test-results へ記録
RUN_CHECK=1 FAIL_ON_CHECK=1 make eslint10-readiness-record
```

## 判定

- summaryStatus: pass|fail
- ready: true|false
- checkExitCode:

## 収集結果

- pluginTarget:
- pluginVersion:
- pluginPeerEslint:
- pluginSupportsEslint10:
- parserTarget:
- parserVersion:
- parserPeerEslint:
- parserSupportsEslint10:
- reactPluginTarget:
- reactPluginVersion:
- reactPluginPeerEslint:
- reactPluginSupportsEslint10:
- reactHooksPluginTarget:
- reactHooksPluginVersion:
- reactHooksPluginPeerEslint:
- reactHooksPluginSupportsEslint10:

## ログ（抜粋）

```text
<check-eslint10-readiness output>
```

## 対応メモ

-
