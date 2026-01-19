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
