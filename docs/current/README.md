# NEKO FAMILY PROXY — CURRENT PROJECT STATUS & START HERE GUIDE

```text
DOCUMENT:               docs/current/README.md
STATUS:                 AUTHORITATIVE CURRENT PROJECT STATUS
CLASSIFICATION:         PRIMARY ORIENTATION & GOVERNANCE AUTHORITY
CURRENT_PHASE:          T7 V1B COMPLETED — UNIFIED DISCORD WORKER LOCAL CANDIDATE
LAST_CLOSED_PHASE:      T7 V1B (Unified Lightsail Discord Worker Implementation & Tests)
ACTIVE_PHASE:           T7 V1B (Completed Local Candidate)
NEXT_PHASE:             T7 V1C (Production Deployment & Legacy Cutover)
DATE:                   2026-08-18
```

---

## 1. Quick Orientation: What is the Project Doing Now?

**Neko Family Proxy** is a high-performance proxy routing and management platform for *Phantasy Star Online 2 (PSO2 JP)*.

The project has completed **Phase T6 (Historical Server Metrics)**, **Phase T7 V1A (Discovery & Architecture Freeze)**, and **Phase T7 V1B (Unified Discord Worker Local Candidate)**:
- **Phase T4B (Closed)** established the live server monitoring pipeline from Japan VPS to Backend to Admin Dashboard.
- **Phase T5 (Closed)** polished the Admin Dashboard UI and added an honest browser-local rolling 5-minute live network graph.
- **Phase T6 (Closed)** designed, implemented, migrated, and production-verified 7-day raw historical server time-series storage, automated hourly retention pruning via `pg_cron`, and historical range queries (1h, 24h, 7d).
- **Phase T7 Original Design (Superseded)**: The initial T7A plan (Vercel Cron + Backend Active Users query + Supabase persistence) was **superseded by Owner Decision** in favor of a low-maintenance, resilient, AWS Lightsail-local architecture (**T7 V1**).
- **Phase T7 V1A (Closed / Authority Frozen)**: Discovered existing legacy Lightsail Discord integration (`neko-traffic-monitor.service`), classified its traffic source (`AF_PACKET` on `ens5:8388`) and calculation (`TOTAL_BYTES_DURING_WINDOW`), froze the unified Lightsail Discord Worker architecture, redefined Traffic Summary as time-weighted average throughput, removed Active Users/Backend/Vercel dependencies, and established local state persistence.
- **Phase T7 V1B (Closed / Candidate Completed)**: Implemented the unified long-running systemd worker candidate (`agent/neko_discord_worker.py` in Backend repo), preserving proven `AF_PACKET` :8388 packet accounting, calculating time-weighted average throughput, managing persistent status embed (~60s) and transition alerts with anti-flap 2-sample confirmation and 300s cooldown, atomic local state persistence (`/var/lib/neko/discord-state.json`), candidate systemd service unit (`agent/systemd/neko-discord-worker.service`), and 29 deterministic unit tests (all passing).

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
| **Phase T7 V1C** | Production Deployment & Legacy Cutover | **PLANNED / NEXT** | Staging on Lightsail, legacy publisher retirement, live proof |

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
DISCORD_PRODUCTION_STATE        = LEGACY VPS PUBLISHER ACTIVE (neko-traffic-monitor.service)
UNIFIED_T7_V1_DISCORD_WORKER    = NOT YET IMPLEMENTED / DEPLOYED (Pending Phase T7 V1B & T7 V1C)
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
   - **VPS Location**: Protected EnvironmentFile `/etc/neko-traffic-monitor.env` (existing legacy) / `/etc/neko/discord.env` (target T7 V1) (`chmod 600`, root-owned).
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
5. **[docs/current/server-monitoring-implementation-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/server-monitoring-implementation-handoff.md)**
   *Phase T4B implementation handoff and live VPS production deployment evidence.*
6. **[docs/current/admin-dashboard-polish-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/admin-dashboard-polish-handoff.md)**
   *Phase T5 Admin Dashboard polish, UI hierarchy, and browser-local live graph contract.*
7. **[docs/current/historical-server-metrics-implementation-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-implementation-handoff.md)**
   *Phase T6B implementation handoff, RPC definitions, testing evidence, and T6C UI handoff.*
8. **[docs/current/historical-server-metrics-ui-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-ui-handoff.md)**
   *Phase T6C UI implementation handoff, range switcher, gap splitting, and race condition protections.*
9. **[docs/current/historical-server-metrics-production-proof.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-production-proof.md)**
   *Phase T6D production verification evidence, Supabase migrations, pg_cron retention, and live VPS proof.*
10. **[docs/current/discord-server-status-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/discord-server-status-handoff.md)**
    *Phase T7 V1A legacy discovery & architecture freeze handoff, discovered services/counters, and T7 V1B implementation roadmap.*
