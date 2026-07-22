# Storage／backup統合readiness 記録テンプレート

## 実行情報

- evidenceBasis: `repo-side | target-environment`
- generatedAt: `YYYY-MM-DDTHH:MM:SS.000Z`
- commitSha: `REPLACE_WITH_FULL_COMMIT_SHA`
- environmentLabel: `REPLACE_WITH_NON_SECRET_LABEL`
- mode: `read | write_probe`
- overallStatus: `pass | warn | fail | unknown | not_configured`
- overallReasons: `- | REPLACE_WITH_ALLOWLIST_REASON`
- exitCode: `0 | 1 | 2 | 3`

## Sanitized component summary

| Component                 | Status           | Reasons                           | Metrics |
| ------------------------- | ---------------- | --------------------------------- | ------- |
| `app_gdrive_chat`         | `not_configured` | `provider_not_configured`         | `-`     |
| `app_gdrive_pdf`          | `not_configured` | `provider_not_configured`         | `-`     |
| `app_gdrive_evidence`     | `not_configured` | `provider_not_configured`         | `-`     |
| `app_gdrive_report`       | `not_configured` | `provider_not_configured`         | `-`     |
| `backup_local`            | `not_configured` | `provider_not_configured`         | `-`     |
| `backup_sakura_primary`   | `not_configured` | `provider_not_configured`         | `-`     |
| `backup_gdrive_secondary` | `not_configured` | `provider_not_configured`         | `-`     |
| `restore_evidence`        | `not_configured` | `restore_evidence_not_configured` | `-`     |

## 判定

- 結果: `blocked`
- 理由: `REPLACE_WITH_ALLOWLIST_REASON_AND_OPERATOR_SUMMARY`
- 未完了実環境検証: `REPLACE_WITH_TARGET_ONLY_CHECKS`
- 再開条件: `REPLACE_WITH_REQUIRED_INPUT_OR_APPROVAL`
- 再開command: `./scripts/storage-readiness.sh --format json`

## 証跡境界

- repo-sideの場合、fake/synthetic fixtureの結果であり実provider成功を示さない。
- target-environmentの場合も、raw log、credential、folder/Shared Drive ID、bucket/prefix/endpoint、object key、backup IDを本記録へ含めない。
- 実行していないcheckをpassにしない。
