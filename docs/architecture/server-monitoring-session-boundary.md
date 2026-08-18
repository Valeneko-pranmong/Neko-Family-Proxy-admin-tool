# NEKO FAMILY PROXY — SERVER MONITORING & SESSION AUTHORITY CONTRACT
# Server-Side Aggregate Observability, Session Authority & Privacy Boundary

```text
DOCUMENT:               docs/architecture/server-monitoring-session-boundary.md
STATUS:                 DESIGN_FROZEN (T4A Contract)
CLASSIFICATION:         HARD ARCHITECTURE INVARIANT & CONTRACT
OWNER:                  TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
CONSUMERS:              ADMIN WEB, BACKEND API, SERVER INFRASTRUCTURE
CORE / LAUNCHER SCOPE:  NO ACTION — READ-ONLY REFERENCE ONLY
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

### Two Independent Data Authorities:
The Admin Web is powered by two distinct, decoupled authority channels:
1. **Server Aggregate Channel**: Originates strictly on the **Japan VPS** via a dedicated server monitoring daemon, reporting fleet-level infrastructure and proxy service health.
2. **User Session Authority Channel**: Originates in the **Auth / Database Backend (Supabase)**, tracking user sessions, licenses, and heartbeat liveness.

```text
+-------------------------------------------------------------------------------+
|                            TWO INDEPENDENT CHANNELS                           |
+-------------------------------------------------------------------------------+
|                                                                               |
|  [ CHANNEL 1: SERVER AGGREGATE ]                                              |
|  Japan VPS (Host & SS Service)                                                |
|       │                                                                       |
|       ▼ (Outbound HTTPS Push with Ingest Secret)                              |
|  Backend Ingest API -> Stored Snapshot (Latest Only)                          |
|       │                                                                       |
|       ▼ (Admin Query API)                                                     |
|  Admin Web Dashboard [ Server Health Panel ]                                  |
|                                                                               |
|  ───────────────────────────────────────────────────────────────────────────  |
|                                                                               |
|  [ CHANNEL 2: SESSION AUTHORITY ]                                             |
|  Launcher Client                                                              |
|       │                                                                       |
|       ▼ (Minimal Heartbeat: session_id every 30s)                             |
|  Supabase `launcher_sessions` Table (Heartbeat Freshness <= 120s)             |
|       │                                                                       |
|       ▼ (Admin Overview / Session Query)                                      |
|  Admin Web Dashboard [ Active Users & Session Management Panel ]              |
|                                                                               |
+-------------------------------------------------------------------------------+
```

---

## 2. Metric Source & Semantics Mapping Matrix

Every field presented on the Admin Web dashboard is mapped to an authoritative origin, collection mechanism, and privacy classification:

| Metric | Authoritative Source | Collection Method | Sampling / Push Cadence | Storage Required | Web Display Scope | Privacy Class |
|---|---|---|---|---|---|---|
| `server_online` | Japan VPS Monitoring Agent | Agent heartbeat / push to Ingest API | 5s – 10s | Latest Snapshot | Host reachability indicator | `SERVER_AGGREGATE` |
| `server_ping_ms` | Japan VPS -> PSO2 JP Upstream | Low-frequency ICMP / TCP ping from VPS | 15s – 30s | Latest Snapshot | VPS to Upstream Latency | `SERVER_AGGREGATE` |
| `server_packet_loss_percent` | Japan VPS -> PSO2 JP Upstream | Sampled ICMP ping bursts (5 pkts) | 30s | Latest Snapshot | Upstream packet loss % | `SERVER_AGGREGATE` |
| `server_rx_bytes_total` | Japan VPS Interface (`eth0`) | `/proc/net/dev` or `/sys/class/net` | 5s – 10s | Latest Snapshot | VPS Total Bytes Received | `SERVER_AGGREGATE` |
| `server_tx_bytes_total` | Japan VPS Interface (`eth0`) | `/proc/net/dev` or `/sys/class/net` | 5s – 10s | Latest Snapshot | VPS Total Bytes Sent | `SERVER_AGGREGATE` |
| `server_rx_bps` | Japan VPS Monitoring Agent | Rate delta: $\Delta \text{rx\_bytes} / \Delta t$ | 5s – 10s | Latest Snapshot | VPS Download Speed | `SERVER_AGGREGATE` |
| `server_tx_bps` | Japan VPS Monitoring Agent | Rate delta: $\Delta \text{tx\_bytes} / \Delta t$ | 5s – 10s | Latest Snapshot | VPS Upload Speed | `SERVER_AGGREGATE` |
| `server_uptime_seconds` | Japan VPS Host Kernel | `/proc/uptime` | 10s – 30s | Latest Snapshot | VPS Host Uptime | `SERVER_AGGREGATE` |
| `proxy_service_status` | Japan VPS Systemd Manager | `systemctl is-active shadowsocks` | 5s – 10s | Latest Snapshot | Daemon process status | `SERVER_AGGREGATE` |
| `shadowsocks_service_status` | Japan VPS Local Listener | Local TCP socket probe (`127.0.0.1:<port>`) | 5s – 10s | Latest Snapshot | Service listening health | `SERVER_AGGREGATE` |
| `active_user_count` | Supabase `launcher_sessions` | Count unrevoked sessions with fresh heartbeat | On Admin Request (Cached) | Existing DB Table | Fleet Active Users | `SESSION_AUTHORITY` |
| `server_cpu_percent` (Optional) | Japan VPS Kernel | `/proc/stat` delta | 10s | Latest Snapshot | VPS CPU Load % | `SERVER_AGGREGATE` |
| `server_memory_percent` (Optional) | Japan VPS Kernel | `/proc/meminfo` | 10s | Latest Snapshot | VPS RAM Usage % | `SERVER_AGGREGATE` |

---

## 3. Detailed Metric Semantics & Boundary Rules

### 3.1 Server Online Semantics
`server_online` must not be conflated across different architectural components. The system defines a three-tier health hierarchy:

```text
[ Host Layer ]       host_online                 VPS kernel responds and agent pushes data
         │
         ▼
