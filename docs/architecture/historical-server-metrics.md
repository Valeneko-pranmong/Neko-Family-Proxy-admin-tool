# NEKO FAMILY PROXY — HISTORICAL SERVER METRICS ARCHITECTURE
# Server-Side Time-Series Persistence, Query Contract & Retention Specification (Phase T6)

```text
DOCUMENT:               docs/architecture/historical-server-metrics.md
STATUS:                 DESIGN_AUTHORITY (T6A Architecture Frozen)
CLASSIFICATION:         HARD ARCHITECTURE INVARIANT & SYSTEM SPECIFICATION
PHASE:                  T6A (Design & Documentation Only — No Runtime Implementation)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
CURRENT_PRE_T6_HEAD:    41067701f6aa4498ba928fbf0359e939c705a5f0 (Docs/Evidence)
T5_RUNTIME_SOURCE:      840adc18da08cd3af284c5e2cbffbb20d5ef5d6a
BACKEND_DB_AUTHORITY:   bc34b5b1e70228f3c007ba077e72d3650602bd34
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Purpose

### 1.1 Purpose
Phase **T6** extends the existing Japan VPS monitoring stack (established in T4B and polished in T5) by introducing **durable server-side historical time-series storage and query capabilities**.

While Phase T4B and T5 established the authoritative real-time pipeline:
- **T4B**: Server monitoring data plane with dedicated ingest secret, systemd monitoring daemon on Japan VPS, and single-row snapshot persistence (`public.server_metrics_latest`).
- **T5**: Accessible Admin Dashboard with an honest **browser-local rolling live buffer** (~5 minutes, 60 samples, resets on page reload).

Phase **T6** adds a dedicated historical telemetry storage authority, an authenticated historical query API, and bounded time-range visualization (1h, 24h, 7d) that persists across browser sessions and multiple administrator endpoints without altering client privacy invariants or proxy runtime operations.

### 1.2 Non-Goals & Strict Exclusions
1. **No Client Telemetry**: Historical monitoring remains 100% server-side aggregate. Client Core PIDs, Game PIDs (`pso2.exe`), local SOCKS state, packet payloads, DNS lookups, per-user traffic, and hardware identifiers are strictly prohibited.
2. **No Proxy Data Plane Coupling**: Historical storage failures, database slowdowns, or ingest network errors must never interrupt Shadowsocks proxy traffic or crash the VPS monitoring daemon.
3. **No Unbounded Storage**: Database storage must not grow indefinitely. Explicit rolling retention and storage bounds are mandatory.
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
|  Replay Guard: Reject older/stale timestamps      Replay Guard: Idempotent (ON CONFLICT IGNORE)   |
|                                                                                                   |
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
   │ 3. Validate clock skew (within 60s future, not older than retention window)
   ▼
[Supabase / PostgreSQL RPC: launcher.ingest_server_metrics]
   │ ── ATOMIC / CONTROLLED TRUSTED OPERATION ──
   ├─► 1. UPSERT public.server_metrics_latest (updates if observed_at > existing)
   └─► 2. INSERT public.server_metrics_history (ON CONFLICT (server_id, observed_at) DO NOTHING)
   ▼
[Historical Query API: GET /api/server/metrics/history?serverId=...&range=1h|24h|7d]
   │ (Admin Session Cookie Authentication Required)
   │ (Server-side downsampling / bucketing via PostgreSQL date_bin / aggregation)
   ▼
[Admin Web Dashboard (T6C UI)]
   ├── Tab 1: Live (Browser-local rolling 5m, 5s poll)
   ├── Tab 2: 1h (Server history, ~60 downsampled points)
   ├── Tab 3: 24h (Server history, ~288 downsampled points)
   └── Tab 4: 7d (Server history, ~336 downsampled points)
```

---

## 3. Database Model & Schema Design

### 3.1 Proposed Table: `public.server_metrics_history`

> [!NOTE]
> This schema is designed for forward-only migration in Phase T6B. Applied migration `20260818090000_server_monitoring_latest_snapshot.sql` remains immutable.

