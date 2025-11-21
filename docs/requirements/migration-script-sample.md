# 移行スクリプト雛形（サンプル）

Python + CSV で一方向にロードする最小例。実際は FDW/DBT でも可。

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

手順:
1. legacy DB から CSV 抽出
2. 上記のような変換スクリプトで新ID発行/マッピング
3. `COPY` などで新テーブルにロード
4. 件数/合計値をプロジェクト単位で突き合わせる

注意:
- 旧ID→新UUIDのマップをファイルに残す（FK復元に使用）
- 通貨/税率/日付のタイムゾーンに注意（JST想定なら明示）
- 欠損/重複はレポートに出し、手動で解消
- ユーザIDマッピングが欠落している場合は手動で補完（メール/社員コードベース）
