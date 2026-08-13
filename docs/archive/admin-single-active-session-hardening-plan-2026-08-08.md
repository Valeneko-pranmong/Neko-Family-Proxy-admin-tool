# Admin Tool Single-Active-Session Hardening Implementation Plan

> **ARCHIVED HISTORICAL PLAN — DO NOT USE AS CURRENT POLICY.** Current Admin Web
> permits multiple remembered installations, one active Launcher session per
> user, newest login replacing previous session, and no permanent installation
> lock merely because active authority moved. See current source/tests and
> `README.md`.

> **For Hermes:** Implement this plan task-by-task using strict RED → GREEN → REFACTOR. Preserve all concurrent working-tree changes and never edit the generated standalone HTML by hand.

**Goal:** ทำให้ `Neko-Family-Proxy-admin-tool` บริหารนโยบาย “จดจำได้หลาย installation แต่ active ได้ครั้งละ 1 Launcher session และ login ล่าสุดแทน session เดิม” อย่างถูกต้อง โดยทุกคำสั่งที่เปลี่ยน account/license/installation/session ใช้ trusted, actor-checked, transactional Backend RPC และ UI แยก installation history ออกจาก current active session อย่างชัดเจน

**Architecture:** Browser เรียก same-origin Vercel API ด้วย signed `HttpOnly` admin cookie เท่านั้น; `server/admin.mjs` ตรวจ input และส่ง `actor.userId` ไปยัง service-role-only RPC ใน schema `launcher`; Backend RPC เป็น transaction boundary สำหรับ mutation, session revocation และ audit. Browser ไม่เรียก Supabase โดยตรงและไม่เห็น Secret Key. Read models ยังคงมาจาก server-side PostgREST แต่ต้อง sanitize installation hash ก่อนส่งออก

**Tech Stack:** Node.js ESM, Vercel Node Function, Supabase/PostgREST, PostgreSQL RPC, vanilla browser JavaScript, esbuild single-file HTML, Node test runner

---

## 0. Current state and boundaries

### Repository ownership

- Admin Web implementation: `E:\Github\Neko-Family-Proxy-admin-tool`
- Backend/Supabase implementation: `E:\Github\Neko-Family-Proxy`
- Launcher consumer: `E:\Github\Neko-Family-Proxy\launcher`
- Production authority/deployment configuration remains private; this work does not require or expose a public authority endpoint

### Evidence already present in Admin Tool

The current Admin Tool already implements several correct preparatory behaviors. Preserve and test them rather than rewriting them:

- `server/admin.mjs:getInstallations()` masks `installation_key_hash` and removes the full hash before returning data
- installation rows distinguish `owns_active_session` from historical remembered installations
- installation view shows active-session creation and heartbeat timestamps
- UI copy states that a new machine replaces the previous session
- Products/Licenses UI does not present legacy `max_devices` as the active policy
- UI offers distinct actions for session revocation, installation revocation, and account suspension
- browser bundle contains no server credential

### Gaps to close

1. `set_user_status`, `revoke_license`, `extend_license`, and `revoke_session` currently mutate public tables directly and write audit separately, despite existing trusted RPCs in the Backend repository.
2. Direct `set_user_status` does not transactionally revoke active Launcher sessions when the account becomes suspended/banned.
3. Direct `revoke_license` does not transactionally revoke sessions bound to that license.
4. Direct `extend_license` computes expiry in Vercel and audits separately, creating race and partial-failure risk.
5. Direct `revoke_session` and `revoke_installation` split state change, session revocation, and audit across independent requests.
6. `admin_revoke_installation(uuid, uuid)` is not present in committed Backend migration history. A concurrent untracked forward migration `20260808143000_harden_session_policy_admin_operations.sql` now defines it and a parallel contract test expects it, but both still require review, test execution, commit coordination, and staging deployment evidence.
7. Overview label “อุปกรณ์ที่ใช้งาน” counts non-revoked remembered installations, not concurrently active machines, and is misleading.
8. “เซสชันออนไลน์” view loads historical revoked sessions too; wording should distinguish current active session from session history.
9. Current Admin Tool working tree contains concurrent implementation changes in `server/admin.mjs` and `tests/vercel-api.test.mjs`, plus a line-ending/generated-worktree change in `standalone/dist/neko-control.html`. The concurrent code has already started routing all five actions through RPCs. Do not overwrite, reset, stage, or reformat these files; re-read before every patch and treat Tasks 2–5 as review/complete-the-existing-TDD work rather than starting over.
10. Current Backend working tree contains concurrent RED/GREEN files `launcher/tests/test_session_policy_hardening_migration.py` and `supabase/migrations/20260808143000_harden_session_policy_admin_operations.sql`. The migration now defines the expected installation-revocation RPC and heartbeat hardening but remains untracked/unverified at planning time.
11. Admin Tool `package.json` requires Node `24.x`, while the planning environment reported Node `v22.23.2`. Verification must use Node 24 before release claims; results under Node 22 are diagnostic only.

