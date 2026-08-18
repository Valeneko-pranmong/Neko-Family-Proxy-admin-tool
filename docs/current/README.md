# NEKO FAMILY PROXY — CURRENT PROJECT STATUS & START HERE GUIDE

```text
DOCUMENT:               docs/current/README.md
STATUS:                 AUTHORITATIVE CURRENT PROJECT STATUS
CLASSIFICATION:         PRIMARY ORIENTATION & GOVERNANCE AUTHORITY
PHASE:                  T6A (Historical Server Metrics Architecture)
LAST_CLOSED_PHASE:      T5 (Admin Dashboard Polish & Live Visualization)
DATE:                   2026-08-18
```

---

## 1. Quick Orientation: What is the Project Doing Now?

**Neko Family Proxy** is a high-performance proxy routing and management platform for *Phantasy Star Online 2 (PSO2 JP)*.

The project is currently working on **Phase T6 (Historical Server Metrics)**:
- **Phase T4B (Closed)** established the live server monitoring pipeline from Japan VPS to Backend to Admin Dashboard.
- **Phase T5 (Closed)** polished the Admin Dashboard UI and added an honest browser-local rolling 5-minute live network graph.
- **Phase T6A (Active / Current)** designs the authoritative server-side historical time-series storage, retention, query contract, and UI downsampling model.

---

## 2. Phase Status & Authority Checkpoints

| Phase | Description | Status | Authority Commit / Milestone |
| :--- | :--- | :---: | :--- |
| **Phase T1-T2** | Core Telemetry Engine | **CLOSED** | Frozen at Phase T2 (Local Named Pipe diagnostics) |
| **Phase T3** | Launcher Telemetry Consumer | **CLOSED** | Frozen at Phase T3 (Local GUI consumption) |
| **Phase T4A** | Server Monitoring Architecture Contract | **CLOSED** | `docs/architecture/server-monitoring-session-boundary.md` |
| **Phase T4B** | Server Monitoring Data Plane & Production Deploy | **CLOSED** | Backend `bc34b5b1...` / Admin `2aac1028...` |
| **Phase T5** | Admin Dashboard Polish & Live Visualization | **CLOSED** | Source: `840adc18...` / Evidence: `41067701...` |
| **Phase T6A** | Historical Server Metrics Architecture | **DESIGN / ACTIVE** | `docs/architecture/historical-server-metrics.md` |
| **Phase T6B** | Historical Persistence & Backend Query API | **PLANNED** | Next subphase (Database migration + API) |
| **Phase T6C** | Admin Dashboard Historical Charts UI | **PLANNED** | Next subphase (1h, 24h, 7d Range Selectors) |
| **Phase T6D** | Live VPS Production Proof & Retention Verification | **PLANNED** | Final verification gate for T6 |

### Git Authority Identifiers:
- **Admin Git HEAD**: `41067701f6aa4498ba928fbf0359e939c705a5f0` (Docs-only production evidence commit)
- **Admin Runtime Source**: `840adc18da08cd3af284c5e2cbffbb20d5ef5d6a` (T5 runtime implementation)
- **Backend Database Authority**: `bc34b5b1e70228f3c007ba077e72d3650602bd34` (`Neko-Family-Proxy` repo)

---

## 3. Monitoring System Operational State

```text
CURRENT_PRODUCTION_MONITORING = LIVE
CURRENT_STORAGE               = LATEST_ONLY (public.server_metrics_latest)
CURRENT_LIVE_GRAPH            = BROWSER_LOCAL_ROLLING (~5 minutes, 60 samples, resets on reload)
HISTORICAL_SERVER_STORAGE     = NOT YET IMPLEMENTED (Architecture designed in T6A)
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

---

## 5. Frozen Systems & Boundaries (Do NOT Reopen)

1. **Team Core Scope**: `NO ACTION` — Local diagnostics engine frozen.
2. **Team Launcher Scope**: `NO ACTION` — Desktop launcher UI frozen.
3. **Client Privacy Boundary**: Frozen. The backend and Admin Web never receive Core PID, Game PID (`pso2.exe`), local SOCKS state, packet payloads, DNS queries, destination IPs, or hardware serials.
4. **Applied Database Migrations**: Immutable. `20260818090000_server_monitoring_latest_snapshot.sql` must never be modified. All new changes must use forward-only migrations in the Backend repo.

---

## 6. Guardrails: What NOT to Do

- **DO NOT** rebuild or recompile `NekoProxyCore` for Web monitoring tasks.
- **DO NOT** launch or retest PSO2 JP game sessions for Web-only historical metrics work.
- **DO NOT** rotate or alter `SERVER_METRICS_INGEST_SECRET` unless there is a verified credential compromise.
- **DO NOT** edit existing applied migrations in `supabase/migrations/`.
- **DO NOT** send client-side telemetry or desktop metrics to the Backend.
- **DO NOT** treat the T5 browser-local live graph as a persistent historical database.
- **DO NOT** fabricate historical data during initial deployment (no fake past points).
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
   *Foundational server monitoring architecture, two-plane decoupling, and privacy boundary.*
3. **[docs/current/server-monitoring-implementation-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/server-monitoring-implementation-handoff.md)**  
   *Phase T4B implementation handoff and live VPS production deployment evidence.*
4. **[docs/current/admin-dashboard-polish-handoff.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/admin-dashboard-polish-handoff.md)**  
   *Phase T5 Admin Dashboard polish, UI hierarchy, and browser-local live graph contract.*
5. **[docs/architecture/historical-server-metrics.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/historical-server-metrics.md)**  
   *Phase T6 historical server metrics architecture, database model, retention, and query API contract.*
