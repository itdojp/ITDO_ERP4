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

- ルート単位のRBAC（admin/mgmt/exec/user/hr + 社員区分 + 外部チャット）
- projectIdフィルタによる簡易スコープ制御
- 監査ログは主要アクションのみ

### 本番（段階2以降）

- RBAC: ロールで機能単位の可否を決定
- ABAC: ユーザ属性/リソース属性/環境属性で行レベル制御（subject/resource/environment）
- PBAC: Phase 3 では導入しない（将来必要になれば OPA/Cerbos 等を検討）
- DB側: アプリ側フィルタを継続し、必要なテーブルのみRLSを併用
  - 対象: time_entries / expenses / daily_reports / wellbeing_entries

## ロール一覧（ドラフト）

現行PoCの実装で使っているロールに基づくたたき台です。実運用での責務は要確認。

| ロール        | 想定責務       | 主要権限（例）                                            |
| ------------- | -------------- | --------------------------------------------------------- |
| admin         | システム管理者 | 全設定/全データの閲覧・編集・承認                         |
| mgmt          | 管理部         | 見積/請求/発注/仕入の作成・承認、マスタ管理、アラート設定 |
| exec          | 経営           | 高額案件の承認、ダッシュボード/レポート閲覧               |
| hr            | 人事           | ウェルビーイングの閲覧（専用）、人事関連の閲覧            |
| project_lead  | 社員（リーダ） | user相当（追加権限は要定義）                              |
| employee      | 社員（一般）   | user相当                                                  |
| probationary  | 社員（試用）   | user相当                                                  |
| external_chat | 外部ユーザ（暫定） | チャットはグループACLで制御（roleによる固定区分は廃止）。他機能の抑止用途は暫定的に残す |

### 補足

- ルートのpreHandlerでは上記ロールを前提に `requireRole` を適用
- `project_lead` / `employee` / `probationary` は現状 user 相当として扱う（追加/制限は後続決定）
- `external_chat` はチャットの権限制御には使わない（chatは group ACL に統一）
- `external_chat` を使った非チャット機能の抑止は暫定運用とし、後続で権限プロファイルへ移行する
- 承認インスタンスの閲覧は mgmt/exec + 申請者本人 + 所属案件のメンバー
- プロジェクトメンバーは ERP 側で管理（ProjectMember）。admin/mgmt がリーダを登録し、リーダは自プロジェクトのメンバーを追加/削除できる

## グループ管理（段階導入）

- SCIM 同期グループに加え、ERP 側で手動作成したグループを運用可能にする
- 識別子は GroupAccount.id（UUID）を正とし、displayName は表示用として扱う
- 移行期間を含め、API は GroupAccount.id（UUID）のみを受け付ける。displayName ベースの既存設定は事前に UUID へ移行（クライアント/移行スクリプト側で解決）する

## ユーザ属性（ABAC入力）

- tenantId / orgUnitId / departmentId
- roleCodes（RBACロール）
- groupIds（承認/人事などのグループ）
- projectIds（所属案件、ProjectMemberから取得）
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
    "now": "YYYY-MM-DDTHH:mm:ssZ"
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

- 公式ロール一覧の確定（役割/責務の整理）【決定済み】
- ABAC条件の共通フォーマット整理【決定: subject/resource/environment】
- PBAC導入の可否と運用フローの決定【決定: Phase 3 では導入しない】
- RLS対象テーブルの選定【決定: time_entries / expenses / daily_reports / wellbeing_entries】
