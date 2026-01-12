# Phase 3 本実装計画（ドラフト）

## 目的
Phase 3 PoCの結果を踏まえ、GRC/監査とAI/分析の本実装スコープを確定する。

## 対象範囲
- GRC/監査: 監査ログの対象拡張、外部保全、アクセスレビューの運用
- AI/分析: インサイトの拡張、根拠表示、運用ガバナンス

## GRC/監査（本実装）
### 監査対象イベントの拡張
- 認証: login success/failure, token検証失敗
- 権限: role/group/assignment の付与・剥奪
- 承認: approve/reject/cancel, step skip
- データ操作: export, bulk update, reassignment
- 設定変更: approval rules / alert settings / template settings

### 監査ログの拡張項目
- actorRole/actorGroupId
- requestId/ipAddress/userAgent
- source (api/ui/job)
- reasonCode/reasonText

### 外部保全・改ざん検知
- WORM対応の保管先検討（S3 Object Lock Compliance mode など）
- 保存形式: 日次ローテーションのCSV/JSON
- ハッシュチェーン（sha256）で改ざん検知

### 検索/出力
- 期間/対象/アクション/理由での検索
- エクスポート時の申請/承認フロー
- CSV/JSONの出力フォーマットを統一

### 性能/保持
- 期間パーティション（月単位）
- 保存期間とアーカイブ方針
- 監査ログの増加に備えたindex設計

## AI/分析（本実装）
### インサイト拡張
- 予実ギャップ（予算・工数・粗利）
- 承認ボトルネックの特定
- 納期/請求遅延の傾向
- 外部連携失敗の影響度

### 根拠表示
- インサイトごとの根拠データ（件数/対象/期間）
- 計算式/基準値の明示
- 影響度/優先度の算出方法

### 権限/匿名化
- HR系は集計のみ、5人未満は非表示
- 閲覧ログの監査必須

### 性能/品質
- 期間集計の事前集計（materialized view or job）
- 説明可能性の最小要件
- 誤検知の扱い（人手レビュー）

## 依存関係
- 監査ログ拡張のスキーマ変更
- 監査ログ外部保全の運用合意
- インサイト追加指標の定義とデータ品質

## マイルストーン案
- M3.1: 監査対象イベント拡張 + 出力統一
- M3.2: 外部保全（WORM）検証
- M3.3: インサイト拡張 + 根拠表示
- M3.4: 運用設計/監査対応フロー確定
