# NEKO FAMILY PROXY — HISTORICAL SERVER METRICS ARCHITECTURE
# Server-Side Time-Series Persistence, Query Contract & Retention Specification (Phase T6)

```text
DOCUMENT:               docs/architecture/historical-server-metrics.md
STATUS:                 DEPLOYED_AUTHORITY (Implemented, Deployed & Verified in Production)
CLASSIFICATION:         HARD ARCHITECTURE INVARIANT & SYSTEM SPECIFICATION
PHASE:                  T6D (Production Deployment & Historical Metrics Proof Closed)
PREVIOUS_PHASES:        T6A (Design Frozen), T6B (Persistence & API), T6C (Charts UI)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
BACKEND_MIGRATIONS:     supabase/migrations/20260818120000_server_monitoring_history.sql
                        supabase/migrations/20260818130000_server_monitoring_history_retention_schedule.sql
ADMIN_API_AUTHORITY:    server/server-metrics.mjs & api/index.mjs
ADMIN_UI_AUTHORITY:     standalone/src/sections/render.js & standalone/src/main.js
PRODUCTION_DEPLOYED:    YES (Production Verified in Phase T6D)
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Purpose

### 1.1 Purpose
Phase **T6** extends the existing Japan VPS monitoring stack (established in T4B and polished in T5) by introducing **durable server-side historical time-series storage and query capabilities**.

While Phase T4B and T5 established the authoritative real-time pipeline:
- **T4B**: Server monitoring data plane with dedicated ingest secret, systemd monitoring daemon on Japan VPS, and single-row snapshot persistence (`public.server_metrics_latest`).
- **T5**: Accessible Admin Dashboard with an honest **browser-local rolling live buffer** (~5 minutes, 60 samples, resets on page reload).

Phase **T6** implements and deploys:
- **T6B (Closed)**: Dedicated historical telemetry table (`public.server_metrics_history`), atomic ingest RPC (`launcher.store_server_metrics_sample`), 7-day retention pruning function (`launcher.prune_server_metrics_history`), and authenticated query-time downsampling API (`GET /api/server/metrics/history`).
- **T6C (Closed)**: Admin Web Dashboard historical chart controls and time-range selectors (Live, 1h, 24h, 7d), gap splitting, and race condition protections.
- **T6D (Closed)**: Production Supabase migrations applied, automated hourly database pruning configured via `pg_cron`, and end-to-end telemetry verified against the live Japan VPS daemon.

### 1.2 Non-Goals & Strict Exclusions
1. **No Client Telemetry**: Historical monitoring remains 100% server-side aggregate. Client Core PIDs, Game PIDs (`pso2.exe`), local SOCKS state, packet payloads, DNS lookups, per-user traffic, and hardware identifiers are strictly prohibited.
2. **No Proxy Data Plane Coupling**: Historical storage failures, database slowdowns, or ingest network errors must never interrupt Shadowsocks proxy traffic or crash the VPS monitoring daemon.
3. **No Unbounded Storage**: Database storage must not grow indefinitely. Explicit rolling retention (7 days) and hourly pruning are enforced.
4. **No Synthetic / Fake Data**: Missing historical periods must remain visible gaps. No fake zero-rate points or synthetic interpolations across outages may be fabricated.
5. **No Centralized Historical Backfill**: Historical data begins from the instant T6 persistence is activated in production. No synthetic history may be backfilled.
6. **No Reopening of Closed Phases**: Core (T2), Launcher (T3), T4B, and T5 remain closed and frozen.

---

## 2. Architecture & Data Authority Model

### 2.1 Two Distinct Storage Authorities
T6 maintains two complementary, non-conflicting server monitoring storage authorities in PostgreSQL:

```text
+---------------------------------------------------------------------------------------------------+
|                                 SERVER MONITORING STORAGE MODEL                                   |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [ 1. LATEST SNAPSHOT AUTHORITY ]                 [ 2. HISTORICAL TIME-SERIES AUTHORITY ]         |
|  Table: public.server_metrics_latest              Table: public.server_metrics_history            |
|  Cardinality: 1 row per server (UPSERT)           Cardinality: Bounded time-series append         |
|  Purpose: Fast current-state inspection,           Purpose: Trend analysis, capacity planning,     |
|           Host Status (ONLINE/DEGRADED/STALE),             outage forensics, historical charts    |
|           freshness evaluation (<30s).                    (1h, 24h, 7d).                          |
|  Storage Model: LATEST_ONLY                       Storage Model: 7-DAY ROLLING BOUNDED RAW        |
|  Replay Guard: Reject older/stale timestamps      Replay Guard: Idempotent identical retry;       |
|                                                                 Conflict rejection on payload desync|
+---------------------------------------------------------------------------------------------------+
```

### 2.2 End-to-End Ingest & Query Data Flow

```text
[Japan VPS Server Agent]
   │ (Push: HTTPS POST /api/server/metrics/ingest every 5s with Bearer Secret)
   ▼
