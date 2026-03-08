# フロントE2E（UIエビデンス r1）

- date: 2026-03-09
- run: r1
- startedAt(UTC): 2026-03-08T21:07:00Z
- git: 8996d738
- evidence: docs/test-results/2026-03-09-frontend-e2e-r1/

## 実行コマンド

```bash
E2E_CAPTURE=1 \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-09-frontend-e2e-r1" \
E2E_GREP="frontend smoke core|frontend leave submit validation|frontend smoke workflow evidence chat references|frontend smoke vendor approvals|frontend smoke approval ack link lifecycle|frontend smoke audit logs: AgentRun詳細ドリルダウンが利用できる|frontend offline queue|pwa offline duplicate time entries|pwa service worker cache refresh" \
./scripts/e2e-frontend.sh

E2E_CAPTURE=1 \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-09-frontend-e2e-r1" \
E2E_GREP="frontend smoke additional sections|frontend smoke reports masters settings|frontend smoke vendor docs create|frontend smoke admin ops|frontend smoke room chat \\(private_group/dm\\)|frontend smoke room chat hr analytics" \
./scripts/e2e-frontend.sh
```

## 結果

- status: PASS
- notes:
  - initial capture subset: 10 passed
  - supplemental capture subset: 6 passed
  - screenshots: 44 files
  - docs/manual/\* and docs/manual/screen-coverage.md were updated to this directory

- finishedAt(UTC): 2026-03-08T21:08:15Z
