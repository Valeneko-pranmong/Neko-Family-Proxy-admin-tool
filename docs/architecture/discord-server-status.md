# NEKO FAMILY PROXY — DISCORD SERVER STATUS & ALERTING ARCHITECTURE CONTRACT (PHASE T7)

```text
DOCUMENT:               docs/architecture/discord-server-status.md
STATUS:                 DESIGNED (Phase T7A Design & Documentation Contract Frozen)
CLASSIFICATION:         HARD ARCHITECTURE INVARIANT & CONTRACT
OWNER:                  TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
CONSUMERS:              BACKEND DISCORD WORKER / SCHEDULER, ADMIN WEB
TEAM_CORE SCOPE:        NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER SCOPE:    NO ACTION (Frozen at Phase T3)
CURRENT_DEPLOYMENT:     NOT YET DEPLOYED (Phase T7B Implementation / Phase T7C Production Proof Planned)
WEBHOOK_STATUS:         NOT YET CONFIGURED (Production Secret Pending T7C)
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Purpose

This document establishes the authoritative specification, data contracts, anti-spam state machine, privacy safeguards, and operational failure boundaries for **Phase T7 (Discord Server Status & Alerting)** in the Neko Family Proxy ecosystem.

The primary product goal is to provide operators and community moderators with an honest, real-time, zero-spam operational window into the Japan VPS proxy infrastructure via a dedicated Discord channel:

```text
+-------------------------------------------------------------------------------+
|                       PHASE T7 ARCHITECTURAL GOAL                             |
+-------------------------------------------------------------------------------+
| 1. Persistent Operational Status: One pinned/editable message updated every   |
|    ~60 seconds displaying aggregate health, bandwidth, latency, and sessions. |
|                                                                               |
| 2. Discrete State Transition Alerts: Standalone notification messages sent    |
|    ONLY when the server health state meaningfully transitions (e.g. ONLINE to |
|    DEGRADED/STALE, or upon RECOVERY).                                         |
|                                                                               |
| 3. Strict Zero-Spam / Anti-Flap: Alert deduplication and multi-sample         |
|    confirmation ensure Discord channels remain clean and actionable.          |
+-------------------------------------------------------------------------------+
```

---

## 2. Non-Goals & Strict Exclusions

Phase T7 explicitly excludes the following capabilities:

1. **No Client/Player Telemetry in Discord**: Zero client metrics, process names (`pso2.exe`), local SOCKS data, packet flows, DNS lookups, or user identities are ever delivered to Discord.
2. **No Interactive Bot Commands / Gateway Socket**: V1 is strictly outbound unidirectional HTTP webhook publishing; it does not connect to the Discord Gateway websocket or run an interactive bot daemon.
3. **No Mass Mentions**: V1 alerts will **NEVER** use `@everyone` or `@here` mentions (`MASS_MENTION = NO`).
4. **No Direct VPS-to-Discord Webhook Calling**: The Japan VPS monitoring agent never talks directly to Discord; the integration runs exclusively through the trusted Backend serverless/scheduled worker.
5. **No Browser/Admin UI Dependency**: Status publishing and alerting run completely autonomously in the backend without requiring any admin browser session to remain open.

---

## 3. Data Authority & Decoupled Data Planes

The Discord integration derives all displayed metrics strictly from pre-existing, verified, and closed data authorities:

```text
+-------------------------------------------------------------------------------+
|                      DISCORD DATA INGESTION PIPELINE                          |
+-------------------------------------------------------------------------------+
|                                                                               |
|  [ SERVER AGGREGATE DATA PLANE ]                                              |
|  Japan VPS Monitoring Daemon (`neko-server-monitor.service`)                  |
|       │                                                                       |
|       ▼ (HTTPS Push every 5s with SERVER_METRICS_INGEST_SECRET)               |
|  Backend Ingest Endpoint (`/api/server/metrics/ingest`)                       |
|       │                                                                       |
|       ▼ (Atomic RPC `launcher.store_server_metrics_sample`)                   |
|  Supabase `public.server_metrics_latest` Table (Latest Snapshot Authority)    |
|       │                                                                       |
|       ├────────────────────────────────────────────────┐                      |
|       │                                                │                      |
|       ▼                                                ▼                      |
|  [ SESSION DATA PLANE ]                   [ DISCORD INTEGRATION WORKER ]      |
|  Supabase `launcher_sessions`                  (Trusted Backend / Cron)       |
|  (unrevoked + last_seen_at <= 120s)                    │                      |
|       │                                                │                      |
|       └───────────────────────────────────────────────►│                      |
|                                                        ▼ (HTTPS POST / PATCH) |
|                                                   Discord Webhook             |
|                                                                               |
+-------------------------------------------------------------------------------+
```

### 3.1 Frozen Authority Mapping Table

| Metric Field in Discord | Authoritative Source | Freshness & Authority Rule |
| :--- | :--- | :--- |
| **Status State** | `public.server_metrics_latest` | Evaluated against `observed_at` ($> 30\text{s} \rightarrow \text{STALE}$) and service health. |
| **Ping Latency (`ping_ms`)** | `public.server_metrics_latest.upstream_ping_ms` | Japan VPS to configured upstream target. |
| **Packet Loss (`packet_loss_percent`)** | `public.server_metrics_latest.upstream_packet_loss_percent` | 5-packet burst loss rate from Japan VPS. |
| **Ping Target Label** | `CONFIGURED_UPSTREAM_MONITOR_TARGET` | **MUST BE**: `VPS → Upstream` (Frozen label authority). |
| **Download Speed** | `public.server_metrics_latest.rx_bps` | Interface delta bits/sec ($\Delta \text{rx\_bytes} / \Delta t \times 8$). |
| **Upload Speed** | `public.server_metrics_latest.tx_bps` | Interface delta bits/sec ($\Delta \text{tx\_bytes} / \Delta t \times 8$). |
| **RX Total Bytes** | `public.server_metrics_latest.rx_bytes_total` | Total network interface cumulative bytes received. |
| **TX Total Bytes** | `public.server_metrics_latest.tx_bytes_total` | Total network interface cumulative bytes sent. |
| **Host Uptime** | `public.server_metrics_latest.host_uptime_seconds` | System `/proc/uptime` on Japan VPS. Label: `Host Uptime`. |
| **Shadowsocks Daemon** | `public.server_metrics_latest.proxy_service_status` | Systemd unit state (`active` vs `inactive`/`failed`). |
| **Shadowsocks Listener** | `public.server_metrics_latest.shadowsocks_service_status` | Local TCP listener state (`listening` vs `closed`/`error`). |
| **Active Users** | `public.launcher_sessions` | Aggregate integer: `revoked_at IS NULL` AND `last_seen_at >= now() - interval '120 seconds'`. |
| **Last Observation Age** | `public.server_metrics_latest.observed_at` | Delta from `now() - observed_at` (Never from Discord send timestamp). |

---

## 4. Privacy & Security Boundary Contract

The Discord integration is subject to strict privacy governance:

```text
=============================================================================
STRICTLY FORBIDDEN FROM DISCORD MESSAGES & EMBEDS
=============================================================================
❌ User Identifiers:      user_id, username, email, display name
❌ Session & Auth Data:   session_id, token, license_id, JWT, permit key
❌ Client Hardware Data:  machine_id, device name, hardware hashes, MAC addresses
❌ Process Details:       Core PID, Game PID (pso2.exe), v2ray PID, client handles
❌ Client Network Data:   Client RX/TX, destination IPs, DNS queries, packet buffers
❌ Proxy Secrets:         SERVER_METRICS_INGEST_SECRET, Shadowsocks passwords
=============================================================================
```

```text
DISCORD_CLIENT_DEEP_TELEMETRY = NO
DISCORD_USER_IDENTITY         = NO
DISCORD_USER_COUNT            = AGGREGATE_ONLY
ACTIVE_USER_AUTHORITY         = SESSION_ONLY
```

---

## 5. Status Model & Semantics

The Discord status integration adheres strictly to the four-tier status model defined in Phase T4A:

```text
+-------------------+-------------------------------------------------------------------+
| Status State      | Authoritative Criteria & Meaning                                  |
+-------------------+-------------------------------------------------------------------+
| 🟢 ONLINE         | Fresh snapshot (`observed_at <= 30s`), systemd daemon is `active`, |
|                   | and Shadowsocks listener is `listening`.                          |
|                   |                                                                   |
| 🟡 DEGRADED       | Fresh snapshot (`observed_at <= 30s`), BUT systemd daemon is NOT  |
|                   | `active` or Shadowsocks listener is NOT `listening`.              |
|                   |                                                                   |
| 🟠 STALE          | Latest snapshot `observed_at > 30s` (VPS daemon stopped reporting)|
|                   | Invariant: STALE != OFFLINE. Proxy reachability is not disproven. |
|                   |                                                                   |
| ⚪ UNKNOWN         | No authoritative snapshot recorded in database.                   |
+-------------------+-------------------------------------------------------------------+
```

### 5.1 Invariant: No OFFLINE Inference from Stale Monitoring
```text
DISCORD_INFERS_OFFLINE = NO
```
If Japan VPS telemetry ceases for $> 30\text{s}$, the Discord status **MUST** transition to `STALE`. It must **NEVER** state `SERVER OFFLINE` or `PROXY CRASHED` without independent reachability corroboration, because network firewalls or agent restarts can pause metrics while traffic routing continues uninterrupted.

---

## 6. Message Delivery & Presentation Architecture

### 6.1 Delivery Architecture: Option C (Persistent Status + Transition Alerts)
- **Status Delivery Model**: **OPTION C**
  - **Channel Message 1 (Pinned / Persistent)**: A single dedicated status message that is edited in-place (`PATCH /webhooks/.../messages/{message_id}`) every **60 seconds**.
  - **Channel Message 2+ (Alerts)**: Standalone messages posted (`POST /webhooks/...`) **ONLY** on confirmed state transitions or service degradations.
- **Benefits**: Eliminates Discord channel clutter and scrolling spam while providing instant push alerts when issues occur.

```text
STATUS_DELIVERY_MODEL    = OPTION_C (PERSISTENT_STATUS_EDIT + TRANSITION_ALERTS)
STATUS_REFRESH_INTERVAL  = 60 seconds
```

### 6.2 Conceptual Discord Embed Contract

#### A. Persistent Status Embed (Edited Every 60s)
```text
------------------------------------------------------------
🟩 NEKO FAMILY PROXY — SERVER STATUS
------------------------------------------------------------
Status        🟢 ONLINE
Ping          1.7 ms
Loss          0.0%

