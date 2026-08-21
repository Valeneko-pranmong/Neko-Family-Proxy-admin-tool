# NEKO FAMILY PROXY — CURRENT PROJECT STATUS & START HERE GUIDE

```text
DOCUMENT:                       docs/current/README.md
STATUS:                         T10 COMMERCIAL LAUNCHER UI/UX
CURRENT_PHASE:                  T10 COMMERCIAL LAUNCHER UI/UX
T10:                            IN PROGRESS
T10A:                           CLOSED
T10B1:                          CLOSED
T10B1_APPROVED_LAUNCHER_COMMIT: 57698a853c0dc2b171617b19b15ae3f249afd606
T10B2:                          CLOSED — OWNER FUNCTIONAL/UI REVIEW PASS
T10B2_APPROVED_LAUNCHER_COMMIT: b5497e35481ffacabdc3c43ffd1191342b6c2ae2
T10B2_APPROVED_EXE_SHA256:      1A886ADEB4F142B031B5BD771F87939BA323445346F1361A4FA1EFDC8C19D4A6
T10B3:                          CLOSED — ENGINEERING + OWNER FINAL VISUAL REVIEW PASS
T10B4:                          BLOCKED — CORE ARTIFACT AUTHORITY RESOLUTION REQUIRED
T10B3_APPROVED_COMMIT:          1edfdb05042ed4a74128fc6826280f70f558b61d
T10B3_APPROVED_EXE_SHA256:      E4E114E138845566F7D25172CB4E8EAAC862FC43948EBEB8AF79D2F3AC9378C2
CORE_DEPLOYED_ARTIFACT:         AMBIGUOUS / NOT YET REFROZEN
LAUNCHER_ACTIVE_BRANCH:         feature/t10-commercial-launcher-ui
LATEST_LAUNCHER_DOC_HEAD:       1edfdb05042ed4a74128fc6826280f70f558b61d
COMPLETED_PHASES:               T1-T9 + PRE-T10 REPOSITORY BASELINE (CLOSED)
GLOBAL_STATUS_AUTHORITY:        D:\Github\Neko-Family-Proxy-admin-tool\docs\current\README.md
LAST_UPDATED:                   2026-08-20
```

---

## 1. Quick Orientation: What is the Project Doing Now?

**Neko Family Proxy** is a high-performance proxy routing and management platform for *Phantasy Star Online 2 (PSO2 JP)*.

The project has completed all production operations hardening, automated monitoring, historical time-series telemetry, unified Discord status integration, automated weekly maintenance lifecycles, and cross-repository Git hygiene (**Phases T1 through T9 and PRE-T10 Baseline**).

All infrastructure is operational and verified in production on AWS Lightsail Japan (`18.178.140.8`).

**Phase T10A (Commercial Launcher UI/UX Design Freeze)** is **CLOSED**. The commercial UI architecture, customer status translation layer, single-instance Settings window design, and capability matrix are frozen in Launcher repository (`docs/current/t10-commercial-ui-ux-design-freeze.md`). The next active phase is **T10B (Commercial UI Implementation)**.

> [!IMPORTANT]
> **Active Client Security Release Blocker:**
> `PHASE_2_5_DISTINCT_AUTH_SESSION_PROOF` remains **`PREPARED ONLY / UNRESOLVED`** and is the **current public release blocker**.
> - **Blocks UI Design / Implementation:** **NO**
> - **Blocks Public Commercial Client Release:** **YES**
> This proof must be executed and verified before any public release of the desktop client.

---

## 2. Global Cross-Repository Authority Matrix

