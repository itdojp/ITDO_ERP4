# 2026-02-16 Static Review Findings

Issue: #993  
Scope: Backend / Frontend / API contract

## Findings

### Critical

1. Header-auth fallback can be abused in production if misconfigured

- Context: `AUTH_MODE=header` (or `hybrid` without Bearer token) accepts identity from request headers.
- Risk: If reverse-proxy hardening is missing, clients can forge `x-user-id`/`x-roles` and escalate privileges.
- Evidence:
  - `packages/backend/src/plugins/auth.ts`
  - `packages/backend/src/services/envValidation.ts`
- Mitigation implemented in this work:
  - Production guard for `AUTH_MODE=header` (requires explicit override flag)
  - Production `hybrid` without token now returns 401 unless explicit override flag is enabled
  - Validation and documentation for `AUTH_ALLOW_HEADER_FALLBACK_IN_PROD`

### High

- No additional High findings in frontend static review (`packages/frontend/src`) or API contract spot check.

## Notes

- Header-based auth remains available for local/dev and trusted internal proxy deployments.
- Production use requires explicit opt-in (`AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=true`) and should be limited to controlled network boundaries.
