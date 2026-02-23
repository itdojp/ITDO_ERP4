# 委任認証（principal/actor + scope）仕様

更新日: 2026-02-23  
関連Issue: #1208

## 目的

エージェント実行時に「誰の代理で（principal）」「誰が実行したか（actor）」「どの権限範囲か（scope）」をAPIと監査ログで一貫して扱う。

## JWT claim設計

- `sub`: principal のユーザーID（必須）
- `act.sub`: actor の識別子（任意、未指定時は `sub` を採用）
- `scp`: スコープ（配列または空白区切り文字列）
- `jti`: トークンID（失効判定に利用）
- `aud`: 想定利用先（配列または文字列）
- `exp`: 有効期限（UNIX epoch seconds）

### 実装上の既定値

- `JWT_SUB_CLAIM=sub`
- `JWT_ACTOR_SUB_CLAIM=act.sub`
- `JWT_SCOPE_CLAIM=scp`
- `JWT_TOKEN_ID_CLAIM=jti`

## スコープ表現

MVPでは次の3段階を扱う。

- `read-only`（同義語: `read`, `agent:read-only`, `agent:read`）
- `write-limited`（同義語: `write`, `agent:write-limited`, `agent:write`）
- `approval-required`（同義語: `agent:approval-required`）

### 判定ルール

- 読み取りメソッド（`GET/HEAD/OPTIONS`）は read/write/approval のいずれかで許可
- 変更メソッド（`POST/PUT/PATCH/DELETE`）は write/approval のみ許可
- 委任トークンで scope 条件を満たさない場合は `403 scope_denied`

## トークン発行/失効フロー

### 発行

- 短命アクセストークン（推奨: 5〜15分）を前提
- 更新は refresh トークンまたは再発行APIで実施
- トークンには必ず `jti` を含める

### 失効

- 緊急失効は `JWT_REVOKED_JTI`（CSV）で拒否
- `jti` 一致時は `401 unauthorized`（reason: `jwt_revoked`）
- 恒久運用は次フェーズで DB/Redis deny-list へ移行

## ブレークグラス運用

- 例外運用時は通常トークンと別系統の発行ポリシーを適用
- 必須記録: 発行理由、発行者、期限、対象scope
- 監査ログ上で `source=agent` と `_auth` 情報を必ず残す

## 監査ログ要件

`AuditLog.metadata` に次を標準格納する。

- `_auth.principalUserId`
- `_auth.actorUserId`
- `_auth.scopes`
- `_auth.tokenId`
- `_auth.audience`
- `_auth.expiresAt`
- `_request.id`
- `_request.source`

`source` カラムは委任実行時に `agent`、それ以外は `api`。

## 既知の制約（MVP）

- route単位の細粒度scope（例: `invoice:send`）は未導入
- `approval-required` の業務フロー連携（承認ID必須化）は Phase 2 で実装