```sql
-- Proposed Migration: supabase/migrations/20260818120000_server_monitoring_history.sql

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

  -- Composite Primary Key guarantees strict logical sample uniqueness and idempotency
  constraint server_metrics_history_pkey primary key (server_id, observed_at)
);

-- Primary query index for time-range filtering and descending order scans
create index if not exists server_metrics_history_range_idx
  on public.server_metrics_history (server_id, observed_at desc);

-- Retention maintenance index (supports efficient bulk deletion of expired rows)
create index if not exists server_metrics_history_retention_idx
  on public.server_metrics_history (observed_at);
```

### 3.2 Security, Permissions & Row Level Security (RLS)

```sql
alter table public.server_metrics_history enable row level security;

-- Strict Access Policies:
-- 1. Ingest is performed exclusively by trusted Backend via security definer RPC using service-role.
-- 2. Public/anonymous clients have ZERO SELECT, INSERT, UPDATE, or DELETE grants.
-- 3. Authenticated frontend queries run through Admin API with session cookie verification.
revoke all on public.server_metrics_history from anon, authenticated;
grant select on public.server_metrics_history to service_role;
```

---

## 4. Ingestion, Idempotency & Clock Contracts

### 4.1 Sample Identity & Idempotent Insertion Contract
- **Sample Identity**: Defined strictly by `(server_id, observed_at)`.
- **Idempotency Rule**: Network retries, proxy timeouts, or agent re-transmissions sending the identical `(server_id, observed_at)` must **NOT** create duplicate rows.
- **SQL Invariant**:
  ```sql
  insert into public.server_metrics_history (...)
  values (...)
  on conflict (server_id, observed_at) do nothing;
  ```
- `HISTORY_INSERT_IDEMPOTENT = YES`

### 4.2 Out-of-Order Sample Handling
- Unlike `server_metrics_latest` (which only advances if `p_observed_at > existing.observed_at`), the historical table accommodates legitimate out-of-order samples (e.g. transient network queuing delays or delayed HTTP retries).
- **Rules**:
  1. **Newer sample (`p_observed_at > latest.observed_at`)**: Appends to `server_metrics_history` and updates `server_metrics_latest`.
  2. **Same timestamp (`p_observed_at == existing.observed_at`)**: History insert ignored via `ON CONFLICT DO NOTHING`; latest snapshot remains unchanged.
  3. **Older sample within retention (`retention_cutoff <= p_observed_at < latest.observed_at`)**: Appends to `server_metrics_history` (valid historical record); `server_metrics_latest` is **NOT** overwritten with older state.
  4. **Stale/Expired sample (`p_observed_at < retention_cutoff`)**: Rejected by validation or immediately pruned.
  5. **Future timestamp (`p_observed_at > now() + 60s`)**: Strictly rejected at Backend ingest validation (`400 Bad Request`).

### 4.3 Clock Skew & Timestamp Validation
To protect historical integrity against malformed timestamps or client clock drift:
- **Maximum Future Drift**: `now() + 60 seconds` (accommodates normal NTP jitter and network propagation). Timestamps exceeding this are rejected.
- **Maximum Past Age**: `now() - 7 days` (samples older than the maximum retention window are rejected).
- **ISO-8601 UTC Requirement**: All timestamps must parse to valid finite UTC milliseconds.

### 4.4 Agent Payload Compatibility
- Source inspection of `agent/neko_server_agent.py` confirms that the current agent already emits all necessary historical fields:
  `server_id`, `observed_at`, `host_uptime_seconds`, `shadowsocks_service_status`, `shadowsocks_listener_status`, `ping_ms`, `ping_status`, `packet_loss_percent`, `rx_bytes_total`, `tx_bytes_total`, `rx_bps`, `tx_bps`, `cpu_percent`, `memory_percent`.
- **Decision**: `AGENT_PAYLOAD_CHANGE_REQUIRED = NO`.
- The Japan VPS agent requires zero code changes or redeployment for Phase T6.

### 4.5 Atomic Ingest Execution (RPC Contract)
To prevent split-brain states where historical storage succeeds but latest snapshot fails (or vice versa), Backend ingest executes a single unified PostgreSQL function:

```sql
create or replace function launcher.ingest_server_metrics(
  p_server_id text,
  p_observed_at timestamptz,
  p_host_uptime_seconds bigint,
  p_shadowsocks_service_status text,
  p_shadowsocks_listener_status text,
  p_ping_ms double precision,
  p_ping_status text,
  p_packet_loss_percent double precision,
  p_rx_bytes_total bigint,
  p_tx_bytes_total bigint,
  p_rx_bps double precision,
  p_tx_bps double precision,
  p_cpu_percent double precision default null,
  p_memory_percent double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_updated boolean := false;
  v_history_inserted boolean := false;
begin
  -- 1. Insert into historical time-series (Idempotent)
  insert into public.server_metrics_history (
    server_id, observed_at, host_uptime_seconds,
    shadowsocks_service_status, shadowsocks_listener_status,
    ping_ms, ping_status, packet_loss_percent,
    rx_bytes_total, tx_bytes_total, rx_bps, tx_bps,
    cpu_percent, memory_percent, created_at
  )
  values (
    p_server_id, p_observed_at, p_host_uptime_seconds,
    p_shadowsocks_service_status, p_shadowsocks_listener_status,
    p_ping_ms, p_ping_status, p_packet_loss_percent,
    p_rx_bytes_total, p_tx_bytes_total, p_rx_bps, p_tx_bps,
    p_cpu_percent, p_memory_percent, now()
  )
  on conflict (server_id, observed_at) do nothing;

  v_history_inserted := found;

  -- 2. Upsert into latest snapshot (Only advances if strictly newer)
  insert into public.server_metrics_latest (
    server_id, observed_at, host_uptime_seconds,
    shadowsocks_service_status, shadowsocks_listener_status,
    ping_ms, ping_status, packet_loss_percent,
    rx_bytes_total, tx_bytes_total, rx_bps, tx_bps,
    cpu_percent, memory_percent, updated_at
  )
  values (
    p_server_id, p_observed_at, p_host_uptime_seconds,
    p_shadowsocks_service_status, p_shadowsocks_listener_status,
    p_ping_ms, p_ping_status, p_packet_loss_percent,
    p_rx_bytes_total, p_tx_bytes_total, p_rx_bps, p_tx_bps,
    p_cpu_percent, p_memory_percent, now()
  )
  on conflict (server_id) do update set
    observed_at = excluded.observed_at,
    host_uptime_seconds = excluded.host_uptime_seconds,
    shadowsocks_service_status = excluded.shadowsocks_service_status,
    shadowsocks_listener_status = excluded.shadowsocks_listener_status,
    ping_ms = excluded.ping_ms,
    ping_status = excluded.ping_status,
    packet_loss_percent = excluded.packet_loss_percent,
    rx_bytes_total = excluded.rx_bytes_total,
    tx_bytes_total = excluded.tx_bytes_total,
    rx_bps = excluded.rx_bps,
    tx_bps = excluded.tx_bps,
    cpu_percent = excluded.cpu_percent,
    memory_percent = excluded.memory_percent,
    updated_at = now()
  where public.server_metrics_latest.observed_at < excluded.observed_at;

  v_latest_updated := found;

  return jsonb_build_object(
    'history_inserted', v_history_inserted,
    'latest_updated', v_latest_updated
  );
end;
$$;
```

---

## 5. Storage Calculations & Retention Architecture

### 5.1 Telemetry Sample Cadence & Growth Estimates
With a push cadence of $T = 5\text{ seconds}$ ($12\text{ samples/minute}$):

| Time Window | Total Samples per Server | Estimated Table Heap Size | Estimated Index Size | Total Footprint per Server |
| :--- | :---: | :---: | :---: | :---: |
| **1 Minute** | $12\text{ samples}$ | $\sim 2.2\text{ KB}$ | $\sim 1.2\text{ KB}$ | $\sim 3.4\text{ KB}$ |
| **1 Hour** | $720\text{ samples}$ | $\sim 130\text{ KB}$ | $\sim 72\text{ KB}$ | $\sim 202\text{ KB}$ |
| **1 Day (24 Hours)** | $17,280\text{ samples}$ | $\sim 3.1\text{ MB}$ | $\sim 1.7\text{ MB}$ | $\sim 4.8\text{ MB}$ |
| **7 Days** | $120,960\text{ samples}$ | $\sim 21.8\text{ MB}$ | $\sim 12.1\text{ MB}$ | $\sim 33.9\text{ MB}$ |
| **30 Days** | $518,400\text{ samples}$ | $\sim 93.3\text{ MB}$ | $\sim 51.8\text{ MB}$ | $\sim 145.1\text{ MB}$ |
| **1 Year (Unbounded)** | $6,307,200\text{ samples}$ | $\sim 1.13\text{ GB}$ | $\sim 630\text{ MB}$ | $\sim 1.76\text{ GB}$ |

