# NEKO FAMILY PROXY — CURRENT PROJECT STATUS & START HERE GUIDE

```text
DOCUMENT:               docs/current/README.md
STATUS:                 AUTHORITATIVE CURRENT PROJECT STATUS
CLASSIFICATION:         PRIMARY ORIENTATION & GOVERNANCE AUTHORITY
CURRENT_PHASE:          T8A COMPLETED — AUDIT & HARDENING DESIGN CLOSED
LAST_CLOSED_PHASE:      T8A (Production Operations Baseline Audit + Hardening Design)
ACTIVE_PHASE:           T8 (PRODUCTION OPERATIONS & HEALTH HARDENING)
NEXT_PHASE:             T8B (Local Operations Hardening Candidate Implementation)
DATE:                   2026-08-18
```

---

## 1. Quick Orientation: What is the Project Doing Now?

**Neko Family Proxy** is a high-performance proxy routing and management platform for *Phantasy Star Online 2 (PSO2 JP)*.

The project has completed **Phase T6 (Historical Server Metrics)**, all milestones of **Phase T7 V1 (Unified AWS Lightsail Discord Integration)**, and **Phase T8A (Production Operations Baseline Audit + Hardening Design)**:
- **Phase T4B (Closed)** established the live server monitoring pipeline from Japan VPS to Backend to Admin Dashboard.
- **Phase T5 (Closed)** polished the Admin Dashboard UI and added an honest browser-local rolling 5-minute live network graph.
- **Phase T6 (Closed)** designed, implemented, migrated, and production-verified 7-day raw historical server time-series storage, automated hourly retention pruning via `pg_cron`, and historical range queries (1h, 24h, 7d).
- **Phase T7 V1 (Closed & Production Verified)**: Unified Discord status embed (~60s), transition alerts with anti-flap 2-sample confirmation and 300s cooldown, time-weighted average throughput Traffic Summary (30m epoch boundary, 1 MiB threshold gating), and local atomic state persistence (`/var/lib/neko/discord-state.json`) into a single long-running Lightsail daemon (`neko-discord-worker.service`). Controlled production cutover completed with zero dual-publishing and legacy service safely disabled.
- **Phase T8 (Active — Production Operations & Health Hardening)**: Hardens VPS reliability, boot authority, restart backoff, journal hygiene, atomic state cleanup, and operator diagnostics without adding external SaaS dependencies, external watchdogs, or cloud scheduler infrastructure.
  - **Phase T8A (Closed / Audit & Design Frozen)**: Conducted live read-only empirical audit of AWS Lightsail JP host and service daemons. Established exact resource baselines, confirmed zero secret leaks, verified independent failure domains and boot readiness, formulated `Restart=always` + 60s burst limit design, `SystemMaxUse=500M` journal bounds, and designed sanitized read-only operator diagnostic tooling (`neko_ops_status.py`, `--check-config`).
  - **Phase T8B (Planned / Local Candidate Implementation)**: Local Backend repository implementation and testing of hardened unit definitions, state temp cleanup, and diagnostic CLI tools.
  - **Phase T8C (Planned / Production Rollout & Proof)**: Controlled staging, verification, and proof on AWS Lightsail Japan.

---

## 2. Phase Status & Authority Checkpoints

