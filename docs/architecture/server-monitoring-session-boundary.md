# NEKO FAMILY PROXY — SERVER MONITORING & SESSION AUTHORITY CONTRACT
# Server-Side Aggregate Observability, Session Authority & Privacy Boundary

```text
DOCUMENT:               docs/architecture/server-monitoring-session-boundary.md
STATUS:                 DEPLOYED_AUTHORITY (T4B/T5/T6 Deployed & Production Verified)
CLASSIFICATION:         HARD ARCHITECTURE INVARIANT & CONTRACT
OWNER:                  TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
CONSUMERS:              ADMIN WEB, BACKEND API, SERVER INFRASTRUCTURE
CORE / LAUNCHER SCOPE:  NO ACTION — READ-ONLY REFERENCE ONLY
CURRENT_STORAGE_STATUS: LATEST + HISTORY (Deployed in public.server_metrics_latest & public.server_metrics_history)
T6_EXTENSION_STATUS:    DEPLOYED (Described in docs/architecture/historical-server-metrics.md & docs/current/historical-server-metrics-production-proof.md)
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Foundational Invariants

This document defines the authoritative architecture, data contracts, metric origin points, and trust boundaries for **Phase T4 (Server Monitoring & Session Authority)** in the Neko Family Proxy ecosystem.

The central architectural invariant is:

```text
THE ADMIN WEB MAY KNOW WHO IS ONLINE AND HOW THE JAPAN VPS IS PERFORMING,
BUT MUST NOT KNOW WHAT IS HAPPENING INSIDE THE USER'S LOCAL MACHINE.
```

### System Data Scope:
```text
WEB SCOPE     = SERVER AGGREGATE MONITORING + USER SESSION AUTHORITY
CLIENT SCOPE  = DEEP LOCAL OBSERVABILITY & DIAGNOSTICS (LOCAL ONLY)
```

```text
WEB != CLIENT OBSERVABILITY
```

### Two Independent Data Authorities (Decoupled Planes):
The Admin Web is powered by two distinct, decoupled authority channels:
1. **Server Aggregate Channel (Server Plane)**: Originates strictly on the **Japan VPS** via a dedicated server monitoring daemon, reporting fleet-level infrastructure and proxy service health into an authenticated Backend Ingest API.
2. **User Session Authority Channel (Session Plane)**: Originates in the **Auth / Database Backend (Supabase)**, tracking user sessions, licenses, and heartbeat liveness.

```text
+-------------------------------------------------------------------------------+
|                      TWO INDEPENDENT DATA PLANES                              |
+-------------------------------------------------------------------------------+
|                                                                               |
|  [ DATA PLANE 1: SERVER AGGREGATE ]                                           |
|  Japan VPS (Host & SS Service)                                                |
|       │                                                                       |
|       ▼ (Outbound HTTPS Push with Pre-Shared Ingest Secret)                   |
|  Backend Ingest API -> Persisted Snapshot Table (Latest & History)            |
|       │                                                                       |
|       ├─► (Admin Query API) ────────────────────────► Admin Web Dashboard    |
|       │                                               [ Server Health Panel ] |
|       │                                                                       |
|       └─► (Planned Phase T7 Outbound Integration) ──► Discord Channel Status  |
|           Trusted Backend / Scheduled Worker          & Transition Alerts     |
|           (Aggregate Operational Projection Only)                             |
|                                                                               |
|  ───────────────────────────────────────────────────────────────────────────  |
|                                                                               |
|  [ DATA PLANE 2: SESSION AUTHORITY ]                                          |
|  Launcher Client                                                              |
|       │                                                                       |
|       ▼ (Minimal Heartbeat: session_id every 30s)                             |
|  Supabase `launcher_sessions` Table (DB Freshness: 90s, Admin Freshness: 120s)|
|       │                                                                       |
|       ├─► (Admin Overview / Session Query) ─────────► Admin Web Dashboard    |
|       │                                               [ Active Users Panel ]  |
|       │                                                                       |
|       └─► (Planned Phase T7 Session Aggregation) ───► Discord Status Embed    |
|           (Session-Only Integer Count: unrevoked && last_seen_at <= 120s)     |
|                                                                               |
+-------------------------------------------------------------------------------+
```

### Outbound Operational Projections (Current vs Planned T7):
- **Current Deployed Path (T4B/T5/T6)**:
  `Japan VPS` $\rightarrow$ `Monitoring Backend` $\rightarrow$ `Supabase (Latest + History)` $\rightarrow$ `Admin Web Dashboard`.
- **Planned Outbound Path (Phase T7 — Designed / Not Yet Deployed)**:
  `Trusted Backend Worker / Scheduler` $\rightarrow$ `Discord Webhook` (Receives aggregate operational projection and session-only active user count only; zero client/user identity).

---

## 2. Metric Source & Semantics Mapping Matrix

Every field presented on the Admin Web dashboard is mapped to an authoritative origin, collection mechanism, and privacy classification:

| Metric | Authoritative Source | Collection Method | Sampling / Push Cadence | Storage Required | Web Display Scope | Privacy Class |
|---|---|---|---|---|---|---|
| `host_status` | Japan VPS Monitoring Agent | Agent heartbeat / push to Ingest API | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | Host reachability & agent liveness | `SERVER_AGGREGATE` |
| `proxy_service_status` | Japan VPS Systemd Manager | `systemctl is-active shadowsocks` | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | Daemon process status | `SERVER_AGGREGATE` |
| `shadowsocks_service_status` | Japan VPS Local Listener | Local TCP socket probe (`127.0.0.1:<port>`) | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | Service listening health | `SERVER_AGGREGATE` |
| `server_ping_ms` | Japan VPS -> `CONFIGURED_UPSTREAM_MONITOR_TARGET` | Low-frequency ICMP / TCP ping from VPS | 15s – 30s | Latest Snapshot (`server_metrics_latest`) | VPS to Upstream Latency | `SERVER_AGGREGATE` |
| `server_ping_status` | Japan VPS Monitoring Agent | Ping probe outcome (`AVAILABLE`/`TIMEOUT`/`UNSUPPORTED`/`UNKNOWN`) | 15s – 30s | Latest Snapshot (`server_metrics_latest`) | Probe availability state | `SERVER_AGGREGATE` |
| `server_packet_loss_percent` | Japan VPS -> `CONFIGURED_UPSTREAM_MONITOR_TARGET` | Sampled ICMP ping bursts (5 pkts) | 30s | Latest Snapshot (`server_metrics_latest`) | Upstream packet loss % | `SERVER_AGGREGATE` |
| `server_rx_bytes_total` | Japan VPS Interface (`eth0`/default route) | `/proc/net/dev` or `/sys/class/net` | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | VPS Total Bytes Received | `SERVER_AGGREGATE` |
| `server_tx_bytes_total` | Japan VPS Interface (`eth0`/default route) | `/proc/net/dev` or `/sys/class/net` | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | VPS Total Bytes Sent | `SERVER_AGGREGATE` |
| `server_rx_bps` | Japan VPS Monitoring Agent | Rate delta: $\Delta \text{rx\_bytes} / \Delta t$ | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | VPS Download Speed | `SERVER_AGGREGATE` |
| `server_tx_bps` | Japan VPS Monitoring Agent | Rate delta: $\Delta \text{tx\_bytes} / \Delta t$ | 5s – 10s | Latest Snapshot (`server_metrics_latest`) | VPS Upload Speed | `SERVER_AGGREGATE` |
| `server_uptime_seconds` | Japan VPS Host Kernel | `/proc/uptime` | 10s – 30s | Latest Snapshot (`server_metrics_latest`) | VPS Host Uptime | `SERVER_AGGREGATE` |
| `online_session_count` | Supabase `launcher_sessions` | Unrevoked sessions with fresh heartbeat | On Admin Request (Cached) | Existing DB Table | Active raw session total | `SESSION_AUTHORITY` |
| `entitled_active_user_count` | Supabase `launcher_sessions` + `licenses` | Unrevoked sessions with fresh heartbeat + active license | On Admin Request (Cached) | Existing DB Table | Entitled active user total | `SESSION_AUTHORITY` |
| `server_cpu_percent` (Optional) | Japan VPS Kernel | `/proc/stat` delta | 10s | Latest Snapshot (`server_metrics_latest`) | VPS CPU Load % | `SERVER_AGGREGATE` |
| `server_memory_percent` (Optional) | Japan VPS Kernel | `/proc/meminfo` | 10s | Latest Snapshot (`server_metrics_latest`) | VPS RAM Usage % | `SERVER_AGGREGATE` |

---

## 3. Detailed Metric Semantics & Boundary Rules

### 3.1 Split Host and Service Health Semantics
Server health must **NEVER** be collapsed into a single overloaded `server_online` boolean. The architecture enforces three distinct, non-overlapping status concepts:

```text
+---------------------------------------------------------------------------------+
|                          THREE-TIER SERVER HEALTH MODEL                         |
+---------------------------------------------------------------------------------+
| [ 1. Host Layer ]     host_status                                               |
|                       Whether fresh authenticated reports (<= 30s) are received |
|                       from the Japan VPS agent.                                 |
|                                                                                 |
| [ 2. Process Layer ]  proxy_service_status                                      |
|                       Authoritative systemd daemon state (`active`/`inactive`/  |
|                       `failed`).                                                |
|                                                                                 |
| [ 3. Port Layer ]     shadowsocks_service_status                                |
|                       Authoritative local TCP listener probe on proxy port      |
|                       (`listening`/`closed`/`error`).                           |
+---------------------------------------------------------------------------------+
```

- **Health Rule**: A down Shadowsocks service does **NOT** mean the host is offline.
- **UI State Derivation**:
  - `ONLINE`: Fresh metrics received ($\le 30\text{s}$), `proxy_service_status == "active"`, and `shadowsocks_service_status == "listening"`.
  - `DEGRADED`: `host_status == "ONLINE"` (fresh report $\le 30\text{s}$), but `proxy_service_status != "active"` or `shadowsocks_service_status != "listening"`.
  - `STALE`: No fresh report received from the VPS agent for $> 30\text{ seconds}$.
  - `UNKNOWN`: Initial state, uninitialized snapshot, or probe collection failure.
  - `OFFLINE`: Confirmed host unreachability (or prolonged staleness beyond offline threshold $\ge 300\text{s}$ with independent corroboration). Stale metrics must not be prematurely reported as OFFLINE.

---

### 3.2 Ping Target Authority & ICMP Failure Semantics
Ping targets must be explicitly configured and bounded. Wildcards such as `gs*.pso2.jp / JP IX` are prohibited in executable contracts.

```text
PING MEASUREMENT ARCHITECTURE:
- PING_ORIGIN:             JAPAN_VPS (Monitoring Daemon)
- PING_TARGET_AUTHORITY:   CONFIGURED_UPSTREAM_MONITOR_TARGET (Managed server-side via VPS env config)
- RECOMMENDED UI LABEL:    "VPS → Upstream" (or "VPS → PSO2 JP" if target is configured to a known PSO2 JP endpoint)
```

#### ICMP Failure & Probe Semantics:
- ICMP packets may be dropped or filtered by intermediate firewalls even when proxy and game TCP services are fully functional.
- **Invariant**: Ping probe failure $\ne$ server offline; ping probe failure $\ne$ PSO2 offline.
- Explicit probe states:
  ```text
  PING_STATUS = AVAILABLE | TIMEOUT | UNSUPPORTED | UNKNOWN
  ```
- If ICMP is blocked in an environment, T4B may optionally configure a bounded TCP connect probe against the upstream target. Packet-loss or ICMP timeout must never mark the server down.

---

### 3.3 Packet Loss Semantics
- **Origin**: Japan VPS monitoring daemon.
- **Target**: `CONFIGURED_UPSTREAM_MONITOR_TARGET`.
- **Measurement Policy**: Send small bursts (5 ICMP echo requests) every 30 seconds with a 1000ms timeout per packet.
- **Calculation**: $\text{loss\_percent} = \frac{\text{lost\_packets}}{\text{total\_packets}} \times 100\%$.
- **Protection**: High-frequency ICMP flooding is strictly forbidden to prevent network throttling or upstream firewall blocking.

---

### 3.4 Server Network RX/TX & Speed Calculation
Server network throughput must represent actual VPS infrastructure traffic:

- **Data Layer**: Whole VPS network interface (`SERVER_RX_TX_LAYER = WHOLE_VPS_INTERFACE`).
- **Interface Selection**: `SERVER_RX_TX_INTERFACE_SELECTION = CONFIGURED_OR_DEFAULT_ROUTE_INTERFACE` (Discovered via default route inspection or configured in `/etc/neko/server-agent.env`, defaulting to `eth0` with dynamic fallback).
- **Accounting Method**: Read raw 64-bit byte counters from `/proc/net/dev` or `/sys/class/net/<interface>/statistics/`.
- **Instantaneous Bandwidth Formula**:
  $$\text{rx\_bps} = \max\left(0, \frac{\text{current\_rx\_bytes} - \text{prev\_rx\_bytes}}{\text{current\_timestamp} - \text{prev\_timestamp}}\right) \times 8$$
  $$\text{tx\_bps} = \max\left(0, \frac{\text{current\_tx\_bytes} - \text{prev\_tx\_bytes}}{\text{current\_timestamp} - \text{prev\_timestamp}}\right) \times 8$$
- **Reboot & Counter Reset Handling**: If $\text{current\_bytes} < \text{prev\_bytes}$, the agent treats the counter as reset (due to server reboot or interface restart), sets rates to `0 bps`, and re-anchors the baseline.

> [!WARNING]
> Summing client-reported `rx_bytes` / `tx_bytes` from desktop Launchers to derive server traffic is **STRICTLY PROHIBITED**. Server transfer totals must originate exclusively from the VPS interface.

---

### 3.5 Server Uptime
- **Primary Dashboard Uptime**: VPS Host Uptime (derived from system `/proc/uptime`).
- **Secondary Metric (Optional)**: Proxy daemon service uptime (derived from `systemctl show shadowsocks --property=ActiveEnterTimestamp`).

---

## 4. Heartbeat Freshness Authority & Active User Semantics

### 4.1 Exact Heartbeat Freshness Authority Mapping
The repository defines four distinct, non-conflicting timing constants across the stack. Each has a specific, authoritative purpose:

```text
+------------------------------------+------------+-----------------------------------------------------------+
| Timing Rule                        | Value      | Exact Codebase Authority / Source File                    |
+------------------------------------+------------+-----------------------------------------------------------+
| HEARTBEAT_WRITE_INTERVAL           | 30 seconds | `launcher/src/neko_launcher/ui/app_window.py`             |
|                                    | (30,000ms) | `HEARTBEAT_INTERVAL_MS = 30_000` (Launcher push cadence)   |
|                                    |            |                                                           |
| SESSION_HEARTBEAT_ACCEPTANCE_RULE  | 90 seconds | `supabase/migrations/20260813120000_*.sql`                |
| (DB Staleness Invalidation Limit)  |            | `launcher.heartbeat_session`: `last_seen_at > now() - 90s`|
|                                    |            | `launcher.authorize_launch_permit`: `HeartbeatStale`      |
|                                    |            |                                                           |
| ADMIN_ONLINE_FRESHNESS_RULE        | 120 seconds| `server/dashboard.mjs:2`                                  |
| (UI Overview Reporting Tolerance)  | (120,000ms)| `RECENT_ONLINE_WINDOW_MS = 2 * 60 * 1000`                  |
|                                    |            | `standalone/src/sections/render.js:37`                    |
|                                    |            |                                                           |
| ACTIVE_USER_COUNT_FRESHNESS_RULE   | 120 seconds| `server/dashboard.mjs:36-66`                              |
| (Overview KPI Aggregation Filter)  |            | `hasFreshHeartbeat`: `last_seen_at >= now - 120s`         |
+------------------------------------+------------+-----------------------------------------------------------+
```

#### Why 90s and 120s Both Exist (Authority Resolution):
- **90 seconds** is the **strict Database RPC enforcement window**. A client that misses 3 consecutive 30s heartbeats is rejected from refreshing its session in PostgreSQL (`launcher.heartbeat_session`).
- **120 seconds** is the **Admin Dashboard UI aggregation window** (`RECENT_ONLINE_WINDOW_MS`). It provides a small reporting tolerance for network transit time and serverless query execution without premature UI flicker.
- `HEARTBEAT_AUTHORITY_AMBIGUOUS = NO`

---

### 4.2 Active User Exact Semantics
Active user counts are divided into two distinct metrics to avoid conflating session presence with license entitlement:

```text
1. ONLINE_SESSION_COUNT (Raw Active Sessions):
   - Predicate 1: `launcher_sessions.revoked_at IS NULL`
   - Predicate 2: `launcher_sessions.last_seen_at >= now() - interval '120 seconds'`
   - Source: `server/dashboard.mjs` (`summarizeCurrentSessions.recentlyOnline`)

