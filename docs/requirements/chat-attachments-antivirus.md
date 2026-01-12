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

## 動作
- `provider=disabled|stub` の場合
  - 従来通り保存して成功（監査ログに scan 情報を付与）
- `provider=eicar` の場合
  - EICAR文字列を含むファイルは 422 で拒否し保存しない

## 監査ログ
- upload 成功: `chat_attachment_uploaded` の metadata に scan 情報を付与
- ブロック: `chat_attachment_blocked` を記録

## テスト（手動）
1. backend を `CHAT_ATTACHMENT_AV_PROVIDER=eicar` で起動
2. チャット添付に以下の内容を含むテキストファイルをアップロード

EICARテスト文字列（例）
```
X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

3. 422（`VIRUS_DETECTED`）で拒否されることを確認