| Repository | Active Branch | Branch HEAD (Doc/Hygiene Tip) | Runtime Source Commit | Artifact / Deployment State |
| :--- | :--- | :--- | :--- | :--- |
| **`Neko-Family-Proxy`** | **`feature/t10-commercial-launcher-ui`** | `1edfdb05042ed4a74128fc6826280f70f558b61d` (T10B3 Approved) | `1edfdb05042ed4a74128fc6826280f70f558b61d` (T10B3 Approved) | **T10B1 CLOSED**<br>**T10B2 CLOSED** (Engineering + Authenticated Packaged + Owner Review PASS)<br>**T10B3 CLOSED** (Engineering + Owner Final Visual Review PASS)<br>**T10B4 BLOCKED** (Core Artifact Authority Resolution Required) |
| **`NekoProxyCore`** | `feature/neko-auth-lite-v1-core` | `b592725f...` | `f269627351fc6a2c13b07c90f0e43ff69d17f058` | **Runtime Source:** `f269627`<br>**Production Artifact:** `AMBIGUOUS / NOT YET REFROZEN` |
| **`Neko-Family-Proxy-admin-tool`** | `main` | Current Tip | `6b5940bdfcd2dcbaf1d5966213fab934c2a4c85d` (UI) | **Global Doc & Status Authority** (T1–T9 Verified in Production) |

### Core Authority Distinction:
- `CORE_BRANCH_HEAD`: `b592725f...`
- `CORE_RUNTIME_SOURCE_COMMIT`: `f2696273...` (`feature/neko-auth-lite-v1-core`)
- `CORE_HISTORICAL_S0_BASELINE`: `b3c9d085...` (`origin/feature/neko-headless`)
- `CORE_V2RAY_LIVE_DATA_PLANE_FIX`: `c3e3fb09...` (Proven with live PSO2 game client)
- `CORE_DEPLOYED_ARTIFACT_SOURCE`: `AMBIGUOUS / NOT YET REFROZEN` (Hosted Lite cutover pending cross-component E2E)

---

## 3. Authoritative Read Order (Start Here in < 10 Minutes)

For any engineer or agent joining the project, read these documents in order:

1. **[Global Status & Orientation](README.md)** (`docs/current/README.md`) — Current phase, repository matrix, and production state.
2. **[Admin Web Work Freeze](ADMIN_WEB_CURRENT_WORK_FREEZE.md)** (`docs/current/ADMIN_WEB_CURRENT_WORK_FREEZE.md`) — Admin Web boundaries, verified scope, and open blockers.
3. **[Launcher Account Recovery Contract](LAUNCHER_ACCOUNT_RECOVERY_CONTRACT.md)** (`docs/current/LAUNCHER_ACCOUNT_RECOVERY_CONTRACT.md`) — Active recovery code verification and password reset API contract.
4. **[Server Monitoring Architecture](../architecture/server-monitoring-session-boundary.md)** (`docs/architecture/server-monitoring-session-boundary.md`) — Japan VPS metric collectors, data plane, and privacy boundaries.
5. **[Historical Server Metrics](../architecture/historical-server-metrics.md)** (`docs/architecture/historical-server-metrics.md`) — 7-day raw time-series persistence, RPC queries, and automated `pg_cron` retention.
6. **[Unified Discord Status Architecture](../architecture/discord-server-status.md)** (`docs/architecture/discord-server-status.md`) — Lightsail single-daemon Discord worker, transition alerts, and state persistence.
7. **[Production Operations Hardening](../architecture/production-operations-hardening.md)** (`docs/architecture/production-operations-hardening.md`) — Systemd service recovery, restart backoff, journald caps, and operator diagnostics.
8. **[Core Telemetry Contract](../architecture/core-telemetry-contract.md)** & **[Client Observability Privacy Boundary](../architecture/client-observability-privacy-boundary.md)** — Local Named Pipe telemetry format and strict client-side data privacy boundaries.

---

## 4. Production Systems Operational State (T1–T9 Closed)

