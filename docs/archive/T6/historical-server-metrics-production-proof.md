# NEKO FAMILY PROXY — HISTORICAL SERVER METRICS PRODUCTION PROOF (PHASE T6D)

```text
DOCUMENT:               docs/current/historical-server-metrics-production-proof.md
STATUS:                 AUTHORITATIVE PRODUCTION VERIFICATION EVIDENCE
CLASSIFICATION:         PRODUCTION DEPLOYMENT PROOF & AUDIT RECORD
PHASE:                  T6D (Production Deployment & Historical Metrics Proof)
PREVIOUS_PHASES:        T6A (Design Frozen), T6B (Persistence & API), T6C (Charts UI)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
SUPABASE_PROJECT:       miikoutrnxsunbndecqh (Neko-Family-Proxy)
VERCEL_PROJECT:         neko-control-room
PRODUCTION_URL:         https://neko-control-room.vercel.app
DATE:                   2026-08-18
T6D_EXIT_GATE:          PASS
T6_CLOSED:              YES
```

---

## 1. Executive Summary & Verification Outcome

Phase **T6D** successfully deployed, activated, and verified the complete **Historical Server Metrics Pipeline** in the live production environment.

All historical monitoring components are operational, verified with genuine time-series telemetry from the Japan VPS monitoring daemon, and sealed against data-plane coupling or privacy leaks:

```text
+---------------------------------------------------------------------------------------------------+
|                                      PHASE T6 FINAL STATUS                                        |
+---------------------------------------------------------------------------------------------------+
|  Phase T6A: Architecture & Contract Design         | CLOSED (Commit 7168bf65...)                 |
|  Phase T6B: Persistence & Admin History API        | CLOSED (Backend 94f389c5... / Admin 2662193e)|
|  Phase T6C: Admin Dashboard Historical Charts UI   | CLOSED (Admin 6b5940bd...)                   |
|  Phase T6D: Production Deployment & Remote Proof   | CLOSED / PASS (Production Verified)          |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Remote Authority & Deployment Identifiers

### 2.1 Git Remote Authority

- **Backend Remote Authority**: `PASS`
  - **Repository**: `D:\Github\Neko-Family-Proxy`
  - **Branch**: `feature/neko-auth-lite-v1-launcher-backend`
  - **T6B Migration Commit**: `94f389c5c3dfd6c919dcbdb54955ebc621345b5f`
  - **T6D Retention Migration Commit**: `852bfb67e482d264729fc83aa862340c732df7db`
  - **Remote Tracking**: `origin/feature/neko-auth-lite-v1-launcher-backend` (Ahead: 0, Behind: 0)

- **Admin Remote Authority**: `PASS`
  - **Repository**: `D:\Github\Neko-Family-Proxy-admin-tool`
  - **Branch**: `main`
  - **T6A Design Commit**: `7168bf655623230f3a327f48705cb880f34fa830`
  - **T6B Persistence Commit**: `2662193e077789a3beae5d4063b74b6fba7fd6ec`
  - **T6C UI Implementation Commit**: `6b5940bdfcd2dcbaf1d5966213fab934c2a4c85d`
  - **Remote Tracking**: `origin/main` (Ahead: 0, Behind: 0)

- **Force Push Policy**: `FORCE_PUSH_USED = NO` (Strict normal push only).

---

## 3. Database Production Migration & Schema Proof

### 3.1 Applied Migrations

Both forward-only migrations applied cleanly to live Supabase production project `miikoutrnxsunbndecqh`:

1. `20260818120000_server_monitoring_history.sql` (`APPLIED`)
2. `20260818130000_server_monitoring_history_retention_schedule.sql` (`APPLIED`)

Pre-existing applied migration `20260818090000_server_monitoring_latest_snapshot.sql` remained completely immutable and unedited (`OLD_APPLIED_MIGRATION_EDITED = NO`).

### 3.2 Database Objects & Security Proof

- **Table**: `public.server_metrics_history`
  - **Primary Key**: `(server_id, observed_at)` (`PASS`)
  - **Indexes**:
    - `server_metrics_history_range_idx` on `(server_id, observed_at desc)`
    - `server_metrics_history_retention_idx` on `(observed_at)`
  - **Row Level Security**: `ENABLED` (`PASS`)
  - **Grants**: `anon` and `authenticated` revoked; `service_role` granted (`PASS`).

- **Stored RPCs in `launcher` schema**:
  - `launcher.store_server_metrics_sample(...)` (`SECURITY DEFINER`, `PASS`)
  - `launcher.query_server_metrics_history(...)` (`SECURITY DEFINER`, `PASS`)
  - `launcher.prune_server_metrics_history(...)` (`SECURITY DEFINER`, `PASS`)

---

## 4. Automated Retention Scheduler Authority

- **Retention Executor**: `DATABASE_SCHEDULED_JOB` (`pg_cron`)
- **Raw Retention Limit**: `7 days`
- **Pruning Interval**: `1 hour` (`0 * * * *`)
- **Active Job Name**: `prune_server_metrics_history_hourly`
- **Executed Command**: `select launcher.prune_server_metrics_history(7);`
- **Duplicate Job Check**: `DUPLICATE_RETENTION_JOB = NO` (Exactly 1 active cron job)
- **Retention Scope Safety**: `PRUNE_SCOPE = HISTORY_ONLY`
- **Pruning Smoke Execution**: Executed successfully in production, safely returning 0 deleted rows on newly initialized dataset (`RETENTION_PRODUCTION_WIRING = PASS`).

---

## 5. Live Production Ingestion & Raw History Evidence

### 5.1 Japan VPS Daemon Continuity

- **Daemon Status**: `neko-server-monitor.service` = `active`
- **Shadowsocks Service**: `shadowsocks-libev.service` = `active`
- **Proxy Port**: TCP `8388` = `listening`
- **Agent Code**: `AGENT_SOURCE_CHANGED = NO`, `AGENT_PAYLOAD_CHANGED = NO`
- **Ingest Secret**: `INGEST_SECRET_ROTATED = NO`

### 5.2 Real Ingested Telemetry Accumulation

Within minutes of production deployment, genuine 5-second observations automatically populated `public.server_metrics_history`:

- **Real Raw Rows Ingested**: $\ge 18$ consecutive raw samples (Requirement $\ge 12$ passed).
- **Server Identity**: `server_id = 'japan-vps-1'`
- **Observed Progression**: Timestamps advanced monotonically without gaps or duplicate key collisions (`DUPLICATE_PRIMARY_KEYS = 0`).
- **Sample Ingested Metrics**:
  - Host Uptime: `823737s` (~9.5 days)
  - Ping to Upstream Target: `1.7ms – 1.9ms` (`ping_status: AVAILABLE`)
  - Packet Loss: `0.0%`
  - Instantaneous RX Rate: `4.5 Kbps – 9.6 Kbps`
  - Instantaneous TX Rate: `2.0 Kbps – 3.7 Kbps`
  - RAM Utilization: `42%`
- **Latest Snapshot Continuity**: `public.server_metrics_latest` advances monotonically in lockstep with history (`LATEST_SNAPSHOT_AUTHORITY_PRESERVED = YES`).

---

## 6. History API & Downsampling Proof

### 6.1 Authentication & Boundary Checks

- **Unauthenticated Ingest**: `POST /api/server/metrics/ingest` $\rightarrow$ `401 Unauthorized` (`UNAUTHENTICATED_INGEST = DENIED`)
- **Invalid Bearer Secret**: `POST /api/server/metrics/ingest` with bad secret $\rightarrow$ `401 Unauthorized` (`INVALID_SECRET_INGEST = DENIED`)
- **Anonymous History Query**: `GET /api/server/metrics/history?range=1h` $\rightarrow$ `401 Unauthorized` (`ANONYMOUS_HISTORY_ACCESS = DENIED`)
- **Invalid Range Query**: `GET /api/server/metrics/history?range=30d` $\rightarrow$ `400 Bad Request` (`UNBOUNDED_HISTORY_QUERY = DENIED`)

### 6.2 Real Query-Time Downsampling Results

All three production ranges query successfully against real data:

1. **Range `1h` (`HISTORY_1H_PRODUCTION = PASS`)**:
   - `bucket_seconds`: 60
   - `points_count`: 2 real 1-minute buckets
   - `available_since`: Reflects exact deployment activation time (`2026-08-18T05:20:54Z`)
   - `sample_count`: 8 samples per bucket

2. **Range `24h` (`HISTORY_24H_PRODUCTION = PASS`)**:
   - `bucket_seconds`: 300
   - `points_count`: 1 real 5-minute bucket
   - `available_since`: Honest initial activation timestamp
   - Behavior: Honest partial history without synthetic backfill (`PARTIAL_24H_HISTORY = HONEST`).

3. **Range `7d` (`HISTORY_7D_PRODUCTION = PASS`)**:
   - `bucket_seconds`: 1800
   - `points_count`: 1 real 30-minute bucket
   - `available_since`: Honest initial activation timestamp
   - Behavior: Honest partial history without synthetic backfill (`PARTIAL_7D_HISTORY = HONEST`).

- **Historical Gap Invariant**: `HISTORICAL_GAPS_PRESERVED = YES`, `SYNTHETIC_HISTORY = NO`, `BACKFILL_EXISTING_HISTORY = NO`.

---

## 7. Admin UI & Cross-Context Persistence Proof

- **Range Controls**: `RANGE_CONTROLS_PRODUCTION = PASS` (Exposes `LIVE`, `1H`, `24H`, `7D`).
- **Live Mode Authority**: `LIVE_MODE_PRODUCTION = PASS` (Maintains browser-local rolling 5m buffer; no regression on T5 live charts).
- **Historical UI Rendering**: `UI_1H = PASS`, `UI_24H = PASS`, `UI_7D = PASS`.
- **Available Since Badge**: `AVAILABLE_SINCE_UI = PASS` (Renders `มีข้อมูลตั้งแต่ ...` notice).
- **Reload Persistence**: Reloading the dashboard re-queries the server history API and reconstructs the historical timeline from PostgreSQL authority (`HISTORY_SURVIVES_BROWSER_RELOAD = PASS`).
- **Multi-Context Authority**: Querying the dashboard from a second independent browser context returns identical historical telemetry (`SERVER_HISTORY_AVAILABLE_SECOND_CONTEXT = PASS`), proving history is server-side and not browser-local state.
- **Race Condition Immunity**: Rapid tab switching (`1H` $\rightarrow$ `7D` $\rightarrow$ `LIVE`) drops stale in-flight responses and prevents overwriting the active view (`PRODUCTION_RANGE_RACE = PASS`).
- **Tab Visibility Polling**: History polling suspends when the browser tab is hidden and resumes immediately when visible (`HISTORY_POLL_WHILE_HIDDEN = NO`, `POLL_REQUEST_STORM = NO`).

---

## 8. Privacy, Security & Isolation Audit

| Audit Area | Status | Verified Invariant |
| :--- | :---: | :--- |
| **Client Privacy** | **PASS** | No Core PID, Game PID (`pso2.exe`), local SOCKS state, packet payloads, DNS queries, per-user traffic, or hardware serials stored or displayed |
| **Frontend Secrets** | **PASS** | No `SERVER_METRICS_INGEST_SECRET`, `SUPABASE_SECRET_KEY`, or private credentials in client bundle |
| **Direct Mutation** | **DENIED** | Direct frontend history insertion, update, or deletion is revoked at DB RLS layer |
| **Failure Decoupling** | **PASS** | Historical database outages cannot interrupt Shadowsocks proxying, Core execution, or game sessions |
| **User Presence** | **PASS** | Active user counts derive strictly from `launcher_sessions` heartbeat freshness (`SESSION_ONLY`) |

---

## 9. Conclusion & Production Sign-Off

Phase **T6D** satisfies all exit gate criteria without blockers or regressions:

```text
T6D_EXIT_GATE = PASS
T6_CLOSED     = YES
```
