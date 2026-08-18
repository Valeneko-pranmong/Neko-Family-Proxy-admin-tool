# NEKO FAMILY PROXY — PRODUCTION OPERATIONS & HEALTH HARDENING HANDOFF (PHASE T8)

```text
DOCUMENT:               docs/current/production-operations-hardening-handoff.md
STATUS:                 AUTHORITATIVE PRODUCTION ROLLOUT & LIFECYCLE RECORD
CLASSIFICATION:         OPERATIONAL HARDENING & PRODUCTION PROOF RECORD
PHASE:                  T8C (Controlled Production Operations Hardening Rollout + Proof)
PREVIOUS_PHASES:        T8A (Audit & Design — CLOSED) | T8B (Candidate Implementation — CLOSED)
CURRENT_PHASE:          T8C (Controlled Production Rollout & Proof — CLOSED)
SUCCESSOR_PHASE:        T8_FINAL_REMOTE_EVIDENCE_CLOSURE (Admin Docs Remote Push)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
BACKEND_COMMIT:         3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
ADMIN_DOC_COMMIT:       077e523c9511b48b47c4e45720b448d0445399cf
DATE:                   2026-08-18
T8_EXIT_GATE:           PASS
```

---

## 1. Executive Summary & Phase T8 Lifecycle Closure

Phase **T8 (Production Operations & Health Hardening)** has completed all milestones across audit, implementation, and production deployment:
- **Phase T8A (CLOSED)**: Empirical baseline discovery audit on AWS Lightsail Japan host; identified and classified the Shadowsocks `Restart=no` vendor gap as a **P1 Reliability Gap**, journal retention unpinned as P2, state atomic cleanup as P2, missing operator diagnostics as P2.
- **Phase T8B (CLOSED)**: Local Backend candidate implementation in `D:\Github\Neko-Family-Proxy` (commit `3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a`), implementing drop-ins, static config check CLI, state cleanup, `neko_ops_status.py`, and 51 passing unit tests.
- **Phase T8C (CLOSED)**: Controlled non-destructive rollout to AWS Lightsail Japan VPS (`18.178.140.8`), static validation, daemon-reload, verified effective systemd recovery policies (`Restart=always`), journald 500M cap, single-publisher Discord Worker restart, 0_HEALTHY operator diagnostics, and 15m+ production soak.

---

## 2. Artifact Authority & Hashes Record

```text
=============================================================================
PRODUCTION ARTIFACT AUTHORITY & SHA256 VERIFICATION
=============================================================================
BACKEND_COMMIT:               3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
ADMIN_DOC_COMMIT:             077e523c9511b48b47c4e45720b448d0445399cf

ARTIFACT HASHE MATRIX:
1. Discord Worker Source:
   Path:                      /opt/neko/neko_discord_worker.py (0755 root:root)
   Pre-T8C SHA256:            f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4
   Post-T8C SHA256:           86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c
   Expected SHA256:           86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c
   Match:                     EXACT

2. Operator Diagnostics Tool:
   Path:                      /opt/neko/neko_ops_status.py (0755 root:root)
   Post-T8C SHA256:           cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af
   Expected SHA256:           cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af
   Match:                     EXACT

3. Discord Worker Systemd Unit:
   Path:                      /etc/systemd/system/neko-discord-worker.service (0644 root:root)
   Pre-T8C SHA256:            74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94
   Post-T8C SHA256:           3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b
   Expected SHA256:           3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b
   Match:                     EXACT

4. Shadowsocks Recovery Drop-in:
   Path:                      /etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf (0644 root:root)
   Post-T8C SHA256:           b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb
   Expected SHA256:           b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb
   Match:                     EXACT

5. Journal Storage Capacity Drop-in:
   Path:                      /etc/systemd/journald.conf.d/10-neko-journal-cap.conf (0644 root:root)
   Post-T8C SHA256:           e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84
   Expected SHA256:           e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84
   Match:                     EXACT
=============================================================================
```

---

## 3. Production Service Authority & Recovery Configuration

