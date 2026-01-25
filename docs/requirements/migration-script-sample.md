# 移行スクリプト雛形（サンプル）

Python + CSV で一方向にロードする最小例。実際は FDW/DBT でも可。SQL 版の雛形も末尾に記載。

```python
import csv
import uuid

LEGACY_TO_NEW_PROJECT = {}
LEGACY_TO_NEW_USER = {}

# 1) load legacy users
with open('legacy_users.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        new_id = str(uuid.uuid4())
        LEGACY_TO_NEW_USER[row['legacy_user_id']] = new_id

# 2) load legacy projects
with open('legacy_projects.csv') as f:
    reader = csv.DictReader(f)
    out = []
    for row in reader:
        new_id = str(uuid.uuid4())
        LEGACY_TO_NEW_PROJECT[row['project_id']] = new_id
        out.append({
            'id': new_id,
            'code': row['project_code'],
            'name': row['project_name'],
            'status': 'active',
        })
with open('projects_load.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=out[0].keys())
    writer.writeheader(); writer.writerows(out)

# 3) map time entries
with open('legacy_time.csv') as f:
    reader = csv.DictReader(f)
    out = []
    for row in reader:
        out.append({
            'id': str(uuid.uuid4()),
            'project_id': LEGACY_TO_NEW_PROJECT.get(row['project_id']),
            'user_id': LEGACY_TO_NEW_USER.get(row['user_id']),
            'work_date': row['work_date'],
            'minutes': int(float(row['hours']) * 60),
            'status': 'submitted'
        })
with open('time_entries_load.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=out[0].keys())
    writer.writeheader(); writer.writerows(out)
```

## SQL + COPY での変換/ロード例
PostgreSQL 同士の場合のサンプル。旧DBを`legacy` FDWで参照し、新DBにUUIDとコード正規化を付与する。

```sql
-- 1) 旧→新のIDマップ用テーブル
create table if not exists mapping_projects(legacy_id text primary key, new_id uuid not null);
create table if not exists mapping_users(legacy_id text primary key, new_id uuid not null);
create table if not exists mapping_groups(legacy_id text primary key, new_id uuid not null);

-- 2) IDマッピングを生成
insert into mapping_projects(legacy_id, new_id)
select p.project_id, gen_random_uuid()
from legacy.im_projects p
on conflict do nothing;

insert into mapping_users(legacy_id, new_id)
select u.user_id, gen_random_uuid()
from legacy.users u
on conflict do nothing;

insert into mapping_groups(legacy_id, new_id)
select g.group_id, gen_random_uuid()
from legacy.acs_groups g
on conflict do nothing;

-- 3) プロジェクトをロード
insert into "Project"(id, code, name, status, "createdAt")
select m.new_id, p.project_code, p.project_name, 'active', now()
from legacy.im_projects p
join mapping_projects m on m.legacy_id = p.project_id;

-- 4) 工数をロード
insert into "TimeEntry"(id, "projectId", "userId", "workDate", minutes, status, "createdAt")
select gen_random_uuid(),
       mp.new_id,
       mu.new_id,
       t.work_date::date,
       (t.hours * 60)::int,
       'submitted',
       now()
from legacy.im_timesheet t
join mapping_projects mp on mp.legacy_id = t.project_id
left join mapping_users mu on mu.legacy_id = t.user_id;
```

## 手順チェックリスト
1. legacy DB から CSV 抽出 or FDW で参照
2. 上記のような変換スクリプトで新ID発行/マッピング（mapping_* テーブルに保持）
3. `COPY` などで新テーブルにロード
4. 件数/合計値をプロジェクト単位で突き合わせる

注意:
- 旧ID→新UUIDのマップをファイルに残す（FK復元に使用）
- 通貨/税率/日付のタイムゾーンに注意（JST想定なら明示）
- 欠損/重複はレポートに出し、手動で解消
- ユーザIDマッピングが欠落している場合は手動で補完（メール/社員コードベース）