*Assumptions*: Average tuple header + payload $\approx 180\text{ bytes}$; 2 indexes $\approx 100\text{ bytes/row}$; standard PostgreSQL $8\text{KB}$ page fill factor $\approx 85\%$.

### 5.2 Architectural Trade-Off Analysis (Raw vs. Downsampled Tables)

| Architecture | Description | Pros | Cons | Operational Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Option A: Raw 5s table for full 7d retention** | Single table storing raw 5s samples for 7 days; query API aggregates dynamically. | Simplest pipeline; zero aggregation worker lag; exact raw metrics for forensic debugging; footprint is only $\sim 34\text{ MB}$. | 7d raw queries require database aggregation scanning up to 120k rows. | **RECOMMENDED FOR V1** |
| **Option B: Raw 24h + Continuous Rollup Tables** | Raw 5s for 24h, 1m rollups for 7d, 1h rollups for 30d/90d. | Lower disk for large fleets; faster multi-month queries. | High complexity (triggers/cron aggregation workers); potential rollup desync; complex multi-table query routing. | Over-engineered for current single-VPS fleet. |
| **Option C: Scheduled In-Place Downsampling** | Scheduled job collapses older raw samples into 5m/30m buckets within the same table. | Single table. | High write churn (deleting raw rows and inserting averages); complex locking. | Not recommended. |

### 5.3 Selected Retention Strategy (V1 Authority)
1. **Model**: **Option A** (Single raw historical table with query-time downsampling).
2. **Raw Retention Window**: **7 Days** (`INTERVAL '7 days'`).
3. **Pruning Mechanism**: Dedicated PostgreSQL cleanup function `launcher.prune_server_metrics_history(p_retention_days integer default 7)`:
   ```sql
   create or replace function launcher.prune_server_metrics_history(p_retention_days integer default 7)
   returns integer
   language plpgsql
   security definer
   set search_path = ''
   as $$
   declare
     v_deleted_count integer;
     v_cutoff timestamptz;
   begin
     v_cutoff := now() - (p_retention_days || ' days')::interval;
     delete from public.server_metrics_history
     where observed_at < v_cutoff;
     get diagnostics v_deleted_count = row_count;
     return v_deleted_count;
   end;
   $$;
   ```
4. **Pruning Execution**:
   - Primary: Scheduled via `pg_cron` (if supported on hosted Supabase instance) or an automated daily cron endpoint triggered by Vercel Cron.
   - Secondary: Opportunistic low-overhead cleanup triggered during ingest (e.g. 1% probability check) or Admin overview request if cron is unavailable.
   - Failure Tolerance: Missing pruning runs for days or weeks causes bounded storage growth ($\sim 4.8\text{ MB/day}$) without breaking ingest or queries.

---

## 6. Query Ranges, Downsampling & Semantics

### 6.1 Target Query Ranges & Bucket Resolution

To prevent the Admin frontend from downloading tens of thousands of raw points, the backend aggregates data into uniform time buckets:

| Range | Query Window | Raw Samples Available | Bucket Resolution | Max Points Returned | Target Metric Aggregation |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **1h** | Last 1 Hour ($\le 3600\text{s}$) | $720$ | $60\text{ seconds}$ ($1\text{m}$) | **60 points** | `avg_rx_bps`, `max_rx_bps`, `avg_tx_bps`, `max_tx_bps`, `avg_ping_ms`, `max_loss_percent` |
| **24h** | Last 24 Hours ($\le 86400\text{s}$) | $17,280$ | $300\text{ seconds}$ ($5\text{m}$) | **288 points** | `avg_rx_bps`, `max_rx_bps`, `avg_tx_bps`, `max_tx_bps`, `avg_ping_ms`, `max_loss_percent` |
| **7d** | Last 7 Days ($\le 604800\text{s}$) | $120,960$ | $1800\text{ seconds}$ ($30\text{m}$) | **336 points** | `avg_rx_bps`, `max_rx_bps`, `avg_tx_bps`, `max_tx_bps`, `avg_ping_ms`, `max_loss_percent` |

### 6.2 Statistical Downsampling Semantics by Field Type

