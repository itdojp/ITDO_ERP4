# Google Workspace グループ利用ポリシー

## 1. 目的

- Google Workspace を主認証基盤とする前提を維持しつつ、Google グループを ERP4 で使う場合の安全条件を定義する。
- Google グループを **使わない本番構成** を既定値とし、必要時のみ限定導入する判断基準を明文化する。
- グループ起点の自動権限付与で ERP4 側の要求セキュリティが過度に上がることを防ぐ。

## 2. 結論

- 既定の本番構成では、Google グループを ERP4 の権限制御一次ソースにしない。
- Google グループを利用する場合でも、用途は **read-only かつ coarse role** に限定する。
- `system_admin` / `admin` / `mgmt` / `exec`、承認権限、会計・人事の高リスク権限、案件所属 (`ProjectMember`) は Google グループだけで自動付与しない。
- Google グループ導入時も、ERP4 側の明示的なマッピング設定、監査ログ、障害時の fail-closed を必須とする。

## 3. 既定アーキテクチャ

### 3.1 既定値

- Google OIDC は認証に使う。
- 権限・所属・承認グループは ERP4 DB を一次ソースとする。
- Google グループは未使用でも本番運用可能であることを前提に設計する。

### 3.2 Google グループを使わない理由

- Google の標準 ID token をそのまま使うだけでは、安定したグループ claim を前提にできない。
- ERP4 が Google Admin SDK や Domain-wide Delegation を常時必要とすると、ERP4 側の保護対象が増える。
- グループ変更の伝播遅延、同期失敗、設定誤りがそのまま権限誤付与に直結しやすい。

## 4. 利用可能な用途

Google グループを利用できるのは、次の用途に限る。

- 粗い閲覧系ロールの候補付与
  - 例: `user`, `viewer`, `sales_viewer`
- ERP4 側 DB に既に存在するグループ候補の補助選択
- UI 表示の補助情報
  - 例: 所属候補、参照用ラベル

次の用途には使わない。

- `system_admin`, `admin`, `mgmt`, `exec` の自動付与
- 案件所属 (`ProjectMember`) の自動付与・削除
- 承認フローの approver 自動昇格
- 会計・人事・給与関連ロールの自動付与
- break-glass アカウント制御

## 5. 許容する導入方式

### 5.1 優先順位

1. **利用しない**
   - 推奨既定値。
2. **信頼済み Broker/IdP が付与する claim を read-only で利用する**
   - `group_ids` 等の coarse claim に限定する。
3. **定期同期で ERP4 側へ read-only 反映する**
   - Google への runtime lookup を避ける。

### 5.2 不許可方式

- ERP4 API が request ごとに Google Admin SDK へ runtime lookup する方式
- ERP4 本体が Domain-wide Delegation を常時保持する方式
- email アドレスや display name からグループ所属を推測する方式
- グループ同期だけで高権限へ自動昇格する方式

## 6. セキュリティ条件

Google グループを導入する場合、次の条件を満たすこと。

- 取得経路は read-only であること
- Google 資格情報は最小権限で管理すること
- ERP4 側に `externalGroupId -> ERP4 role/group` の明示マッピングを持つこと
- マッピング変更は監査ログを残すこと
- 同期失敗時は権限過剰ではなく権限不足側へ倒すこと
- stale データの利用は `GROUP_SYNC_STALE_TTL_MINUTES` 以内に限定すること
  - 既定値は `30`
  - 上限は `60`
  - 期限超過時は Google グループ由来マッピングを停止する
- 高権限ロールは Google グループ単独では付与しないこと

## 7. フェイルセーフ

- 同期ジョブ失敗時
  - 最終成功データは `GROUP_SYNC_STALE_TTL_MINUTES` 以内に限って参照してよい
  - TTL 超過後は Google グループ由来の自動付与を順次無効化し、権限不足側へ縮退させる
  - 新規昇格は停止する
- グループ未解決時
  - role 付与をスキップする
  - fallback で広い権限を与えない
- マッピング欠落時
  - 未割当として扱う
- Google 側障害時
  - Google グループ由来で自動付与された ERP4 ロール/グループは、`GROUP_SYNC_STALE_TTL_MINUTES` 以内でのみ維持する
  - `GROUP_SYNC_STALE_TTL_MINUTES` 超過後の Google グループ由来ロール/グループは順次無効化し、権限不足側へ縮退させる
  - ERP4 上で手動付与されたロール/グループは維持する
  - Google グループ再取得の即時復旧を前提にしない

## 8. 運用判断マトリクス

| 条件                              | Google グループ利用 | 判断               |
| --------------------------------- | ------------------- | ------------------ |
| Google グループなしでも運用できる | 不要                | 導入しない         |
| coarse role だけ補助したい        | 可                  | 条件付き導入       |
| 高権限ロールを自動付与したい      | 不可                | ERP4 DB 管理へ切替 |
| request ごとに Google 参照が必要  | 不可                | 構成見直し         |
| Domain-wide Delegation が必須     | 原則不可            | 個別承認が必要     |

## 9. 導入前チェックリスト

- Google グループを使わない構成で運用可能と確認した
- 対象ロールが coarse role に限定されている
- 高権限ロールが対象外である
- 取得経路が read-only である
- runtime lookup をしない
- 失敗時に fail-closed になる
- 監査ログ項目を定義した
- 運用責任者と見直し周期を決めた

## 10. ERP4 で先に実装すべきこと

- `UserIdentity` / `LocalCredential` による認証主体分離
- Google OIDC 本番経路の確立
- ERP4 側 DB を一次ソースとした RBAC 運用
- グループマッピングを導入する場合の read-only 同期テーブル
- マッピング変更・同期結果の監査ログ

## 11. 関連仕様

- `docs/requirements/auth-architecture.md`
- `docs/requirements/auth-implementation-breakdown.md`
- `docs/requirements/id-management.md`
- `docs/requirements/access-control.md`
- `docs/requirements/rbac-matrix.md`
