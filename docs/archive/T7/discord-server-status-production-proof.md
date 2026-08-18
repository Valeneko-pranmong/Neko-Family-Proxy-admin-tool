# NEKO FAMILY PROXY — DISCORD SERVER STATUS & ALERTING PRODUCTION PROOF (PHASE T7 V1C)

```text
DOCUMENT:               docs/current/discord-server-status-production-proof.md
STATUS:                 AUTHORITATIVE PRODUCTION PROOF RECORD
CLASSIFICATION:         LIVE ENVIRONMENT VERIFICATION EVIDENCE
PHASE:                  T7 V1C (AWS Lightsail Production Cutover & Proof)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
DATE:                   2026-08-18
T7_V1C_EXIT_GATE:       PASS
T7_V1_STATUS:           PRODUCTION CLOSED & VERIFIED
```

---

## 1. Executive Summary & Production Gate Verification

Phase **T7 V1C (AWS Lightsail Production Cutover & Proof)** has successfully deployed, verified, and stabilized the unified Discord status worker daemon (`neko-discord-worker.service`) on the live AWS Lightsail Japan VPS:

```text
=============================================================================
PRODUCTION AUTHORITY & CUTOVER GATE
=============================================================================
ADMIN_ARCH_COMMIT:            a35311d059e591430f99cb74bf70dca0f31cb435
ADMIN_DOC_COMMIT:             b33db64e2b480b5851943b15f396779dca77917b
BACKEND_SERVER_COMMIT:        5ad8e693e549b7d8b5b178f7269f9b1b737ac8bf

SERVER_REMOTE_AUTHORITY:      PASS (Pushed to origin/feature/neko-auth-lite-v1-launcher-backend)
ADMIN_REMOTE_AUTHORITY:       PASS (Pushed to origin/main)

DEPLOYED_WORKER_PATH:         /opt/neko/neko_discord_worker.py (0755 root:root)
DEPLOYED_WORKER_SHA256:       f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4
EXPECTED_WORKER_SHA256:       f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4
WORKER_SHA256_MATCH:          EXACT (100% Match)

DEPLOYED_UNIT_PATH:           /etc/systemd/system/neko-discord-worker.service (0644 root:root)
DEPLOYED_UNIT_SHA256:         74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94
EXPECTED_UNIT_SHA256:         74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94
UNIT_SHA256_MATCH:            EXACT (100% Match)

SYSTEMD_UNIT_VERIFY:          PASS (systemd-analyze verify clean)
PROTECTED_ENV_PATH:           /etc/neko/discord.env (0600 root:root)
PRODUCTION_WEBHOOK_REUSED:    YES (Secure server-side transfer; secret never exposed)
STATE_FILE_PATH:              /var/lib/neko/discord-state.json (0600 root:root)

UNIFIED_WORKER_STATE:         ACTIVE & ENABLED (PID 50924)
LEGACY_SERVICE_STATE:         INACTIVE & DISABLED (Rollback artifacts retained)
ACTIVE_DISCORD_PUBLISHERS:    1 (Exact single-publisher authority)
=============================================================================
```

---

## 2. Controlled Production Cutover Execution Record

Cutover was executed following the strict non-overlapping sequence (`STAGE -> VERIFY -> STOP LEGACY -> START UNIFIED`):

1. **Staging & Hash Verification**:
   - `neko_discord_worker.py` staged to `/opt/neko/` with `0755 root:root`.
   - `neko-discord-worker.service` staged to `/etc/systemd/system/` with `0644 root:root`.
   - Hashes independently computed on Japan VPS:
     - Worker SHA256: `f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4`
     - Unit SHA256: `74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94`
2. **Environment & Webhook Re-use**:
   - Provisioned webhook securely transferred from `/etc/neko-traffic-monitor.env` to `/etc/neko/discord.env` without displaying or logging secret tokens.
   - Permissions verified: `0600 root:root`.
3. **Cutover Switch**:
   ```bash
   sudo systemctl stop neko-traffic-monitor.service
   sudo systemctl daemon-reload
   sudo systemctl start neko-discord-worker.service
   ```
   Result: Legacy stopped immediately, Unified started with zero dual-publishing.