### Required Backend RPC contract

Existing RPCs to consume after verifying their latest deployed definitions:

```text
launcher.admin_set_user_status(p_actor_id uuid, p_user_id uuid, p_status text) returns boolean
launcher.admin_revoke_license(p_actor_id uuid, p_license_id uuid) returns boolean
launcher.admin_extend_license(p_actor_id uuid, p_license_id uuid, p_days integer) returns timestamptz
launcher.admin_revoke_session(p_actor_id uuid, p_session_id uuid) returns boolean
```

New coordinated RPC expected from Backend:

```text
launcher.admin_revoke_installation(
  p_actor_id uuid,
  p_installation_id uuid
) returns boolean
```

The new installation RPC must atomically:

1. call `launcher.assert_admin_actor(p_actor_id)`;
2. lock and locate the installation;
3. set `installations.revoked_at` without silently un-revoking it later;
4. revoke only active sessions bound to that installation;
5. record `admin_installation_revoked` with safe metadata and scope `installation`;
6. be executable only by `service_role`;
7. preserve `launcher_sessions_one_active_per_user_idx`.

Backend implementation is owned by `Neko-Family-Proxy`, not this Admin Tool plan. Admin Tool integration can be coded against the reviewed contract, but staging completion is blocked until the migration is applied and verified.

---

## Task 1: Freeze the cross-repository contract and baseline

**Objective:** Confirm exact RPC behavior and preserve concurrent work before changing Admin Tool production code.

**Files:**

- Read: `E:\Github\Neko-Family-Proxy\supabase\migrations\20260725134935_secure_admin_operations.sql`
- Read: `E:\Github\Neko-Family-Proxy\supabase\migrations\20260808143000_harden_session_policy_admin_operations.sql`
- Read: `E:\Github\Neko-Family-Proxy\launcher\tests\test_session_policy_hardening_migration.py`
- Read: `E:\Github\Neko-Family-Proxy-admin-tool\tests\vercel-api.test.mjs`
- Modify only if documentation needs synchronization: `E:\Github\Neko-Family-Proxy-admin-tool\docs\backend-single-active-session-ai-prompt.md`

**Step 1: Capture repository state**

Run independently in both repositories:

```bash
git status --short --branch
git branch --show-current
git log -3 --oneline
```

Expected: record actual branches and all modified/untracked files. Do not assume the session-start snapshot remains current.

**Step 2: Verify RPC definitions, grants, and return shapes**

Check the latest effective migration definitions and, when staging access is approved, compare with `pg_get_functiondef(...)`. Confirm that all five RPCs:

- verify the actor server-side;
- are service-role-only;
- perform mutation, related session revocation, and audit in one transaction;
- return the shapes listed above;
- use safe `search_path`;
- are idempotent according to the reviewed contract.

**Step 3: Record the coordination gate**

Do not claim Admin Tool staging readiness until Backend provides:

- migration filename/revision;
- staging deployment confirmation;
- exact function definitions/grants;
- audit constraint support for `admin_installation_revoked`;
- evidence that suspension, license revocation, session revocation, and installation revocation invalidate the intended Launcher session only.

**Step 4: Establish executable baseline**

From Admin Tool root:

```bash
npm ci
npm test
```

