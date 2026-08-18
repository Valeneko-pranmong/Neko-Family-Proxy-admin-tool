# NEKO FAMILY PROXY — DISCORD SERVER STATUS & ALERTING HANDOFF (PHASE T7 V1B)

```text
DOCUMENT:               docs/current/discord-server-status-handoff.md
STATUS:                 AUTHORITATIVE HANDOFF (T7 V1B Candidate Complete & Tested)
CLASSIFICATION:         PHASE TRANSITION & IMPLEMENTATION HANDOFF RECORD
PHASE:                  T7 V1B (Unified Lightsail Discord Worker Implementation & Tests)
PREVIOUS_PHASE:         T7 V1A (Legacy Discord Discovery & Unified Architecture Freeze — CLOSED)
SUCCESSOR_PHASE:        T7 V1C (Lightsail Production Cutover & Live Proof)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_DISCORD:     LEGACY PUBLISHER ACTIVE (neko-traffic-monitor.service)
UNIFIED_WORKER_STATUS:  CANDIDATE COMMITTED & TESTED (Planned for T7 V1C Deploy)
DATE:                   2026-08-18
T7_V1B_EXIT_GATE:       PASS
```

---

## 1. Executive Summary & Phase T7 V1B Outcome

Phase **T7 V1B (Unified Discord Worker Local Candidate)** has implemented, packaged, and deterministically tested the unified AWS Lightsail Discord Worker candidate in `D:\Github\Neko-Family-Proxy`.

```text
=============================================================================
T7 V1B CANDIDATE ARTIFACT AUTHORITY
=============================================================================
BACKEND_COMMIT:               5ad8e693e549b7d8b5b178f7269f9b1b737ac8bf
ADMIN_ARCH_COMMIT:            a35311d059e591430f99cb74bf70dca0f31cb435

WORKER_SOURCE_PATH:           agent/neko_discord_worker.py
WORKER_SOURCE_SHA256:         f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4

SYSTEMD_UNIT_PATH:            agent/systemd/neko-discord-worker.service
SYSTEMD_UNIT_SHA256:          74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94

ENV_EXAMPLE_PATH:             agent/neko-discord-worker.env.example
TEST_SUITE_PATH:              agent/tests/test_discord_worker.py
TEST_SUITE_STATUS:            29 / 29 TESTS PASS (100% Deterministic)
=============================================================================
```

