# NEKO FAMILY PROXY — DISCORD SERVER STATUS & ALERTING ARCHITECTURE CONTRACT (PHASE T7 V1)

```text
DOCUMENT:               docs/architecture/discord-server-status.md
STATUS:                 AUTHORITATIVE ARCHITECTURE CONTRACT (T7 V1 FROZEN)
CLASSIFICATION:         HARD ARCHITECTURE INVARIANT & CONTRACT
OWNER:                  TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
PUBLISHER_AUTHORITY:    AWS_LIGHTSAIL (Local-Only Daemon / Scheduler)
CONSUMERS:              DISCORD WORKER ON JAPAN VPS
TEAM_CORE SCOPE:        NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER SCOPE:    NO ACTION (Frozen at Phase T3)
CURRENT_DEPLOYMENT:     LEGACY PUBLISHER ACTIVE (neko-traffic-monitor.service)
UNIFIED_T7_V1_STATUS:   CANDIDATE_COMPLETED (Phase T7 V1B Candidate Committed & Tested)
SUPERSEDED_COMMIT:      d242c5981d04b2b11fdbae79aa908bd646275eb7 (Original T7A Vercel-Side Plan)
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Architecture Authority (T7 V1)

This document establishes the authoritative specification, metric semantics, state persistence models, privacy boundaries, and operational failure boundaries for **Phase T7 V1 (Unified AWS Lightsail Discord Integration)** in the Neko Family Proxy ecosystem.

### 1.1 Owner Decision — Supersession of Original T7A Plan

The original Phase T7A design (commit `d242c5981d04b2b11fdbae79aa908bd646275eb7`) proposed a Vercel-side scheduled cron worker calling Supabase database tables (`public.server_metrics_latest`, `public.launcher_sessions`, and `public.server_status_integrations`).

```text
=============================================================================
HISTORICAL DESIGN SUPERSEDED RECORD
=============================================================================
ORIGINAL_T7A_PLAN:
  - Publisher: Vercel Serverless Cron (* * * * *)
  - Active Users: Queried from public.launcher_sessions (Supabase)
  - State Storage: Persisted in PostgreSQL table public.server_status_integrations
  - Dependencies: Vercel + Supabase + Backend API

SUPERSEDED_STATUS:
  SUPERSEDED_BY = T7 V1 (AWS Lightsail Unified Local Architecture)

RATIONALE:
  1. AWS Lightsail is the operational home and single notification authority.
  2. Lower maintenance overhead: zero Vercel Cron setup, zero Supabase schema migrations.
  3. Resilience & Failure Independence: Discord reporting continues uninterrupted
     even if Backend, Supabase, or Vercel experiences outages.
  4. Privacy & Decoupling: Complete removal of user session dependencies from Discord.
  5. Existing Working Foundation: Discovered legacy Lightsail Discord integration
     provides proven raw network capture capabilities that can be cleanly unified.
=============================================================================
```

```text
+-------------------------------------------------------------------------------+
|                       PHASE T7 V1 ARCHITECTURAL GOAL                          |
+-------------------------------------------------------------------------------+
| 1. ONE Discord Publisher on AWS Lightsail (Unified Long-Running Worker).      |
| 2. ONE Discord Webhook (Reused from protected VPS environment).               |
| 3. THREE Core Responsibilities in ONE Process:                                |
|    A. Persistent Operational Status: One pinned/editable message (~60s).      |
|    B. Traffic Summary: Chronological usage record per interval (30m),         |
|       reporting TIME-WEIGHTED AVERAGE THROUGHPUT on port 8388 as primary.     |
|    C. Transition Alerts: Standalone messages posted ONLY on confirmed health   |
|       state transitions (ONLINE -> DEGRADED/STALE, or RECOVERY).              |
| 4. ZERO Active Users / ZERO Backend / ZERO Supabase / ZERO Vercel Cron.       |
| 5. Protected Local State Persistence (/var/lib/neko/discord-state.json).      |
| 6. Long-Running Systemd Service (NO systemd timer; continuous capture).       |
+-------------------------------------------------------------------------------+
```

---

## 2. Legacy Discord Discovery & Operational Baseline

During Phase T7 V1A, read-only operational discovery was conducted on the production AWS Lightsail Japan VPS:

```text
=============================================================================
AWS LIGHTSAIL LEGACY DISCORD DISCOVERY REPORT
=============================================================================
LEGACY_SERVICE:               neko-traffic-monitor.service
SERVICE_PATH:                 /etc/systemd/system/neko-traffic-monitor.service
EXECUTION_MODEL:              LONG_RUNNING_DAEMON (Type=simple with select() loop)
LEGACY_SCRIPT:                /usr/local/lib/neko-traffic-monitor/neko_traffic_monitor.py
LEGACY_SCRIPT_SHA256:         3056e3bd6ac6628fa9119d90b28bbee146fc0a27adfaedd13e46c6516bd684ac
RUNTIME_USER:                 root (Capabilities: CAP_NET_RAW)
LEGACY_SCHEDULE:              30-minute epoch-aligned windows (MONITOR_INTERVAL_SECONDS=1800)
REPORT_THRESHOLD:             1,048,576 bytes (1 MB minimum; skips interval if below)
TIMEZONE:                     Asia/Bangkok (Thai date/time formatting)

