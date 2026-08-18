# NEKO FAMILY PROXY — DISCORD SERVER STATUS & ALERTING HANDOFF (PHASE T7 V1A)

```text
DOCUMENT:               docs/current/discord-server-status-handoff.md
STATUS:                 AUTHORITATIVE HANDOFF (T7 V1A Complete — Discovery & Architecture Frozen)
CLASSIFICATION:         PHASE TRANSITION & IMPLEMENTATION HANDOFF RECORD
PHASE:                  T7 V1A (Legacy Discord Discovery & Unified Architecture Freeze)
PREVIOUS_PHASE:         T6D (Historical Server Metrics Production Proof — CLOSED)
ORIGINAL_T7A_BASELINE:  d242c5981d04b2b11fdbae79aa908bd646275eb7 (SUPERSEDED)
SUCCESSOR_PHASE:        T7 V1B (Unified Lightsail Discord Worker Implementation & Tests)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_DISCORD:     LEGACY PUBLISHER ACTIVE (neko-traffic-monitor.service)
UNIFIED_WORKER_STATUS:  NOT YET IMPLEMENTED (Planned for T7 V1B)
DATE:                   2026-08-18
T7_V1A_EXIT_GATE:       PASS
```

---

## 1. Executive Summary & Phase T7 V1A Outcome

Phase **T7 V1A (Legacy Discord Discovery & Unified Architecture Freeze)** has completed comprehensive read-only operational discovery on the AWS Lightsail Japan VPS and frozen all authoritative architecture specifications for **Phase T7 V1**.

```text
=============================================================================
AUTHORITY REPLACEMENT SUMMARY
=============================================================================
ORIGINAL T7A DESIGN:
  - Vercel Cron + Supabase queries + Active Users session tracking + DB state.
  - Status: SUPERSEDED BY OWNER DECISION.

APPROVED T7 V1 DESIGN:
  - AWS Lightsail Local-Only Publisher (One publisher, One webhook).
  - Time-weighted average throughput as primary Traffic Summary metric.
  - Local state persistence (/var/lib/neko/discord-state.json).
  - Zero Active Users, Zero Backend/Supabase/Vercel dependencies.
  - Status: FROZEN & AUTHORITATIVE.
=============================================================================
```