```text
+---------------------------------------------------------------------------------------------------+
|                                      PHASE T7 STATUS MATRIX                                       |
+---------------------------------------------------------------------------------------------------+
|  Original T7A: Vercel Cron / DB Status Design      | SUPERSEDED (Commit d242c598...)              |
|  Phase T7 V1A: Legacy Discovery & Architecture     | CLOSED / FROZEN (Commit 6a59900a...)         |
|  Phase T7 V1B: Unified Lightsail Worker Candidate  | CLOSED / CANDIDATE READY (Commit 5ad8e693...)|
|  Phase T7 V1C: Production Staging & Cutover        | NEXT / PLANNED                               |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Technical Architecture & Frozen Authorities

| Component | Authoritative Technical Specification |
| :--- | :--- |
| **Execution Model** | `LONG_RUNNING_SYSTEMD_SERVICE` (`Type=simple` with continuous `select()` event loop) |
| **Systemd Timer** | `NO` (Continuous `AF_PACKET` packet collection prevents traffic loss between runs) |
| **Traffic Authority** | `SHADOWSOCKS_PORT_8388_FILTERED_TRAFFIC` (`AF_PACKET` raw socket on `ens5` port `8388`) |
| **Download Direction**| Outbound packets on `ens5` from source port `8388` (VPS $\rightarrow$ client) |
| **Upload Direction** | Inbound packets on `ens5` to destination port `8388` (client $\rightarrow$ VPS) |
| **Traffic Summary Metric** | `TIME_WEIGHTED_AVERAGE_THROUGHPUT` |
| **Average Throughput Formula** | $\text{filtered\_window\_bytes} \times 8 / \text{actual\_elapsed\_seconds}$ (`bps`, `Kbps`, `Mbps`, `Gbps`) |
| **Window Totals** | `SECONDARY_DISPLAY` (Cumulative window formatted bytes displayed under average) |
| **Summary Interval** | 30-minute epoch-aligned (`1800s`), 1 MiB minimum reporting threshold |
| **Current Status Message** | Single persistent message edited in-place every ~60s (`PATCH /messages/{id}`) |
| **Transition Alerts** | Discrete embeds posted on confirmed transitions with 2-sample anti-flap & 300s cooldown |
| **Local State Path** | `/var/lib/neko/discord-state.json` (Atomic temp-file replace, `0600 root:root`) |
| **Webhook Secrets** | `/etc/neko/discord.env` (No secrets in Git, State file, or logs) |

---

## 3. Automated Test Suite Matrix

The unified worker is verified by 29 unit tests in `agent/tests/test_discord_worker.py`:

| Test Suite Class | Tests Run | Result | Key Invariants Verified |
| :--- | :---: | :---: | :--- |
| `TestPacketParsingAndFiltering` | 6 | **PASS** | TCP/UDP inbound/outbound on :8388 classified correctly; non-8388 and malformed ignored safely. |
| `TestUnitConversionsAndFormatting` | 4 | **PASS** | `format_bps` SI scaling, `format_bytes` IEC scaling, `format_uptime`, Thai period formatting. |
| `TestStatusModelAndDerivation` | 4 | **PASS** | `ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN` derivation; `STALE != OFFLINE` enforced. |
| `TestStatusStateMachineAndAntiFlap`| 4 | **PASS** | First run baseline (no alert), 2-sample anti-flap confirmation, deduplication, cooldown suppression. |
| `TestStatePersistence` | 2 | **PASS** | Atomic write round-trip, `0600` permissions, corrupt state fallback without crash loop. |
| `TestDiscordPayloads` | 2 | **PASS** | Current status embed fields (no Active Users), 30m summary average/total throughput. |
| `TestDiscordTransportMocks` | 4 | **PASS** | `200 OK`, `404 Not Found` handling, `429` rate-limit backoff, `500` server error bounded retry. |
| `TestTrafficSummaryThresholdsAndWorkerSimulation` | 3 | **PASS** | 1 MiB threshold gating, time-weighted average for arbitrary durations, full simulation tick flow. |
| **Total Test Suite** | **29** | **PASS** | **100% Unit Test Pass Rate** |

---

## 4. Known Operational Limitations

1. **Full Host Outage Limitation (`FULL_HOST_OUTAGE_EXTERNAL_DETECTION = NOT_PROVIDED_IN_T7_V1`)**:
   Because the worker runs locally on the Japan Lightsail VPS, it cannot self-alert Discord if the entire host crashes or loses network connectivity.
2. **No Fake Traffic Continuity**:
   Traffic missed while the worker process was stopped cannot be reconstructed; the worker anchors a clean baseline on restart.
3. **No Active Users or Session Data**:
   Intentionally removed to decouple Discord completely from Supabase, Backend API, and Vercel Cron.

---

## 5. Phase T7 V1C Cutover Requirements (Next Phase)

Phase **T7 V1C** will execute the live production deployment on AWS Lightsail:

1. Stage committed `agent/neko_discord_worker.py` and `agent/systemd/neko-discord-worker.service` to `/opt/neko/` and `/etc/systemd/system/`.
2. Stage `/etc/neko/discord.env` referencing existing protected webhook URL.
3. Start `neko-discord-worker.service` and verify initial persistent status embed creation.
4. Verify 30-minute traffic summary output and state persistence in `/var/lib/neko/discord-state.json`.
5. Stop and disable legacy `neko-traffic-monitor.service`.
6. Verify exactly ONE publisher remains active with zero duplicate Discord messages.
7. Record live Discord production proof.