LEGACY_MESSAGE_MODEL:         NEW_MESSAGE_PER_INTERVAL (POST to Webhook, Thai embed)
LEGACY_MESSAGE_TITLE:         "🌐 Neko Proxy Core Status"

LEGACY_TRAFFIC_SOURCE:        AF_PACKET raw socket on interface 'ens5' filtered to port 8388
LEGACY_DOWNLOAD_SOURCE:       Outbound packets from port 8388 on ens5 (VPS -> client)
LEGACY_UPLOAD_SOURCE:         Inbound packets to port 8388 on ens5 (client -> VPS)
LEGACY_TRAFFIC_SOURCE_CLASS:  SHADOWSOCKS_PORT_RAW_PACKET_SNIFFING

LEGACY_TRAFFIC_CALCULATION:   TOTAL_BYTES_DURING_WINDOW (Cumulative sum of packet lengths)
LEGACY_STATE_PERSISTENCE:     NO (In-memory variables only; lost on service restart)

WEBHOOK_SECRET_LOCATION:      /etc/neko-traffic-monitor.env
WEBHOOK_FILE_PROTECTIONS:     -rw------- 1 root root (0600 least-privilege)
WEBHOOK_SECRET_PRINTED:       NO
=============================================================================
```

### 2.1 Key Insights from Legacy Discovery
1. **Source Precision**: The legacy script captures traffic specifically on Shadowsocks port `8388` using raw packet sniffing (`AF_PACKET`). Whole-interface ens5 counters must NOT replace this authority.
2. **Missing Rate Authority**: Legacy traffic summary calculates only total cumulative bytes in the interval (e.g. `319.5 MB`), but does **not** compute average throughput or data rate.
3. **No Persistent Status / Alerts**: Legacy script does not manage a persistent status message and does not send health degradation/recovery alerts.
4. **State Fragility**: Current state is purely in-memory. If the service restarts mid-interval, partial byte counts are lost.
5. **Runtime Model**: Continuous AF_PACKET packet sniffing requires a **long-running systemd service**. A systemd timer would miss packets between one-shot runs (`SYSTEMD_TIMER = NO`).

---

## 3. Metric Semantics & Traffic Summary Authority

### 3.1 Traffic Summary: Time-Weighted Average Throughput (Frozen Authority)

The owner decision freezes the primary metric of the Discord Traffic Summary as **Average Throughput over the reporting window** on **Shadowsocks port 8388 filtered traffic**:

```text
TRAFFIC_SOURCE           = SHADOWSOCKS_PORT_8388_FILTERED_TRAFFIC (ens5 TCP/UDP 8388)
TRAFFIC_SUMMARY_METRIC   = TIME_WEIGHTED_AVERAGE_THROUGHPUT
AVERAGE_NUMERATOR        = FILTERED_PORT_8388_WINDOW_BYTES
AVERAGE_DENOMINATOR      = REAL_ELAPSED_TIME
RATE_UNIT_AUTHORITY      = BITS_PER_SECOND (bps, Kbps, Mbps, Gbps)
WINDOW_TOTAL_BYTES       = OPTIONAL_SECONDARY
```

#### Authoritative Calculation Formulas:

$$\text{download\_avg\_bps} = \frac{\text{filtered\_download\_bytes\_during\_window} \times 8}{\text{actual\_elapsed\_seconds}}$$

$$\text{upload\_avg\_bps} = \frac{\text{filtered\_upload\_bytes\_during\_window} \times 8}{\text{actual\_elapsed\_seconds}}$$

```text
=============================================================================
CRITICAL CALCULATION INVARIANT:
DO NOT DEFINE THE AUTHORITY AS: sum(sample_rates) / sample_count
DO NOT USE: whole ens5 interface counter delta
RATIONALE:
1. Irregular sampling intervals or missing probe ticks will bias arithmetic
   sample averages. The cumulative counter delta divided by true elapsed time
   guarantees mathematically exact throughput across the entire interval.
