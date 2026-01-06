# Phase 3 PoC 評価（2026-01-07）

## 環境
- Backend: `http://localhost:3001` (AUTH_MODE=header)
- DB: Podman `erp4-pg-poc` (Postgres 15, port 55432)

## 事前データ投入
PoC確認用に最低限のユーザ/グループ/アラートを投入。
```sql
INSERT INTO "UserAccount" (id, "userName", "displayName", "createdAt", "updatedAt")
VALUES ('10000000-0000-0000-0000-00000000A001','auditor','Audit User', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "GroupAccount" (id, "displayName", "createdAt", "updatedAt")
VALUES ('20000000-0000-0000-0000-00000000B001','Audit Group', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "UserGroup" (id, "userId", "groupId", "createdAt")
VALUES ('30000000-0000-0000-0000-00000000C001','10000000-0000-0000-0000-00000000A001','20000000-0000-0000-0000-00000000B001', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "AlertSetting" (id, type, threshold, period, recipients, channels, "createdAt", "updatedAt")
VALUES ('90000000-0000-0000-0000-000000000001','budget_overrun',10,'month','[]'::jsonb,'["dashboard"]'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Alert" (id, "settingId", "targetRef", status, "createdAt", "updatedAt")
VALUES ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','open', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "AlertSetting" (id, type, threshold, period, recipients, channels, "createdAt", "updatedAt")
VALUES ('90000000-0000-0000-0000-000000000002','approval_delay',24,'day','[]'::jsonb,'["dashboard"]'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Alert" (id, "settingId", "targetRef", status, "createdAt", "updatedAt")
VALUES ('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002','approval-instance-demo','open', now(), now())
ON CONFLICT (id) DO NOTHING;
```

## 実施内容と結果
1. アクセス棚卸しスナップショット
   - `GET /access-reviews/snapshot?format=json` → OK
   - `GET /access-reviews/snapshot?format=csv` → OK
2. インサイト生成
   - `GET /insights?projectId=00000000-0000-0000-0000-000000000001` → OK（budget_overrun のみ）
   - `GET /insights` → OK（budget_overrun / approval_delay）
3. 監査ログ記録
   - `GET /audit-logs?action=access_review_exported` → access_review_exported を確認
   - `GET /audit-logs?action=insights_view` → insights_view を確認
   - `GET /audit-logs?action=audit_log_exported` → audit_log_exported を確認
4. 権限チェック
   - `GET /audit-logs` with role=user → 403

## エビデンス
- `docs/test-results/2026-01-07-phase3-poc-eval/access-reviews.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/access-reviews.csv`
- `docs/test-results/2026-01-07-phase3-poc-eval/insights-project.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/insights-all.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/audit-access.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/audit-insights.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/audit-export.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/audit-forbidden.json`
- `docs/test-results/2026-01-07-phase3-poc-eval/audit-forbidden.status`
