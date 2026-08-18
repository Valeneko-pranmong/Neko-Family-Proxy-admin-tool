# NEKO FAMILY PROXY — PRODUCTION OPERATIONS HARDENING PROOF (PHASE T8C)

```text
DOCUMENT:               docs/current/production-operations-hardening-production-proof.md
STATUS:                 AUTHORITATIVE PRODUCTION PROOF RECORD
CLASSIFICATION:         LIVE ENVIRONMENT VERIFICATION EVIDENCE
PHASE:                  T8C (Controlled Production Operations Hardening Rollout + Proof)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
DATE:                   2026-08-18
T8C_EXIT_GATE:          PASS
T8_STATUS:              PRODUCTION HARDENING DEPLOYED & VERIFIED
```

---

## 1. Executive Summary & Production Gate Verification

Phase **T8C (Controlled Production Operations Hardening Rollout + Proof)** has successfully deployed, verified, and stabilized all operational reliability controls on the live AWS Lightsail Japan VPS without creating data-plane proxy outages or altering backend database schemas:

```text
=============================================================================
PRODUCTION AUTHORITY & CUTOVER GATE
=============================================================================
SERVER_COMMIT:                  3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
SERVER_BRANCH:                  feature/neko-auth-lite-v1-launcher-backend
ADMIN_T8B_COMMIT:               077e523c9511b48b47c4e45720b448d0445399cf
ADMIN_BRANCH:                   main

SERVER_REMOTE_AUTHORITY:        PASS (Pushed to remote origin; ahead 0, behind 0)
ADMIN_REMOTE_AUTHORITY:         PASS (Pushed to remote origin; ahead 0, behind 0)

DEPLOYED_WORKER_PATH:           /opt/neko/neko_discord_worker.py (0755 root:root)
DEPLOYED_WORKER_SHA256:         86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c
EXPECTED_WORKER_SHA256:         86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c
WORKER_SHA256_MATCH:            EXACT (100% Match)

DEPLOYED_OPS_STATUS_PATH:       /opt/neko/neko_ops_status.py (0755 root:root)
DEPLOYED_OPS_STATUS_SHA256:     cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af
EXPECTED_OPS_STATUS_SHA256:     cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af
OPS_STATUS_SHA256_MATCH:        EXACT (100% Match)

DEPLOYED_DISCORD_UNIT_PATH:     /etc/systemd/system/neko-discord-worker.service (0644 root:root)
DEPLOYED_DISCORD_UNIT_SHA256:   3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b
EXPECTED_DISCORD_UNIT_SHA256:   3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b
DISCORD_UNIT_SHA256_MATCH:      EXACT (100% Match)

DEPLOYED_SS_DROPIN_PATH:        /etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf (0644 root:root)
DEPLOYED_SS_DROPIN_SHA256:      b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb
EXPECTED_SS_DROPIN_SHA256:      b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb
SS_DROPIN_SHA256_MATCH:         EXACT (100% Match)

DEPLOYED_JOURNAL_DROPIN_PATH:   /etc/systemd/journald.conf.d/10-neko-journal-cap.conf (0644 root:root)
DEPLOYED_JOURNAL_DROPIN_SHA256: e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84
EXPECTED_JOURNAL_DROPIN_SHA256: e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84
JOURNAL_DROPIN_SHA256_MATCH:    EXACT (100% Match)

ALL_PRODUCTION_HASHES:          PASS (5 / 5 Exact Match)
=============================================================================
```

---

## 2. Pre-Rollout Baseline Measurements

Recorded on AWS Lightsail Japan VPS prior to staging:

```text
=============================================================================
PRE-ROLLOUT BASELINE AUDIT
=============================================================================
HOST_OS:                        Ubuntu 22.04.5 LTS (6.8.0-1061-aws)
HOST_UPTIME:                    9 days, 15 hours
HOST_LOAD:                      0.00, 0.00, 0.00
HOST_RAM:                       914 MiB Total | 209 MiB Used | 534 MiB Available
HOST_ROOT_DISK:                 39 GB Total | 3.7 GB Used (10%) | 35 GB Free
HOST_JOURNAL_USAGE:             352.0M
PRE_ROLLOUT_WORKER_PID:         50924 (active, running, NRestarts=0)
PRE_ROLLOUT_WORKER_MEM:         15.1 MiB (MemoryCurrent=15859712)
PRE_ROLLOUT_WORKER_SHA256:      f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4
PRE_ROLLOUT_UNIT_SHA256:        74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94
SHADOWSOCKS_SERVICE:            active (running, MainPID: 431)
SHADOWSOCKS_LISTENER_8388:      tcp/udp LISTENING
SERVER_MONITOR_SERVICE:         active (running, MainPID: 46806)
LEGACY_MONITOR_SERVICE:         inactive (disabled)
=============================================================================
```

---

## 3. Staged Verification & Pre-Flight Execution

Artifacts were staged to protected temporary directory `/tmp/neko-t8c-20260818143251` on the VPS:

1. **SHA256 Verification on Staged Files**:
   - `10-neko-journal-cap.conf`: `e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84` (PASS)
   - `10-neko-recovery.conf`: `b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb` (PASS)
   - `neko-discord-worker.service`: `3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b` (PASS)
   - `neko_discord_worker.py`: `86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c` (PASS)
   - `neko_ops_status.py`: `cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af` (PASS)
2. **Staged Python Bytecode Compilation**:
   - `python3 -m py_compile neko_discord_worker.py`: PASS (Exit 0)
   - `python3 -m py_compile neko_ops_status.py`: PASS (Exit 0)
3. **Staged `--check-config` Pre-flight**:
   - Output: `[CONFIG_CHECK] SUCCESS: Configuration is valid. (interface=ens5, port=8388, state=/var/lib/neko/discord-state.json)`
   - Exit Code: `0`
   - Secrets Leaked: `NO`
   - Discord Request Sent: `NO`
   - State Mutated: `NO`
4. **Staged Ops Status Diagnostics**:
   - Output: `ALL SYSTEMS HEALTHY (0_HEALTHY)`
   - Exit Code: `0`

---

## 4. Protected Rollback Snapshot

Captured immediately prior to artifact replacement:

- **Directory**: `/opt/neko/rollback/t8c-20260818073350/` (`chmod 700 root:root`)
- **Archived Unit**: `/opt/neko/rollback/t8c-20260818073350/neko-discord-worker.service.pre-t8c` (SHA256: `74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94`)
- **Archived Worker**: `/opt/neko/rollback/t8c-20260818073350/neko_discord_worker.py.pre-t8c` (SHA256: `f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4`)

---

## 5. Systemd Static & Effective Configuration Verification

### 5.1 Static Verification
- `systemd-analyze verify /etc/systemd/system/neko-discord-worker.service`: PASS (Exit 0)
- `systemd-analyze cat-config journald.conf`: Output confirmed `[Journal] SystemMaxUse=500M`.

### 5.2 Shadowsocks Recovery Policy Verification
- Drop-in installed: `/etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf`
- Executed `systemctl daemon-reload`.
- Effective systemd inspection via `systemctl show shadowsocks-libev.service`:
  ```text
  Restart=always
  RestartUSec=5s
  StartLimitIntervalUSec=1min
  StartLimitBurst=5
  DropInPaths=/etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf
  ActiveState=active
  SubState=running
  MainPID=431
  ```
- **Recovery Policy Effective**: `VERIFIED_BY_SYSTEMD_EFFECTIVE_CONFIG`
- **Destructive Crash Testing**: `DESTRUCTIVE_FAILURE_INJECTION = NOT_PERFORMED`
- **Process Continuity**: `SHADOWSOCKS_PROCESS_INTERRUPTED = NO` (MainPID 431 remained continuously running)
- **Port Listener**: `tcp/udp :8388` continuously listening and unbroken.

