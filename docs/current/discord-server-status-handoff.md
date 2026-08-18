# NEKO FAMILY PROXY — DISCORD SERVER STATUS & ALERTING HANDOFF (PHASE T7A)

```text
DOCUMENT:               docs/current/discord-server-status-handoff.md
STATUS:                 DESIGNED (Phase T7A Architecture & Contract Complete)
CLASSIFICATION:         PHASE TRANSITION & IMPLEMENTATION HANDOFF RECORD
PHASE:                  T7A (Discord Server Status & Alerting Architecture Design)
PREVIOUS_PHASE:         T6D (Historical Server Metrics Production Proof — CLOSED)
SUCCESSOR_PHASE:        T7B (Server-Side Integration Implementation & Tests)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
DISCORD_INTEGRATION:    NOT YET IMPLEMENTED (Planned for T7B)
PRODUCTION_WEBHOOK:     NOT YET CONFIGURED (Planned for T7C)
DATE:                   2026-08-18
T7A_EXIT_GATE:          PASS
```

---

## 1. Executive Summary & Phase T7A Outcome

Phase **T7A (Discord Server Status & Alerting Design)** has frozen all architecture specifications, data contracts, embed formats, anti-spam state machines, privacy boundaries, and test matrices required for the upcoming implementation phases.

This phase is **purely architectural and documentation-only**. No runtime code was altered, no database migrations were applied, no production webhooks were created, and no Discord messages were dispatched.

```text
+---------------------------------------------------------------------------------------------------+
|                                      PHASE T7 STATUS MATRIX                                       |
+---------------------------------------------------------------------------------------------------+
|  Phase T7A: Design & Documentation Contract        | COMPLETED / FROZEN (Docs-Only Authority)     |
|  Phase T7B: Server-Side Worker & Test Matrix       | NEXT / PLANNED                                |
|  Phase T7C: Production Secret & Live Proof         | PLANNED                                       |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Decisions Frozen in T7A

1. **Delivery Strategy (Option C — Pinned Status + Transition Alerts)**:
   - **Persistent Status**: Exactly one persistent message in the designated Discord channel, updated via `PATCH` every **60 seconds**.
   - **Transition Alerts**: Standalone notification messages sent strictly upon confirmed health state transitions (e.g. `ONLINE` $\rightarrow$ `DEGRADED`, `ONLINE` $\rightarrow$ `STALE`) and upon service recovery (`DEGRADED`/`STALE` $\rightarrow$ `ONLINE`).
   - **Zero Spam**: Channel history remains clean, actionable, and free of periodic polling spam.

2. **Data Authorities & Ingestion Pipeline**:
   - **Server Infrastructure Metrics**: Sourced exclusively from `public.server_metrics_latest` (populated by the Japan VPS agent via `/api/server/metrics/ingest`).
   - **Active Users**: Sourced exclusively from Supabase `launcher_sessions` with unrevoked status and fresh heartbeat ($\le 120\text{s}$). Represented strictly as an aggregate integer count (`SESSION_ONLY`).
   - **Ping Label**: Frozen strictly as `VPS → Upstream`.
   - **Uptime Label**: Frozen strictly as `Host Uptime` (derived from `/proc/uptime`).

3. **Privacy Invariant**:
   - Zero user identifiers (emails, usernames, user IDs, session IDs, license IDs) are ever sent to Discord.
   - Zero client machine metrics, process names (`pso2.exe`), local SOCKS state, packet contents, or destination IPs are ever exposed.

4. **Status & Anti-Flap Model**:
   - Four distinct states: `ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN`.
   - **Staleness Invariant**: `STALE != OFFLINE`. Telemetry staleness ($> 30\text{s}$) must never be reported as server offline without independent reachability proof.
   - **Anti-Flap Confirmation**: Bounded multi-sample confirmation requires **2 consecutive unhealthy samples** before triggering a `DEGRADED` alert, and **2 consecutive healthy samples** before triggering `RECOVERY`.
   - **Safety Cooldown**: 5-minute cooldown prevents alert storms in case of worker restarts.

5. **Scheduler & Secret Management**:
   - **Scheduler**: Autonomous server-side scheduler (e.g. Vercel Cron calling `/api/server/integrations/discord/tick`). Zero dependency on open admin browser sessions.
   - **State Persistence**: Supabase table `public.server_status_integrations` persists `status_message_id`, last alert timestamps, and anti-flap counters.
   - **Secret Location**: Vercel production environment variable `DISCORD_SERVER_STATUS_WEBHOOK_URL` (Server-side only; never exposed to frontend or Git).
   - **Failure Isolation**: Discord API errors or webhook invalidity are fully isolated and cannot interrupt proxy traffic, metrics ingestion, or database operations.

---

## 3. Reference Documentation

Engineers implementing Phase T7B must reference:
- **Architecture Contract**: [docs/architecture/discord-server-status.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/discord-server-status.md)
- **Foundational Boundary**: [docs/architecture/server-monitoring-session-boundary.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/architecture/server-monitoring-session-boundary.md)
- **Latest Production Proof**: [docs/current/historical-server-metrics-production-proof.md](file:///D:/Github/Neko-Family-Proxy-admin-tool/docs/current/historical-server-metrics-production-proof.md)

---

## 4. Phase T7B Implementation Scope (Next Phase)

Phase **T7B** will implement and test the server-side integration:

1. **Database Migration**:
   - Create forward-only migration for `public.server_status_integrations` table with RLS enabled.
2. **Worker Implementation**:
   - Develop the Discord webhook formatting, update/post logic, anti-flap state machine, and rate limit backoff in `server/integrations/discord.mjs` (or designated backend module).
   - Implement scheduled tick handler endpoint.
3. **Automated Test Suite**:
   - Unit tests for payload generators across all 4 status states (`ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN`).
   - State machine transition tests (anti-flap 2-sample confirmation, deduplication, recovery).
   - Rate limit retry and error handling tests with mock Discord endpoints.
   - Privacy assertion tests (zero user identities in payloads).

---

## 5. Phase T7C Production Proof Scope (Future Planned Phase)

Phase **T7C** will execute the live production deployment:
1. Owner creates private Discord channel and provisions webhook.
2. Owner configures `DISCORD_SERVER_STATUS_WEBHOOK_URL` in Vercel Production Environment Variables.
3. Deploy backend worker and activate cron schedule.
4. Verify persistent status message creation and monotonic 60s updates in live Discord channel.
5. Verify state transition alerts and recovery notifications via live verification tests.
6. Commit production proof document and close Phase T7.
