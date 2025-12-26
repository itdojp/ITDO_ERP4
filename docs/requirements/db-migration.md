# DBマイグレーション方針（Prisma）

## 目的
- スキーマ変更を安全に反映する
- 環境ごとの差異を避ける
- 変更履歴を追跡できる状態にする

## 基本方針
- **ローカル開発**: `prisma migrate dev` を使用
- **ステージング/本番**: `prisma migrate deploy` を使用
- **`prisma db push`** は PoC/一時DBのみ（ステージング/本番は禁止）

## 運用ルール
- スキーマ変更は `prisma/schema.prisma` で行い、`prisma migrate dev --name <change>` でマイグレーション作成
- 生成された `prisma/migrations/*` をコミット
- データ修正が必要な場合は、マイグレーション SQL に追記するか、別途手動SQL手順を用意
- 破壊的変更（カラム削除/型変更/制約強化）は事前に影響確認と移行手順を用意

## 推奨フロー
1) `prisma/schema.prisma` を更新
2) `npx prisma migrate dev --name <change>`
3) `npx prisma generate`（必要に応じて）
4) PRでレビュー
5) ステージングで `npx prisma migrate deploy`
6) 本番で `npx prisma migrate deploy`

## PoC/検証用
- 一時的な検証DBは `prisma db push` を許容
- seed/チェックを実行して動作確認

## 次のTODO
- 最初のベースラインマイグレーション作成
- ステージング/本番の実行権限とロールを整備
- データ移行手順との統合
