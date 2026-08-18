# NEKO FAMILY PROXY — WEEKLY MAINTENANCE AUTOMATION & EXECUTION PRODUCTION PROOF (PHASES T9B & T9C)

```text
DOCUMENT:               docs/current/weekly-maintenance-automation-production-proof.md
STATUS:                 AUTHORITATIVE PRODUCTION PROOF RECORD
CLASSIFICATION:         LIVE ENVIRONMENT DEPLOYMENT & EXECUTION EVIDENCE
PHASE:                  T9B (Production Scheduler Rollout) & T9C (Controlled First Maintenance Execution Proof)
PREVIOUS_PHASES:        T9A (Candidate Implementation & Discovery — CLOSED)
CURRENT_PHASES:         T9B (Scheduler Deployed — PASS) & T9C (First Execution Proof — PASS)
SUCCESSOR_PHASE:        T9_FINAL_REMOTE_EVIDENCE_CLOSURE
PRIMARY_TEAM:           TEAM_COORDINATION
SUPPORT_TEAM:           TEAM_WEB
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
SERVER_COMMIT:          8832429a7546ab57dd8ac3a48b40b93387cb9f19
ADMIN_T9A_COMMIT:       ac5f64778f38406a257137f831afa7b733dc4f35
DATE:                   2026-08-18
T9B_EXIT_GATE:          PASS
T9C_EXIT_GATE:          PASS
FIRST_MAINTENANCE_PROOF: CONTROLLED OWNER-AUTHORIZED SYSTEMD SERVICE EXECUTION (SAME SERVICE AS TIMER)
WEEKLY_TIMER_STATE:     LIVE & ACTIVE (Next natural run: Tuesday 02:00 Asia/Bangkok)
```

---

## 1. Executive Summary & Verification Matrix

Phase **T9B (Scheduler Rollout)** and Phase **T9C (Controlled First Maintenance Execution Proof)** have successfully installed, enabled, and executed the automated weekly maintenance pipeline on the live AWS Lightsail Japan host (`18.178.140.8`).

Owner authorization was granted to perform the first maintenance proof immediately via the authoritative systemd service (`neko-weekly-maintenance.service`) rather than waiting for the next natural Tuesday 02:00 window.

```text
=============================================================================
PRODUCTION AUTHORITY & ARTIFACT VERIFICATION
=============================================================================
SERVER_COMMIT:                      8832429a7546ab57dd8ac3a48b40b93387cb9f19
SERVER_BRANCH:                      feature/neko-auth-lite-v1-launcher-backend
ADMIN_T9A_COMMIT:                   ac5f64778f38406a257137f831afa7b733dc4f35
ADMIN_BRANCH:                       main

SERVER_REMOTE_AUTHORITY:            PASS (Pushed to remote origin; ahead 0, behind 0)
ADMIN_REMOTE_AUTHORITY:             PASS (Pushed to remote origin; ahead 0, behind 0)

1. Maintenance Controller:
   Path:                            /opt/neko/neko_weekly_maintenance.py (0755 root:root)
   Deployed SHA256:                 4a68faacd28c7b166d2c4906048328d59f18235da9f11562f61f8067e64273ce
   Expected SHA256:                 4a68faacd28c7b166d2c4906048328d59f18235da9f11562f61f8067e64273ce
   Match:                           EXACT (100% Match)

2. Maintenance Systemd Service:
   Path:                            /etc/systemd/system/neko-weekly-maintenance.service (0644 root:root)
   Deployed SHA256:                 32d40bfa2945ceb68ec80ee201a9d0ec10c89aa45ad3827cf9a8e5997fc0a4d7
   Expected SHA256:                 32d40bfa2945ceb68ec80ee201a9d0ec10c89aa45ad3827cf9a8e5997fc0a4d7
   Match:                           EXACT (100% Match)

3. Maintenance Systemd Timer:
   Path:                            /etc/systemd/system/neko-weekly-maintenance.timer (0644 root:root)
   Deployed SHA256:                 1d43df76b4218df1034f70efd1c9402b8b7725415b6d7b0bf8e12a1932ec1ac8
   Expected SHA256:                 1d43df76b4218df1034f70efd1c9402b8b7725415b6d7b0bf8e12a1932ec1ac8
   Match:                           EXACT (100% Match)

ALL_PRODUCTION_HASHES:              PASS (3 / 3 Exact Match)
=============================================================================
```

---

## 2. Phase T9B: Live Systemd Calendar & Timer Activation Proof

