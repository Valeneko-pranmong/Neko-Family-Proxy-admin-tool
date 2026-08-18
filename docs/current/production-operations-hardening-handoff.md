# NEKO FAMILY PROXY — PRODUCTION OPERATIONS & HEALTH HARDENING HANDOFF (PHASE T8B)

```text
DOCUMENT:               docs/current/production-operations-hardening-handoff.md
STATUS:                 AUTHORITATIVE HANDOFF (Phase T8B Local Candidate Complete)
CLASSIFICATION:         OPERATIONAL HARDENING CANDIDATE & PHASE T8C HANDOFF RECORD
PHASE:                  T8B (Local Operations Hardening Candidate Implementation)
PREVIOUS_PHASE:         T8A (Production Operations Baseline Audit + Hardening Design — CLOSED)
SUCCESSOR_PHASE:        T8C (Controlled Production Hardening Rollout & Proof)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
BACKEND_COMMIT:         3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
ADMIN_DOC_COMMIT:       e810ee8ba07a5f45d05da75aaf1d34c50d139494
DATE:                   2026-08-18
T8B_EXIT_GATE:          PASS
```

---

## 1. Executive Summary & Phase T8B Outcome

Phase **T8B (Local Operations Hardening Candidate Implementation)** has designed, implemented, and verified local candidates for all approved production reliability controls in the server repository (`D:\Github\Neko-Family-Proxy` at commit `3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a`):

1. **Shadowsocks Self-Recovery Drop-in** (`agent/systemd/shadowsocks-libev.service.d/10-neko-recovery.conf`):
   - Overcomes distro vendor unit's `Restart=no` gap (reclassified as **P1 Reliability Gap**).
   - Configures `Restart=always`, `RestartSec=5s`, `StartLimitIntervalSec=60s`, `StartLimitBurst=5` without altering vendor unit files, port bindings, or configurations.
2. **Discord Worker Systemd Unit Hardening** (`agent/systemd/neko-discord-worker.service`):
   - Migrates `Restart=on-failure` to `Restart=always` with `RestartSec=5s`.
   - Adds restart storm protection: `StartLimitIntervalSec=60s`, `StartLimitBurst=5`.
   - Adds conservative resource safety ceilings: `MemoryMax=128M`, `TasksMax=16`.
   - Integrates static pre-flight configuration validation via `ExecStartPre=/usr/bin/python3 /opt/neko/neko_discord_worker.py --check-config`.
   - Preserves `CAP_NET_RAW` bounding capability and strict filesystem isolation.
3. **Journal Storage Capacity Drop-in** (`agent/systemd/journald.conf.d/10-neko-journal-cap.conf`):
   - Bounds system journal storage to `SystemMaxUse=500M`.
4. **State File Atomic Cleanup** (`agent/neko_discord_worker.py`):
   - Implements `try ... finally` exception-safe unlinking of `.tmp` files in `save_state_atomic()` upon write or rename failure, preventing orphaned temp files under full disk conditions while preserving existing state files.
5. **Static Config Validation CLI** (`agent/neko_discord_worker.py --check-config`):
   - Validates required env keys, port range (1..65535), interface, intervals, state path, and timezone without opening network connections or leaking webhook secrets.
6. **Read-Only Operator Diagnostics Script** (`agent/neko_ops_status.py`):
   - Single, zero-dependency, read-only Python 3.10 CLI providing host metrics, service statuses, listener probes, state validation, and disk thresholds with deterministic exit codes (`0_HEALTHY`, `1_DEGRADED`, `2_ERROR`).
7. **Comprehensive Unit Tests** (`agent/tests/test_operations_hardening.py`):
   - 22 new deterministic tests added. Full test suite executes 51 tests with 100% pass rate.

---

## 2. Candidate Deliverables & Authority Hashes

```text
=============================================================================
T8B CANDIDATE ARTIFACT AUTHORITY RECORD
=============================================================================
BACKEND_COMMIT:               3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
BACKEND_BRANCH:               feature/neko-auth-lite-v1-launcher-backend

CANDIDATE DELIVERABLE SHA256 HASHES:
  agent/neko_discord_worker.py:
    86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c

  agent/neko_ops_status.py:
    cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af

  agent/systemd/neko-discord-worker.service:
    3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b

  agent/systemd/shadowsocks-libev.service.d/10-neko-recovery.conf:
    b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb

  agent/systemd/journald.conf.d/10-neko-journal-cap.conf:
    e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84

TEST EXECUTION:
  Total Unit Tests:           51
  Existing T7 Tests:          29 (All PASS)
  New T8 Hardening Tests:     22 (All PASS)
  Failures / Regressions:     0
=============================================================================
```

