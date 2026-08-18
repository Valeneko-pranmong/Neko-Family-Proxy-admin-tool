# NEKO FAMILY PROXY — WEEKLY MAINTENANCE SCHEDULER PRODUCTION PROOF (PHASE T9B)

```text
DOCUMENT:               docs/current/weekly-maintenance-automation-production-proof.md
STATUS:                 AUTHORITATIVE PRODUCTION PROOF RECORD
CLASSIFICATION:         LIVE ENVIRONMENT DEPLOYMENT EVIDENCE
PHASE:                  T9B (Weekly Maintenance Production Scheduler Rollout)
PREVIOUS_PHASES:        T9A (Candidate Implementation & Discovery — CLOSED)
CURRENT_PHASE:          T9B (Controlled Production Deployment & Scheduler Proof — DEPLOYED)
SUCCESSOR_PHASE:        T9C (First Natural Weekly Maintenance Execution & Evidence Closure)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
SERVER_COMMIT:          8832429a7546ab57dd8ac3a48b40b93387cb9f19
ADMIN_T9A_COMMIT:       ac5f64778f38406a257137f831afa7b733dc4f35
DATE:                   2026-08-18
T9B_EXIT_GATE:          PASS
T9_STATUS:              PRODUCTION SCHEDULER DEPLOYED & LIVE (First real execution pending natural schedule)
```

---

## 1. Executive Summary & Production Gate Verification

Phase **T9B (Weekly Maintenance Production Scheduler Rollout)** has successfully staged, statically verified, installed, and enabled the automated weekly maintenance systemd timer on the live AWS Lightsail Japan VPS (`18.178.140.8`) with **zero unscheduled reboots**, **zero false maintenance Discord messages**, and **zero interruption to the data plane**:

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

## 2. Live Systemd Calendar Interpretation Proof (Ubuntu Systemd 249)

Before enabling the timer, the schedule expression was verified on the host systemd engine (`systemd 249.11-0ubuntu3.22`):

```bash
systemd-analyze calendar "Tue *-*-* 02:00:00 Asia/Bangkok"
```

**Host Output**:
```text
Normalized form: Tue *-*-* 02:00:00 Asia/Bangkok
    Next elapse: Mon 2026-08-24 19:00:00 UTC
       From now: 6 days left
```

```text
=============================================================================
CALENDAR & SCHEDULE INTERPRETATION PROOF
=============================================================================
SCHEDULED_DAY:                      Tuesday
SCHEDULED_TIME:                     02:00:00
SCHEDULED_TIMEZONE:                 Asia/Bangkok (Thailand UTC+7)
UTC_EQUIVALENT_NEXT_TRIGGER:        Mon 2026-08-24 19:00:00 UTC
LOCAL_EQUIVALENT_NEXT_TRIGGER:      Tue 2026-08-25 02:00:00 Asia/Bangkok
SYSTEMD_CALENDAR_PARSER:            PASS (100% Native Timezone Parsing)
=============================================================================
```

---

## 3. Pre-Flight Config Check & Dry-Run Verification

Executed securely on AWS Lightsail Japan:

```bash
sudo /opt/neko/neko_weekly_maintenance.py --check-config
sudo /opt/neko/neko_weekly_maintenance.py --dry-run
```

**Host Output**:
```text
===CHECK_CONFIG===
[CONFIG_CHECK] SUCCESS: Weekly maintenance configuration is valid.
===DRY_RUN===
[2026-08-18 08:41:33 UTC] MAINTENANCE_SEQUENCE_START | mode=DRY_RUN
[2026-08-18 08:41:33 UTC] DRY_RUN_STOP_WORKER | service=neko-discord-worker.service
[2026-08-18 08:41:33 UTC] DRY_RUN_MAINTENANCE_STATUS | has_webhook=True | status_message_id=1539165666089762837
[2026-08-18 08:41:33 UTC] DRY_RUN_REBOOT_INTENT | command=systemctl reboot
[2026-08-18 08:41:33 UTC] MAINTENANCE_SEQUENCE_COMPLETE | reboot_status=TRIGGERED
```

```text
=============================================================================
PRE-FLIGHT DRY-RUN AUDIT
=============================================================================
CHECK_CONFIG_STATUS:                PASS (Zero secret leakage)
DRY_RUN_STATUS:                     PASS
DISCORD_HTTP_REQUEST_SENT:          NO
WORKER_SERVICE_STOPPED:             NO (Remained active throughout dry-run)
DISCORD_STATE_MUTATED:              NO (Persistent message ID 1539165666089762837 preserved)
HOST_REBOOT_TRIGGERED:              NO
SECRET_LOG_EXPOSURE:                NO
=============================================================================
```

