# 移行ETLサンプル（抽出→変換→ロード）

## 抽出SQL（例: PostgreSQL → CSV）
```sql
\copy (
  select project_id, project_code, project_name, status, parent_id
  from im_projects
) to 'projects_legacy.csv' with csv header;

\copy (
  select invoice_id, project_id, invoice_no, total_amount, currency, status, issue_date
  from im_invoices
) to 'invoices_legacy.csv' with csv header;

\copy (
  select u.user_id, u.username, pa.email, pe.first_names, pe.last_name
  from users u
  join parties pa on pa.party_id = u.user_id
  join persons pe on pe.person_id = u.user_id
) to 'users_legacy.csv' with csv header;
```

## 変換（Python/pandas雛形）
```python
import pandas as pd, uuid

proj = pd.read_csv('projects_legacy.csv')
proj['id'] = [str(uuid.uuid4()) for _ in range(len(proj))]
proj['code'] = proj['project_code'].str.strip()
proj['name'] = proj['project_name']
proj['parentId'] = None  # 親子対応は後でJOIN
proj[['id','code','name','status']].to_csv('projects_load.csv', index=False)

users = pd.read_csv('users_legacy.csv')
users['new_id'] = [str(uuid.uuid4()) for _ in range(len(users))]
users[['user_id','new_id','email']].to_csv('mapping_users.csv', index=False)

inv = pd.read_csv('invoices_legacy.csv')
mapping_proj = proj[['project_id','id']].rename(columns={'project_id':'legacy'})
inv = inv.merge(mapping_proj, left_on='project_id', right_on='legacy', how='left')
inv['invoice_no'] = None  # 新環境で再採番
inv[['id','project_id','total_amount','currency','status']].to_csv('invoices_load.csv', index=False)
```

## ロード（PostgreSQL）
```sql
-- 依存順にロード
copy "Project"(id, code, name, status) from 'projects_load.csv' csv header;
copy mapping_users(legacy_id, new_id, legacy_login) from 'mapping_users.csv' csv header;
-- 請求は invoice_no を空で入れ、アプリ側で採番 or UPDATE
copy "Invoice"(id, "projectId", totalAmount, currency, status) from 'invoices_load.csv' csv header;
```

## 検証チェックリスト
- [ ] 件数: プロジェクト件数、請求件数が一致
- [ ] 合計: プロジェクト単位で請求 total_amount の合計が一致
- [ ] コード重複: project_code/invoice_no に重複なし
- [ ] 参照切れ: project_id/task_id がNULLや参照なしのレコードがない
- [ ] 通貨/日付フォーマット: currencyがNULLでない、日付がパース可能
