# NEKO FAMILY PROXY — HISTORICAL SERVER METRICS IMPLEMENTATION HANDOFF (PHASE T6B)

```text
DOCUMENT:               docs/current/historical-server-metrics-implementation-handoff.md
STATUS:                 IMPLEMENTATION_CANDIDATE (T6B Completed Locally — Ready for T6C UI & T6D Deploy)
CLASSIFICATION:         OPERATIONAL HANDOFF & IMPLEMENTATION AUTHORITY
PHASE:                  T6B (Historical Server Metrics Persistence & Admin History API)
PREVIOUS_PHASE:         T6A (Historical Server Metrics Architecture Authority)
NEXT_PHASE:             T6C (Admin Dashboard Historical Charts UI)
FINAL_VERIFICATION:     T6D (Production Deployment, Pruning Job Setup & Remote Proof)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
DATE:                   2026-08-18
```

---

## 1. Handoff Purpose & Status

This document provides the authoritative implementation handoff for **Phase T6B: Historical Server Metrics Persistence & Admin History API**.

All database schema migrations, ingestion and downsampling RPCs, API route registrations, and comprehensive test suites have been implemented and verified locally.

```text
+---------------------------------------------------------------------------------------------------+
|                                      PHASE STATUS SUMMARY                                         |
+---------------------------------------------------------------------------------------------------+
|  Phase T6A: Architecture & Contract Design         | COMPLETED & FROZEN (Commit 7168bf65...)     |
|  Phase T6B: Persistence & Admin History API        | COMPLETED LOCALLY (Candidate for T6C/T6D)    |
|  Phase T6C: Admin Dashboard Historical Charts UI   | NEXT IN QUEUE (Requires T6B API)            |
|  Phase T6D: Supabase Migration & Production Proof  | FINAL DEPLOYMENT (Scheduled after T6C)       |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Artifacts & Code Implementations

### 2.1 Backend Repository (`D:\Github\Neko-Family-Proxy`)

#### 1. Forward-Only Database Migration
- **Path**: `supabase/migrations/20260818120000_server_monitoring_history.sql`
- **Objects Created**:
  1. `public.server_metrics_history` table:
     - Composite primary key `(server_id, observed_at)`
     - Range query index `server_metrics_history_range_idx` on `(server_id, observed_at desc)`
     - Retention pruning index `server_metrics_history_retention_idx` on `(observed_at)`
     - Row-Level Security enabled (revoked from `anon`/`authenticated`, accessible via `service_role`).
  2. `launcher.store_server_metrics_sample(...)` function:
     - Atomically checks duplicate samples.
     - Validates payload equivalence on duplicate timestamp: returns `{ accepted: true, history_inserted: false, latest_updated: false, is_idempotent_retry: true }` if identical; raises `sample_conflict` exception if divergent.
     - Inserts new row into `public.server_metrics_history`.
     - Updates `public.server_metrics_latest` only if `p_observed_at > existing.observed_at`.
  3. `launcher.query_server_metrics_history(...)` function:
     - Uses PostgreSQL `date_bin` to aggregate into strictly uniform query-time buckets (1h: 60s, 24h: 300s, 7d: 1800s).
     - Aggregates `rx_bps_avg`, `rx_bps_max`, `tx_bps_avg`, `tx_bps_max`, `ping_ms_avg`, `ping_ms_min`, `ping_ms_max`, `packet_loss_percent_avg`, `packet_loss_percent_max`.
     - Computes boolean service rollups: `had_service_failure`, `had_listener_failure`.
     - Does NOT average cumulative byte counters.
     - Preserves historical gaps.
  4. `launcher.prune_server_metrics_history(p_retention_days integer default 7)` function:
     - Deletes records where `observed_at < now() - (p_retention_days * interval '1 day')`.
     - Returns number of deleted rows.

---

### 2.2 Admin Tool Repository (`D:\Github\Neko-Family-Proxy-admin-tool`)

#### 1. Server Metrics Ingestion & History Logic
- **Path**: `server/server-metrics.mjs`
- **Functions & Constants**:
  - `RANGE_CONFIGS`: Definitive query window configurations (`1h` $\rightarrow$ 60s / 60 pts, `24h` $\rightarrow$ 300s / 288 pts, `7d` $\rightarrow$ 1800s / 336 pts).
  - `FUTURE_TOLERANCE_MS` (2 min) & `MAX_INGEST_SAMPLE_AGE_MS` (10 min) validation.
  - `validateIngestPayload(body, now)`: Enforces exact timestamp window `[now - 10m, now + 2m]`.
  - `ingestServerMetrics(body, authHeader, now)`: Calls `store_server_metrics_sample` and handles duplicate idempotency and conflict mappings (`sample_conflict` $\rightarrow$ 409).
  - `queryServerMetricsHistory({ serverId, range, now })`: Validates range and queries `query_server_metrics_history`.
  - `pruneServerMetricsHistory(retentionDays)`: Invokes pruning RPC.

#### 2. Admin History API Route
- **Path**: `api/index.mjs`
- **Route**: `GET /api/server/metrics/history`
- **Access Control**: Requires valid Admin cookie session. Returns `401` if unauthenticated, `400` on invalid query params, `200` on successful query.

#### 3. Automated Test Suites
- **Path**: `tests/server-metrics-history.test.mjs` (New unit test suite for range configs, timestamp acceptance windows, and query validation).
- **Path**: `tests/server-metrics-api.test.mjs` (Updated unit tests for ingest bounds and range bounds).
- **Path**: `tests/vercel-api.test.mjs` (Updated end-to-end integration tests with mock RPC handlers for `store_server_metrics_sample`, `query_server_metrics_history`, `prune_server_metrics_history`, idempotent retry, conflict duplicate 409, and unauthenticated/authenticated history queries).

---

## 3. Contract & Invariant Summary

| Invariant | Implementation Mechanism | Validation / Enforcement |
| :--- | :--- | :--- |
| **Atomic Ingest Transaction** | `launcher.store_server_metrics_sample` | Single DB transaction handles history insert + snapshot update |
| **Identical Retry Idempotency** | Field-by-field compare in RPC | Identical duplicate payload returns `200 OK` (`is_idempotent_retry: true`) |
| **Conflicting Duplicate Rejection** | Field mismatch in RPC | Differing duplicate payload throws `sample_conflict` $\rightarrow$ `409 Conflict` |
| **Out-of-Order History Insertion** | Conditioned snapshot update in RPC | Past sample accepted to history; latest snapshot does not regress |
| **Timestamp Acceptance Window** | `validateIngestPayload` + RPC check | `now() - 10m <= observed_at <= now() + 2m` |
| **7-Day Rolling Retention** | `launcher.prune_server_metrics_history` | Deletes rows older than 7 days |
| **Query-Time Downsampling** | `launcher.query_server_metrics_history` | Uniform `date_bin` buckets (1h: 60s, 24h: 300s, 7d: 1800s) |
| **Bounded Payload Points** | `date_bin` interval partitioning | 1h $\le$ 60 pts, 24h $\le$ 288 pts, 7d $\le$ 336 pts |
| **Privacy Boundary Enforcement** | Ingest validator & query RPC | Excludes client hardware, PIDs, per-client traffic |
| **Historical Gap Preservation** | SQL GROUP BY `date_bin` | Bins without observations are omitted, not synthesized |

---

## 4. Test Verification Results

All automated test suites in `D:\Github\Neko-Family-Proxy-admin-tool` pass completely:

```text
> npm run build:standalone && node --test tests/*.test.mjs

Built D:\Github\Neko-Family-Proxy-admin-tool\standalone\dist\neko-control.html (73355 bytes)
ℹ tests 77
ℹ suites 0
ℹ pass 77
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~2950ms
```

---

## 5. Handoff to Phase T6C (Admin Dashboard Historical Charts UI)

### 5.1 API Ready for Consumption
Phase T6C should build the historical chart user interface consuming `GET /api/server/metrics/history?range=1h|24h|7d`.

### 5.2 UI Expectations for T6C
1. **Range Selectors**: Add tabs or buttons for `Live` (5m local buffer), `1h`, `24h`, and `7d`.
2. **Chart Rendering**:
   - `Live` tab: Continues rendering from browser rolling buffer (5s cadence).
   - `1h`, `24h`, `7d` tabs: Fetches downsampled points from `/api/server/metrics/history`.
3. **Empty / Gap Handling**:
   - If partial history exists (e.g. `available_since` is recent), show a clear "Historical tracking active since..." notice.
   - Do not connect lines across known outages if buckets are missing.
4. **Degradation / Service Indicators**:
   - Display visual markers on historical charts when `had_service_failure` or `had_listener_failure` is true.

---

## 6. Remaining Production Work (Phase T6D)

The following items are deferred to **Phase T6D (Production Deployment & Verification)**:
1. Apply migration `20260818120000_server_monitoring_history.sql` to live Supabase production database.
2. Configure database scheduled cron job (or backend scheduled trigger) to execute `launcher.prune_server_metrics_history(7)` hourly.
3. Deploy Admin Web to Vercel production.
4. Verify end-to-end ingestion and historical queries against the live Japan VPS daemon.