| Phase | Description | Status | Authority Commit / Milestone |
| :--- | :--- | :---: | :--- |
| **Phase T1-T2** | Core Telemetry Engine | **CLOSED** | Frozen at Phase T2 (Local Named Pipe diagnostics) |
| **Phase T3** | Launcher Telemetry Consumer | **CLOSED** | Frozen at Phase T3 (Local GUI consumption) |
| **Phase T4A** | Server Monitoring Architecture Contract | **CLOSED** | `docs/architecture/server-monitoring-session-boundary.md` |
| **Phase T4B** | Server Monitoring Data Plane & Production Deploy | **CLOSED** | Backend `bc34b5b1...` / Admin `2aac1028...` |
| **Phase T5** | Admin Dashboard Polish & Live Visualization | **CLOSED** | Source: `840adc18...` / Evidence: `41067701...` |
| **Phase T6A** | Historical Server Metrics Architecture | **CLOSED (DESIGN FROZEN)** | Commit `7168bf65...` / `docs/architecture/historical-server-metrics.md` |
| **Phase T6B** | Historical Persistence & Admin History API | **CLOSED** | Backend `94f389c5...` / Admin `2662193e...` |
| **Phase T6C** | Admin Dashboard Historical Charts UI | **CLOSED** | Commit `6b5940bd...` / UI Range Selectors & Gap Splitting |
| **Phase T6D** | Production Deployment & Historical Proof | **CLOSED** | Backend `852bfb67...` / Retention `pg_cron` / Remote Proof Verified |
| **Original T7A** | Vercel Cron / Backend Discord Architecture | **SUPERSEDED** | Commit `d242c598...` (Superseded by Owner Decision in favor of T7 V1) |
| **Phase T7 V1A** | Legacy Discord Discovery & Lightsail Architecture Freeze | **CLOSED (AUTHORITY FROZEN)** | Admin `6a59900a...` / Discovery & Architecture Freeze |
| **Phase T7 V1B** | Unified Lightsail Discord Worker & Tests | **CLOSED (CANDIDATE COMPLETE)**| Backend `5ad8e693...` / 29 Unit Tests Passing / Systemd Candidate |
| **Phase T7 V1C** | Production Deployment & Legacy Cutover | **CLOSED (PRODUCTION PROOF)**  | Live Proof Verified / 1 Publisher Active / Legacy Disabled |
| **Phase T8A** | Production Operations Baseline Audit & Hardening Design | **CLOSED (AUDIT & DESIGN FROZEN)** | Admin Doc Commit `683cb997...` / Live VPS Audit Verified |
| **Phase T8B** | Local Operations Hardening Candidate Implementation | **PLANNED** | Next: Unit Updates, State Cleanup, Ops Tool |
| **Phase T8C** | Controlled Production Hardening Rollout & Proof | **PLANNED** | Pending Phase T8B Completion & Owner Approval |

### Git Authority Identifiers:
- **Admin Git T6A Design Commit**: `7168bf655623230f3a327f48705cb880f34fa830`
- **Backend Git T6B Migration Commit**: `94f389c5c3dfd6c919dcbdb54955ebc621345b5f`
- **Backend Git T6D Retention Commit**: `852bfb67e482d264729fc83aa862340c732df7db`
- **Backend Git T7 V1B Server Commit**: `5ad8e693e549b7d8b5b178f7269f9b1b737ac8bf`
- **Admin Git T6B Implementation Commit**: `2662193e077789a3beae5d4063b74b6fba7fd6ec`
- **Admin Git T6C UI Implementation Commit**: `6b5940bdfcd2dcbaf1d5966213fab934c2a4c85d`
- **Admin Runtime Source (Deployed Authority)**: `6b5940bdfcd2dcbaf1d5966213fab934c2a4c85d`
- **Admin Original T7A Baseline Commit**: `d242c5981d04b2b11fdbae79aa908bd646275eb7`
- **Admin T7 V1B Architecture Correction**: `a35311d059e591430f99cb74bf70dca0f31cb435`
- **Admin T7 V1B Doc Record Commit**: `b33db64e2b480b5851943b15f396779dca77917b`
- **Admin T7 V1C Production Proof Commit**: `683cb99724e9dffbf342875031f0e0a4abbc6172`

---

## 3. Monitoring System Operational State