### 5.3 Discord Worker Effective Policy Verification
- Unit installed: `/etc/systemd/system/neko-discord-worker.service`
- Effective systemd inspection via `systemctl show neko-discord-worker.service`:
  ```text
  Restart=always
  RestartUSec=5s
  StartLimitIntervalUSec=1min
  StartLimitBurst=5
  MemoryMax=134217728 (128M)
  TasksMax=16
  CapabilityBoundingSet=cap_net_raw
  AmbientCapabilities=cap_net_raw
  ExecStartPre=/usr/bin/python3 /opt/neko/neko_discord_worker.py --check-config
  Requires=sysinit.target system.slice -.mount
  PartOf=
  ```
- No tight couplings (`Requires=shadowsocks-libev.service` or `PartOf=` omitted to prevent cascade restarts).

### 5.4 Journald Capacity Verification
- Drop-in installed: `/etc/systemd/journald.conf.d/10-neko-journal-cap.conf`
- Executed `systemctl kill -s HUP systemd-journald.service`.
- Journald log: `systemd-journald[54986]: System Journal (/var/log/journal/...) is 360.0M, max 500.0M, 139.9M free.`
- `SYSTEM_MAX_USE = 500M`
- `CURRENT_USAGE = 368.0M`
- `JOURNAL_MANUAL_VACUUM = NO` (Usage already below 500M cap; no unnecessary vacuum required)
- `JOURNAL_HISTORY_AVAILABLE = YES`

---

## 6. Controlled Discord Worker Restart & Runtime Verification

Controlled restart of `neko-discord-worker.service` was executed at `2026-08-18 07:34:25 UTC`:

1. **Pre-flight Execution (`ExecStartPre`)**:
   - `python3 /opt/neko/neko_discord_worker.py --check-config` exited with status 0.
   - `[CONFIG_CHECK] SUCCESS: Configuration is valid. (interface=ens5, port=8388, state=/var/lib/neko/discord-state.json)`
2. **Socket Initialization**:
   - `STARTING_DISCORD_WORKER | interface=ens5 | port=8388`
   - `DISCORD_WORKER_READY | next_summary_epoch=1787040000`
   - Raw socket on `ens5` port `8388` created successfully under `CAP_NET_RAW`.
3. **Persistent Status Message Continuity**:
   - Pre-restart Message ID: `1539165666089762837`
   - Post-restart Message ID: `1539165666089762837`
   - `STATUS_MESSAGE_ID_PRESERVED = YES`
   - `NEW_STATUS_MESSAGE_FROM_T8C = NO` (Edited in-place; zero duplicate message creation)
4. **Anti-Flap Alert Suppression**:
   - `FALSE_TRANSITION_ALERT = NO` (No artificial alerts triggered during restart).
5. **State File Integrity & Atomic Cleanup**:
   - State file: `/var/lib/neko/discord-state.json` (`chmod 600 root:root`, size 397 B)
   - `STATE_TEMP_FILES = 0` (No orphaned `.tmp` files).

---

## 7. Operator Diagnostics Tooling Verification (`neko_ops_status.py`)

Ran `/opt/neko/neko_ops_status.py` on production VPS:

```text
=============================================================================
NEKO FAMILY PROXY — PRODUCTION OPS DIAGNOSTICS
=============================================================================
HOST:               ip-172-26-29-162 (Ubuntu 22.04.5 LTS / 6.8.0-1061-aws)
UPTIME:             9d 15h 3m | Load: 0.05, 0.03, 0.00
RAM USAGE:          394.2 MiB / 914.0 MiB (519.8 MiB available)
DISK USAGE:         3.66 GiB / 38.58 GiB (9.5% used, 34.91 GiB free)
JOURNAL USAGE:      368.0M

SERVICES:
  shadowsocks-libev:    ACTIVE (PID: 431, Restarts: 0, Mem: 5.3 MiB)
  neko-server-monitor:  ACTIVE (PID: 46806, Restarts: 0, Mem: 10.3 MiB)
  neko-discord-worker:  ACTIVE (PID: 55258, Restarts: 0, Mem: 13.8 MiB)
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

- **Exit Code**: `0` (`0_HEALTHY`)
- **Read-Only Verification**: `OPS_STATUS_MUTATION = NO` (No processes restarted, no files modified)
- **Secret Safety**: Zero credentials, tokens, or webhook URLs exposed.

---

## 8. Production Soak & Resource Headroom Evidence (15+ Minutes)

Observed runtime metrics across the 15-minute soak window (`07:34:26 UTC` to `07:50:00+ UTC`):

| Metric | Pre-Rollout Baseline | T8C Immediate (+1m) | T8C Soak Mid (+7m) | T8C Soak End (+16m) | Status / Headroom |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Worker PID** | 50924 | 55258 | 55258 | 55258 | Stable single process |
| **Worker Restarts (`NRestarts`)** | 0 | 0 | 0 | 0 | 0 restarts (Zero crashes) |
| **Worker RSS / MemoryCurrent** | 15.1 MiB | 13.6 MiB | 13.8 MiB | 14.1 MiB | 113.9 MiB headroom (>89% under 128M limit) |
| **Worker TasksCurrent** | 1 | 1 | 1 | 1 | 15 tasks headroom (under 16 limit) |
| **Worker FD Count** | 4 | 4 | 4 | 4 | Stable (Zero FD leak) |
| **Shadowsocks PID** | 431 | 431 | 431 | 431 | Uninterrupted data-plane |
| **Monitoring Agent PID** | 46806 | 46806 | 46806 | 46806 | Uninterrupted telemetry pipeline |
| **Host Available RAM** | 534 MiB | 535.9 MiB | 537.3 MiB | 520.1 MiB | Healthy |
| **Host Root Storage** | 3.7 GB (10%) | 3.66 GB (9.5%) | 3.66 GB (9.5%) | 3.66 GB (9.5%) | 34.91 GB free |
| **Journal Disk Usage** | 352.0M | 368.0M | 368.0M | 368.0M | Bounded below 500M cap |
| **OOM Kill / CGroup Errors** | None | None | None | None | Clean |

---

## 9. Security, Privacy & Secret Audit

```text
=============================================================================
OPERATIONAL SECURITY & PRIVACY AUDIT RECORD
=============================================================================
WEBHOOK_IN_SOURCE_CODE:         NO (Zero hardcoded secrets)
WEBHOOK_IN_SYSTEMD_UNIT:        NO (Loaded exclusively from EnvironmentFile)
WEBHOOK_IN_OPS_OUTPUT:          NO (Sanitized)
WEBHOOK_IN_JOURNAL_LOGS:        NO (Sanitized logs)
SHADOWSOCKS_PASSWORD_EXPOSED:   NO
INGEST_SECRET_EXPOSED:          NO
SUPABASE_KEY_EXPOSED:           NO
ACTIVE_USERS_TRACKING:          REMOVED (Zero client identity)
PACKET_PAYLOAD_TRACKING:        NO (Layer 3/4 headers only)
SESSION_DATA_TRACKING:          NO
DATA_PLANE_MUTATION:            NO
=============================================================================
```

---

## 10. Architectural Invariants & Limitations

```text
FULL_HOST_OUTAGE_EXTERNAL_DETECTION = NOT_PROVIDED (Architectural Invariant — Zero External SaaS)
TRAFFIC_AUTHORITY                   = FILTERED_SHADOWSOCKS_PORT_8388 (Raw AF_PACKET)
STATUS_STATE_MODEL                  = ONLINE / DEGRADED / STALE / UNKNOWN (4-Tier Health)
STALE_IS_NOT_OFFLINE                = ENFORCED
DISCORD_PUBLISHER_COUNT             = 1 (neko-discord-worker.service ACTIVE, legacy DISABLED)
```