Aggregation across time buckets must preserve mathematical and operational correctness:

1. **Transfer Rates (`rx_bps`, `tx_bps`)**:
   - `avg_rx_bps = AVG(rx_bps)`: Represents sustained average throughput over the bucket.
   - `max_rx_bps = MAX(rx_bps)`: Preserves visibility of transient traffic spikes and peak bursts.
   - `avg_tx_bps = AVG(tx_bps)`, `max_tx_bps = MAX(tx_bps)`.
2. **Upstream Latency (`ping_ms`)**:
   - `avg_ping_ms = AVG(ping_ms) WHERE ping_ms IS NOT NULL`.
   - `min_ping_ms = MIN(ping_ms)`, `max_ping_ms = MAX(ping_ms)`: Preserves latency jitter boundaries.
3. **Packet Loss (`packet_loss_percent`)**:
   - `avg_loss_percent = AVG(packet_loss_percent)`.
   - `max_loss_percent = MAX(packet_loss_percent)`: Ensures transient packet drops are not averaged away into invisibility.
4. **Cumulative Interface Totals (`rx_bytes_total`, `tx_bytes_total`)**:
   - **DO NOT AVERAGE**: Averaging monotonic counters is mathematically meaningless.
   - Bucket value represents `MAX(rx_bytes_total)` or the latest sample in the bucket.
5. **Service Health Rollups (`shadowsocks_service_status`, `shadowsocks_listener_status`)**:
   - Bucket state is `active` / `listening` only if **100%** of samples within that bucket were healthy.
   - If any sample in the bucket failed, bucket reports `degraded` or records `degraded_samples_count > 0`.
   - Prevents micro-outages from being concealed by downsampling.

### 6.3 Historical Gap Semantics
- **No Fake Zeros**: When the Japan VPS is powered down or the monitoring agent is stopped, no database rows are created.
- **Visual Presentation**: Gaps are identified when $\Delta t > 2 \times \text{bucket\_resolution}$. The UI chart renderer will break the polyline across gaps rather than drawing a flat zero line.
- `HISTORICAL_GAPS_PRESERVED = YES`

### 6.4 Stale vs. Historical Data Distinction
- **STALE State**: A **current host condition** indicating that the latest snapshot in `server_metrics_latest` is $> 30\text{ seconds}$ old.
- **Historical Data**: Permanent, accurate historical records of what was observed at specific past timestamps.
- **Invariant**: A currently `STALE` server does **not** corrupt past historical points; historical points remain valid records of their respective timestamps.

---

## 7. API Contract & Admin Authentication

### 7.1 Historical Query Endpoint
- **Route**: `GET /api/server/metrics/history`
- **Authentication**: Reuses existing signed, HttpOnly `admin_session` cookie (`requireAdminSession` in `server/auth.mjs`). Unauthenticated calls receive `HTTP 401 Unauthorized`.
- **Query Parameters**:
  - `serverId` (optional, string, default: `"japan-vps-1"`, pattern: `^[a-z0-9_-]{1,64}$`)
  - `range` (required, enum: `"1h" | "24h" | "7d"`)

### 7.2 Response Schema (`200 OK`)

```json
{
  "ok": true,
  "server_id": "japan-vps-1",
  "range": "24h",
  "bucket_seconds": 300,
  "start_time": "2026-08-17T12:00:00.000Z",
  "end_time": "2026-08-18T12:00:00.000Z",
  "points_count": 288,
  "history_available_since": "2026-08-18T00:00:00.000Z",
  "points": [
    {
      "bucket_time": "2026-08-18T11:55:00.000Z",
      "sample_count": 60,
      "rx_bps_avg": 4250100.5,
      "rx_bps_max": 18200400.0,
      "tx_bps_avg": 5120300.0,
      "tx_bps_max": 22400100.0,
      "ping_ms_avg": 1.7,
      "ping_ms_min": 1.5,
      "ping_ms_max": 2.3,
      "packet_loss_avg": 0.0,
      "packet_loss_max": 0.0,
      "service_health": "healthy",
      "degraded_samples": 0
    }
  ]
}
```

### 7.3 Error Responses
- `400 Bad Request`: `{ "ok": false, "error": "Invalid range parameter. Expected 1h, 24h, or 7d." }`
- `401 Unauthorized`: `{ "ok": false, "error": "Admin authentication required" }`
- `500 Internal Server Error`: `{ "ok": false, "error": "Database query failed" }`

