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

## 運用設計（叩き台）

### 有効化の考え方

- 既定は `disabled`（添付を許容しつつ、運用決定を後回しにできる）
- `clamav` の有効化は、少なくとも以下を満たす環境で推奨
  - 外部ユーザが添付をアップロードできる
  - 監査/ガバナンス上「スキャンなし」を許容できない

### コンテナ構成（検証環境）

- backend と同一ホスト上で clamd を別コンテナとして起動する
- 接続は TCP（`CLAMAV_HOST`/`CLAMAV_PORT`）で行う
- この方式では backend 側は「スキャンが成立した場合のみ保存」し、スキャナ利用不能時は 503 で拒否する（fail closed）

### 定義更新（本番の要件として決めること）

ClamAV 定義更新は以下のいずれかを採用する前提で運用を確定する。

- コンテナが自動更新する構成（イメージ/エントリポイントに依存）
- 定期ジョブで `freshclam` を実行する構成（例: 日次）
- 定期的にイメージを更新して入れ替える構成

※ `clamav/clamav` イメージがどの方式かは、本ドキュメント作成時点では検証していません。採用前に検証環境で確認してください。

### 監視/障害時

- 推奨の監視対象
  - clamd の死活（TCP 接続）
  - `chat_attachment_scan_failed` の発生（監査ログ）
  - スキャン遅延（タイムアウトの増加）
- 障害時の挙動
  - 本実装はスキャナ利用不能時に 503 で拒否（fail closed）
  - 影響（添付不可）を許容できない場合は、運用として「復旧優先度」を定義する

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