4. **Enablement & Rollback Authority**:
   - `neko-discord-worker.service` enabled (`multi-user.target.wants`).
   - `neko-traffic-monitor.service` disabled.
   - Legacy rollback files (`/usr/local/lib/neko-traffic-monitor/neko_traffic_monitor.py`, `/etc/systemd/system/neko-traffic-monitor.service`, `/etc/neko-traffic-monitor.env`) retained on VPS.

---

## 3. Live Operational Evidence & Verification

### 3.1 Raw Socket & Packet Accounting Proof
- Worker socket opened successfully via `AF_PACKET` raw socket on `ens5` port `8388`.
- Capability bounding set `CAP_NET_RAW` authorized without full root privilege escalation.
- Log record:
  ```text
  [2026-08-18 06:54:45 UTC] STARTING_DISCORD_WORKER | interface=ens5 | port=8388
  [2026-08-18 06:54:45 UTC] DISCORD_WORKER_READY | next_summary_epoch=1787036400
  ```

### 3.2 Persistent Current Status Embed Proof
- First run safely created persistent Discord message and captured message ID:
  ```text
  [2026-08-18 06:54:50 UTC] CREATING_PERSISTENT_STATUS_MESSAGE
  [2026-08-18 06:54:51 UTC] PERSISTENT_STATUS_MESSAGE_CREATED | message_id=1539165666089762837
  ```
- Second & subsequent ticks (~60s cadence) edited message `1539165666089762837` in-place via HTTP `PATCH`:
  ```text
  last_status_edit_at: 1787036151 (06:55:51 UTC)
  last_status_edit_at: 1787036211 (06:56:51 UTC)
  last_status_edit_at: 1787036271 (06:57:51 UTC)
  last_status_edit_at: 1787036331 (06:58:51 UTC)
  last_status_edit_at: 1787036391 (06:59:51 UTC)
  ```
- Message ID before vs after: **`1539165666089762837`** (Identical).
- `NEW_STATUS_MESSAGE_CREATED_ON_SECOND_TICK = NO`.
- Zero duplicate status messages generated.

### 3.3 30-Minute Epoch-Aligned Traffic Summary & Threshold Gating Proof
- Epoch boundary reached at `07:00:00 UTC` (14:00:00 Bangkok).
- Observed partial first window: `06:54:45 → 07:00:00 UTC` (5m 15s elapsed).
- Filtered port 8388 byte total: `0 bytes` (< 1,048,576 bytes threshold).
- Worker honestly skipped message delivery as designed:
  ```text
  [2026-08-18 07:00:00 UTC] TRAFFIC_SUMMARY_SKIPPED_BELOW_THRESHOLD | total_bytes=0 | min_bytes=1048576
  ```
- State window rolled over cleanly: `window_start_time = 1787036400`, `window_inbound_bytes = 0`, `window_outbound_bytes = 0`.
- No artificial traffic manufactured.

### 3.4 Persistent State File Proof (`/var/lib/neko/discord-state.json`)
State file inspected on Japan VPS:
```json
{
  "version": 1,
  "status_message_id": "1539165666089762837",
  "window_start_time": 1787036400,
  "window_inbound_bytes": 0,
  "window_outbound_bytes": 0,
  "confirmed_status": "ONLINE",
  "pending_status": null,
  "pending_count": 0,
  "last_alert_status": "ONLINE",
  "last_alert_at": 829331.684150404,
  "last_status_edit_at": 1787036391.2449064,
  "last_checkpoint_at": 1787036400.461479
}
```
- Mode: `0600 root:root`.
- Secrets contained: **`NO`**.

---

## 4. Production Service Health & Failure Isolation

### 4.1 Proxy & Server Monitoring Service Verification
During and after the Discord worker cutover:
- `shadowsocks-libev.service`: **`active (running)`**
- TCP & UDP port `8388`: **`LISTENING`** (pid 431 `ss-server`)
- `neko-server-monitor.service`: **`active (running)`** (pid 46806, advancing metrics every 5s)
- Proxy routing regression: **`NONE`**
- Monitoring agent regression: **`NONE`**