Expected baseline: dependencies install from `package-lock.json`; current suite completes without hanging. If tests fail because concurrent RED tests are already present, preserve the failure output as the RED baseline rather than modifying the tests to pass falsely.

**Stop condition:** If `npm ci` would destroy an intentionally modified dependency workspace, ask before running it; use existing `node_modules` only after confirming `@supabase/supabase-js` and `esbuild` resolve from the Admin Tool root.

---

## Task 2: Route account suspension through the trusted RPC

**Objective:** Ensure account restriction and active-session revocation are one Backend transaction.

**Files:**

- Modify: `server/admin.mjs:443-459`
- Modify: `tests/vercel-api.test.mjs` in the fake RPC handler and admin action assertions

**RED:** Add/complete one focused API test proving that `set_user_status` sends exactly:

```json
{
  "p_actor_id": "<current-admin-id>",
  "p_user_id": "<target-user-id>",
  "p_status": "suspended"
}
```

to `launcher.admin_set_user_status`, makes no direct PATCH to `profiles`/`launcher_sessions`, and does not write a second audit row from Vercel.

Also test:

- `active`, `suspended`, and `banned` are the only accepted states;
- malformed/non-UUID user IDs are rejected before Supabase call;
- current admin cannot suspend/ban self;
- RPC `false` or invalid response fails closed;
- raw Supabase details are not returned to the browser.

Run the focused test and verify it fails because production still uses `tablePatch`.

**GREEN:** In `performAction()`:

- retain input and self-restriction validation;
- replace direct table mutation plus `recordAudit()` with `rpcPost("admin_set_user_status", ...)`;
- require exact success (`true`), otherwise raise a safe action error;
- do not duplicate audit in Vercel because RPC owns it.

**VERIFY:** Run the focused test, then full suite.

**Behavioral acceptance:** Suspending/banning a user causes the Backend transaction to revoke all current Launcher sessions; reactivating the account does not restore old sessions or installations.

---

## Task 3: Route license mutation through trusted RPCs

**Objective:** Make license revocation/extension concurrency-safe and ensure invalid sessions are revoked atomically.

**Files:**

- Modify: `server/admin.mjs:460-495`
- Modify: `tests/vercel-api.test.mjs`

### Slice 3A — revoke license

**RED:** Add a test that `revoke_license` calls only:

```json
{
  "p_actor_id": "<current-admin-id>",
  "p_license_id": "<license-id>"
}
```

on `admin_revoke_license`. Assert no direct license PATCH, no direct session PATCH, and no Vercel-side duplicate audit.

**GREEN:** Validate UUID, call RPC, require `true`, and map failures to safe messages.

**Acceptance:** Backend RPC revokes the license and sessions bound to that license atomically; an old Launcher heartbeat then returns `false`.

### Slice 3B — extend license

**RED:** Add a test that `extend_license` calls `admin_extend_license` with actor/license/days, returns the server timestamp, and never calculates `valid_until` from Vercel time.

Test day bounds `1..3650`, malformed UUID, invalid/null timestamp response, and safe error redaction.

**GREEN:** Remove the read-current-license → JavaScript date arithmetic → direct PATCH → separate audit sequence. Call RPC and return `{ valid_until: <validated-server-timestamp> }`.

**Acceptance:** Concurrent extension requests serialize in PostgreSQL and each approved extension is reflected in the returned server timestamp and one audit event.

---

## Task 4: Route session revocation through the trusted RPC

**Objective:** Revoke only the selected session with actor authorization and transactional audit.

**Files:**

- Modify: `server/admin.mjs:496-508`
- Modify: `tests/vercel-api.test.mjs`

**RED:** Test that `revoke_session` calls `admin_revoke_session` with actor and session UUID only. Assert it does not PATCH `launcher_sessions` or call `recordAudit()` separately.

Add cases for:

- malformed UUID rejected before RPC;
- missing session maps to a safe 404/400 according to the agreed RPC error mapping;
- already revoked session follows the RPC's reviewed idempotency contract;
- an old/replaced session revocation cannot affect the current session;
- unauthorized/inactive admin cannot reach the action through the Vercel API.

**GREEN:** Replace direct PATCH/audit with the RPC and require exact success.