↓ VPS Speed   12.84 Mbps
↑ VPS Speed    2.11 Mbps

↓ VPS Total   522.8 MB
↑ VPS Total    84.2 MB

Active Users  12
Host Uptime   9d 14h

Shadowsocks   Active
Listener      Listening

Probe         VPS → Upstream
Updated       8s ago (2026-08-18 12:45:00 UTC)
------------------------------------------------------------
```

#### B. Degradation Alert Embed (Posted on Transition)
```text
------------------------------------------------------------
⚠️ NEKO SERVER DEGRADED
------------------------------------------------------------
Status changed from ONLINE to DEGRADED.
Reason: Shadowsocks Listener is Not Listening (Port 8388 unreachable).
Host telemetry is fresh.
Observed: 10s ago
------------------------------------------------------------
```

#### C. Stale Telemetry Alert Embed (Posted on Transition)
```text
------------------------------------------------------------
⏱️ NEKO MONITORING STALE
------------------------------------------------------------
Status changed from ONLINE to STALE.
No fresh telemetry received from Japan VPS for >30 seconds.
Note: Proxy traffic routing is not independently proven offline.
Last Observed: 42s ago
------------------------------------------------------------
```

#### D. Recovery Alert Embed (Posted on Transition Back to Healthy)
```text
------------------------------------------------------------
✅ NEKO SERVER RECOVERED
------------------------------------------------------------
Status restored to ONLINE.
Shadowsocks daemon is Active and Listener is Listening.
Ping: 1.8 ms | Active Users: 14
Observed: 5s ago
------------------------------------------------------------
```

---

## 7. Labeling, Formatting & Unit Conversion Rules

### 7.1 Explicit Direction Labels
To avoid confusing server infrastructure traffic with client user traffic:
- **Download Rate**: `↓ VPS Download` or `↓ VPS Speed` (Calculated from `rx_bps`).
- **Upload Rate**: `↑ VPS Upload` or `↑ VPS Speed` (Calculated from `tx_bps`).
- **Download Total**: `↓ VPS RX Total` (Calculated from `rx_bytes_total`).
- **Upload Total**: `↑ VPS TX Total` (Calculated from `tx_bytes_total`).
- **Prohibited Labels**: `Client Download`, `Client Upload`, `User Speed`.

### 7.2 Unit Semantics
- **Throughput Rates (`rx_bps`, `tx_bps`)**: Expressed in decimal bit units:
  - $< 1,000 \text{ bps} \rightarrow \text{bps}$
  - $1,000 \text{ to } 999,999 \text{ bps} \rightarrow \text{Kbps}$ (divide by $1,000$)
  - $1,000,000 \text{ to } 999,999,999 \text{ bps} \rightarrow \text{Mbps}$ (divide by $1,000,000$)
  - $\ge 1,000,000,000 \text{ bps} \rightarrow \text{Gbps}$ (divide by $1,000,000,000$)
- **Data Volume Totals (`rx_bytes_total`, `tx_bytes_total`)**: Expressed in binary/IEC or standard byte units:
  - $< 1,024 \text{ B} \rightarrow \text{B}$
  - $1,024 \text{ to } 1,048,575 \text{ B} \rightarrow \text{KB}$ (divide by $1,024$)
  - $1,048,576 \text{ to } 1,073,741,823 \text{ B} \rightarrow \text{MB}$ (divide by $1,048,576$)
  - $1,073,741,824 \text{ to } 1,099,511,627,775 \text{ B} \rightarrow \text{GB}$ (divide by $1,073,741,824$)
  - $\ge 1,099,511,627,776 \text{ B} \rightarrow \text{TB}$ (divide by $1,099,511,627,776$)
- **Missing / Null Values**: Must display `—`, `Unknown`, or `Unavailable`. **NEVER** map missing values to `0 ms`, `0.0%`, or `0 Mbps`.

---

## 8. Anti-Spam, Anti-Flap & Alert State Machine

```text
+-------------------------------------------------------------------------------+
|                       ALERT STATE MACHINE INVARIANTS                          |
+-------------------------------------------------------------------------------+
| 1. State Transition Only: Alerts trigger strictly on status state changes.    |
| 2. Anti-Flap Confirmation:                                                    |
|    - DEGRADED: Requires 2 consecutive fresh unhealthy samples before alert.   |
|    - RECOVERY: Requires 2 consecutive healthy samples before recovery alert.  |
|    - STALE: Fires immediately once snapshot age > 30 seconds.                 |
| 3. Alert Cooldown: 5-minute safety cooldown prevents duplicate alert storms    |
|    during rapid process restarts or flapping conditions.                      |
| 4. Recovery Precedence: Recovery alerts are always permitted when a degraded  |
|    or stale state successfully resolves.                                      |
+-------------------------------------------------------------------------------+
```

```text
ALERT_ON_STATE_TRANSITION_ONLY = YES
DUPLICATE_ALERT_SPAM           = NO
RECOVERY_NOTIFICATION          = YES
ALERT_COOLDOWN                 = 300 seconds (5 minutes)
ANTI_FLAP_POLICY               = 2_SAMPLE_CONFIRMATION (DEGRADED/RECOVERY)
```

---

## 9. Integration State Persistence Architecture

To ensure state machine continuity across serverless cold starts, container recycles, and worker executions, the integration state is persisted in Supabase PostgreSQL:

### 9.1 Database Schema Contract (`public.server_status_integrations`)

```sql
create table if not exists public.server_status_integrations (
  id text primary key default 'primary_discord_status',
  status_message_id text null,
  last_status text not null default 'UNKNOWN',
  unhealthy_sample_count int not null default 0,
  healthy_sample_count int not null default 0,
  last_alert_type text null,
  last_alert_at timestamptz null,
  last_success_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.server_status_integrations enable row level security;
revoke all on public.server_status_integrations from anon, authenticated;
grant select, insert, update on public.server_status_integrations to service_role;
```

> [!IMPORTANT]
> The database table stores operational message IDs and state machine counters **ONLY**. Webhook secrets or tokens must **NEVER** be stored in the database.

---

## 10. Scheduler & Execution Architecture

```text
DISCORD_STATUS_SCHEDULER   = VERCEL_CRON / SERVER_SCHEDULED_WORKER
DASHBOARD_BROWSER_REQUIRED = NO
```

- **Execution Cadence**: Runs every **1 minute** (`* * * * *`).
- **Execution Target**: Trusted serverless worker route `POST /api/server/integrations/discord/tick` (protected by internal authorization bearer token or Vercel Cron HMAC).
- **Execution Flow**:
  1. Worker reads `public.server_metrics_latest` snapshot and active session counts.
  2. Worker loads state record from `public.server_status_integrations`.
  3. Worker computes current health state (`ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN`).
  4. Worker edits persistent status message (or creates first message and stores `status_message_id` if missing).
  5. Worker checks anti-flap confirmation counters and state transitions.
  6. If transition confirmed and outside cooldown, worker posts alert / recovery message.
  7. Worker commits updated state record to PostgreSQL.

---

## 11. Secret Management & Failure Isolation

### 11.1 Secret Management
- **Environment Key**: `DISCORD_SERVER_STATUS_WEBHOOK_URL`
- **Location**: Vercel Production Environment Variables (`WEBHOOK_LOCATION = SERVER_SIDE_ONLY`).
- **Restrictions**:
  - `WEBHOOK_IN_FRONTEND = NO`
  - Webhook secret must never be committed to Git.
  - Webhook secret must never be pasted into chat or logged in backend output.

### 11.2 Failure Isolation Contract
```text
DISCORD_FAILURE_ISOLATION = YES
```
The Discord integration is completely decoupled from core proxy operations:
- If Discord API is down, rate-limited (`429`), or returns `5xx`, the worker logs the error and exits cleanly.
- If the webhook secret is invalid or missing, the worker enters an inactive state.
- Under **NO** circumstances will Discord failure affect VPS metrics ingestion, PostgreSQL storage, Shadowsocks routing, Launcher operations, or game client connections.

---

## 12. Rate Limiting & Bounded Retry Policy

- **Rate Limit Handling (`HTTP 429`)**:
  - Inspect `Retry-After` header.
  - Abort current tick immediately and back off until the specified reset window.
  - Never execute rapid polling or retry loops upon receiving `429`.
- **Transient Network / `5xx` Failures**:
  - Maximum of **1 immediate retry** with a 2-second backoff.
  - If retry fails, record failure and wait for next scheduled 60s tick.
- **Client Error (`4xx` Invalid Webhook / Deleted Message)**:
  - Do not retry within the tick.
  - If persistent message returns `404 Not Found` (message deleted by moderator), clear `status_message_id` in database so next tick creates a fresh message.

---

## 13. Phase T7 Roadmap & Phased Split

```text
+-------------------------------------------------------------------------------+
|                             PHASE T7 ROADMAP                                  |
+-------------------------------------------------------------------------------+
| Phase T7A: Discord Status Architecture & Documentation Contract [CURRENT]     |
|            - Frozen embed layouts, status models, anti-spam rules, schemas.   |
|            - Zero source code changes, docs-only commit.                      |
|                                                                               |
| Phase T7B: Server-Side Implementation & Automated Test Matrix   [NEXT]        |
|            - Integration worker implementation, database migration,          |
|              state machine, unit tests, mock Discord payload tests.           |
|                                                                               |
| Phase T7C: Production Secret Provisioning & Live Proof          [PLANNED]     |
|            - Channel webhook creation, Vercel env variable setup,             |
|              live cron activation, live Discord update & alert verification.  |
+-------------------------------------------------------------------------------+
```

---

## 14. Phase T7B Test Plan Matrix

When Phase T7B implementation commences, the following automated test suites must be developed:

1. **Payload Formatting Tests**:
   - `ONLINE` snapshot renders correct embed fields, green indicator, and `VPS → Upstream` label.
   - `DEGRADED` snapshot renders correct warning emoji and specifies failed service.
   - `STALE` snapshot renders stale notice with exact observation age and no offline claims.
   - `UNKNOWN` snapshot handles missing metrics with clean `—` placeholders.
   - Rate conversions accurately compute bps, Kbps, Mbps, and Gbps without 8x errors.
   - Byte totals accurately compute KB, MB, GB, and TB.
2. **State Machine & Anti-Spam Tests**:
   - `ONLINE` $\rightarrow$ `ONLINE` produces status edit only; no alert message posted.
   - Single transient unhealthy sample does not trigger alert (Anti-flap confirmation = 2).
   - Confirmed 2 consecutive unhealthy samples triggers single alert message.
   - Consecutive `DEGRADED` samples do not produce duplicate alerts.
   - Transition from `DEGRADED` $\rightarrow$ `ONLINE` (2 consecutive healthy) triggers single recovery notification.
   - Safety cooldown prevents rapid repeat alerts within 300 seconds.
3. **Privacy & Security Tests**:
   - Verify payload contains zero user IDs, usernames, session IDs, or client PIDs.
   - Verify active user count is strictly integer session aggregate.
   - Verify webhook URL is not logged or exposed in responses.
4. **Resilience & Error Handling Tests**:
   - Mock Discord `429 Too Many Requests` handled with backoff.
   - Mock Discord `500 Internal Error` triggers bounded single retry.
   - Missing / revoked webhook secret fails cleanly without impacting database or ingestion.
   - Deleted Discord message (`404`) resets `status_message_id` and creates replacement on next tick.

---

## 15. Phase T7C Production Proof Criteria

Production sign-off in Phase T7C requires verification of:
1. **Persistent Status Live**: A real Discord embed appears and updates smoothly every ~60s.
2. **Real VPS Telemetry**: Live ping, loss, RX/TX, and Host Uptime match production database.
3. **Session Count Real**: Active Users integer reflects real unrevoked sessions.
4. **Transition & Recovery Proof**: Simulated service stop triggers alert; service restore triggers recovery.
5. **No Spam Confirmed**: Channel history confirms exactly 1 persistent message and zero duplicate alerts.
6. **Secret Secrecy**: Webhook URL remains strictly confined to Vercel production environment.
