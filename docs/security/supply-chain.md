# 供給網セキュリティ（依存更新/SBOM）

## 目的
- 依存関係起因のリスク（脆弱性・混入）を低減し、更新を習慣化する
- 「何に依存しているか（SBOM）」を継続的に取得できる状態にする

## 依存更新（Dependabot）
- 設定: `.github/dependabot.yml`
- 対象:
  - `packages/backend`（npm）
  - `packages/frontend`（npm）
  - GitHub Actions（workflow）
- 既定ポリシー:
  - patch/minor はまとめて更新（Dependabot groups）
  - major は個別PRとして扱い、影響範囲と移行手順を明記して対応する

## 脆弱性検知（CI）
現状は「high/critical のみ CI を fail」します。

- workflow: `.github/workflows/ci.yml`
- job: `security-audit`
- コマンド:
  - `npm audit --audit-level=high`（backend/frontend）

### moderate の扱い
- moderate は CI で即 fail にはせず、トリアージ運用で管理する
- 判断基準: `docs/security/dependency-vulnerability-policy.md`
- 最新台帳: `docs/security/dependency-vulnerability-register.md`

### Dependabot alert の週次監視
- workflow: `.github/workflows/dependabot-alert-watch.yml`
- 監視対象:
  - alert `#10` (`qs`, low)
  - alert `#11` (`fast-xml-parser`, high)
- 収集項目:
  - alert state / GHSA
  - lockfile 解決バージョン（`qs` / `fast-xml-parser`）
  - upstream 最新版（`googleapis` / `googleapis-common`）
- 手動確認コマンド:
  - `make dependabot-alerts-check`
  - `make dependabot-token-readiness-check`（token設定/権限の事前確認）
- API認証（任意）:
  - `DEPENDABOT_ALERTS_TOKEN`（repo secret）を設定すると、workflow が Dependabot Alert API を安定取得できる
  - 未設定時は `github.token` を使用し、APIアクセス不可の場合は `script status != 0` となる
  - 事前確認（失敗時は原因コードを出力）:
    - `make dependabot-token-readiness-check`
    - `STRICT=1 make dependabot-token-readiness-check`
- 追跡Issue（#1153）の状態同期:
  - bot ステータスコメントは毎回更新する
  - `script status == 0` のときは alert詳細をコメントし、Issue状態同期も実行する
  - `script status != 0` のときは warning を出し、botステータスコメントを `BLOCKED` として更新する（Issue状態同期は行わない）
  - `result reason`（失敗時理由コード）を併記し、`MISSING_DEPENDABOT_ALERTS_TOKEN` / `PERMISSION_DENIED` の場合は `DEPENDABOT_ALERTS_TOKEN` 設定を優先確認する
  - `actionRequired=true` または alert `#10` が `OPEN` の場合は open を維持（closed なら再オープン）
  - alert `#10` が `OPEN` でなく `actionRequired=false` の場合は自動クローズ
- token 設定Issue（#1176）の状態同期:
  - bot ステータスコメント（marker: `dependabot-token-readiness`）を毎回更新する
  - `script status == 0` のときは `READY` として記録し、Issue #1176 を自動クローズする
  - `script status != 0` かつ `MISSING_DEPENDABOT_ALERTS_TOKEN` / `PERMISSION_DENIED` / `BAD_CREDENTIALS` のときは `BLOCKED` を記録し、Issue #1176 を open に維持する（closed なら再オープン）
  - token 非依存の失敗理由（例: `NETWORK_ERROR`）はコメント更新のみ行い、Issue状態は変更しない
  - `upstreamUpdated=true` の場合は backend lockfile 更新PRを自動作成/更新する（`npm update --prefix packages/backend googleapis googleapis-common`）

### 監視対象の最新判断（2026-02-21）
- alert `#10` (`GHSA-w7fw-mjwx-w883`, low):
  - `OPEN` のまま監視継続
  - lockfile は `qs@6.15.0`（patched `>=6.14.2`）を解決
  - `googleapis` / `googleapis-common` の upstream 更新待ち
- alert `#11` (`GHSA-jmr7-xgp7-cmfj`, high):
  - `DISMISSED`（reason: `inaccurate`）
  - 根拠: lockfile が `fast-xml-parser@5.3.6`（first patched）を解決し、`npm audit --audit-level=high` で high/critical 未検知

追跡 Issue: #1153

例外/抑制が必要な場合は、以下を必須として Issue 化します。
- 対象（パッケージ/CVE など）
- 影響範囲（runtime / dev など）
- 回避策（設定、WAF、機能無効化等）
- 期限（次回更新で解消する期日）
- 承認者（セキュリティ責任者/管理者）

## SBOM（CycloneDX）
### CI での生成（artifact）
- workflow: `.github/workflows/ci.yml`
- job: `security-audit`
- 生成ツール: `@cyclonedx/cyclonedx-npm@2.1.0`（Node.js >=14）
- 出力:
  - `tmp/sbom/backend.cdx.json`
  - `tmp/sbom/frontend.cdx.json`
  - 上記を Actions artifact としてアップロード

### ローカルでの生成
```bash
./scripts/export-sbom.sh --out tmp/sbom
```

## Provenance/署名（現状）
現時点では署名や provenance の強制は行いません。
導入する場合は、対象（成果物/コンテナ/依存）と運用（鍵管理・検証点）を含めて別 Issue で設計します。