---

## 8. Dashboard UI Contract (Phase T6C Design Intent)

### 8.1 Time Range Switcher & Visual Hierarchy
The Admin Dashboard Network Activity section will feature four explicit range tabs:

```text
+-----------------------------------------------------------------------------------------+
| LIVE NETWORK ACTIVITY                                                                   |
| Subtitle: [ Dynamic label based on active tab ]                                         |
|                                                                                         |
|  [ Live (5m) ]    [ 1 Hour ]    [ 24 Hours ]    [ 7 Days ]                              |
|  ─────────────                                                                          |
|                                                                                         |
|  [ SVG Time-Series Chart Area ]                                                         |
|  - Renders RX Rate (Cyan/Blue) & TX Rate (Orange/Amber)                                 |
|  - Renders Ping Latency & Packet Loss overlay / secondary axis                          |
|  - Preserves visual gaps across unmonitored periods                                     |
|                                                                                         |
|  Legend: ── RX (Download)  ── TX (Upload)  ┄┄ Latency (ms)                              |
+-----------------------------------------------------------------------------------------+
```

### 8.2 Tab Subtitle & Mode Mapping

| Tab Selected | Mode Authority | Subtitle Displayed | Data Source |
| :---: | :---: | :--- | :--- |
| **Live (5m)** | `BROWSER_LOCAL_ROLLING` | `Live — Since Dashboard Opened (~5 min buffer)` | Browser memory (60 samples, 5s poll) |
| **1 Hour** | `SERVER_HISTORICAL` | `Historical — Last 1 Hour (1m resolution)` | `/api/server/metrics/history?range=1h` |
| **24 Hours** | `SERVER_HISTORICAL` | `Historical — Last 24 Hours (5m resolution)` | `/api/server/metrics/history?range=24h` |
| **7 Days** | `SERVER_HISTORICAL` | `Historical — Last 7 Days (30m resolution)` | `/api/server/metrics/history?range=7d` |

### 8.3 Cold Start & Partial History Policy
- **No Fabrication**: If T6 is deployed at `12:00` and the administrator selects `24 Hours` at `12:15`, the chart renders the available 15 minutes of data.
- **UI Banner**: Displays an informative hint: `Showing history since 2026-08-18 12:00:00 (15 min available)`.
- `BACKFILL_EXISTING_HISTORY = NO`

---

## 9. Failure Isolation & Security Boundaries

### 9.1 Data Plane Failure Isolation Invariants
```text
+---------------------------------------------------------------------------------+
|                         FAILURE ISOLATION GUARANTEES                            |
+---------------------------------------------------------------------------------+
| 1. VPS Proxy Operation:                                                         |
|    Shadowsocks proxy traffic runs independently of the monitoring agent.        |
|    Any ingest HTTP failure, Supabase DB pause, or network partition will NEVER  |
|    interrupt Shadowsocks daemon routing.                                        |
|                                                                                 |
| 2. Agent Resilience:                                                            |
|    The Python monitoring agent traps all transmission exceptions and sleeps     |
|    until the next 5-second interval without crashing or leaking memory.        |
|                                                                                 |
| 3. Partial Backend Failures:                                                    |
|    If historical table write encounters an unexpected lock or DB timeout,       |
|    the latest snapshot upsert remains resilient.                                |
|                                                                                 |
| 4. Ingest Secret Authority:                                                     |
|    Reuses existing SERVER_METRICS_INGEST_SECRET. No new secrets required.        |
+---------------------------------------------------------------------------------+
```

- `DATA_PLANE_FAILURE_ISOLATION = YES`
- `CLIENT_DEEP_TELEMETRY_TO_HISTORY = NO`
- `LATEST_SNAPSHOT_AUTHORITY_PRESERVED = YES`

---

## 10. Implementation Roadmap & Recommended Phase Split

To maintain clean quality gates and isolation, Phase T6 is partitioned into three sequential, reviewable subphases:

```text
T6A (CURRENT)   : Architecture, database model, downsampling semantics, and documentation.
                  [ DESIGN ONLY — NO CODE OR MIGRATIONS ]

T6B (NEXT)      : Historical persistence, Supabase migration, Backend Ingest RPC,
                  pruning function, and Historical Query API with automated Node tests.
                  [ PRIMARY_TEAM: TEAM_WEB | MODEL: Gemini 3.7 Flash ]

T6C             : Admin Web Dashboard historical chart controls (Live, 1h, 24h, 7d),
                  gap rendering, resolution formatting, and frontend tests.
                  [ PRIMARY_TEAM: TEAM_WEB | MODEL: Gemini 3.7 Flash ]

T6D             : Live Japan VPS production verification, 24h history accumulation,
                  pruning verification, and production handoff.
```

---

## 11. Test & Verification Plan for Future Phases

### 11.1 Phase T6B Backend Test Matrix
When T6B begins implementation, the following automated tests must be created in `tests/server-metrics-history.test.mjs`:

1. **Idempotent Ingestion**: Sending identical `(server_id, observed_at)` twice succeeds and results in exactly 1 row in `server_metrics_history`.
2. **Out-of-Order Ingestion**: Ingesting a sample with $t = \text{now} - 10\text{m}$ after $t = \text{now}$ appends to history without regressing `server_metrics_latest`.
3. **Future Timestamp Rejection**: Ingesting $t = \text{now} + 120\text{s}$ fails with `400 Bad Request`.
4. **Historical Query Ranges**: Calling history API with `range=1h`, `range=24h`, and `range=7d` returns properly bucketed data with bounded point counts ($\le 336$).
5. **Authentication Boundary**: History endpoint returns `401 Unauthorized` without valid Admin session cookie.
6. **Privacy Boundary Regression**: Ingest endpoint continues rejecting forbidden client telemetry fields (`core_pid`, `client_rx_bytes`, `device_id`, etc.).
7. **Pruning Verification**: `launcher.prune_server_metrics_history` correctly deletes records older than cutoff while preserving records within the retention window.

### 11.2 Phase T6C Dashboard UI Test Matrix
1. **Range Switching**: Selecting `1h`, `24h`, `7d` triggers history fetch with proper params; selecting `Live` restores browser-local 5s rolling buffer.
2. **Gap Rendering**: Broken lines rendered across unmonitored intervals without fake zero points.
3. **Partial History Display**: Shows appropriate hint when available historical span is shorter than selected range.
4. **Responsive Layout**: Time range controls adapt cleanly without layout breaks across mobile, tablet, and desktop viewports.

---

## 12. Decision Matrix Summary

| Decision Key | Selected Value | Justification |
| :--- | :---: | :--- |
| `HISTORY_TABLE_MODEL` | `public.server_metrics_history` | Dedicated composite-key table decoupled from latest snapshot. |
| `HISTORY_SAMPLE_IDENTITY` | `(server_id, observed_at)` | Natural composite key guaranteeing strict sample uniqueness. |
| `HISTORY_INSERT_IDEMPOTENT` | `YES` | `ON CONFLICT (server_id, observed_at) DO NOTHING` prevents retry duplicates. |
| `RAW_RETENTION` | `7 Days` | Bounded footprint ($\sim 34\text{ MB/server}$) with high fidelity. |
| `DOWNSAMPLED_RETENTION` | `Not required in V1` | Query-time dynamic bucketing avoids complex rollup pipelines. |
| `QUERY_RANGES` | `1h / 24h / 7d` | Covers operational needs from immediate troubleshooting to weekly trends. |
| `MAX_POINTS_PER_QUERY` | `~60 to 336 points` | Prevents browser performance bottlenecks and large payloads. |
| `RETENTION_EXECUTOR` | `pg_cron / Backend scheduled RPC` | Safe bulk delete on indexed timestamp column. |
| `AGENT_PAYLOAD_CHANGE_REQUIRED` | `NO` | Existing T4B VPS agent payload already contains all required history metrics. |
| `BACKFILL_EXISTING_HISTORY` | `NO` | Centralized history begins honestly at T6 deployment timestamp. |
| `LATEST_SNAPSHOT_AUTHORITY_PRESERVED`| `YES` | `public.server_metrics_latest` continues serving instant live state. |
| `CLIENT_DEEP_TELEMETRY_TO_HISTORY` | `NO` | Privacy boundary remains 100% frozen. |
| `DATA_PLANE_FAILURE_ISOLATION` | `YES` | Metrics failures never impact proxy routing or VPS daemon health. |