2. Filtered port 8388 traffic reflects proxy usage directly without noise from
   SSH, monitoring agent push, or VPS management traffic.
=============================================================================
```

### 3.2 Real Elapsed Time Authority
Never assume configured 30 minutes is exactly 1,800.0 seconds. Use real monotonic timestamps:
$$\text{actual\_elapsed\_seconds} = \text{end\_timestamp} - \text{start\_timestamp}$$

### 3.3 Counter Reset & Restart Semantics (No Fake Throughput)
Host reboots or worker restarts mid-window:
- Traffic missed while Worker was down cannot be reconstructed (`NO_FAKE_TRAFFIC_CONTINUITY = YES`).
- Start new baseline from actual observation start time.
- Never output fake spike throughput.

### 3.4 Unit Formatting Standards
- **Average Throughput Rates (`bps`)**: Formatted using decimal SI scaling (1,000):
  - $< 1,000 \text{ bps} \rightarrow \text{bps}$
  - $1,000 \text{ to } 999,999 \text{ bps} \rightarrow \text{Kbps}$ (divide by 1,000)
  - $1,000,000 \text{ to } 999,999,999 \text{ bps} \rightarrow \text{Mbps}$ (divide by 1,000,000)
  - $\ge 1,000,000,000 \text{ bps} \rightarrow \text{Gbps}$ (divide by 1,000,000,000)
- **Cumulative Total Bytes**: Formatted using binary IEC scaling (1,024):
  - $< 1,024 \text{ B} \rightarrow \text{B}$
  - $1,024 \text{ to } 1,048,575 \text{ B} \rightarrow \text{KB}$ (divide by 1,024)
  - $1,048,576 \text{ to } 1,073,741,823 \text{ B} \rightarrow \text{MB}$ (divide by 1,048,576)
  - $\ge 1,073,741,824 \text{ B} \rightarrow \text{GB}$ (divide by 1,073,741,824)

### 3.5 Current Status vs Traffic Summary Separation
- **CURRENT STATUS**: Near-current network rate and service health condition (live snapshot updated every ~60s in persistent message).
- **TRAFFIC SUMMARY**: Bounded time-weighted average throughput over an elapsed window (new chronological message posted every ~30m).
- **Invariant**: These metrics must never be conflated or labeled interchangeably.

---

## 4. Single Unified Discord Worker Architecture

```text
+-------------------------------------------------------------------------------+
|                      UNIFIED LIGHTSAIL DISCORD WORKER                         |
+-------------------------------------------------------------------------------+
|                                                                               |
|  [ LOCAL VPS DATA SOURCES ]                                                   |
|  ├─ AF_PACKET Raw Socket (ens5 filtered to port 8388 TCP/UDP)                 |
|  ├─ Systemd Manager (systemctl is-active shadowsocks-libev)                   |
|  ├─ Socket Listener Probe (127.0.0.1:8388 TCP check)                          |
|  ├─ Upstream Latency / Loss Probe (ICMP / TCP to upstream target)             |
|  └─ Host Uptime (/proc/uptime)                                                |
|                                                                               |
|       │                                                                       |
|       ▼ (Direct In-Process Continuous Event Loop)                             |
|  [ UNIFIED DISCORD WORKER ] (neko-discord-worker.service — Type=simple)       |
|  ├─ Local State: /var/lib/neko/discord-state.json                             |
|  ├─ Secret Config: /etc/neko/discord.env (chmod 600)                          |
|  ├─ Cadence 1: Continuous Packet Capture                                      |
|  ├─ Cadence 2: ~5s Health Probe & Current Rate Calculation                    |
|  ├─ Cadence 3: ~60s Persistent Current Status Message Edit                    |
|  ├─ Cadence 4: 30m Epoch-Aligned Traffic Summary Message Post                 |
|  └─ Cadence 5: State Transition Alert Evaluation                              |
|                                                                               |
|       │                                                                       |
|       ├─► [ Responsibility 1: Current Status ] ──► PATCH status_message_id    |
|       │   (Single persistent embed updated every ~60s)                        |
|       │                                                                       |
|       ├─► [ Responsibility 2: Traffic Summary ] ─► POST new message           |
|       │   (Average throughput embed every ~30m)                               |
|       │                                                                       |
|       └─► [ Responsibility 3: Transition Alerts] ─► POST alert embed          |
|           (Degradation / Recovery alerts on confirmed state changes)          |
|                                                                               |
+-------------------------------------------------------------------------------+
```

### 4.1 Target Service Isolation
```text
SYSTEMD_SERVICES_ON_LIGHTSAIL:
  1. shadowsocks-libev.service    (Core proxy routing)
  2. neko-server-monitor.service  (Agent pushing telemetry to Admin Web Backend)
  3. neko-discord-worker.service  (Unified long-running Discord worker)