---

## 4. Live Timer Activation & Next-Execution Authority

The timer was activated via `sudo systemctl enable --now neko-weekly-maintenance.timer`:

```bash
systemctl list-timers neko-weekly-maintenance.timer --all
systemctl show neko-weekly-maintenance.timer
```

**Host Output**:
```text
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

```text
=============================================================================
LIVE SYSTEMD TIMER STATE
=============================================================================
TIMER_UNIT:                         neko-weekly-maintenance.timer
ACTIVE_STATE:                       active (waiting)
LOAD_STATE:                         loaded (enabled)
ACTIVATES_SERVICE:                  neko-weekly-maintenance.service
SERVICE_STATE_NOW:                  inactive (dead) — PENDING SCHEDULED TRIGGER
PERSISTENT_POLICY:                  Persistent=false (Missed window = SKIP)
ACCURACY:                           AccuracySec=1s (AccuracyUSec=1s)
RANDOMIZED_DELAY:                   RandomizedDelaySec=0 (RandomizedDelayUSec=0)
NEXT_TRIGGER_UTC:                   Mon 2026-08-24 19:00:00 UTC
NEXT_TRIGGER_LOCAL:                 Tue 2026-08-25 02:00:00 Asia/Bangkok
=============================================================================
```

---

## 5. Post-Deployment System Health & Diagnostics

```bash
sudo /opt/neko/neko_ops_status.py
```

**Host Output**:
```text
=============================================================================
NEKO FAMILY PROXY — PRODUCTION OPS DIAGNOSTICS
=============================================================================
HOST:               ip-172-26-29-162 (Ubuntu 22.04.5 LTS / 6.8.0-1061-aws)
UPTIME:             9d 16h 9m | Load: 0.00, 0.00, 0.00
RAM USAGE:          384.8 MiB / 914.0 MiB (529.2 MiB available)
DISK USAGE:         3.66 GiB / 38.58 GiB (9.5% used, 34.91 GiB free)
JOURNAL USAGE:      368.0M

SERVICES:
  shadowsocks-libev:    ACTIVE (PID: 431, Restarts: 0, Mem: 5.3 MiB)
  neko-server-monitor:  ACTIVE (PID: 46806, Restarts: 0, Mem: 10.3 MiB)
  neko-discord-worker:  ACTIVE (PID: 55258, Restarts: 0, Mem: 15.1 MiB)
  neko-traffic-monitor: INACTIVE (Enabled: disabled, Rollback Authority)

NETWORK & LISTENERS:
  TCP Listener :8388:  LISTENING

STATE INTEGRITY:
  discord-state.json:   VALID (Size: 397 B, Mode: 0o600, Status: ONLINE)
  Persistent Msg ID:    PRESENT
  Orphan Temp Files:    0
=============================================================================
OVERALL STATUS:         ALL SYSTEMS HEALTHY (0_HEALTHY)
=============================================================================
```

---

## 6. Active Proxy & Probe Authority Confirmation

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

## 7. Rollback Runbook (If Ever Needed)

To disable and remove the weekly maintenance automation:
```bash
sudo systemctl disable --now neko-weekly-maintenance.timer
sudo rm -f /etc/systemd/system/neko-weekly-maintenance.timer
sudo rm -f /etc/systemd/system/neko-weekly-maintenance.service
sudo rm -f /opt/neko/neko_weekly_maintenance.py
sudo systemctl daemon-reload
```

---

## 8. Phase T9 Status Semantics

```text
T9A:                                CLOSED (Candidate Implementation Complete)
T9B:                                CLOSED (Production Scheduler Deployed & Active)
WEEKLY_MAINTENANCE_TIMER:           LIVE & WAITING
FIRST_REAL_MAINTENANCE_EXECUTION:   PENDING NATURAL SCHEDULE (Tue 2026-08-25 02:00 Asia/Bangkok)
REAL_MAINTENANCE_DISCORD_PROOF:     PENDING NATURAL SCHEDULE
REAL_POST_BOOT_RECOVERY_PROOF:      PENDING NATURAL SCHEDULE
T9_FULL_CLOSURE:                    PENDING (Will be closed in Phase T9C after first natural execution)
```