```text
SERVER_MONITORING_PIPELINE      = PRODUCTION (Live Japan VPS → Backend → Admin Web)
HISTORICAL_METRICS_STORAGE      = PRODUCTION (public.server_metrics_history, 7-day rolling window)
HISTORICAL_PRUNING_JOB          = PRODUCTION (launcher.prune_server_metrics_history scheduled via pg_cron)
DISCORD_STATUS_WORKER           = PRODUCTION (neko-discord-worker.service active on AWS Lightsail Japan)
OPERATIONS_HARDENING_POLICY     = PRODUCTION (Restart=always, SystemMaxUse=500M, diagnostics 0_HEALTHY)
WEEKLY_MAINTENANCE_TIMER        = PRODUCTION (neko-weekly-maintenance.timer / Tuesday 02:00 Asia/Bangkok)
SSH_PRODUCTION_CREDENTIAL       = ROTATED & SECURED (Ed25519; old key revoked from authorized_keys)
```

---

## 5. Active Product Phase: T10 Commercial Launcher UI/UX

> [!NOTE]
> **Phase T10 Scope & Design Philosophy:**
> - **Main Window:** Clean, read-only customer dashboard showing connection status, server health indicator, membership summary, live network metrics, and passive guidance.
> - **Settings Window:** Separate single-instance top-level window for account management, password change, coupon redemption, game path, Tweaker path, and local diagnostics.
> - **Diagnostics:** Support and diagnostic tool embedded inside Settings > Diagnostics (strict local client observability privacy boundary).
> - **Phase Status:** **`T10A CLOSED — T10B1 CLOSED — T10B2 CLOSED — T10B3 CLOSED (Engineering + Owner Final Visual Review PASS) — T10B4 BLOCKED (Core Artifact Authority Resolution Required)`**.

---

## 6. Historical Archive Index

Historical implementation handoffs, test logs, and deployment proofs are preserved in `docs/archive/`:

- **[T1-T2 Telemetry Archive](../archive/T1-T2/)**: [`core-telemetry-implementation-handoff.md`](../archive/T1-T2/core-telemetry-implementation-handoff.md), [`core-telemetry-monitoring-brief.md`](../archive/T1-T2/core-telemetry-monitoring-brief.md), [`core-telemetry-runtime-diagnosis.md`](../archive/T1-T2/core-telemetry-runtime-diagnosis.md)
- **[T1-T5 Monitoring Archive](../archive/T1-T5/)**: [`server-monitoring-implementation-handoff.md`](../archive/T1-T5/server-monitoring-implementation-handoff.md), [`admin-dashboard-polish-handoff.md`](../archive/T1-T5/admin-dashboard-polish-handoff.md)
- **[T6 Historical Metrics Archive](../archive/T6/)**: [`historical-server-metrics-implementation-handoff.md`](../archive/T6/historical-server-metrics-implementation-handoff.md), [`historical-server-metrics-ui-handoff.md`](../archive/T6/historical-server-metrics-ui-handoff.md), [`historical-server-metrics-production-proof.md`](../archive/T6/historical-server-metrics-production-proof.md)
- **[T7 Discord Worker Archive](../archive/T7/)**: [`discord-server-status-handoff.md`](../archive/T7/discord-server-status-handoff.md), [`discord-server-status-production-proof.md`](../archive/T7/discord-server-status-production-proof.md)
- **[T8 Operations Hardening Archive](../archive/T8/)**: [`production-operations-hardening-handoff.md`](../archive/T8/production-operations-hardening-handoff.md), [`production-operations-hardening-production-proof.md`](../archive/T8/production-operations-hardening-production-proof.md)
- **[T9 Weekly Maintenance Archive](../archive/T9/)**: [`weekly-maintenance-automation-handoff.md`](../archive/T9/weekly-maintenance-automation-handoff.md), [`weekly-maintenance-automation-production-proof.md`](../archive/T9/weekly-maintenance-automation-production-proof.md)
- **[Session Management Archive](../archive/sessions/)**: [`admin-single-active-session-hardening-plan-2026-08-08.md`](../archive/sessions/admin-single-active-session-hardening-plan-2026-08-08.md), [`backend-single-active-session-ai-prompt.md`](../archive/sessions/backend-single-active-session-ai-prompt.md)