```text
CURRENT_PRODUCTION_MONITORING   = LIVE (T4B/T5/T6)
CURRENT_PRODUCTION_STORAGE      = LATEST + HISTORY (public.server_metrics_latest & public.server_metrics_history)
CURRENT_LIVE_GRAPH              = BROWSER_LOCAL_ROLLING (~5 minutes, 60 samples, resets on reload)
PRODUCTION_HISTORY              = LIVE (7-day bounded rolling raw telemetry)
PRODUCTION_HISTORY_API          = LIVE (GET /api/server/metrics/history?range=1h|24h|7d)
PRODUCTION_HISTORICAL_CHARTS    = LIVE (Interactive range switching, gap splitting, degradation markers)
HISTORICAL_RETENTION_RULE       = 7 DAYS RAW (Pruned hourly via database scheduled job launcher.prune_server_metrics_history)
DISCORD_PRODUCTION_STATE        = UNIFIED WORKER ACTIVE (neko-discord-worker.service on AWS Lightsail)
UNIFIED_T7_V1_DISCORD_WORKER    = PRODUCTION VERIFIED & LIVE (PID 50924 / 1 Publisher Authority)
LEGACY_DISCORD_SERVICE          = INACTIVE & DISABLED (Rollback Artifacts Preserved)
OPERATIONS_HARDENING_STATE      = T8A AUDIT COMPLETED / DESIGN FROZEN (T8B Candidate Next)
```

---

## 4. Operational Secrets Authority (Conceptual Locations Only)

> [!CAUTION]
> Secret values must **NEVER** be committed to Git or logged in plain text.

1. **VPS Ingest Secret (`SERVER_METRICS_INGEST_SECRET`)**:
   - **VPS Location**: `/etc/neko-server-monitor.env` (`chmod 600`, root-owned).
   - **Backend Location**: Vercel Environment Variables (`SERVER_METRICS_INGEST_SECRET`).
   - **Secure Local Backup**: Restricted NTFS directory `D:\Github\docs\Server\.env` (strictly untracked).
   - **Browser Bundle**: Zero access (`WEB_HAS_SERVER_INGEST_SECRET = NO`).
2. **Database Service Role Secret (`SUPABASE_SECRET_KEY`)**:
   - **Backend Location**: Vercel Environment Variables only. Never leaked to client.
3. **Admin Cookie HMAC Secret (`ADMIN_SESSION_SECRET`)**:
   - **Backend Location**: Vercel Environment Variables only.
4. **Discord Webhook Secret (`DISCORD_WEBHOOK_URL`) [T7 V1 Authority]**:
   - **VPS Location**: Protected EnvironmentFile `/etc/neko/discord.env` (`chmod 600`, root-owned).
   - **Vercel / Backend Location**: Not required (Decoupled from Vercel/Supabase).
   - **Browser Bundle**: Zero access (`WEBHOOK_IN_FRONTEND = NO`).

---

## 5. Frozen Systems & Boundaries (Do NOT Reopen)

1. **Team Core Scope**: `NO ACTION` — Local diagnostics engine frozen.
2. **Team Launcher Scope**: `NO ACTION` — Desktop launcher UI frozen.
3. **Client Privacy Boundary**: Frozen. The backend, Admin Web, and Discord never receive Core PID, Game PID (`pso2.exe`), local SOCKS state, packet payloads, DNS queries, destination IPs, user emails, usernames, or hardware serials.
4. **Applied Database Migrations**: Immutable. `20260818090000_server_monitoring_latest_snapshot.sql`, `20260818120000_server_monitoring_history.sql`, and `20260818130000_server_monitoring_history_retention_schedule.sql` must never be modified. All future changes must use forward-only migrations.

---

## 6. Guardrails: What NOT to Do

- **DO NOT** rebuild or recompile `NekoProxyCore` for Web monitoring tasks.
- **DO NOT** launch or retest PSO2 JP game sessions for Web-only historical metrics or Discord work.
- **DO NOT** rotate or alter `SERVER_METRICS_INGEST_SECRET` unless there is a verified credential compromise.
- **DO NOT** edit existing applied migrations in `supabase/migrations/`.
- **DO NOT** send client-side telemetry or desktop metrics to the Backend or Discord.
- **DO NOT** paste Discord webhook URLs into chat, Git, or client code.
- **DO NOT** use `@everyone` or `@here` mass mentions in Discord integrations.
- **DO NOT** push code directly to `origin/main` without explicit owner approval.
- **DO NOT** introduce external watchdog SaaS, Vercel cron, or Supabase tables for operations monitoring in Phase T8.

