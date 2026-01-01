# アクセス制御方針（RBAC/ABAC/PBAC）

## 目的
- ERP内の閲覧/編集/承認を安全に制御する
- 監査と説明責任に耐える形で運用可能にする
- 役割ベースのわかりやすさと、案件/属性に応じた柔軟性を両立する

## スコープ
- 案件/見積/請求/発注/仕入
- 工数/経費/休暇/日報/ウェルビーイング
- 管理設定（承認ルール/アラート設定）

## 方針（段階的導入）
### PoC（現在）
- ルート単位のRBAC（admin/mgmt/exec/user/hr）
- projectIdフィルタによる簡易スコープ制御
- 監査ログは主要アクションのみ

### 本番（段階2以降）
- RBAC: ロールで機能単位の可否を決定
- ABAC: ユーザ属性/リソース属性/環境属性で行レベル制御
- PBAC: ルールをポリシーとして外出し（OPA/Cerbos等の検討）
- DB側: 必要に応じてPostgreSQL RLSを併用

## ユーザ属性（ABAC入力）
- tenantId / orgUnitId / departmentId
- roleCodes（RBACロール）
- groupIds（承認/人事などのグループ）
- projectIds（所属案件）
- employmentType / managerUserId（将来拡張）

## リソース属性（ABAC入力）
- ownerUserId / createdBy
- projectId / customerId / orgUnitId
- status / amount / currency
- isConfidential（機密フラグ）

## ABAC条件フォーマット（案）
```json
{
  "subject": {
    "userId": "u-123",
    "roles": ["mgmt"],
    "groupIds": ["hr"],
    "projectIds": ["p-001"],
    "orgUnitId": "ou-1"
  },
  "resource": {
    "projectId": "p-001",
    "ownerUserId": "u-123",
    "status": "pending_qa",
    "amount": 120000,
    "currency": "JPY"
  },
  "environment": {
    "action": "approve",
    "now": "2026-01-01T00:00:00Z"
  }
}
```

### ルール例（サンプル）
- `subject.roles` に `admin/mgmt/exec` が含まれる場合は許可
- `subject.userId == resource.ownerUserId` の場合は本人操作として許可
- `resource.projectId` が `subject.projectIds` に含まれる場合は閲覧を許可

## ポリシー例（要約）
- 見積/請求の作成/承認は admin/mgmt/exec
- 工数/経費は本人または管理ロールのみ閲覧・編集
- ウェルビーイング閲覧は人事専用グループのみ
- 承認インスタンスの閲覧は mgmt/exec + 申請者本人 + プロジェクトメンバー

## 運用と監査
- 主要アクション（承認/却下/送信/削除/付け替え）の監査ログ必須
- ロール/ポリシー変更は変更ログを保存
- 例外処理は理由入力を必須にする

## 次のTODO
- 公式ロール一覧の確定（役割/責務の整理）
- ABAC条件の共通フォーマット整理（叩き台は追記済み）
- PBAC導入の可否と運用フローの決定
- RLS対象テーブルの選定
