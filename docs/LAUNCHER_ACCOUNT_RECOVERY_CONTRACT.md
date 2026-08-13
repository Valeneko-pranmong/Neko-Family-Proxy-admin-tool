# Authoritative Launcher Account Recovery Contract

Status: current tracked Admin repository recovery contract. Backend authority is the committed forward migration chain `20260809120000_account_recovery_codes.sql`, `20260809124500_fix_recovery_verify_column_ambiguity.sql`, and `20260810040000_revoke_superseded_recovery_sessions.sql`; repository presence does not establish hosted deployment state.

This flow replaces Admin-assisted temporary passwords. A Recovery Code is not a Supabase password. A Recovery Session is not a normal Launcher session and has only the `change_password` scope.

## 1. Verify Recovery Code

### Endpoint

`POST /api/account/recovery/verify`

Headers:

```text
Content-Type: application/json
```

Exact request fields:

```json
{
  "username": "customer_username",
  "recovery_code": "ABCD-EFGH-JKLM-NPQR-STUV-WX2345"
}
```

- `username`: normalized lowercase account username, 3–32 characters matching `[a-z0-9_]`.
- `recovery_code`: groups `4-4-4-4-4-6`, totaling 26 symbols from a 32-character alphabet (`A-Z2-9` excluding ambiguous characters). This provides 130 bits of entropy; comparison is performed through a server-side HMAC verifier.
- Recovery generation and verification are restricted to customer profiles whose status is `active`. Suspended or banned accounts cannot enter this flow.

Success `200`:

```json
{
  "ok": true,
  "recovery_session_id": "uuid",
  "recovery_session": "opaque-base64url-token",
  "scope": "change_password",
  "expires_at": "RFC3339 timestamp"
}
```

The opaque Recovery Session is generated from 32 cryptographically random bytes and encoded as unpadded base64url (normally 43 characters). The API accepts 40–200 base64url characters. It expires after 10 minutes according to server/database time.

All `expires_at` values are timezone-bearing RFC3339 timestamps (`Z` or an explicit numeric offset). The Launcher must reject malformed timestamps rather than interpreting locale-dependent dates.

The Launcher must keep the token in recovery-flow process memory only. It must not place it in a URL, log, analytics/crash event, normal Launcher auth storage, installation record, or normal Launcher session. The code is consumed when verification succeeds and cannot create another Recovery Session.

Stable verify errors:

| HTTP | `error` | Meaning / Launcher action |
|---|---|---|
| `400` | `Recovery code is invalid or expired` | Malformed, incorrect, expired, used, superseded, locked, unknown username, or database rate-limited. Show one generic message; do not infer account existence. |
| `413` | `Request too large` | Reject the request locally. |
| `502` | `Recovery backend returned an invalid response` or safe generic server error | Backend contract/upstream failure; do not expose details. |
| `500` | `Server error` | Unexpected server failure; do not expose details. |

Verification attempts are database-rate-limited using an HMAC requester verifier; raw requester addresses are not stored. Rate-limit windows older than one day are deleted. Trusted client-address normalization must be verified in the deployed Vercel environment.

## 2. Change Password

### Endpoint

`POST /api/account/recovery/change-password`

Exact transport:

```text
Authorization: Bearer <recovery_session>
Content-Type: application/json
```

Exact request fields:

```json
{
  "new_password": "user-chosen password"
}
```

The Recovery Session must not be sent in the JSON body or query string.

Password policy:

- 12–128 characters;
- at least one uppercase ASCII letter;
- at least one lowercase ASCII letter;
- at least one ASCII digit;
- at least one non-alphanumeric character.

Success and completed replay `200`:

```json
{
  "ok": true,
  "completed": true,
  "state": "completed"
}
```

Stable change-password errors:

| HTTP | `error` | Meaning / Launcher action |
|---|---|---|
| `400` | `Password must be 12-128 characters and include upper, lower, number, and symbol` | Password policy failure; let the user correct it. |
| `401` | `Recovery session required` | Bearer token missing or malformed. |
| `401` | `Recovery session is invalid or expired` | Non-completed session is unknown, expired, revoked, or otherwise invalid; start recovery again through Admin. |
| `409` | `Retry the same recovery session and password` | A different password was supplied after the operation was bound, or the Auth-update lease is still active. Retry only the exact same token and password after a short delay. |
| `502` | `Recovery backend is temporarily unavailable` or `Recovery backend returned an invalid response` | Backend/upstream contract failure; retry later without exposing internal detail. |
| `503` | `Password recovery is temporarily unavailable; retry the same request` | Supabase Auth update failed or was ambiguous. Retry the exact same token and password. |
| `503` | `Password was updated but recovery finalization is pending; retry the same request` | Supabase Auth succeeded but database completion is not confirmed. Do not generate another code; retry the exact same token and password. |
| `413` | `Request too large` | Reject the request locally. |

## 3. Idempotency and lost-response semantics

On the first valid password-change attempt, the server stores an HMAC fingerprint of the user-selected password and claims a short Auth-update lease. Plaintext password is never stored in PostgreSQL or audit metadata.

If a success response is lost after completion:

1. Launcher retries the same endpoint with the same Bearer token and exactly the same password.
2. The database validates token scope and the stored password fingerprint.
3. `completed` takes precedence over generic expiry/revocation rejection because completion itself assigns `revoked_at`.
4. The claim returns `already_completed = true`.
5. The Web API returns the stable `200 completed` response without calling Supabase Auth again.

A completed replay with a different password fails `409`. A truly revoked/expired/invalid non-completed Recovery Session fails `401`. Therefore completed replay does not weaken token, scope, or password-binding checks.

## 4. Success behavior

Database completion transactionally:

1. marks the Recovery Session `completed` and unusable for new work;
2. revokes every still-active `public.launcher_sessions` row for the recovered user;
3. writes `account_password_recovered` audit metadata without code, token, or password.

After `200 completed`, the Launcher must:

1. erase Recovery Code, Recovery Session, and password fields from memory;
2. return to the normal Login screen;
3. require normal login with the new password;
4. obtain a new regular Launcher session only through the existing normal session-claim flow.

Recovery credentials must never authorize Launcher Core startup, product use, coupon/license actions, installation registration, normal session creation, dashboard APIs, or Admin APIs.

## 5. Authority files

Admin Web/API repository:

- `api/index.mjs` — public recovery routes and Bearer transport
- `server/account-recovery.mjs` — generation, verification, password policy, Auth update and retry mapping
- `server/config.mjs` — server-only HMAC secret requirement
- `tests/account-recovery.test.mjs` — recovery/idempotency regression tests
- `tests/vercel-api.test.mjs` — HTTP integration and old-endpoint rejection
- `standalone/src/main.js`
- `standalone/src/sections/render.js`

Backend/Supabase worktree:

- `supabase/migrations/20260809120000_account_recovery_codes.sql` — forward-only schema/RPC/audit/grants contract
- `supabase/migrations/20260809124500_fix_recovery_verify_column_ambiguity.sql` — verification RPC ambiguity fix
- `supabase/migrations/20260810040000_revoke_superseded_recovery_sessions.sql` — recovery-generation supersession boundary
- `launcher/tests/test_account_recovery_migration.py` — static base migration contract tests
- `launcher/tests/test_recovery_session_supersession_migration.py` — supersession contract tests

This repository does not establish hosted migration state. Before enabling recovery against a hosted environment, verify the full chain above, inspect live function definitions/grants/RLS, and run real failure-injection E2E.