```text
+---------------------------------------------------------------------------------------------------+
|                                      PHASE T7 STATUS MATRIX                                       |
+---------------------------------------------------------------------------------------------------+
|  Original T7A: Vercel Cron / DB Status Design      | SUPERSEDED (Commit d242c598...)              |
|  Phase T7 V1A: Legacy Discovery & Architecture     | CLOSED / FROZEN (Authority Established)      |
|  Phase T7 V1B: Unified Lightsail Worker & Tests    | NEXT / PLANNED                               |
|  Phase T7 V1C: Production Staging & Cutover        | PLANNED                                      |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Production Legacy Discovery Findings

Read-only inspection of the Japan VPS revealed the following active legacy integration:

| Discovery Field | Discovered Reality on Japan VPS |
| :--- | :--- |
| **Legacy Service** | `neko-traffic-monitor.service` (`/etc/systemd/system/neko-traffic-monitor.service`) |
| **Execution Model** | `LONG_RUNNING_DAEMON` (Python script with `AF_PACKET` raw socket and `select()` loop) |
| **Legacy Script** | `/usr/local/lib/neko-traffic-monitor/neko_traffic_monitor.py` |
| **Runtime Privileges** | `User=root`, `CapabilityBoundingSet=CAP_NET_RAW` |
| **Legacy Schedule** | 30-minute epoch-aligned window (`MONITOR_INTERVAL_SECONDS=1800`) |
| **Minimum Threshold** | `1,048,576 bytes` (1 MB threshold; skips posting if total traffic is lower) |
| **Message Model** | New message posted per interval (`POST` to Webhook) with Thai date/time formatting |
| **Legacy Traffic Source** | `AF_PACKET` raw socket filtering on interface `ens5` port `8388` (Shadowsocks port) |
| **Download Source** | Outbound packets on `ens5` from source port `8388` (VPS $\rightarrow$ client) |
| **Upload Source** | Inbound packets on `ens5` to destination port `8388` (client $\rightarrow$ VPS) |
| **Traffic Source Class** | `SHADOWSOCKS_PORT_RAW_PACKET_SNIFFING` |
| **Traffic Calculation** | `TOTAL_BYTES_DURING_WINDOW` (Sum of raw packet lengths during interval) |
| **State Storage** | In-memory variables only (`LEGACY_STATE_PERSISTENT = NO`) |
| **Webhook Secret Location** | `/etc/neko-traffic-monitor.env` (`chmod 600`, root:root protected) |
| **Webhook Secret Status** | `PRESENT` (Value strictly unprinted / protected) |

---

## 3. Core Architectural Decisions Frozen in T7 V1

1. **Notification & Publisher Authority**:
   - `DISCORD_PUBLISHER_AUTHORITY = AWS_LIGHTSAIL` (Local daemon / scheduler).
   - `DISCORD_PUBLISHER_COUNT = 1`, `DISCORD_WEBHOOK_COUNT = 1`.
   - Reuses existing provisioned webhook from `/etc/neko-traffic-monitor.env`.

2. **Traffic Summary Semantics (Average Throughput)**:
   - `TRAFFIC_SUMMARY_METRIC = TIME_WEIGHTED_AVERAGE_THROUGHPUT`
   - `CALCULATION_AUTHORITY = CUMULATIVE_BYTE_COUNTER_DELTA / REAL_ELAPSED_TIME`
   - Formulas:
     $$\text{download\_avg\_bps} = \frac{(\text{download\_counter\_end} - \text{download\_counter\_start}) \times 8}{\text{actual\_elapsed\_seconds}}$$
     $$\text{upload\_avg\_bps} = \frac{(\text{upload\_counter\_end} - \text{upload\_counter\_start}) \times 8}{\text{actual\_elapsed\_seconds}}$$
   - `RATE_UNIT_AUTHORITY = BITS_PER_SECOND` (bps, Kbps, Mbps, Gbps).
   - `WINDOW_TOTAL_BYTES = OPTIONAL_SECONDARY` (Total MB/GB displayed alongside rate).
   - `COUNTER_RESET_SEMANTICS = NO_FAKE_THROUGHPUT` (Baseline reset on counter decrease/reboot).
   - `REAL_ELAPSED_TIME`: Derived from actual timestamps ($\Delta t = t_{\text{end}} - t_{\text{start}}$).

3. **Three Core Unified Worker Responsibilities**:
   - **Responsibility 1 (Current Status)**: Single persistent Discord embed edited via `PATCH` every ~60s.
   - **Responsibility 2 (Traffic Summary)**: New chronological Discord embed posted every ~30m reporting average throughput.
   - **Responsibility 3 (Transition Alerts)**: Discrete alert embeds posted strictly upon confirmed state transitions (`ONLINE \rightarrow DEGRADED/STALE`, `RECOVERY`).

4. **Status & Anti-Spam State Machine**:
   - Four states: `ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN`.
   - Invariant: `STALE != OFFLINE`.
   - Anti-flap: **2 consecutive unhealthy samples** for `DEGRADED`, **2 consecutive healthy samples** for `RECOVERY`.
   - Safety cooldown: 300 seconds.

5. **Decoupling & Privacy Safeguards**:
   - `ACTIVE_USERS = REMOVED`.
   - Zero Backend API, Supabase, or Vercel dependencies (`DISCORD_BACKEND_DEPENDENCY = NONE`).
   - Zero user identifiers or client machine data exposed to Discord.

6. **Local State Storage**:
   - `/var/lib/neko/discord-state.json` (`chmod 600`, root-owned).
   - Stores message IDs, counter baselines, and state machine transition timestamps.

---

## 4. Phase T7 V1B Implementation Scope (Next Phase)

Phase **T7 V1B** will develop the unified worker and test suite:

1. **Worker Script Development**:
   - Python-based unified worker implementing Current Status, Traffic Summary, and Alerts.
   - Exact time-weighted average calculation with counter-reset handling.
   - Local state file management with atomic writes.
2. **Systemd Packaging**:
   - Candidate service (`neko-discord-worker.service`) and timer (`neko-discord-worker.timer`).
3. **Automated Test Suite**:
   - Unit tests for throughput conversion, counter reset, embed layouts, and anti-flap state machine.
   - Mock Discord HTTP responses (`200 OK`, `429 Too Many Requests`, `500 Internal Error`).
4. **Staging Preparation**:
   - Zero modifications to production VPS until T7 V1C cutover.

---

## 5. Phase T7 V1C Production Cutover Plan (Future Phase)

1. Stage unified worker on Japan VPS.
2. Validate local state initialization and configuration.
3. Start unified service & timer.
4. Verify Discord output (persistent status + traffic summary).
5. Stop and disable legacy `neko-traffic-monitor.service`.
6. Verify single publisher authority and zero duplicate messages.