---

## 3. Findings Classification Correction (T8A -> T8B)

```text
=============================================================================
FINDINGS CLASSIFICATION
=============================================================================
P0 FINDINGS: 0 (No active outages, data corruption, or secret leaks)

P1 FINDINGS: 1 (Elevated by Owner Review)
  P1_1: Shadowsocks `Restart=no` lacks automatic crash recovery.
        Resolved by candidate drop-in `10-neko-recovery.conf` setting `Restart=always`.

P2 FINDINGS: 4 (Resolved in T8B Candidate)
  P2_1: Discord Worker `Restart=on-failure` clean exit recovery gap -> `Restart=always`.
  P2_2: Journald unpinned default retention -> `SystemMaxUse=500M` drop-in.
  P2_3: State atomic write temporary file cleanup -> `try...finally` in save_state_atomic.
  P2_4: Missing single-command operator diagnostic & pre-flight check -> `neko_ops_status.py` & `--check-config`.

P3 FINDINGS: 1 (Resolved in T8B Candidate)
  P3_1: Resource bounds unpinned -> Added `MemoryMax=128M`, `TasksMax=16` to Worker unit.
=============================================================================
```

---

## 4. Planned Phase T8C Production Rollout Protocol

> [!NOTE]
> Phase T8B changes are strictly local candidates. Production AWS Lightsail VPS has NOT been modified.

When Phase T8C is initiated by the Owner, deployment will follow this controlled non-disruptive sequence:

1. **Pre-flight & Authority Verification**:
   - Verify server commit `3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a` pushed to remote.
   - Verify SHA256 hashes of staged candidate files on Japan VPS.
2. **Journal Capacity Drop-in Staging**:
   - Copy `10-neko-journal-cap.conf` to `/etc/systemd/journald.conf.d/10-neko-journal-cap.conf`.
   - Run `sudo systemctl restart systemd-journald`.
3. **Shadowsocks Recovery Drop-in Staging**:
   - Create `/etc/systemd/system/shadowsocks-libev.service.d/`.
   - Copy `10-neko-recovery.conf` to `/etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf`.
4. **Discord Worker Script & Unit Staging**:
   - Stage updated `neko_discord_worker.py` to `/opt/neko/neko_discord_worker.py` (0755 root:root).
   - Stage `neko_ops_status.py` to `/opt/neko/neko_ops_status.py` (0755 root:root).
   - Stage updated `neko-discord-worker.service` to `/etc/systemd/system/neko-discord-worker.service`.
5. **Pre-flight Execution**:
   - Run `python3 /opt/neko/neko_discord_worker.py --check-config`.
   - Run `systemd-analyze verify /etc/systemd/system/neko-discord-worker.service`.
6. **Controlled Activation**:
   - Run `sudo systemctl daemon-reload`.
   - Run `sudo systemctl restart neko-discord-worker.service`.
7. **Verification & Proof**:
   - Execute `sudo python3 /opt/neko/neko_ops_status.py` (Verify exit 0 and all healthy).
   - Verify Shadowsocks TCP listener `:8388` and UDP relay intact.
   - Verify persistent Discord status embed advances smoothly without duplicate messages.
   - Verify `systemctl show neko-discord-worker.service -p Restart,MemoryMax,TasksMax`.
   - Verify `systemctl show shadowsocks-libev.service -p Restart,StartLimitIntervalUSec`.

---

## 5. Rollback Procedures

If an unexpected regression occurs during T8C:

- **Rollback Discord Worker**:
  Revert `/opt/neko/neko_discord_worker.py` and `/etc/systemd/system/neko-discord-worker.service` to Phase T7 V1 authority (Commit `5ad8e693...`), run `sudo systemctl daemon-reload && sudo systemctl restart neko-discord-worker.service`.
- **Rollback Shadowsocks Drop-in**:
  Remove `/etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf`, run `sudo systemctl daemon-reload`.
- **Rollback Journal Drop-in**:
  Remove `/etc/systemd/journald.conf.d/10-neko-journal-cap.conf`, run `sudo systemctl restart systemd-journald`.
- **Rollback to Legacy Discord Publisher**:
  Stop `neko-discord-worker.service`, enable and start `neko-traffic-monitor.service` (retained on VPS).

---

## 6. Operational Invariant Checkpoint

```text
SERVER_SOURCE_CHANGED:          YES (Local Candidate in Backend repo)
SERVER_COMMIT:                  3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
ADMIN_RUNTIME_CHANGED:          NO
SUPABASE_CHANGED:               NO
VPS_CHANGED:                    NO
PRODUCTION_RUNTIME_CHANGED:     NO
T8B_EXIT_GATE:                  PASS
```