```

```text
DISCORD_FAILURE_CAN_STOP_MONITORING_AGENT = NO
DISCORD_FAILURE_CAN_STOP_SHADOWSOCKS      = NO
```

---

## 5. Discord Presentation Contracts

### 5.1 Responsibility 1: Persistent Current Status (Edited In-Place Every ~60s)

```text
------------------------------------------------------------
🌐 NEKO PROXY — CURRENT STATUS
------------------------------------------------------------
Status        🟢 ONLINE
Ping          1.7 ms
Loss          0.0%

↓ VPS Speed   12.84 Mbps
↑ VPS Speed    2.11 Mbps

Host Uptime   9d 14h
Shadowsocks   Active
Listener      Listening

Probe         VPS → Upstream
Updated       8s ago (2026-08-18 13:30:00 UTC)
------------------------------------------------------------
```

### 5.2 Responsibility 2: Traffic Summary (New Message Every 30m)

```text
------------------------------------------------------------
📊 NEKO PROXY — TRAFFIC SUMMARY
------------------------------------------------------------
ช่วงเวลา: 18 สิงหาคม 2569 เวลา 13:00–13:30 น. (เวลาไทย)

↓ ดาวน์โหลด (เฉลี่ย)
**1.42 Mbps**
(รวม 319.5 MB)

↑ อัปโหลด (เฉลี่ย)
**0.18 Mbps**
(รวม 40.5 MB)

Host Uptime: 9d 14h | Status: 🟢 ONLINE
------------------------------------------------------------
```

### 5.3 Responsibility 3: Transition Alerts (Posted on State Transitions)

#### A. Degradation Alert
```text
------------------------------------------------------------
⚠️ NEKO SERVER DEGRADED
------------------------------------------------------------
Status changed from ONLINE to DEGRADED.
Reason: Shadowsocks Listener is Not Listening (Port 8388 closed).
Observed: 10s ago
------------------------------------------------------------
```

#### B. Telemetry Stale Alert
```text
------------------------------------------------------------
⏱️ NEKO PROBE STALE
------------------------------------------------------------
Status changed from ONLINE to STALE.
Local probe cannot reach upstream target.
Note: Proxy traffic routing is not independently proven offline.
Observed: 35s ago
------------------------------------------------------------
```

#### C. Recovery Alert
```text
------------------------------------------------------------
✅ NEKO SERVER RECOVERED
------------------------------------------------------------
Status restored to ONLINE.
Shadowsocks daemon is Active and Listener is Listening.
Ping: 1.8 ms | Loss: 0.0%
Observed: 5s ago
------------------------------------------------------------
```

---

## 6. Privacy & Security Boundary Contract

```text
=============================================================================
STRICT PRIVACY GOVERNANCE — PUBLIC VPS OPERATIONAL STATUS ONLY
=============================================================================
Discord is strictly a PUBLIC INFRASTRUCTURE HEALTH projection.
It is NOT a user monitoring or client diagnostic tool.