```text
=============================================================================
PRODUCTION SERVICE MATRIX
=============================================================================
1. shadowsocks-libev.service:
   ActiveState:               active (running)
   SubState:                  running
   MainPID:                   431 (Uninterrupted process across rollout)
   Restart Policy:            Restart=always
   RestartSec:                5s (RestartUSec=5s)
   StartLimitInterval:        60s (StartLimitIntervalUSec=1min)
   StartLimitBurst:           5
   DropInPaths:               /etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf
   Recovery Policy Proof:     VERIFIED_BY_SYSTEMD_EFFECTIVE_CONFIG
   Destructive Crash Test:    NOT_PERFORMED (Data-plane protection invariant)
   TCP/UDP Port 8388:         LISTENING & UNBROKEN

2. neko-discord-worker.service:
   ActiveState:               active (running)
   SubState:                  running
   MainPID:                   55258
   Restart Policy:            Restart=always
   RestartSec:                5s (RestartUSec=5s)
   StartLimitInterval:        60s (StartLimitIntervalUSec=1min)
   StartLimitBurst:           5
   MemoryMax:                 128M (134217728 bytes)
   TasksMax:                  16
   CapabilityBoundingSet:     cap_net_raw
   ExecStartPre:              /usr/bin/python3 /opt/neko/neko_discord_worker.py --check-config (PASS)
   State File:                /var/lib/neko/discord-state.json (0600 root:root)
   State Temp Files:          0 (Clean atomic replacement)
   Persistent Msg ID:         1539165666089762837 (PRESERVED & EDITED IN-PLACE)

3. neko-server-monitor.service:
   ActiveState:               active (running)
   MainPID:                   46806 (Uninterrupted telemetry pipeline)
   Restart Policy:            Restart=always

4. neko-traffic-monitor.service:
   ActiveState:               inactive (dead)
   UnitFileState:             disabled (Rollback authority preserved)

5. systemd-journald.service:
   ActiveState:               active (running)
   Effective SystemMaxUse:    500M
   Current Journal Usage:     368.0M (Within 500M limit; no manual vacuum needed)
=============================================================================
```

---

## 4. Operator Diagnostics Tooling (`/opt/neko/neko_ops_status.py`)

A single read-only diagnostics script is deployed at `/opt/neko/neko_ops_status.py`:

- **Execution Command**: `sudo /opt/neko/neko_ops_status.py`
- **Output Sample**:
```text
=============================================================================
NEKO FAMILY PROXY — PRODUCTION OPS DIAGNOSTICS
=============================================================================
HOST:               ip-172-26-29-162 (Ubuntu 22.04.5 LTS / 6.8.0-1061-aws)
UPTIME:             9d 15h 2m | Load: 0.10, 0.04, 0.01
RAM USAGE:          376.7 MiB / 914.0 MiB (537.3 MiB available)
DISK USAGE:         3.66 GiB / 38.58 GiB (9.5% used, 34.91 GiB free)
JOURNAL USAGE:      368.0M

SERVICES:
  shadowsocks-libev:    ACTIVE (PID: 431, Restarts: 0, Mem: 5.3 MiB)
  neko-server-monitor:  ACTIVE (PID: 46806, Restarts: 0, Mem: 10.6 MiB)
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
- **Exit Code**: `0` (`0_HEALTHY`).
- **Safety Audit**: Contains zero secrets, passwords, or webhook tokens. 100% read-only with zero process or file mutations.

---

## 5. Production Rollback Authority Snapshot

Before overwriting production binaries, a protected rollback snapshot was captured on the VPS:

- **Rollback Directory**: `/opt/neko/rollback/t8c-20260818073350/` (0700 root:root)
- **Snapshot Contents**:
  - `neko_discord_worker.py.pre-t8c` (SHA256: `f95f7bcc3bf70a6eedf2f616b4edcf3293306b7d62f3a43fb003bc75afd106f4`)
  - `neko-discord-worker.service.pre-t8c` (SHA256: `74de7d37b7b90bd2f962fb61d5237e73c1cd102e01361ba83bd8944294a9eb94`)

### Rollback Runbook:
1. **Rollback Discord Worker**:
   ```bash
   sudo cp /opt/neko/rollback/t8c-20260818073350/neko_discord_worker.py.pre-t8c /opt/neko/neko_discord_worker.py
   sudo cp /opt/neko/rollback/t8c-20260818073350/neko-discord-worker.service.pre-t8c /etc/systemd/system/neko-discord-worker.service
   sudo systemctl daemon-reload
   sudo systemctl restart neko-discord-worker.service
   ```
2. **Rollback Shadowsocks Drop-in**:
   ```bash
   sudo rm -f /etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf
   sudo systemctl daemon-reload
   ```
3. **Rollback Journald Drop-in**:
   ```bash
   sudo rm -f /etc/systemd/journald.conf.d/10-neko-journal-cap.conf
   sudo systemctl kill -s HUP systemd-journald.service
   ```
4. **Rollback to Legacy Publisher**:
   ```bash
   sudo systemctl stop neko-discord-worker.service
   sudo systemctl enable --now neko-traffic-monitor.service
   ```

---

## 6. Architectural Invariants & Limitations

```text
FULL_HOST_OUTAGE_EXTERNAL_DETECTION = NOT_PROVIDED (Frozen Architectural Non-Goal)
DATA_PLANE_MUTATION                 = ZERO (Uninterrupted port 8388 proxying)
ACTIVE_USERS_TRACKING               = ZERO (Removed in Phase T7 V1)
SESSION_DATA_LEAKAGE                = ZERO
SECRET_LEAKAGE                      = ZERO
```