**Acceptance:** The Launcher owning that current session receives `false` on its next heartbeat; another newer session remains active.

---

## Task 5: Route installation revocation through the new atomic RPC

**Objective:** Block one installation, revoke only its active session, and audit the action without partial state.

**Files:**

- Modify: `server/admin.mjs:509-530`
- Modify: `tests/vercel-api.test.mjs`
- Coordinate only; do not duplicate migration here: `E:\Github\Neko-Family-Proxy\supabase\migrations\20260808143000_harden_session_policy_admin_operations.sql`

**RED:** Preserve and extend the concurrent test already expecting `admin_revoke_installation`. Prove that the API calls exactly:

```json
{
  "p_actor_id": "<current-admin-id>",
  "p_installation_id": "<installation-id>"
}
```

Add assertions that Vercel sends no direct PATCH to `installations`/`launcher_sessions` and no separate audit insert.

Test:

- malformed UUID rejected locally;
- missing installation returns a safe error;
- repeated revocation follows reviewed idempotency behavior;
- revoking installation A cannot revoke a current session belonging to installation B;
- full installation hash never appears in response, UI, error, or audit fixture;
- a blocked installation remains visible as history with `revoked_at` and cannot be silently restored by the Admin Tool.

**GREEN:** Replace the three-request sequence (installation PATCH, session PATCH, audit POST) with `rpcPost("admin_revoke_installation", ...)` and require exact success.

**Acceptance:** There is no state where an installation is revoked but its active session survives due to a later request failing. To block all installations, the operator must suspend/ban the account instead.

---

## Task 6: Centralize Admin action validation and safe RPC results

**Objective:** Avoid repeating insecure input/result handling across the five Admin actions.

**Files:**

- Modify: `server/admin.mjs` near existing constants/helpers at lines 12-53
- Modify: `tests/vercel-api.test.mjs`

**RED:** Add focused tests for wished-for behavior, not helper internals:

- every ID-bearing session-policy action rejects invalid UUIDs without making Supabase requests;
- every boolean RPC requires `response === true`;
- server timestamps are ISO-8601 parseable;
- Backend/PostgREST internal details remain redacted by `api/index.mjs`;
- customer-safe expected failures use `actionError(..., status)` and never become raw 500 details.

**GREEN:** Extract only the minimal helpers needed, for example:

- `requireUuid(value, safeMessage)`;
- `requireRpcSuccess(result, safeMessage)`;
- `requireServerTimestamp(value, safeMessage)`.

Do not create a generic action framework or broad refactor. Keep coupon/password-reset paths unchanged unless a test demonstrates shared behavior is safe.

**REFACTOR:** Remove now-unused `tablePatch` imports only after all converted paths are green. Keep `tableGet` where read paths/password reset still require it and keep `tablePost` only where genuinely needed.

---

## Task 7: Correct Admin UI terminology without changing policy

**Objective:** Make remembered installations, current active session, and session history impossible to confuse.

**Files:**

- Modify: `standalone/src/sections/render.js:17-40,154-168`
- Modify: `standalone/src/config.js:10-12`
- Modify: `standalone/src/main.js:99-118` only if confirmation/success wording changes
- Modify: `tests/vercel-api.test.mjs`
- Generate: `standalone/dist/neko-control.html` via build only

### Slice 7A — overview

**RED:** Assert overview renders the non-revoked installation count as “การติดตั้งที่จดจำ” (or equivalent), not “อุปกรณ์ที่ใช้งาน”. Keep “Session ปัจจุบัน/active sessions” as a separate count.

**GREEN:** Change only the label/subtitle. The existing API key may remain for compatibility unless renamed in one atomic source+test change.

### Slice 7B — session view

**RED:** Assert the navigation/title describes session records/history when revoked rows are included, and active rows are clearly marked as the current usable session.

**GREEN:** Prefer wording equivalent to:

- navigation: `Launcher sessions`
- heading: `ประวัติ Launcher session`
- subtitle: `แต่ละบัญชีมี session ปัจจุบันได้หนึ่งรายการ; รายการก่อนหน้าถูกแทนที่หรือยกเลิกแล้ว`

Do not imply every listed row is online.

### Slice 7C — action confirmations