STRICTLY FORBIDDEN IN DISCORD:
❌ User Identifiers:      user_id, username, email, display name
❌ Session Identifiers:   session_id, token, license_id, JWT, permit key
❌ Client Hardware Data:  machine_id, device names, MAC addresses
❌ Process Details:       Core PID, Game PID (pso2.exe), client handles
❌ Client Network Data:   destination IPs, DNS queries, packet buffers
❌ Proxy Secrets:         SERVER_METRICS_INGEST_SECRET, Shadowsocks passwords
❌ Active Users:          REMOVED (Zero user counts in T7 V1)
=============================================================================
```

```text
DISCORD_DATA_CLASSIFICATION   = PUBLIC_VPS_OPERATIONAL_STATUS
DISCORD_USER_IDENTITY         = NO
DISCORD_CLIENT_DEEP_TELEMETRY = NO
ACTIVE_USERS                  = REMOVED
```

---

## 7. Status Model & Anti-Spam State Machine

### 7.1 Status States
- 🟢 `ONLINE`: Systemd service active, port 8388 listening, upstream ping responsive.
- 🟡 `DEGRADED`: Service inactive OR port 8388 closed.
- 🟠 `STALE`: Upstream probe timeout or unable to inspect local health.
- ⚪ `UNKNOWN`: Initial startup baseline.

```text
STALE_EQUALS_OFFLINE = NO
```

### 7.2 Anti-Flap Confirmation & Cooldown
- **Anti-Flap**: Requires **2 consecutive unhealthy checks** before posting `DEGRADED`, and **2 consecutive healthy checks** before posting `RECOVERY`.
- **Cooldown**: 300-second safety cooldown prevents alert loops during rapid service restarts.
- **Deduplication**: Never post duplicate alert embeds for unchanged states.

### 7.3 Critical Limitation: Full Host Outage External Detection
```text
FULL_HOST_OUTAGE_EXTERNAL_DETECTION = NOT_PROVIDED_IN_T7_V1
```
Because the Discord Worker runs locally on the Japan Lightsail VPS itself, it cannot independently send a Discord alert if:
1. The whole Lightsail VPS loses power or crashes.
2. The entire upstream network interface is disconnected.
3. The host kernel panics.

In such catastrophic failure events, the Discord Worker process terminates along with the host, meaning the last posted status embed remains visible until refreshed or manually removed. An external watchdog is intentionally **OUT OF SCOPE** for T7 V1 to maintain zero external infrastructure maintenance.

---

## 8. Local State Persistence Contract

State is stored locally on the Japan VPS file system:

```text
STATE_FILE_PATH:       /var/lib/neko/discord-state.json
PERMISSIONS:           -rw------- 1 root root (0600)
DATABASE_DEPENDENCY:   NONE (No PostgreSQL / Supabase required)
```

### 8.1 State Schema Contract
```json
{
  "version": 1,
  "status_message_id": "123456789012345678",
  "window_start_time": 1755518400,
  "window_start_rx_bytes": 841643967,
  "window_start_tx_bytes": 720720638,
  "confirmed_status": "ONLINE",
  "pending_status": "ONLINE",
  "pending_count": 0,
  "last_alert_status": "ONLINE",
  "last_alert_at": 1755518400,
  "last_status_edit_at": 1755520200
}
```

> [!IMPORTANT]
> The state file stores operational timestamps, message IDs, and byte counters **ONLY**. Secrets and webhook URLs are strictly forbidden from `discord-state.json`.

---

## 9. Secret Management & Webhook Configuration

- **Environment File**: `/etc/neko-traffic-monitor.env` (existing legacy) $\rightarrow$ `/etc/neko/discord.env` (unified target).
- **Permissions**: Root-owned `0600` (`chmod 600`).
- **Webhook Reuse**: Reuse existing provisioned Discord webhook (`REUSE_EXISTING_WEBHOOK = YES`). No unnecessary rotation needed.
- **Git / Web Safety**: Never committed to Git, never exposed to Vercel/Web bundle, never printed in logs.

---

## 10. Legacy Migration & Production Cutover Plan (Phase T7 V1C)

```text
=============================================================================
PRODUCTION CUTOVER SEQUENCE (PHASE T7 V1C)
=============================================================================
1. Stage unified Discord worker & state directories on Lightsail VPS.
2. Validate permissions, environment files, and counter baseline.
3. Start unified worker service (systemctl start neko-discord-worker.service).
4. Verify persistent status message creation and traffic average posting.
5. Disable legacy publisher:
   systemctl stop neko-traffic-monitor.service
   systemctl disable neko-traffic-monitor.service
6. Verify exactly ONE publisher remains active on the VPS.
7. Verify channel history contains zero duplicate messages.
=============================================================================
```

> [!CAUTION]
> In Phase T7 V1A and T7 V1B, the legacy publisher `neko-traffic-monitor.service` remains running. Do **NOT** stop or disable it during local candidate development.

---

## 11. Phase Roadmap

```text
+-------------------------------------------------------------------------------+
|                             PHASE T7 ROADMAP                                  |
+-------------------------------------------------------------------------------+
| Phase T7 V1A: Legacy Discovery & Architecture Freeze             [COMPLETED]  |
|               - Lightsail legacy discovery, traffic source & formula freeze,  |
|                 redefine Traffic Summary as average throughput, docs updated. |
|                                                                               |
| Phase T7 V1B: Unified Discord Worker Implementation & Tests      [COMPLETED]  |
|               - Develop unified Python worker, time-weighted average calc,    |
|                 state machine, systemd units, unit tests, mock Discord tests. |
|                                                                               |
| Phase T7 V1C: Production Staging & Legacy Cutover                [NEXT]       |
|               - Stage worker on Lightsail, live proof, legacy retirement.     |
+-------------------------------------------------------------------------------+
```