---

## 7. Permanent Documentation Governance Rule

```text
=============================================================================
PERMANENT GOVERNANCE RULE: DOCUMENTATION SYNCHRONIZATION AS PART OF DONE
=============================================================================
Every future phase and task MUST maintain and update source-of-truth project
documentation before declaring completion. Creating a standalone handoff note
alone is INSUFFICIENT.

REQUIRED INVARIANT:
CHAT HISTORY MUST NOT BE REQUIRED TO UNDERSTAND CURRENT PROJECT STATE.

MINIMUM DOCUMENTATION REQUIREMENTS FOR EVERY TASK:
1. Update docs/current/README.md with active phase, closed phases, and HEAD commits.
2. Update affected architecture specifications in docs/architecture/.
3. Update/create phase handoff documents with clear predecessor/successor links.
4. Distinguish clearly between DEPLOYED / APPLIED and PLANNED / DESIGNED states.
5. Preserve historical defects, test evidence, and past blockers (no rewriting history).
6. Verify and update the READ ORDER navigation index.
7. Run `git diff --check` to ensure clean whitespace and formatting before committing.
=============================================================================
```

---

## 8. Document Navigation & Recommended Reading Order

A new engineer joining the project should read documents in the following order:

1. **[docs/current/README.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/README.md)**
   *Current project status, phase boundaries, authoritative commits, and guardrails.*
2. **[docs/architecture/server-monitoring-session-boundary.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/server-monitoring-session-boundary.md)**
   *Foundational server monitoring architecture, two-plane decoupling, Discord isolation, and privacy boundary.*
3. **[docs/architecture/historical-server-metrics.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/historical-server-metrics.md)**
   *Phase T6 historical server metrics architecture, database model, retention, and query API contract.*
4. **[docs/architecture/discord-server-status.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/discord-server-status.md)**
   *Phase T7 V1 Lightsail Discord architecture, Traffic Summary average throughput calculation, status embeds, transition alerts, anti-spam rules, and local state persistence.*
5. **[docs/architecture/production-operations-hardening.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/production-operations-hardening.md)**
   *Phase T8 production operations hardening architecture, recovery design, resource baseline, journal policy, failure modes matrix, and ops tooling specification.*
6. **[docs/current/server-monitoring-implementation-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/server-monitoring-implementation-handoff.md)**
   *Phase T4B implementation handoff and live VPS production deployment evidence.*
7. **[docs/current/admin-dashboard-polish-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/admin-dashboard-polish-handoff.md)**
   *Phase T5 Admin Dashboard polish, UI hierarchy, and browser-local live graph contract.*
8. **[docs/current/historical-server-metrics-implementation-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-implementation-handoff.md)**
   *Phase T6B implementation handoff, RPC definitions, testing evidence, and T6C UI handoff.*
9. **[docs/current/historical-server-metrics-ui-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-ui-handoff.md)**
   *Phase T6C UI implementation handoff, range switcher, gap splitting, and race condition protections.*
10. **[docs/current/historical-server-metrics-production-proof.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-production-proof.md)**
    *Phase T6D production verification evidence, Supabase migrations, pg_cron retention, and live VPS proof.*
11. **[docs/current/discord-server-status-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/discord-server-status-handoff.md)**
    *Phase T7 V1 complete architecture, discovery findings, artifact authority hashes, and operational transition handoff.*
12. **[docs/current/discord-server-status-production-proof.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/discord-server-status-production-proof.md)**
    *Phase T7 V1C live production verification proof, persistent status message ID proof, 30m summary threshold gating, and single-publisher verification.*
13. **[docs/current/production-operations-hardening-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/production-operations-hardening-handoff.md)**
    *Phase T8A production operations baseline discovery findings, empirical resource measurements, hardening matrix, and T8B candidate handoff.*