[Backend Ingest API (Vercel Node.js Serverless)]
   │ 1. Validate Bearer Secret (timingSafeEqual over SHA-256 digests)
   │ 2. Validate payload schema & enforce privacy boundaries (reject client fields)
   │ 3. Validate exact timestamp window (now - 10m <= observed_at <= now + 2m)
   ▼
[Supabase / PostgreSQL RPC: launcher.store_server_metrics_sample]
   │ ── ATOMIC / SINGLE TRANSACTION ──
   ├─► 1. Check existing (server_id, observed_at)
   │      ├─► Identical payload: Idempotent success (no second row)
   │      └─► Conflicting payload: Raise exception 'sample_conflict' (409)
   ├─► 2. Insert into public.server_metrics_history (if new)
   └─► 3. Update public.server_metrics_latest (ONLY if observed_at > existing)
   ▼
[Historical Query API: GET /api/server/metrics/history?serverId=...&range=1h|24h|7d]
   │ (Admin Session Cookie Authentication Required)
   │ (Calls launcher.query_server_metrics_history using date_bin downsampling)
   ▼
[Admin Web Dashboard (T6C UI)]
   ├── Tab 1: Live (Browser-local rolling 5m, 5s poll)
   ├── Tab 2: 1h (Server history, 60s buckets, max 60 points)
   ├── Tab 3: 24h (Server history, 300s buckets, max 288 points)
   └── Tab 4: 7d (Server history, 1800s buckets, max 336 points)
```

---

## 3. Database Schema & Migration Implementation

### 3.1 Migration File Authority
- **Repository**: `D:\Github\Neko-Family-Proxy`
- **Files**:
  - `supabase/migrations/20260818120000_server_monitoring_history.sql` (Applied)
  - `supabase/migrations/20260818130000_server_monitoring_history_retention_schedule.sql` (Applied)
- **Applied Status**: Production Applied (`20260818090000_server_monitoring_latest_snapshot.sql` remains immutable).

### 3.2 Database Table: `public.server_metrics_history`

```sql
create table if not exists public.server_metrics_history (
  server_id text not null check (length(server_id) between 1 and 64 and server_id = lower(server_id)),
  observed_at timestamptz not null,
  rx_bytes_total bigint not null check (rx_bytes_total >= 0),
  tx_bytes_total bigint not null check (tx_bytes_total >= 0),
  rx_bps double precision not null check (rx_bps >= 0),
  tx_bps double precision not null check (tx_bps >= 0),
  host_uptime_seconds bigint not null check (host_uptime_seconds >= 0),
  ping_ms double precision check (ping_ms is null or ping_ms >= 0),
  ping_status text not null default 'UNKNOWN' check (ping_status in ('AVAILABLE', 'TIMEOUT', 'UNSUPPORTED', 'UNKNOWN')),
  packet_loss_percent double precision check (packet_loss_percent is null or (packet_loss_percent >= 0 and packet_loss_percent <= 100)),
  shadowsocks_service_status text not null check (shadowsocks_service_status in ('active', 'inactive', 'failed', 'unknown')),
  shadowsocks_listener_status text not null check (shadowsocks_listener_status in ('listening', 'closed', 'error', 'unknown')),
  cpu_percent double precision check (cpu_percent is null or (cpu_percent >= 0 and cpu_percent <= 100)),
  memory_percent double precision check (memory_percent is null or (memory_percent >= 0 and memory_percent <= 100)),
  created_at timestamptz not null default now(),

  constraint server_metrics_history_pkey primary key (server_id, observed_at)
);

