# チャット添付: ウイルス対策（スキャン）MVP

## 方針

- 添付アップロード時にスキャンを挟めるようにする（保存前に判定）
- 既定は `disabled`（挙動変更なし）
- MVPは「スキャン拡張点 + EICARテスト検知」を提供する（実運用のAVは後続）

## 環境変数（Backend）

- `CHAT_ATTACHMENT_AV_PROVIDER`
  - `disabled`（既定）: スキャンしない
  - `stub`: 常にOK（疎通用）
  - `eicar`: EICAR文字列を含む場合にブロック（テスト用）
  - `clamav`: clamd（ClamAV daemon）へ接続してスキャン（実運用候補）

- clamd 接続（`CHAT_ATTACHMENT_AV_PROVIDER=clamav` の場合）
  - `CLAMAV_HOST`（既定: `127.0.0.1`）
  - `CLAMAV_PORT`（既定: `3310`）
  - `CLAMAV_TIMEOUT_MS`（既定: `10000`）

## 動作

- `provider=disabled|stub` の場合
  - 従来通り保存して成功（監査ログに scan 情報を付与）
- `provider=eicar` の場合
  - EICAR文字列を含むファイルは 422 で拒否し保存しない
- `provider=clamav` の場合
  - clamd でスキャンし、感染判定（`FOUND`）の場合は 422 で拒否し保存しない
  - スキャナが利用不能（接続不可/タイムアウト等）の場合は 503 を返し保存しない

## 監査ログ

- upload 成功: `chat_attachment_uploaded` の metadata に scan 情報を付与
- ブロック: `chat_attachment_blocked` を記録
- スキャン失敗: `chat_attachment_scan_failed` を記録
- 共通 metadata: `scanDurationMs` を記録し、遅延監視（p95）を集計可能にする

## 運用設計（確定候補 / Issue #886）

運用Runbookは `docs/ops/antivirus.md` を正本として管理する。監視しきい値や障害対応フローなどの運用詳細は Runbook 側に記載し、本節では有効化判断と判定ゲートの必須要件を中心に整理する。
本番の最終決定値は `docs/ops/antivirus-decision-record.md` を正本として記録し、決定後に本節へ反映する。

### 現時点の確定事項（2026-02-07時点）

- 既定は `disabled` を維持する（未確定項目が残る間は挙動変更しない）。
- `clamav` 運用時の障害挙動は fail closed（スキャナ利用不能時は 503）とする。
- 検証構成は backend と clamd を同一ホスト別コンテナで接続（TCP: `CLAMAV_HOST`/`CLAMAV_PORT`）する。

### 有効化判断の前提

`clamav` 有効化は、少なくとも以下を満たす場合に推奨する。

- 外部ユーザが添付をアップロード可能である。
- 監査/ガバナンス上、「スキャンなし」を許容できない。

### 定義更新方式（確定候補）

第1候補:
- `docker.io/clamav/clamav:latest` の `freshclam --daemon` を利用する。

補完策:
- 週次以上でイメージ更新ジョブを実行し、定義/エンジン更新の取りこぼしを抑制する。

検証根拠:
- `podman exec erp4-clamav ps -eo pid,comm,args` で `freshclam --daemon` を確認済み。
- `podman logs erp4-clamav` で `ClamAV update process started` を確認済み。

### 監視/障害対応（確定候補）

推奨監視対象:
- clamd 死活（TCP 応答）
- `chat_attachment_scan_failed` の発生件数
- スキャン遅延（タイムアウト増加）
- 添付 API の 503 比率

推奨しきい値:
- clamd 応答不可が 3 分継続: Critical
- `chat_attachment_scan_failed` が 10 分で 5 件以上: High
- 添付 API の 503 比率が 10 分窓で 1% 超: High
- スキャン処理時間 p95 が 5 秒超（10 分継続）: Medium

障害時の原則:
- fail closed を維持し、バイパス保存は行わない。
- 復旧手順は `docs/ops/antivirus.md` に従って再検証まで実施する。

### 本番有効化の判定ゲート（Issue #886）

`CHAT_ATTACHMENT_AV_PROVIDER=clamav` を本番で有効化する前に、以下を満たすことを必須とする。

1. セキュリティ要件
   - 外部ユーザを含む添付利用で「スキャンなし」を許容しないことが、運用責任者/セキュリティ責任者で合意されている。
2. 可用性要件
   - fail closed（スキャナ停止時は 503）を業務として許容するか、許容しない場合の代替フロー（受付窓口/一次保管）が定義されている。
3. 運用要件
   - 定義更新方式（`freshclam --daemon` / 定期ジョブ / イメージ更新）を選定し、担当/頻度/障害時手順が確定している。
   - 監視対象（clamd死活、`chat_attachment_scan_failed`、タイムアウト増加）に対するアラート閾値と一次対応手順が確定している。
4. 検証要件
   - ステージングで `bash scripts/smoke-chat-attachments-av.sh` を実行し、結果を `docs/test-results/` に記録している。
   - 記録は `docs/test-results/chat-attachments-av-staging-template.md` の様式に従う。

上記が未確定の場合は `CHAT_ATTACHMENT_AV_PROVIDER=disabled` を維持する。

## テスト（手動）

1. backend を `CHAT_ATTACHMENT_AV_PROVIDER=eicar` で起動
2. チャット添付に以下の内容を含むテキストファイルをアップロード

EICARテスト文字列（例）

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

3. 422（`VIRUS_DETECTED`）で拒否されることを確認

### ClamAV（clamd）での疎通

1. clamd を起動（例: Podman で TCP 3310 を公開）
   - 例: `podman run -d --name erp4-clamav -p 3310:3310 docker.io/clamav/clamav:latest`
   - 終了後: `podman stop erp4-clamav && podman rm erp4-clamav`
   - 補助スクリプト: `bash scripts/podman-clamav.sh start`（停止は `bash scripts/podman-clamav.sh stop`）
2. backend を `CHAT_ATTACHMENT_AV_PROVIDER=clamav` で起動（`CLAMAV_HOST`/`CLAMAV_PORT` を環境に合わせて設定）
3. EICAR 文字列を含むファイルをアップロードし、422 で拒否されることを確認
4. clamd を停止した状態でアップロードし、503（`AV_UNAVAILABLE`）で拒否されることを確認

### 補助: ClamAV疎通チェック（スクリプト）

clamd の疎通と EICAR 検知（`FOUND`）を確認するスクリプトです。

```bash
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/check-chat-clamav.ts
```

もしくは、Podman起動〜疎通確認までをまとめて実行します。

```bash
bash scripts/podman-clamav.sh check
```

### 補助: Backend 統合スモーク（API）

Podman DB + clamd + backend を起動し、API経由で以下を確認します。

- clamd 稼働中: clean 添付は 200 で成功
- clamd 稼働中: EICAR 添付は 422（`VIRUS_DETECTED`）で拒否
- clamd 停止中: clean 添付は 503（`AV_UNAVAILABLE`）で拒否（fail closed）

```bash
bash scripts/smoke-chat-attachments-av.sh
```
