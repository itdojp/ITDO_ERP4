# Dependabot alerts 監視記録

- executedAt: 2026-03-08T06:56:29Z
- branch: `ops/dependency-watch-records`
- commit: `c5d7d83d`
- sourceLog: `tmp/dependabot-alerts/dependabot-alerts-20260308-155627.log`
- summaryStatus: pass
- actionRequired: false
- checkExitCode: 0

## Alert 状態

- alertLowState: OPEN
- alertLowGhsa: `GHSA-w7fw-mjwx-w883`
- alertHighState: NOT_FOUND
- alertHighGhsa: ``

## 依存解決状態

- googleapisCurrent: `171.4.0`
- googleapisLatest: `171.4.0`
- googleapisCommonCurrent: `8.0.1`
- googleapisCommonLatest: `8.0.1`
- qsResolvedVersion: `6.15.0`
- qsPatched: true
- fastXmlResolvedVersion: `5.3.6`
- fastXmlPatched: true
- upstreamUpdated: false

## ログ

```text
WARN: alert #11 not found; treating as NOT_FOUND
alertLowNumber: 10
alertLowState: OPEN
alertLowSeverity: LOW
alertLowPackage: qs
alertLowGhsa: GHSA-w7fw-mjwx-w883
alertLowVulnerableRequirements: >= 6.7.0, <= 6.14.1
alertHighNumber: 11
alertHighState: NOT_FOUND
alertHighSeverity:
alertHighPackage:
alertHighGhsa:
alertHighVulnerableRequirements:
googleapisCurrent: 171.4.0
googleapisLatest: 171.4.0
googleapisCommonCurrent: 8.0.1
googleapisCommonLatest: 8.0.1
qsResolvedVersion: 6.15.0
qsPatched: true
fastXmlResolvedVersion: 5.3.6
fastXmlPatched: true
upstreamUpdated: false
actionRequired: false
OK: alerts are stable and patched versions are resolved.
```
