# テスト結果 2026-01-16 チャット添付AV（ClamAV/clamd）

## 実行日時
- 2026-01-16

## 目的
- チャット添付AVスキャン（`CHAT_ATTACHMENT_AV_PROVIDER=clamav`）の前提として、clamd の疎通と EICAR 検知を確認する。

## 実行環境
- Podman: 4.9.3
- Node: v22.19.0
- ClamAV image: `docker.io/clamav/clamav:latest`（image digest: `sha256:771f415d5c8d6bf91d3e331bf49f12bd73dbb8ab0651a811cccfa128be711788`）

## 実行方法
- `WAIT_TIMEOUT_SEC=600 bash scripts/podman-clamav.sh check`
- `bash scripts/podman-clamav.sh stop`

## 結果
- clean test: OK（`stream: OK`）
- EICAR: 検知（`Eicar-Test-Signature FOUND`）
- exit code: 0

## ログ（抜粋）
```text
clamav container started: erp4-clamav (host port: 3310)
[clamav] host: 127.0.0.1
[clamav] port: 3310
[clamav] timeoutMs: 10000
[clamav] clean test: { verdict: 'clean', raw: 'stream: OK' }
[clamav] eicar test: {
  verdict: 'infected',
  detected: 'Eicar-Test-Signature',
  raw: 'stream: Eicar-Test-Signature FOUND'
}
[clamav] ok
clamav stopped: erp4-clamav
```

## 備考
- 初回起動は定義更新のため時間がかかる場合がある（`WAIT_TIMEOUT_SEC` で待機時間を調整）。

---

## 統合（Backend API）テスト

### 目的
- backend の添付アップロード経路で、AV判定が期待通りに動作することを確認する。
  - clamd 稼働中: clean は許可（200）
  - clamd 稼働中: EICAR は拒否（422）
  - clamd 停止中: fail closed（503）

### 実行方法
- `bash scripts/smoke-chat-attachments-av.sh`
  - 内部で Podman DB + clamd を起動し、backend を `AUTH_MODE=header` で起動してAPI経由で検証する。
  - 主要な環境変数（変更する場合）:
    - `BACKEND_PORT`（既定: 3003）
    - `DB_CONTAINER_NAME` / `DB_HOST_PORT`（既定: `erp4-pg-smoke-chat-av` / 55436）
    - `CLAMAV_CONTAINER_NAME` / `CLAMAV_HOST_PORT`（既定: `erp4-clamav-smoke` / 3311）

### 結果（抜粋）
```text
upload clean (clamd up): status=200
upload eicar (clamd up): status=422
error_code=VIRUS_DETECTED
stop clamd and expect 503
upload clean (clamd down): status=503
smoke ok
```

### ログ
- 実行ログ: `tmp/smoke-chat-attachments-av-2026-01-16.txt`
- backend ログ: `tmp/smoke-chat-attachments-av-backend.log`