```bash
systemd-analyze calendar "Tue *-*-* 02:00:00 Asia/Bangkok"
systemctl list-timers neko-weekly-maintenance.timer --all
systemctl show neko-weekly-maintenance.timer
```

**Host Output**:
```text
Normalized form: Tue *-*-* 02:00:00 Asia/Bangkok
    Next elapse: Mon 2026-08-24 19:00:00 UTC
       From now: 6 days left

NEXT                        LEFT        LAST PASSED UNIT                          ACTIVATES
Mon 2026-08-24 19:00:00 UTC 6 days left n/a  n/a    neko-weekly-maintenance.timer neko-weekly-maintenance.service

Unit=neko-weekly-maintenance.service
AccuracyUSec=1s
RandomizedDelayUSec=0
Persistent=no
LoadState=loaded
ActiveState=active
SubState=waiting
```

---

## 3. Phase T9C: Controlled Maintenance Execution & Real Host Reboot Proof

### 3.1 Pre-Reboot Baseline
- **Host Uptime Before**: `9d 16h 15m`
- **Kernel Boot ID Before**: `a1f67ac6-3f05-4e75-8209-d0c484972f4a`
- **Discord Status Message ID**: `1539165666089762837` (PRESENT)
- **Confirmed Status**: `ONLINE`
- **Weekly Timer Before**: `Mon 2026-08-24 19:00:00 UTC` (`Tue 2026-08-25 02:00:00 Asia/Bangkok`)

### 3.2 Maintenance Service Invocation
Triggered via:
```bash
sudo systemctl start neko-weekly-maintenance.service
```

**Host Journal Log Evidence (`neko-weekly-maintenance.service`)**:
```text
[2026-08-18 08:48:00 UTC] MAINTENANCE_SEQUENCE_START | mode=EXECUTE
[2026-08-18 08:48:00 UTC] STOPPING_DISCORD_WORKER | service=neko-discord-worker.service
[2026-08-18 08:48:00 UTC] WORKER_SERVICE_STATE | state=inactive
[2026-08-18 08:48:00 UTC] EDITING_PERSISTENT_MAINTENANCE_STATUS | message_id=1539165666089762837
[2026-08-18 08:48:00 UTC] MAINTENANCE_STATUS_PUBLISHED_IN_PLACE | message_id=1539165666089762837
[2026-08-18 08:48:00 UTC] EXECUTING_ORDERLY_REBOOT | command=systemctl reboot
[2026-08-18 08:48:00 UTC] MAINTENANCE_SEQUENCE_COMPLETE | reboot_status=TRIGGERED
```

### 3.3 Reboot Timing & Host Return
- **Reboot Initiated**: `2026-08-18 08:48:09 UTC` (SSH connection closed by remote host)
- **SSH Connectivity Returned**: `2026-08-18 08:48:25 UTC`
- **Approximate Host Downtime**: **16.4 seconds**

### 3.4 Real Host Reboot Proof
- **Host Uptime After**: `0m` (19.14 seconds)
- **Kernel Boot ID After**: `28c81f14-8c23-4e88-86b1-078a19831196` (**Changed — Real Reboot Proven**)

---

## 4. Post-Boot Service Recovery & Discord Real-Health Proof

### 4.1 Daemon Startup & Listener Verification
- `shadowsocks-libev.service`: **ACTIVE** (PID 444, enabled, 0 restarts)
- `neko-server-monitor.service`: **ACTIVE** (PID 445, enabled, 0 restarts)
- `neko-discord-worker.service`: **ACTIVE** (PID 602, enabled, 0 restarts)
- `neko-weekly-maintenance.service`: **INACTIVE** (Oneshot completed cleanly)
- `TCP / UDP Listener :8388`: **LISTENING**

### 4.2 Discord Same-Message Real Health Recovery
- **Discord Worker Startup Log**:
  ```text
  [CONFIG_CHECK] SUCCESS: Configuration is valid. (interface=ens5, port=8388, state=/var/lib/neko/discord-state.json)
  [2026-08-18 08:48:18 UTC] STARTING_DISCORD_WORKER | interface=ens5 | port=8388
  [2026-08-18 08:48:18 UTC] DISCORD_WORKER_READY | next_summary_epoch=1787043600
  ```
- **State Integrity (`/var/lib/neko/discord-state.json`)**:
  - `status_message_id`: `1539165666089762837` (**EXACT SAME MESSAGE PRESERVED**)
  - `confirmed_status`: `ONLINE` (**Derived from real probe health**)
  - `last_status_edit_at`: `1787043144.2512956` (In-place edit confirmed)
