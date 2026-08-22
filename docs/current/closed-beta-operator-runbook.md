# Closed Beta operator runbook

```text
CLOSED_BETA_STATUS:          READY
BETA_DATABASE_BASELINE:      CLEAN
CUSTOMER_TEST_USERS:         0 before onboarding
PRODUCTION_HEAD:             6ff9a3de70da34e52088c47eb1cdcfd62fa9f731
LAUNCHER_RUNTIME_AUTHORITY:  bba655b3e6443ebcdf84a266e42cc918bdefe32f
CORE_AUTHORITY:              862bfec463d06d57e1bee05c2bc490740eb714d4
LAUNCHER_EXE_SHA256:         4ae0aa676a41822033a6b00fdae9dde7ff3b900fc30ae39ca71dea6851411609
LAST_VERIFIED:               2026-08-22
```

This is the supported Admin procedure for the limited closed beta. It does not
change production security contracts and never requires disclosing privileged
configuration or an Admin UID.

## Onboard one tester

1. Confirm the beta database baseline is still clean before the first tester:
   zero customer/test profiles and zero active Launcher sessions. The preserved
   Admin profile/license and historical revoked session/installation records are
   not customer beta data.
2. Have the tester self-register in the approved Launcher and provide only the
   exact username. Current Admin Web does not create customer accounts.
3. Open **Members** and verify that username is an active customer.
4. Open **Coupons**, create a one-code batch for the existing product and beta
   duration, then copy the code at creation time. Deliver it privately. Do not
   store it in tickets, logs, source, or chat; plaintext cannot be recovered from
   the database later.
5. After the tester redeems it, verify **Licenses** shows effective status
   **ACTIVE** and the intended validity period.
6. Verify **Launcher sessions** shows the username and a fresh heartbeat. A
   heartbeat no older than 120 seconds is online. A remembered installation is
   not proof of an active session.

## Grant, revoke, and offboard

- Initial entitlement: supported coupon redemption flow.
- Existing entitlement extension: **Licenses → Extend**.
- Entitlement revocation: **Licenses → Revoke**.
- Active session termination: **Launcher sessions → End session** or the
  corresponding current-session action under **Installations**.
- Offboard: end the current session, revoke the license, then set the customer
  to **Suspended** or **Banned** under **Members**.
- Restore: set the customer to **Active** and issue a new coupon if entitlement
  is needed.
- Account deletion and direct new-license assignment are not supported current
  Admin actions. Do not use ad-hoc SQL or invent an alternate onboarding path.

## Identify the active Launcher session

Use **Launcher sessions**, match the exact username, and require `revoked_at` to
be absent plus a heartbeat within 120 seconds. The current session includes its
creation time and last heartbeat; older entries show revoked/offline. The
latest successful login is authoritative and displaces the older Launcher
session.

## Monitoring and rollback

- Verify registration/login, ACTIVE entitlement, latest-login-wins, PSO2
  detection, Core start/stop/cleanup, no crash/orphan Core, and availability of
  sanitized local diagnostic logs.
- Use Admin Web Overview/server metrics for a fresh server sample,
  Shadowsocks service/listener state, ping availability, and packet loss.
- On a stop condition, halt onboarding; revoke affected sessions, licenses, and
  coupon batches through Admin Web; restore the approved Launcher/Core artifact
  baseline. Do not roll back production security migrations/contracts.

Never expose Supabase secret/service-role material, Admin cookie/session
material, recovery HMAC material, proxy credentials, private signing keys,
passwords, plaintext settings, raw tokens/permits, or Admin UID.