[ Process Layer ]    proxy_service_status        Shadowsocks systemd service is active/running
         │
         ▼
[ Port Layer ]       shadowsocks_service_status  Local proxy port is listening and accepting connections
```

- **Degraded State**: If `host_online == True` but `proxy_service_status != "running"`, the dashboard displays `Degraded (Service Down)`.
- **Offline State**: If no metrics have been received from the VPS agent for $\ge 30\text{ seconds}$, the entire server status transitions to `Offline / Stale`.

---

### 3.2 Ping & Latency Semantics
Latency metrics must be explicitly defined and truthfully labeled.

```text
THREE DISTINCT LATENCY MEASUREMENTS:

1. Client (Thailand) ──(Game Traffic)──> Japan VPS
   - Scope: Layer 2 Local Diagnostics ONLY
   - Origin: Desktop Launcher
   - Target: Japan VPS Shadowsocks endpoint
   - Boundary: NEVER uploaded to Backend; visible ONLY on local user's screen.

2. Japan VPS ──(Health Probe)──> PSO2 JP Upstream (e.g., gs*.pso2.jp / JP IX)
   - Scope: Layer 3 Server Aggregate Monitoring
   - Origin: Japan VPS Server Agent
   - Target: Japanese game server upstream / Tokyo gateway
   - Boundary: Uploaded by Server Agent; displayed on Admin Web.
   - Recommended UI Label: "VPS → PSO2 Upstream Latency (ms)"

3. Admin Backend (Vercel) ──(API Probe)──> Japan VPS
   - Scope: Optional Backend Infrastructure Diagnostic
   - Origin: Vercel serverless function
   - Target: Japan VPS public endpoint
   - Boundary: Internal operational check.
   - Recommended UI Label: "Backend → VPS Latency (ms)"