create index if not exists server_metrics_history_range_idx
  on public.server_metrics_history (server_id, observed_at desc);

create index if not exists server_metrics_history_retention_idx
  on public.server_metrics_history (observed_at);

alter table public.server_metrics_history enable row level security;
revoke all on public.server_metrics_history from anon, authenticated;
grant select on public.server_metrics_history to service_role;
```

---

## 4. Contract Freezes & Exact Rules (Phase T6 Authority)

### 4.1 Retention & Downsampling Freeze
- **RAW_RETENTION**: `7 days`
- **STORED_DOWNSAMPLE_TABLES**: `NONE`
- **QUERY_TIME_BUCKETING**: `YES` (Dynamic bucketing via PostgreSQL `date_bin`)
- **PRUNING_INTERVAL**: `1 hour`
- **RETENTION_EXECUTOR**: `DATABASE_SCHEDULED_JOB` (`pg_cron`) executing `launcher.prune_server_metrics_history(7)`

### 4.2 Exact Timestamp Acceptance Boundaries
- `FUTURE_TOLERANCE`: `2 minutes` (120 seconds)
- `MAX_INGEST_SAMPLE_AGE`: `10 minutes` (600 seconds)
- **Accepted Window**: `now() - 10 minutes <= observed_at <= now() + 2 minutes`
- Observations outside this window fail with `400 Bad Request`.

### 4.3 Duplicate Sample Integrity & Conflict Handling
- **Natural Composite Key**: `(server_id, observed_at)`
- **Identical Retry**: Same `server_id` + same `observed_at` + identical metric payload $\rightarrow$ `IDEMPOTENT` success (`is_idempotent_retry: true`, no second row inserted).
- **Conflicting Duplicate**: Same `server_id` + same `observed_at` + differing metric payload $\rightarrow$ `REJECTED` with `409 Conflict` (`sample_conflict`). Plain silent overwrite or blind `ON CONFLICT DO NOTHING` is forbidden.

### 4.4 Out-of-Order Samples & Latest State Isolation
- An older sample within the 10-minute acceptance window is accepted into `public.server_metrics_history`.
- `public.server_metrics_latest` only updates if `observed_at > existing.observed_at`.
- `OUT_OF_ORDER_HISTORY_ACCEPTABLE = YES`, `LATEST_STATE_REGRESSION = NO`.

### 4.5 Atomic Ingestion Transaction
- Execution handled in single PostgreSQL function: `launcher.store_server_metrics_sample(...)`.
- `LATEST_HISTORY_TRANSACTION = ATOMIC`.

### 4.6 Agent Payload Unchanged
- `AGENT_PAYLOAD_CHANGE_REQUIRED = NO`.
- `agent/neko_server_agent.py` source remains untouched.

---

## 5. Storage Calculations & Bounds

With push cadence $T = 5\text{ seconds}$ ($12\text{ samples/minute}$):

| Time Window | Total Samples per Server | Total Footprint per Server (Heap + 2 Indexes) |
| :--- | :---: | :---: |
| **1 Hour** | $720$ | $\sim 202\text{ KB}$ |
| **1 Day (24 Hours)** | $17,280$ | $\sim 4.8\text{ MB}$ |
| **7 Days (Retention Bound)** | $120,960$ | $\sim 33.9\text{ MB}$ |
| **30 Days (Hypothetical Unpruned)** | $518,400$ | $\sim 145.1\text{ MB}$ |

---

## 6. Query Ranges & Downsampling Contract

| Range | Query Window | Bucket Resolution | Max Points Returned | Primary Aggregations |
| :---: | :---: | :---: | :---: | :--- |
| **1h** | Last 1 Hour ($\le 3600\text{s}$) | $60\text{s}$ ($1\text{m}$) | **60 points** | `avg_rx_bps`, `max_rx_bps`, `avg_tx_bps`, `max_tx_bps`, `avg_ping_ms`, `max_loss_percent` |
| **24h** | Last 24 Hours ($\le 86400\text{s}$) | $300\text{s}$ ($5\text{m}$) | **288 points** | `avg_rx_bps`, `max_rx_bps`, `avg_tx_bps`, `max_tx_bps`, `avg_ping_ms`, `max_loss_percent` |
| **7d** | Last 7 Days ($\le 604800\text{s}$) | $1800\text{s}$ ($30\text{m}$) | **336 points** | `avg_rx_bps`, `max_rx_bps`, `avg_tx_bps`, `max_tx_bps`, `avg_ping_ms`, `max_loss_percent` |

### Special Aggregation Semantics:
- **Cumulative Counters (`rx_bytes_total`, `tx_bytes_total`)**: `CUMULATIVE_COUNTER_AVERAGED = NO`. Cumulative byte totals are not averaged.
- **Latency (`ping_ms`)**: Averaged over valid numeric observations only; missing pings remain `null` rather than converted to fake zeros.
- **Service Degradations**: Preserved in each bucket via `had_service_failure` and `had_listener_failure`. If any sample in the bucket degraded, the bucket reflects the degradation event.
- **Gaps**: `HISTORICAL_GAPS_PRESERVED = YES`. Missing time intervals produce no points.

---

## 7. API Specification

### Endpoint: `GET /api/server/metrics/history`
- **Auth**: Admin session cookie required (`admin_session`). Unauthenticated $\rightarrow$ `401 Unauthorized`.
- **Query Params**:
  - `range` (required, enum: `"1h" | "24h" | "7d"`)
  - `serverId` or `server_id` (optional, default: `"japan-vps-1"`)

### Response Example (`200 OK`):
```json
{
  "ok": true,
  "server_id": "japan-vps-1",
  "range": "1h",
  "bucket_seconds": 60,
  "window_start": "2026-08-18T11:00:00.000Z",
  "window_end": "2026-08-18T12:00:00.000Z",
  "available_since": "2026-08-18T11:00:00.000Z",
  "points_count": 60,
  "points": [
    {
      "bucket_start": "2026-08-18T11:59:00Z",
      "sample_count": 12,
      "rx_bps_avg": 15420.0,
      "rx_bps_max": 25000.0,
      "tx_bps_avg": 16800.0,
      "tx_bps_max": 28000.0,
      "ping_ms_avg": 1.7,
      "ping_ms_min": 1.5,
      "ping_ms_max": 2.1,
      "packet_loss_percent_avg": 0.0,
      "packet_loss_percent_max": 0.0,
      "shadowsocks_service_healthy": true,
      "shadowsocks_listener_healthy": true,
      "had_service_failure": false,
      "had_listener_failure": false
    }
  ]
}
```

---

## 8. Decision Matrix Summary

| Decision Key | Frozen Implementation Authority |
| :--- | :--- |
| `DESIGNED` | `YES` |
| `IMPLEMENTED` | `YES` |
| `PRODUCTION_DEPLOYED` | `YES` |
| `PRODUCTION_VERIFIED` | `YES` |
| `HISTORY_TABLE_MODEL` | `public.server_metrics_history` |
| `HISTORY_SAMPLE_IDENTITY` | `(server_id, observed_at)` |
| `IDENTICAL_RETRY` | `IDEMPOTENT` (`is_idempotent_retry: true`) |
| `CONFLICTING_DUPLICATE` | `REJECTED` (`409 Conflict` / `sample_conflict`) |
| `OUT_OF_ORDER_HISTORY_ACCEPTABLE` | `YES` |
| `LATEST_STATE_REGRESSION` | `NO` |
| `LATEST_HISTORY_TRANSACTION` | `ATOMIC` (`launcher.store_server_metrics_sample`) |
| `RAW_RETENTION` | `7 days` |
| `STORED_DOWNSAMPLED_HISTORY` | `NO` |
| `QUERY_TIME_BUCKETING` | `YES` |
| `RETENTION_EXECUTOR` | `DATABASE_SCHEDULED_JOB` (`pg_cron` / `launcher.prune_server_metrics_history`) |
| `PRUNING_INTERVAL` | `1 hour` |
| `TIMESTAMP_VALIDATION` | `now() - 10 minutes <= observed_at <= now() + 2 minutes` |
| `AGENT_PAYLOAD_CHANGE_REQUIRED` | `NO` |
| `LATEST_SNAPSHOT_AUTHORITY_PRESERVED` | `YES` |
| `BACKFILL_EXISTING_HISTORY` | `NO` |
| `HISTORICAL_GAPS_PRESERVED` | `YES` |
| `CLIENT_DEEP_TELEMETRY_TO_HISTORY` | `NO` |