2. ENTITLED_ACTIVE_USER_COUNT (Active Users with Valid Entitlement):
   - Predicate 1: `launcher_sessions.revoked_at IS NULL`
   - Predicate 2: `launcher_sessions.last_seen_at >= now() - interval '120 seconds'`
   - Predicate 3: Session is bound to an active license for product 'neko-family-proxy'
                  (`licenses.status = 'active'` AND `valid_from <= now()` AND `valid_until > now()`)
   - Source: `server/dashboard.mjs` (`countRecentlyOnlineSessions`)
```

- **Entitlement Rule**: `ENTITLEMENT_PART_OF_ONLINE_COUNT = NO` (Raw session presence is tracked independently from license entitlement).
- `ACTIVE_USER_SOURCE_CLASS = SESSION_AUTHORITY`

```text
FORBIDDEN METHODS FOR COUNTING ACTIVE USERS:
❌ Counting active TCP connections on Japan VPS
❌ Counting Shadowsocks connected sockets / file descriptors
❌ Counting Core telemetry named pipe clients
❌ Counting raw network flows or netfilter state entries
```

---

## 5. Privacy Boundary & Admin Web Session Fields

### 5.1 Web-Visible Session Contract
To prevent client tracking and maintain privacy invariants, device details and hardware identifiers are removed from the T4 monitoring and session dashboard contract:

```text
ALLOWED WEB SESSION FIELDS:
- user_id                  (Account identifier)
- username / email         (Admin identity display)
- session_id               (Unique session reference)
- created_at               (Session login / claim timestamp)
- last_seen_at             (Last successful heartbeat timestamp)
- revoked_at               (Session revocation timestamp / null if active)
- license_id               (Bound license reference)
```

```text
STRICTLY EXCLUDED FROM WEB SESSION CONTRACT:
❌ device / device name
❌ machine ID / hardware ID
❌ installation key hash / installation fingerprint
❌ client OS details
❌ client process names / PIDs
```

- `WEB_DEVICE_DETAIL = NOT_EXPOSED`

---

## 6. Session Administration Semantics (Kick & Revoke)

The Admin Web exercises **Session Authority**, not **Machine Control**.

```text
ADMIN REVOKE / KICK LIFECYCLE:

[ Admin Web ]
     │
     ▼ (POST /api/admin { action: "revoke_session", sessionId })
[ Backend API ]
     │
     ▼ (Calls `launcher.admin_revoke_session(actor_id, session_id)`)
[ PostgreSQL Database ]
     │
     ├─► Sets `launcher_sessions.revoked_at = now()`
     └─► Records `audit_events` row: { event_type: "admin_revoke_session", ... }
     │
     ▼
[ Next Launcher Heartbeat (~30s) / Next Core Token Check ]
     │
     ├─► `launcher.heartbeat_session` returns `FALSE`
     ├─► Launcher observes session revocation
     ├─► Launcher gracefully stops local Core proxy engine
     └─► Launcher transitions UI to unauthenticated / logged out state
```

### Strict Prohibition on Machine-Level Commands:
Under no circumstances may the Admin Web or Backend issue:
- Remote `KILL_PROCESS` (e.g. `taskkill /f /im pso2.exe` or `kill NekoProxyCore`)
- Remote shell execution / script injection
- Process tree inspection or memory capture

---

## 7. Server Monitoring Agent Architecture

### 7.1 Push Architecture
The Japan VPS agent periodically pushes metrics via HTTPS POST to the Backend Ingest API.

| Criteria | Push Model (Authoritative) |
|---|---|
| **VPS Attack Surface** | Inbound ports remain 100% closed (Zero open HTTP ports on VPS) |
| **Serverless Compatibility** | Fully compatible with Vercel / Edge Functions |
| **Firewall / NAT** | Outbound HTTPS only (443) |
| **Failure Mode** | VPS stops pushing -> Backend detects stale snapshot |

---

### 7.2 Trust Boundary & Agent Authentication
1. **Authentication Mechanism**: The VPS agent authenticates to the Backend Ingest API using a dedicated high-entropy secret token passed via HTTP header:
   ```http
   POST /api/server/metrics/ingest
   Authorization: Bearer <SERVER_METRICS_INGEST_SECRET>
   Content-Type: application/json
   ```
2. **Secret Storage**:
   - On VPS: Stored in root-owned environment file `/etc/neko/server-agent.env` (`chmod 600`).
   - On Backend (Vercel): Stored as encrypted environment variable `SERVER_METRICS_INGEST_SECRET`.
3. **Trust Rules**:
   - The Server Agent is **NOT** a user client and never uses user JWTs.
   - The Server Agent has **NO** access to Supabase service-role keys.
   - The Browser / Admin Web frontend bundle **NEVER** receives the ingest secret (`WEB_HAS_SERVER_INGEST_SECRET = NO`).
   - Do NOT reuse Supabase service-role keys, user JWTs, Launcher tokens, permit keys, or Shadowsocks passwords.

---

### 7.3 Metrics Storage Authority

#### DEPLOYED IN PRODUCTION (T4B/T5/T6):
- **Storage Model**: `SERVER_METRICS_STORAGE_MODEL = LATEST_AND_HISTORY`
- **Storage Authority**:
  - Current state: `public.server_metrics_latest` (Preserved for instant status evaluation, host health ONLINE/DEGRADED/STALE, and liveness).
  - Historical state: `public.server_metrics_history` (Additive composite-key time-series table, 7-day rolling retention pruned hourly via `pg_cron`, query-time downsampling for 1h, 24h, and 7d).
- **Stateless Ingest Invariant**: Process memory in serverless functions (Vercel) is ephemeral and not durable across requests; therefore, authoritative metrics state is persisted in PostgreSQL database tables via atomic RPC `launcher.store_server_metrics_sample`.
- **Staleness Cadence**:
  - Push Cadence: 5s – 10s
  - Stale Threshold: 30s ($> 30\text{s}$ without report $\rightarrow$ `is_stale = true`, `host_status = STALE`)
- **Detailed Specification & Verification**: See [docs/architecture/historical-server-metrics.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/historical-server-metrics.md) and [docs/current/historical-server-metrics-production-proof.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-production-proof.md).

---

## 8. Data Schemas & API Contracts

### 8.1 Agent Ingest Request Contract (VPS Agent -> Backend)

```json
{
  "observed_at": "2026-08-18T08:00:00.000Z",
  "host_uptime_seconds": 1204850,
  "proxy_service_status": "active",
  "shadowsocks_service_status": "listening",
  "upstream_ping_ms": 12.4,
  "upstream_ping_status": "AVAILABLE",
  "upstream_packet_loss_percent": 0.0,
  "rx_bytes_total": 48291048291,
  "tx_bytes_total": 51928491028,
  "rx_bps": 15420000,
  "tx_bps": 16800000,
  "cpu_percent": 8.5,
  "memory_percent": 24.1
}
```

---

### 8.2 Sanitized Web Monitoring Response Contract (Backend -> Admin Web)

```json
{
  "ok": true,
  "server": {
    "host_status": "ONLINE",
    "proxy_service_status": "active",
    "shadowsocks_service_status": "listening",
    "is_stale": false,
    "observed_at": "2026-08-18T08:00:00.000Z",
    "uptime_seconds": 1204850,
    "ping_ms": 12.4,
    "ping_status": "AVAILABLE",
    "ping_target_label": "VPS → Upstream",
    "packet_loss_percent": 0.0,
    "rx_bytes_total": 48291048291,
    "tx_bytes_total": 51928491028,
    "rx_bps": 15420000,
    "tx_bps": 16800000,
    "online_session_count": 18,
    "entitled_active_user_count": 16
  }
}
```

---

## 9. Comprehensive Prohibited Client Data Boundary

Under **NO circumstances** may any backend endpoint, table, log, or Web UI receive, store, or display:

```text
=============================================================================
STRICTLY FORBIDDEN CLIENT / CORE DATA IN BACKEND & ADMIN WEB
=============================================================================
❌ Process Metadata:       Core PID, Game PID (pso2.exe), v2ray PID, helper handles
❌ Local Network Ports:    Local SOCKS5 port (127.0.0.1:2801), local pipe handles
❌ Client Traffic Totals:  Client Core rx_bytes / tx_bytes, client RX/TX rates
❌ Client Connection Data: tcp_active, tcp_connect_total, tcp_closed_total
❌ Client DNS Data:        dns_query_total, dns_failure_total, DNS query contents
❌ Flow & Destination:     Destination IPs, destination hostnames, connection history
❌ Game Server Targets:    Specific PSO2 ship IP addresses contacted by user
❌ Packet Content:         Raw packet payloads, stream buffers, PCAP dumps
❌ Diagnostics & Logs:     Core internal trace logs, memory dumps, stack traces
❌ Security Material:      Shadowsocks passwords, JWT tokens, Permits, private keys
❌ Client Hardware Data:   Device serials, machine IDs, hardware hashes, MAC addresses
=============================================================================
```

- `CLIENT_TELEMETRY_FIELDS_ACCEPTED_BY_SERVER_API = NONE`
- `CLIENT_CORE_TELEMETRY_USED = NO`
- `CLIENT_LAUNCHER_TELEMETRY_USED = NO`

---

## 10. Phase T4 Implementation Ownership Split

```text
+---------------------+-------------------------------------------------------------+
| Team / Role         | T4B Implementation Responsibilities                         |
+---------------------+-------------------------------------------------------------+
| TEAM_WEB            | - Server metrics ingest API endpoint (/api/server/metrics)  |
|                     | - Snapshot store & staleness validation logic               |
|                     | - Admin Web server health UI panel rendering                |
|                     | - Active user aggregation from `launcher_sessions`          |
|                     | - Admin session revoke/kick action handlers                 |
+---------------------+-------------------------------------------------------------+
| INFRASTRUCTURE      | - Lightweight Python/Go daemon for Japan VPS                |
| EXECUTION           | - Systemd service unit (`neko-server-monitor.service`)      |
|                     | - Ingest secret provisioning & secure environment file      |
+---------------------+-------------------------------------------------------------+
| TEAM_COORDINATION   | - Architecture governance & privacy regression validation   |
|                     | - Cross-repository contract consistency                     |
+---------------------+-------------------------------------------------------------+
| TEAM_CORE           | NO ACTION — Local telemetry frozen at Phase T2              |
+---------------------+-------------------------------------------------------------+
| TEAM_LAUNCHER       | NO ACTION — Local consumer frozen at Phase T3               |
+---------------------+-------------------------------------------------------------+
```

---

## 11. Automated Test Matrix for Future Phase T4B

When implementation begins in Phase T4B, the following test suites must be developed and validated:

1. **Server Monitoring Agent Tests**:
   - Network byte counter delta calculation and rate derivation.
   - Dynamic interface fallback (`eth0` vs default route).
   - Counter reset / reboot handling without negative rates.
   - Systemd service status and local port listener probing.
   - ICMP ping sampling and packet loss rate calculation with `PING_STATUS` fallback.
   - Ingest secret inclusion and payload schema conformance.
2. **Backend / API Tests**:
   - Ingest authentication (valid secret passes, invalid secret returns `401`).
   - Rate limiting and input sanitization on ingest endpoint.
   - Snapshot staleness detection ($> 30\text{s}$ returns `is_stale: true`, `host_status: "STALE"`).
   - Active user query correctness (filtering by `revoked_at IS NULL` and $120\text{s}$ heartbeat).
   - Separate verification of `online_session_count` and `entitled_active_user_count`.
   - Rejection of payloads containing client telemetry.
3. **Admin Web UI Tests**:
   - Server health panel rendering (ONLINE, DEGRADED, STALE, UNKNOWN, OFFLINE).
   - Verification that ping failure does not mark server offline.
   - Correct formatting of speeds (Kbps, Mbps, Gbps) and uptime (days, hours, minutes).
   - Session list display without `device` or machine fingerprint columns.
   - Session revoke button action triggers.
4. **Privacy Regression Gate**:
   - Explicit negative tests asserting backend rejects payloads containing `core_pid`, `client_rx_bytes`, `pso2_pid`, `device_id`, or destination IPs.

---

## 12. Conclusion & Phase Gate Sign-Off

Phase T4A establishes a strict, unambiguous boundary ensuring that:
- Server monitoring represents genuine Japan VPS aggregate infrastructure.
- User session liveness derives strictly from authentication session heartbeat freshness.
- User machine privacy remains 100% safeguarded against surveillance.
