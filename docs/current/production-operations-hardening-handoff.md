# NEKO FAMILY PROXY — PRODUCTION OPERATIONS & HEALTH HARDENING HANDOFF (PHASE T8A)

```text
DOCUMENT:               docs/current/production-operations-hardening-handoff.md
STATUS:                 AUTHORITATIVE HANDOFF (Phase T8A Audit Completed & Design Frozen)
CLASSIFICATION:         OPERATIONAL DISCOVERY EVIDENCE & PHASE T8B HANDOFF RECORD
PHASE:                  T8A (Production Operations Baseline Audit + Hardening Design)
PREVIOUS_PHASE:         T7 V1C (Unified Discord Worker Production Cutover & Proof — CLOSED)
SUCCESSOR_PHASE:        T8B (Local Operations Hardening Candidate Implementation)
PRIMARY_TEAM:           TEAM_COORDINATION
SUPPORT_TEAM:           TEAM_WEB
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
BACKEND_COMMIT:         5ad8e693e549b7d8b5b178f7269f9b1b737ac8bf
ADMIN_DOC_COMMIT:       683cb99724e9dffbf342875031f0e0a4abbc6172
DATE:                   2026-08-18
T8A_EXIT_GATE:          PASS
```

---

## 1. Executive Summary & Audit Completion

Phase **T8A (Production Operations Baseline Audit + Hardening Design)** has completed empirical read-only discovery of the live AWS Lightsail Japan production environment. All three core services (`shadowsocks-libev.service`, `neko-server-monitor.service`, and `neko-discord-worker.service`) are active, stable, and executing with minimal resource footprints and zero secret exposures.

```text
=============================================================================
PRODUCTION OPERATIONS AUDIT SUMMARY (2026-08-18)
=============================================================================
HOST INFRASTRUCTURE:
  - Host OS:              Ubuntu 22.04.5 LTS (x86_64) | Kernel: 6.8.0-1061-aws
  - Python Version:       Python 3.10.12 | systemd: 249 (249.11-0ubuntu3.22)
  - Host Uptime:          9 days, 14 hours | Load Average: 0.00, 0.00, 0.00
  - Memory:               228 MiB Used / 914 MiB Total (515 MiB Available, No Swap)
  - Root Disk (/):        3.7 GB Used / 39 GB Total (10% Used, 35 GB Free)
  - Root Inodes (/):      114,814 Used / 5,160,960 Total (3% Used, 97% Free)
  - Journal Storage:      352.0 MiB active + archived logs

SERVICE LIFECYCLES:
  - shadowsocks-libev:    ACTIVE (PID 431, Restarts: 0, Mem: 7.6 MiB, FDs: 7, Restart=no)
  - neko-server-monitor:  ACTIVE (PID 46806, Restarts: 0, Mem: 20.7 MiB, FDs: 5, Restart=always)
  - neko-discord-worker:  ACTIVE (PID 50924, Restarts: 0, Mem: 25.3 MiB, FDs: 4, Restart=on-failure)
  - neko-traffic-monitor: INACTIVE & DISABLED (Rollback files intact)

STATE & SECURITY:
  - State File:           /var/lib/neko/discord-state.json (0600 root:root, 397 bytes, VALID JSON)
  - Secret Log Leaks:     0 webhook URLs, 0 Authorization headers, 0 Bearer tokens in journal
  - Capability Model:     CAP_NET_RAW only on Worker (Minimum practical privileges)
  - Lifecycle Isolation:  Zero coupling (No Requires/PartOf across daemons)
=============================================================================
```

---

## 2. Empirical Findings & Risk Classification

### 2.1 Findings Matrix

- **P0 Findings (Critical / Outage / Data Corruption)**: **0 findings**.
- **P1 Findings (Major Reliability Defects)**: **0 findings**.
- **P2 Findings (Maintenance & Recovery Hardening)**: **4 items identified for T8B candidate implementation**:
  1. `neko-discord-worker.service` currently specifies `Restart=on-failure`. If the Python interpreter terminates cleanly (exit code 0) during an unexpected loop termination, systemd will not auto-restart. **Target**: `Restart=always` with `StartLimitIntervalSec=60s`.
  2. `/etc/systemd/journald.conf` is unconfigured (defaults to dynamic 10% disk cap / ~3.9 GB). **Target**: Add `/etc/systemd/journald.conf.d/00-journal-size.conf` setting `SystemMaxUse=500M`.
  3. `save_state_atomic()` in `agent/neko_discord_worker.py` creates a temporary file via `mkstemp()` before `os.replace()`, but does not clean up the `.tmp` file in a `finally` block if writing or syncing fails. **Target**: Add exception safety cleanup.
  4. Operators currently lack a single zero-dependency sanitized CLI diagnostic command. **Target**: Create `agent/neko_ops_status.py` and add `--check-config` to `agent/neko_discord_worker.py`.
- **P3 Findings (Optional / Cosmetic)**: **1 item**:
  1. Add conservative resource safety bounds (`MemoryMax=128M`, `TasksMax=16`) to custom service unit files.

---

## 3. Scope for Successor Phase T8B

Phase **T8B (Local Operations Hardening Candidate Implementation)** will develop and test the following deliverables in the local Backend repository:

1. **Worker Systemd Unit Hardening** (`agent/systemd/neko-discord-worker.service`):
   - Update `Restart=always`
   - Set `RestartSec=5s`
   - Set `StartLimitIntervalSec=60s` / `StartLimitBurst=5`
   - Add safety bounds `MemoryMax=128M` and `TasksMax=16`
2. **Worker Script State Cleanup & CLI** (`agent/neko_discord_worker.py`):
   - Wrap atomic state temporary file in `try ... finally` to remove orphaned `.tmp` files on write failure.
   - Add `--check-config` CLI pre-flight flag for zero-traffic static configuration validation.
3. **Read-Only Operator Diagnostics Script** (`agent/neko_ops_status.py`):
   - Zero-dependency script to print comprehensive host, service, network, and state health without leaking secrets.
4. **Journal Hardening Configuration Drop-in** (`agent/systemd/00-journal-size.conf`):
   - Bound system journal storage to `SystemMaxUse=500M`.
5. **Deterministic Unit Tests**:
   - Add tests for config check CLI, state cleanup under simulated disk write errors, and ops status parser.

---

## 4. Operational Invariant Checkpoint

```text
SERVER_SOURCE_CHANGED:          NO
ADMIN_RUNTIME_CHANGED:          NO
SUPABASE_CHANGED:               NO
VPS_CHANGED:                    NO
PRODUCTION_RUNTIME_CHANGED:     NO
T8A_EXIT_GATE:                  PASS
```