### 4.2 Resource Utilization & Process Metrics (Soak Evidence)
```text
Service:              neko-discord-worker.service
Main PID:             50924 (python3)
State:                active (running)
Uptime / Soak:        > 15 minutes continuous
Memory (RSS):         14.0 MB (systemd cgroup), 25.3 MB (proc RSS)
CPU Time:             < 1.0s total across soak window
Restart Count:        0
CGroup:               /system.slice/neko-discord-worker.service
```

---

## 5. Security, Secret & Privacy Audit Record

| Audit Item | Scope | Result | Details |
| :--- | :--- | :---: | :--- |
| **Webhook URL Storage** | Production Env | **PASS** | Stored strictly in `/etc/neko/discord.env` (`0600 root:root`). |
| **Webhook URL in Git** | Admin & Backend | **PASS** | 0 webhook secrets in tracked files (`.env.example` used). |
| **Webhook URL in State** | Local State | **PASS** | `/var/lib/neko/discord-state.json` contains 0 URLs or tokens. |
| **Webhook URL in Logs** | Systemd Journal | **PASS** | Journal contains 0 webhook URLs or query tokens. |
| **Packet Payload Audit** | AF_PACKET Reader | **PASS** | Header sniffing only on port 8388. 0 payload stored, logged, or sent. |
| **User Privacy Audit** | Discord Embeds | **PASS** | 0 active users, 0 usernames, 0 user IDs, 0 sessions, 0 client IPs. |
| **Single Publisher** | Process Count | **PASS** | Exactly 1 publisher active (`neko-discord-worker.service`). |

---

## 6. Known Operational Invariants & Limitations

1. **Full Host Outage Limitation (`FULL_HOST_OUTAGE_EXTERNAL_DETECTION = NOT_PROVIDED_IN_T7_V1`)**:
   Because the unified worker runs locally on the Japan Lightsail VPS, it cannot self-alert Discord if the entire host loses power or network reachability.
2. **Transition Alert Verification Policy**:
   In Phase T7 V1C, Shadowsocks was **NOT** intentionally broken to manufacture a false alert. The alert state machine is certified by the 29/29 deterministic unit tests (`V1B_ALERT_TEST_AUTHORITY = PASS`), and classified on production as `PRODUCTION_REAL_TRANSITION_ALERT = NOT_TRIGGERED_NO_NATURAL_EVENT`.
3. **No Fake Traffic Continuity**:
   Traffic is measured strictly during live worker execution; no artificial throughput is backfilled across service restarts.

---

## 7. Final Phase T7 V1 Exit Gate Assessment

```text
=============================================================================
FINAL EXIT GATE ASSESSMENT
=============================================================================
SERVER_REMOTE_AUTHORITY:              PASS
ADMIN_T7_V1B_REMOTE_AUTHORITY:        PASS
PRODUCTION_WORKER_SHA256:             PASS (f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4)
PRODUCTION_UNIT_SHA256:               PASS (74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94)
SYSTEMD_UNIT_VERIFY:                  PASS
PRODUCTION_WEBHOOK_REUSED:            YES
WEBHOOK_VALUE_PRINTED:                NO
LEGACY_SERVICE_ACTIVE:                NO (inactive)
LEGACY_SERVICE_ENABLED:               NO (disabled)
UNIFIED_WORKER:                       ACTIVE (running)
UNIFIED_WORKER_ENABLED:               YES (enabled)
AF_PACKET_PRODUCTION:                 PASS (ens5:8388)
SHADOWSOCKS:                          ACTIVE (listening)
LISTENER_8388:                        LISTENING (TCP/UDP)
MONITORING_AGENT:                     ACTIVE (advancing)
CURRENT_STATUS_CREATED:               PASS (id 1539165666089762837)
PERSISTENT_STATUS_EDIT:               PASS (PATCH in-place updates)
DUPLICATE_DISCORD_MESSAGES:           NO
REAL_TIME_WEIGHTED_AVERAGE:           NOT_YET_ELIGIBLE (0 bytes < 1MB threshold, skipped per design)
PRIVACY:                              PASS
SECRET_AUDIT:                         PASS
DISCORD_PUBLISHER_COUNT:              1
DOCUMENTATION:                        PASS

OVERALL RESULT:                       PASS
=============================================================================
```