```

> [!CRITICAL]
> The Admin Web MUST NOT label Japan VPS upstream latency as "User Ping". A monitoring agent located in Japan cannot honestly measure Thailand-to-Japan client latency.

---

### 3.3 Packet Loss Semantics
- **Origin**: Japan VPS monitoring daemon.
- **Target**: Upstream gateway / Japanese upstream DNS or IX endpoint.
- **Measurement Policy**: Send small bursts (5 ICMP echo requests) every 30 seconds with a 1000ms timeout per packet.
- **Calculation**: $\text{loss\_percent} = \frac{\text{lost\_packets}}{\text{total\_packets}} \times 100\%$.
- **Protection**: High-frequency ICMP flooding is strictly forbidden to avoid network throttling or upstream firewall blocks.

---

### 3.4 Server Network RX/TX & Speed Calculation
Server network throughput must represent actual VPS infrastructure traffic:

- **Data Layer**: Whole VPS network interface (`eth0` / primary public interface).
- **Accounting Method**: Read raw 64-bit byte counters from `/proc/net/dev` or `/sys/class/net/eth0/statistics/`.
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

## 4. Active User Count & Session Authority

### 4.1 Authoritative Active User Definition
The metric `active_user_count` represents verified user session liveness from authentication authority.

```text
ACTIVE USER RULE:
An active user is defined as an account having:
1. An unrevoked row in `public.launcher_sessions` (`revoked_at IS NULL`), AND
2. A recent heartbeat timestamp (`last_seen_at >= now() - interval '120 seconds'`), AND
3. An active, unexpired license for 'neko-family-proxy'.
```

```text
FORBIDDEN METHODS FOR COUNTING ACTIVE USERS:
❌ Counting active TCP connections on Japan VPS
❌ Counting Shadowsocks connected sockets / file descriptors
❌ Counting Core telemetry named pipe clients
❌ Counting raw network flows or netfilter state entries
```

### 4.2 Heartbeat Freshness Policy
- **Launcher Heartbeat Cadence**: Launcher sends heartbeat every `30 seconds` (`HEARTBEAT_INTERVAL_MS = 30_000`).
- **Database Freshness Rule**: `launcher.heartbeat_session` requires `s.last_seen_at > now() - interval '90 seconds'` to update.
- **Admin Web Dashboard Threshold**: `RECENT_ONLINE_WINDOW_MS = 120_000` (2 minutes). A session without a heartbeat for $> 120\text{s}$ is marked offline in overview KPIs.

---

## 5. Session Administration Semantics (Kick & Revoke)

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

## 6. Server Monitoring Agent Architecture

### 6.1 Push vs Pull Architecture Decision

```text
EVALUATION:
Option A (Push Model): VPS Agent periodically pushes HTTPS POST to Backend API.
Option B (Pull Model): Backend API periodically polls VPS HTTP endpoint.

DECISION:
Option A (PUSH MODEL) is selected for V1.
```

| Criteria | Push Model (Recommended) | Pull Model (Rejected) |
|---|---|---|
| **VPS Attack Surface** | Inbound ports remain 100% closed (Zero open HTTP ports) | Requires public HTTP port or reverse tunnel on VPS |
| **Serverless Compatibility** | Fully compatible with Vercel / Edge Functions | Vercel cannot run background polling cron continuously |
| **Firewall / NAT** | Outbound HTTPS only (443) | Requires firewall rules, dynamic DNS, or static IP allowlists |
| **Failure Mode** | VPS stops pushing -> Backend detects stale snapshot | Polling timeout delays admin page loads |

---

### 6.2 Trust Boundary & Agent Authentication

1. **Authentication Mechanism**: The VPS agent authenticates to the Backend Ingest API using a dedicated high-entropy secret token passed via HTTP header:
   ```http
   POST /api/server/metrics/ingest
   Authorization: Bearer <SERVER_INGEST_KEY>
   Content-Type: application/json
   ```
2. **Secret Storage**:
   - On VPS: Stored in root-owned environment file `/etc/neko/server-agent.env` (`chmod 600`).
   - On Backend (Vercel): Stored as encrypted environment variable `SERVER_METRICS_INGEST_SECRET`.
3. **Trust Rules**:
   - The Server Agent is **NOT** a user client and never uses user JWTs.
   - The Server Agent has **NO** access to Supabase service-role keys.
   - The Browser / Admin Web has **NO** access to the VPS SSH credentials or the Server Ingest Key.

---

### 6.3 Sampling Cadence, Staleness & Storage Model

```text
CADENCE & RETENTION POLICIES:

- Agent Sample & Push Frequency:   5.0s – 10.0s
- Backend Stale Threshold:         30.0s
- Storage Model for V1:            LATEST_ONLY (Single-row snapshot in DB or in-memory cache)
```

- **Stale Transition**: If $\text{now} - \text{snapshot.observed\_at} > 30\text{s}$, the API returns `status: "stale"` and the Admin Web displays a warning banner ("Server metrics stale — last seen X seconds ago").

---

## 7. Data Schemas & API Contracts

### 7.1 Agent Ingest Request Contract (VPS Agent -> Backend)

```json
{
  "observed_at": "2026-08-18T08:00:00.000Z",
  "host_uptime_seconds": 1204850,
  "service_status": "running",
  "port_listening": true,
  "upstream_ping_ms": 12.4,
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

### 7.2 Sanitized Web Monitoring Response Contract (Backend -> Admin Web)

```json
{
  "ok": true,
  "server": {
    "status": "healthy",
    "is_stale": false,
    "observed_at": "2026-08-18T08:00:00.000Z",
    "uptime_seconds": 1204850,
    "ping_ms": 12.4,
    "ping_target": "upstream_pso2_jp",
    "packet_loss_percent": 0.0,
    "rx_bytes_total": 48291048291,
    "tx_bytes_total": 51928491028,
    "rx_bps": 15420000,
    "tx_bps": 16800000,
    "proxy_service_status": "active",
    "shadowsocks_port_status": "listening",
    "active_users": 18
  }
}
```

---

## 8. Comprehensive Prohibited Client Data Boundary

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
=============================================================================
```

---

## 9. Security & Access Control (RLS) Review

1. **Admin Web Authorization**:
   - Access to server monitoring and session management is strictly protected by signed HttpOnly SameSite=Strict `admin_session` cookies.
   - Admin identity and active status are verified against `public.profiles` on every API request.
2. **Server Ingest Endpoint Protection**:
   - Protected by `SERVER_METRICS_INGEST_SECRET`.
   - Rate-limited to max 1 request per 3 seconds per IP.
   - Reject any payload containing unauthorized or unrecognized client telemetry fields.
3. **PostgreSQL RLS Invariant**:
   - Tables `launcher_sessions` and `audit_events` remain inaccessible to anonymous or unauthenticated public users.
   - Session revocation requires authenticated admin actor ID recorded in immutable audit logs.

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
   - Counter reset / reboot handling without negative rates.
   - Systemd service status parsing.
   - ICMP ping sampling and packet loss rate calculation.
   - Ingest secret inclusion and payload schema conformance.
2. **Backend / API Tests**:
   - Ingest authentication (valid secret passes, invalid secret returns `401`).
   - Rate limiting and input sanitization on ingest endpoint.
   - Snapshot staleness detection ($> 30\text{s}$ returns `stale: true`).
   - Active user query correctness (filtering by `revoked_at IS NULL` and $120\text{s}$ heartbeat).
   - Admin authorization check for server metrics retrieval.
3. **Admin Web UI Tests**:
   - Server health panel rendering (Healthy, Degraded, Stale, Offline).
   - Correct formatting of speeds (Kbps, Mbps, Gbps) and uptime (days, hours, minutes).
   - Session list display and revoke button triggers.
   - Complete absence of client PID, client SOCKS port, or client DNS fields.
4. **Privacy Regression Gate**:
   - Explicit negative tests asserting backend rejects payloads containing `core_pid`, `client_rx_bytes`, `pso2_pid`, or destination IPs.

---

## 12. Conclusion & Phase Gate Sign-Off

Phase T4A establishes a strict, unambiguous boundary ensuring that:
- Server monitoring represents genuine Japan VPS aggregate infrastructure.
- User session liveness derives strictly from authentication session heartbeat freshness.
- User machine privacy remains 100% safeguarded against surveillance.
