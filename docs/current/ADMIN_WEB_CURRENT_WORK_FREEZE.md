# Admin Web Current-Work Freeze

Status: current closure handoff. This document freezes Admin Web repository scope before future NEKO-AUTH-LITE coordination. It does not certify production deployment.

## Frozen scope

Implemented and locally verified:

- Vercel Admin API with signed, HttpOnly, SameSite=Strict Admin cookie and same-origin mutation checks.
- Dashboard KPIs, trends, recent audit activity, users, products, licenses, coupons, redemption history, Launcher sessions, and remembered installations.
- Admin lifecycle actions for user status, license extension/revocation, Launcher session revocation, coupon batch operations, and Admin-generated temporary Recovery Codes.
- Public Recovery Code verification and restricted Recovery Session password-change flow.
- Multiple remembered installations with one current Launcher session per user; latest successful login wins; displaced installations are not permanently locked.
- Server-only Supabase privileged key and recovery HMAC secret boundaries.
- Realistic PostgREST SQL exception mapping for missing users, licenses, and sessions.
- Effective Backend audit event names and allowlisted metadata rendering.
- Strict single-IP recovery requester normalization: Vercel uses canonical `x-vercel-forwarded-for`; malformed or multi-value values fall back to server-observed peer identity without trusting generic forwarded input.

Intentionally absent from current approved scope:

- Account creation/deletion, role changes, product mutation, new license assignment, and dedicated account/license detail workflows.
- Permanent installation revocation.
- Legacy email password reset.
- NEKO-AUTH-LITE permit protocol or migration work.

## Current account policy

- Primary recovery authority: Admin-generated temporary Recovery Code.
- Legacy email password reset: inactive.
- Remembered installations: multiple allowed.
- Active Launcher sessions: one per user.
- Takeover rule: latest successful login wins.
- Displaced installation: may authenticate again; no permanent lock.

## Open release blockers

### BLOCKER-01 — Admin logout cannot revoke a retained signed cookie

Severity: high.
Owner: Admin Web + Backend.

Current logout clears browser cookie only. A copied pre-logout cookie remains valid until its TTL expires unless Admin profile becomes inactive. Production release requires durable opaque Admin sessions or a server-checked per-session/per-user revocation epoch, plus a negative replay test proving retained cookie receives `401` after logout.

### BLOCKER-02 — Recovery supersession is not a proven barrier against an in-flight Auth update

Severity: high.
Primary OWNER = Launcher + Backend for durable supersession barrier and database/Auth contract. Admin Web owns handler integration and regression proof because it executes Supabase Auth password update.

A prior Recovery Session can claim `auth_updating`; Admin can then generate a replacement Recovery Code and mark that session revoked while an already-running Admin Web request still calls Supabase Auth password update. Replacement-code success therefore does not yet prove earlier derivative authority stopped. Backend must serialize generation against the external Auth-update lease or use a durable generation-fenced worker/recheck immediately before the irreversible Auth update. Admin Web must integrate that barrier and add a concurrent handler-to-real-DB/Auth negative test. Verify full flow with real concurrent database/Auth integration.

### BLOCKER-03 — Hosted migration and runtime state not proven

Severity: high release gate.
Primary OWNER = Launcher + Backend for hosted migration/catalog state, database concurrency, and Launcher takeover proof. Admin Web owns handler-to-real-DB/Auth integration evidence.

Current Admin Web code depends on recovery and one-active-session Backend contracts, but source references and external migration files are not hosted deployment proof. Before production use, compare live migration history and `pg_get_functiondef`, grants, RLS, indexes, triggers, and columns against approved Backend migration artifacts. Launcher + Backend must prove real two-client takeover and database concurrency. Admin Web must prove recovery handlers against real disposable DB/Auth, including Auth failure/retry and supersession races. Permit/session-binding work remains outside this freeze and is not claimed as implemented.

### BLOCKER-04 — Edge controls need deployed evidence

Severity: medium operational gate.
Owner: Admin Web operations.

Verify Vercel Firewall/WAF throttling for login, Admin mutations, recovery verification, and password change. Vercel documentation identifies `x-vercel-forwarded-for` as canonical when a proxy sits above Vercel. Verify deployed project behavior because local normalization tests do not prove edge-header delivery.

## External dependencies

- `E:\Github\Neko-Family-Proxy`: authoritative Backend migrations/RPCs, Supabase Auth integration, recovery supersession barrier, Launcher session policy, hosted catalog proof, and two-client runtime verification. `OWNER = Launcher + Backend`.
- `E:\Github\NekoProxyCore`: future permit verification and Core authorization integration only. No Core source or artifact changed in this freeze. `OWNER = Core`.

## Verification boundary

Canonical repository command:

```text
npm test
```

This runs standalone build plus all tracked Node tests. `npm run build`, `npm audit --audit-level=moderate`, JavaScript syntax checks, and `git diff --check` are separate closure checks. Repository has no dedicated lint, typecheck, browser E2E, or CI workflow script; absence must not be reported as a passing gate.

Fresh local closure evidence on Node `v24.19.0` / npm `11.17.0`:

- `npm ci`: passed; 0 vulnerabilities.
- `npm test`: 37 passed, 0 failed, 0 skipped.
- `npm run build`: passed; generated `standalone/dist/neko-control.html` is 54,125 bytes with no tracked logical drift.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- `node --check` for every tracked `.mjs`/`.js`: passed.
- `git diff --check`: passed.

Local fake API/RPC tests are regression evidence, not proof of hosted Supabase/Vercel state. Production readiness remains blocked until all open release blockers above close with runtime evidence.

## Migration boundary

No `NEKO-AUTH-S0` or old S0 release-gate reference exists in current Admin Web source/docs. NEKO-AUTH-LITE appears only as a future coordination boundary in this handoff; no implementation source or migration was added. Archived plans under `docs/archive/` are historical reference only and must not act as current contract or release gate.

Current Admin Web revision may be frozen for coordination while production release remains blocked. Future NEKO-AUTH-LITE work must start from a new coordinated contract after this current-work boundary.