**RED:** Assert confirmations clearly distinguish:

- revoke session: disconnect current session only;
- revoke installation: block this installation and revoke its current session;
- suspend account: block every installation and revoke all active sessions.

**GREEN:** Update copy, retaining HTML escaping and safe action payloads.

**VERIFY:** Run `npm run build:standalone`; inspect generated bundle only for expected content and credential absence. Never hand-edit `standalone/dist/neko-control.html`.

---

## Task 8: Strengthen read-model and privacy tests

**Objective:** Prove the Admin Web view remains accurate under multiple historical installations and one active session.

**Files:**

- Modify: `server/admin.mjs:278-379`
- Modify: `tests/vercel-api.test.mjs`

**RED/GREEN vertical slices:**

1. Two remembered installations for one user, one active session: exactly one row has `owns_active_session = true`.
2. Replaced/revoked historical sessions are never joined as active ownership because the active-session query filters `revoked_at is null`.
3. More than 1,000 active sessions are paginated through `tableGetAll`; retain the existing pagination test.
4. Full `installation_key_hash` is removed server-side before serialization, including null/legacy rows.
5. Active-session creation/heartbeat timestamps attach only to the owning installation.
6. Overview presents remembered-installation count separately from active-session count.
7. Legacy `max_devices` may remain in Backend data but is never displayed or editable as the current policy.
8. The browser bundle contains none of `SUPABASE_SECRET_KEY`, test secrets, service-role values, full installation hashes, access tokens, or refresh tokens.

Avoid adding a full-hash operational endpoint. Masking remains mandatory.

---

## Task 9: Document the operational meaning and handoff

**Objective:** Keep operators from using installation revocation as an account ban or interpreting history as concurrent usage.

**Files:**

- Modify: `README.md`
- Modify: `VERCEL_ADMIN_GUIDE_TH.md`
- Modify if contract changed: `docs/backend-single-active-session-ai-prompt.md`

Document:

- account may have multiple remembered installations;
- exactly one current active Launcher session per account;
- newest successful login replaces the previous session;
- “revoke session” ends only that session and the user may sign in again;
- “revoke installation” blocks only that locally generated installation identity;
- clearing local secure storage can create a different installation identity, so this is not an account ban;
- “suspend/ban account” blocks all installations and revokes active sessions;
- legacy `max_devices` is compatibility data, not the current historical-device policy;
- all admin mutations use Vercel server → service-role-only RPC; Secret Key never reaches browser;
- Backend migration must be deployed before enabling the new installation action in production;
- no public production authority URL is required or documented.

---

## Task 10: Full verification and release gate

**Objective:** Produce real evidence across Admin Tool, Backend contract, and disposable staging without claiming production completion prematurely.

### Local Admin Tool gates

From `E:\Github\Neko-Family-Proxy-admin-tool`:

```bash
npm ci
npm test
npm run build
npm test
```

Expected:

- build succeeds;
- Node test suite exits normally with exact pass/fail/skip counts reported;
- second test run proves generated bundle is current;
- `git diff --check` passes;
- `standalone/dist/neko-control.html` changes only as generated output;
- bundle credential scan passes.

### Backend contract gates

From `E:\Github\Neko-Family-Proxy\launcher` using its supported environment:

```bash
python -m pytest -q tests/test_session_policy_hardening_migration.py
python -m pytest -q tests/test_single_active_session_migration.py
```

Also run the Backend repository's maintained SQL/security checks. Confirm:

- one-active-session unique partial index remains present;
- heartbeat checks the license bound to the session;
- all Admin mutation RPCs are service-role-only and actor-checked;
- audit event constraint accepts all emitted event types;
- no existing migration was edited in place.

### Disposable staging E2E

Using approved disposable users and private staging configuration:

1. create customer with valid license;
2. claim installation A and confirm heartbeat A is `true`;
3. claim installation B and confirm A becomes `false`, B remains `true`;
4. Admin revokes current session B; confirm B heartbeat is `false`, but B can sign in again;
5. claim B again, Admin revokes installation B; confirm B heartbeat is `false` and B re-claim yields `installation_revoked`;
6. confirm non-revoked installation A can claim;
7. suspend account; confirm A heartbeat/claim fails under account restriction;
8. reactivate account; confirm old sessions do not revive and a fresh non-revoked installation claim is required;
9. revoke a license; confirm sessions bound to it are invalidated;
10. verify audit entries contain actor/target/safe reason but no passwords, tokens, service keys, or full installation hashes;
11. verify unauthorized/inactive admin cannot invoke any action;
12. clean up disposable users, licenses, sessions, installations, and audit fixtures through approved workflow.

### Release blockers

Do not deploy/claim production readiness if any is missing:

- reviewed Backend migration and live function-definition comparison;
- staging deployment of all five RPCs;
- Admin Tool test suite and generated bundle passing;
- two-client staging takeover evidence;
- action authorization/audit evidence;
- Supabase RLS/grant/security-advisor checks;
- explicit release approval.

---

## Files expected to change in Admin Tool

| File | Planned change |
|---|---|
| `server/admin.mjs` | Validate IDs/results and route five session-policy actions through trusted RPCs |
| `tests/vercel-api.test.mjs` | TDD coverage for RPC-only mutations, privacy, UI wording, RBAC, safe errors |
| `standalone/src/sections/render.js` | Correct overview/session terminology and preserve installation/session distinction |
| `standalone/src/config.js` | Rename misleading “online sessions” navigation if historical rows remain |
| `standalone/src/main.js` | Clarify destructive-action confirmations if required by tests |
| `standalone/dist/neko-control.html` | Regenerated artifact only |
| `README.md` | Summarize policy and trusted mutation architecture |
| `VERCEL_ADMIN_GUIDE_TH.md` | Operator guidance for session vs installation vs account actions |
| `docs/backend-single-active-session-ai-prompt.md` | Update only if final reviewed cross-repo contract differs |

Backend-owned coordinated file, not to be implemented in this repository:

- `E:\Github\Neko-Family-Proxy\supabase\migrations\20260808143000_harden_session_policy_admin_operations.sql`

---

## Acceptance criteria

- [ ] Multiple remembered installations are shown as history, not concurrent authorized devices
- [ ] Exactly one current active session is visually and structurally distinct per account
- [ ] `set_user_status` uses `admin_set_user_status` and suspension/ban revokes sessions transactionally
- [ ] `revoke_license` uses `admin_revoke_license` and revokes bound sessions transactionally
- [ ] `extend_license` uses server-side `admin_extend_license` without Vercel date arithmetic
- [ ] `revoke_session` uses `admin_revoke_session` and cannot affect a newer unrelated session
- [ ] `revoke_installation` uses `admin_revoke_installation` and state/session/audit cannot partially succeed
- [ ] All five RPCs receive the authenticated admin actor ID and validate it server-side
- [ ] Browser never receives Supabase Secret Key/service role, full installation hash, token, or raw internal error
- [ ] Account restriction, installation blocking, and session revocation have distinct UI copy and scope
- [ ] Legacy `max_devices` is not presented or editable as the current policy
- [ ] Overview no longer labels remembered installations as currently active devices
- [ ] Session history is not mislabeled as entirely online
- [ ] Local build/tests pass with exact counts
- [ ] Backend migration contract tests pass
- [ ] Disposable staging takeover/admin-action E2E passes
- [ ] Security/grant/advisor checks pass
- [ ] Concurrent user/agent working-tree changes were preserved
- [ ] No commit, push, Vercel deploy, Supabase deploy, or production change occurs without explicit instruction

---

## Final implementation report format

1. Current gap/root cause
2. Admin Tool files changed
3. Backend RPC revision and staging deployment status
4. Direct table mutations removed and RPC mapping used
5. UI terminology changes
6. Unit/API/build commands with exact pass/fail/skip counts
7. Two-client staging evidence
8. RBAC/grant/audit/privacy evidence
9. Generated bundle and secret-scan result
10. Concurrent working-tree changes preserved
11. Remaining blockers
12. Explicit statement of whether production was modified

Do not claim full completion from mock tests alone. If Backend staging RPCs or disposable credentials are unavailable, report Admin Tool implementation as locally verified and integration-blocked with the exact missing evidence.