- **Duplicate Message Creation**: **NO** (Zero extra messages)
- **False Alert Storm**: **NO** (Zero false degraded, recovery, or stale alerts dispatched)

---

## 5. Weekly Maintenance Timer Post-Reboot Survival

```bash
systemctl list-timers neko-weekly-maintenance.timer --all
```

**Host Output**:
```text
NEXT                        LEFT        LAST PASSED UNIT                          ACTIVATES
Mon 2026-08-24 19:00:00 UTC 6 days left n/a  n/a    neko-weekly-maintenance.timer neko-weekly-maintenance.service

1 timers listed.
```

- **Timer State**: `active (waiting)`
- **Enabled on Boot**: `enabled`
- **Next Scheduled Execution**: `Mon 2026-08-24 19:00:00 UTC` (= `Tue 2026-08-25 02:00:00 Asia/Bangkok`)
- **Timer Settings Preserved**: `Persistent=no`, `AccuracySec=1s`, `RandomizedDelaySec=0`

---

## 6. Post-Reboot Soak & Operational Health (5-Minute Soak)

```bash
sudo /opt/neko/neko_ops_status.py
```

**Host Output**:
```text
=============================================================================
NEKO FAMILY PROXY — PRODUCTION OPS DIAGNOSTICS
=============================================================================
HOST:               ip-172-26-29-162 (Ubuntu 22.04.5 LTS / 6.8.0-1061-aws)
UPTIME:             5m | Load: 0.00, 0.02, 0.00
RAM USAGE:          385.3 MiB / 914.0 MiB (528.7 MiB available)
DISK USAGE:         3.65 GiB / 38.58 GiB (9.5% used, 34.91 GiB free)
JOURNAL USAGE:      368.0M

SERVICES:
  shadowsocks-libev:    ACTIVE (PID: 444, Restarts: 0, Mem: 1.7 MiB)
  neko-server-monitor:  ACTIVE (PID: 445, Restarts: 0, Mem: 10.0 MiB)
  neko-discord-worker:  ACTIVE (PID: 602, Restarts: 0, Mem: 14.5 MiB)
  neko-traffic-monitor: INACTIVE (Enabled: disabled, Rollback Authority)

NETWORK & LISTENERS:
  TCP Listener :8388:  LISTENING

STATE INTEGRITY:
  discord-state.json:   VALID (Size: 396 B, Mode: 0o600, Status: ONLINE)
  Persistent Msg ID:    PRESENT
  Orphan Temp Files:    0
=============================================================================
OVERALL STATUS:         ALL SYSTEMS HEALTHY (0_HEALTHY)
=============================================================================
```

---

## 7. Active Proxy & Probe Infrastructure Authority

```text
=============================================================================
ACTIVE INFRASTRUCTURE AUTHORITY MATRIX
=============================================================================
CURRENT_PROXY_PROTOCOL:             SHADOWSOCKS
CURRENT_PROXY_IMPLEMENTATION:       shadowsocks-libev (shadowsocks-libev.service)
CURRENT_PROXY_PORT:                 8388
CURRENT_PROXY_CIPHER:               aes-128-gcm
PROXY_CIPHER_SOURCE:                AWS LIGHTSAIL ACTIVE CONFIG (/etc/shadowsocks-libev/config.json)
SEGA_PROBE_AUTHORITY:               BLOCKED_PENDING_AUTHORITY
CURRENT_PING_TARGET:                1.1.1.1
CURRENT_PING_LABEL:                 Ping (Proxy VPS → Upstream)
PING_LABEL_FALSE_CLAIM:             NO
CORE_SOURCE_CHANGED:                NO
CLIENT_TELEMETRY_ADDED:             NO
=============================================================================
```

---

## 8. Final Status Classification

```text
T9A (Controller & Unit Candidate):             CLOSED
T9B (Production Scheduler Rollout):             CLOSED & LIVE
T9C (Controlled First Maintenance Execution):   CLOSED (FULL LIFECYCLE PROVEN)
WEEKLY_MAINTENANCE_TIMER:                       LIVE (Next trigger: Tuesday 02:00 Asia/Bangkok)
DISCORD_STATUS_RECOVERY:                        PROVEN (In-place edit 🛠️ MAINTENANCE -> ONLINE)
REBOOT_DOWNTIME_OBSERVED:                       16.4 seconds
PRODUCTION_HEALTH:                              0_HEALTHY
```
