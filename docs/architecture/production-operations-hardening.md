# NEKO FAMILY PROXY — PRODUCTION OPERATIONS & HEALTH HARDENING ARCHITECTURE (PHASE T8)

```text
DOCUMENT:               docs/architecture/production-operations-hardening.md
STATUS:                 AUTHORITATIVE ARCHITECTURE CONTRACT & PRODUCTION VERIFIED SPECIFICATION
CLASSIFICATION:         OPERATIONAL RELIABILITY & RECOVERY GOVERNANCE
PHASE:                  T8C (Controlled Production Hardening Rollout & Proof)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
SERVER_AUTHORITY:       3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
ADMIN_DOC_AUTHORITY:    077e523c9511b48b47c4e45720b448d0445399cf
DATE:                   2026-08-18
T8_STATUS:              DESIGNED = YES / IMPLEMENTED = YES / DEPLOYED = YES / PRODUCTION VERIFIED = YES
```

---

## 1. Executive Summary & Intent

### 1.1 T8 Mission
Phase **T8 (Production Operations & Health Hardening)** establishes low-maintenance, predictable, and resilient operational guardrails for the AWS Lightsail production environment without adding external SaaS dependencies, external watchdogs, or cloud scheduler infrastructure.

```text
=============================================================================
T8 SCOPE INVARIANTS & BOUNDARIES
=============================================================================
NO:
  - NO external watchdog / monitoring SaaS (Datadog, UptimeRobot, Grafana Cloud, etc.)
  - NO Vercel scheduler / cron dependency
  - NO Supabase schema migrations or state tables
  - NO new database / machine APIs
  - NO new Discord publisher
  - NO containerization / Docker / Kubernetes / supervisord / PM2 overhead

YES:
  - Systemd service lifecycle & crash auto-recovery reliability
  - Host boot auto-recovery authority
  - Predictable restart policies & backoff bounds
  - Real resource usage baseline & safety ceilings
  - Bounded journal retention hygiene
  - State file atomic persistence & temp file cleanup
  - Disk & inode capacity awareness
  - Sanitized read-only operator diagnostics (neko_ops_status.py)
  - Config pre-flight check CLI (--check-config)
  - Standardized operator runbook & rollback procedures
=============================================================================
```

### 1.2 Explicit Non-Goal: Full Host Outage External Detection
T8 intentionally preserves the following architectural invariant:
```text
FULL_HOST_OUTAGE_EXTERNAL_DETECTION = NOT_PROVIDED
```
*Rationale*: Detecting a complete hypervisor or data-center level host power-off requires an external polling authority (e.g. AWS CloudWatch Alarms, third-party heartbeat pinger). Introducing external polling SaaS or multi-cloud infrastructure directly conflicts with the project's frozen low-maintenance, single-operator, zero-cost architecture. T8 instead optimizes **service self-recovery**, **host-boot recovery**, and **operator diagnostics**.

---

## 2. Production Baseline Audit (T8A Empirical Findings)

The live production environment on AWS Lightsail Japan was audited in read-only mode on **2026-08-18**:

### 2.1 Host Infrastructure Baseline

```text
HOST_OS:                Ubuntu 22.04.5 LTS (x86_64)
KERNEL:                 Linux 6.8.0-1061-aws #64~22.04.1-Ubuntu SMP x86_64
PYTHON:                 Python 3.10.12 (standard CPython)
SYSTEMD:                systemd 249 (249.11-0ubuntu3.22) default-hierarchy=unified
HOST_UPTIME:            9 days, 14 hours (Load Average: 0.00, 0.00, 0.00)
PHYSICAL_MEMORY:        914 MiB Total | 228 MiB Used | 515 MiB Available | 463 MiB Cache
SWAP:                   0 B (No swap configured)
ROOT_STORAGE (/):       39 GB Total | 3.7 GB Used (10%) | 35 GB Available (90%)
INODE_USAGE (/):        5,160,960 Total | 114,814 Used (3%) | 5,046,146 Free (97%)
JOURNAL_USAGE:          352.0 MiB active + archived journals
NETWORK_INTERFACE:      ens5 (MTU 9001, Link UP, Carrier UP, Default Gateway 172.26.16.1)
DNS_RESOLVER:           127.0.0.53 (systemd-resolved) -> Upstream ping 8.8.8.8 ~2.28 ms
```

### 2.2 Production Service Authority Matrix

| Service Unit | Active State | Unit State | Main PID | NRestarts | Memory (RSS) | Systemd MemoryCurrent | Tasks | Restart Policy | RestartSec | StartLimitBurst/Interval |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `shadowsocks-libev.service` | `active (running)` | `enabled` | 431 | 0 | ~7.6 MiB | 5.3 MiB | 1 | `no` | default (100ms) | 5 / 10s |
| `neko-server-monitor.service`| `active (running)` | `enabled` | 46806 | 0 | ~20.7 MiB | 10.2 MiB | 1 | `always` | 5s | 5 / 10s |
| `neko-discord-worker.service` | `active (running)` | `enabled` | 50924 | 0 | ~25.3 MiB | 14.5 MiB | 1 | `on-failure` | 5s | 5 / 10s |
| `neko-traffic-monitor.service`| `inactive (dead)` | `disabled` | 0 | 0 | - | - | - | `on-failure` | 5s | 5 / 10s |

---

## 3. Service Reliability & Recovery Design

### 3.1 Restart Policy Analysis & Decision

```text
=============================================================================
RESTART POLICY SELECTION: Restart=always vs Restart=on-failure
=============================================================================
Current Discord Worker Setting:  Restart=on-failure
Current Monitor Agent Setting:   Restart=always
Current Shadowsocks Setting:     Restart=no (Vendor package default)

EVALUATION & CLASSIFICATION:
1. `Restart=on-failure` only restarts if the process exits with a non-zero return code
   or is terminated by an unhandled signal. If Python encounters an unexpected clean exit
   (e.g., an unhandled loop break returning code 0), systemd considers it a clean exit
   and leaves the service in `inactive (dead)` state.
2. `Restart=always` restarts the service on ANY exit (code 0, non-zero, or signal),
   WHILE STILL HONORING manual maintenance stops (`sudo systemctl stop <service>`).
   When stopped manually via systemctl, systemd marks the stop as deliberate and does
   NOT trigger auto-restart.
3. Shadowsocks `Restart=no` (P1 Finding Correction):
   Because Shadowsocks is the primary proxy data-plane, leaving it at `Restart=no` creates
   a single point of failure where a process crash on an active VPS never recovers.
   This was elevated from P2 to P1 (SERVICE SELF-RECOVERY GAP).
   Target: Minimal systemd drop-in override (10-neko-recovery.conf) without modifying vendor unit.

RECOMMENDATIONS:
- Discord Worker:   Migrate from `Restart=on-failure` to `Restart=always` + StartLimitIntervalSec=60s
- Monitoring Agent: Maintain `Restart=always`
- Shadowsocks:      Add drop-in override: `Restart=always`, `RestartSec=5s`, `StartLimitIntervalSec=60s`
=============================================================================
```

### 3.2 Restart Backoff & Storm Protection Design

To prevent rapid crash-loop storms (which could burn CPU, flood journal logs, or trigger Discord API rate-limiting), restart policies must be strictly bounded:

```ini
# Recommended Hardening Drop-in for neko-discord-worker.service & neko-server-monitor.service
[Unit]
StartLimitIntervalSec=60s
StartLimitBurst=5

[Service]
Restart=always
RestartSec=5s
```

*Mathematical Storm Guarantee*:
- Minimum delay between restarts: 5 seconds (`RestartSec=5s`).
- 5 restarts require at least `5 * 5s = 25s`.
- If 5 crashes occur within 60 seconds (`StartLimitIntervalSec=60s`), systemd halts auto-restart and transitions the unit to `failed` state, preventing endless loops and API flooding.

### 3.3 Systemd Watchdog Decision (`WatchdogSec` + `sd_notify`)

```text
SYSTEMD_WATCHDOG_DECISION: NO (NOT RECOMMENDED)
RATIONALE:
1. Both `neko_discord_worker.py` and `neko_server_agent.py` are simple, single-threaded,
   linear event-loop daemons with explicit timeouts on all network calls:
   - ICMP ping: 3.5s timeout
   - TCP port probe: 1.0s timeout
   - HTTP requests: 5.0s timeout
2. The processes do not perform heavy blocking compute or complex concurrency that could dead-lock.
3. Implementing `sd_notify` would require importing external C-extensions (`systemd-python`)
   or writing custom socket notification code.
4. Unnecessary complexity introduces new failure points without measurable reliability benefit.
```

---

## 4. Boot & Lifecycle Isolation Authority

### 4.1 Host Boot Recovery Model
All active services are bound to `multi-user.target`:
- `shadowsocks-libev.service`: `WantedBy=multi-user.target`, `After=network-online.target`
- `neko-server-monitor.service`: `WantedBy=multi-user.target`, `After=network.target shadowsocks-libev.service`
- `neko-discord-worker.service`: `WantedBy=multi-user.target`, `After=network-online.target`

*Verification*: Upon host reboot, systemd automatically brings up all three daemons in parallel without human intervention.

### 4.2 Failure Domain Isolation Invariant
The three daemons operate in strictly isolated lifecycle domains:

```text
+-------------------------------------------------------------------------------+
|                           FAILURE DOMAIN ISOLATION                            |
+-------------------------------------------------------------------------------+
|  Discord Worker Failure   != Shadowsocks Failure  (Proxy continues routing)   |
|  Monitoring Agent Failure != Shadowsocks Failure  (Proxy continues routing)   |
|  Discord Worker Failure   != Monitoring Failure   (Dashboard continues live)  |
|  Shadowsocks Failure      != Worker Crash         (Worker transitions to      |
|                                                    DEGRADED / sends alerts)   |
+-------------------------------------------------------------------------------+
```

No service uses `Requires=`, `BindsTo=`, or `PartOf=` against any other daemon.

---

## 5. Security & Privilege Hardening

### 5.1 Capability & User Model

- **Shadowsocks**: Uses systemd `DynamicUser=true` with bounded capability `CAP_NET_BIND_SERVICE`.
- **Discord Worker**:
  - Runs as `User=root` because Linux kernel requires root or `CAP_NET_RAW` to open `AF_PACKET` raw sockets on network interfaces (`ens5`).
  - Capabilities are strictly restricted via `CapabilityBoundingSet=CAP_NET_RAW` and `AmbientCapabilities=CAP_NET_RAW`.
  - All other root capabilities (e.g. `CAP_SYS_ADMIN`, `CAP_DAC_OVERRIDE`, `CAP_NET_ADMIN`) are permanently dropped by systemd.
  - Hardened with `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `ProtectKernelTunables=true`, `ProtectKernelModules=true`, `ProtectControlGroups=true`, `LockPersonality=true`, and `MemoryDenyWriteExecute=true`.
  - Address families restricted to: `AF_UNIX AF_INET AF_INET6 AF_PACKET`.
- **Privilege Classification**: `MINIMUM_PRACTICAL` (optimal balance of security and zero-maintenance raw packet capture).

---

## 6. Resource Limits & Capacity Management

### 6.1 Empirical Resource Baseline

| Daemon | Observed CPU % | Observed RSS | Peak VmHWM | Open FDs | Threads |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `shadowsocks-libev` | 0.0% | 7.6 MiB | 8.4 MiB | 7 | 1 |
| `neko_server_agent.py` | 0.1% | 20.7 MiB | 20.7 MiB | 5 | 1 |
| `neko_discord_worker.py` | 0.1% | 25.3 MiB | 25.4 MiB | 4 | 1 |
| **Combined Custom Services** | **0.2%** | **~53.6 MiB** | **~54.5 MiB** | **16** | **3** |

### 6.2 Resource Limit Policy & Recommendation

```text
=============================================================================
RESOURCE LIMIT RECOMMENDATIONS (HEADROOM BASED)
=============================================================================
Total Host Physical RAM: 914 MiB (No Swap)

1. Memory Limits (MemoryMax):
   - Worker Baseline: ~26 MiB RSS
   - Monitor Baseline: ~21 MiB RSS
   - Recommendation: Add `MemoryMax=128M` to custom services.
     Leaves >400% operational headroom for garbage collection / buffer surges,
     while guaranteeing a runaway memory leak cannot exhaust the 914 MiB host.

2. Task / Thread Limits (TasksMax):
   - Baseline: 1 thread per daemon
   - Recommendation: Add `TasksMax=16` to prevent thread exhaustion bugs.

3. File Descriptor Limits (LimitNOFILE):
   - Worker / Agent use < 10 FDs. Distro default (1024) is fully sufficient.
   - Shadowsocks has vendor `LimitNOFILE=32768` (retained).

4. CPU Limits (CPUQuota):
   - NOT RECOMMENDED / NOT NEEDED. Daemons consume < 0.2% CPU. Imposing quota
     could throttle CPU during startup imports.
=============================================================================
```

---

## 7. Storage, State & Journal Hygiene

### 7.1 Journal Retention Policy

- **Current State**: `/etc/systemd/journald.conf` uses unpinned default settings. Active journals currently consume `352.0 MiB`.
- **Systemd Default**: Dynamically bounds to 10% of root filesystem (~3.9 GB on a 39 GB disk).
- **Hardening Recommendation**: Create `/etc/systemd/journald.conf.d/00-journal-size.conf`:
  ```ini
  [Journal]
  SystemMaxUse=500M
  SystemMaxFileSize=50M
  MaxRetentionSec=1month
  ```
  *Benefit*: Guarantees journal storage will never exceed 500 MB (~1.2% of disk) while preserving several months of operational history.

### 7.2 State File Integrity & Temp File Cleanup

- **Location**: `/var/lib/neko/discord-state.json` (`0600 root:root`).
- **Size**: 397 bytes (Strictly bounded; fixed key schema; no append log).
- **Atomic Persistence Model**: Uses `tempfile.mkstemp` + `os.write` + `os.fsync` + `os.chmod(0600)` + `os.replace`.
- **Hardening Improvement (P2)**: Wrap `mkstemp` in `try ... finally` block to guarantee unlinking of temporary file if writing or syncing fails, eliminating any chance of orphaned `.tmp` files under low-disk conditions.

---

## 8. Operations Diagnostics & Tooling Design

### 8.1 Read-Only Ops Status Command (`agent/neko_ops_status.py`)

A single, zero-dependency, read-only Python utility designed for instant operator diagnosis:

```bash
# Target Operator Diagnostic Invocation:
sudo python3 /opt/neko/neko_ops_status.py
```

**Output Design (Sanitized, Human-Readable, Zero Secrets)**:
```text
=============================================================================
NEKO FAMILY PROXY — PRODUCTION OPS DIAGNOSTICS
=============================================================================
HOST:               ip-172-26-29-162 (Ubuntu 22.04.5 LTS / Linux 6.8.0-1061-aws)
UPTIME:             9 days, 14 hours | Load: 0.00, 0.00, 0.00
RAM USAGE:          228 MiB / 914 MiB (25% used, 515 MiB free) | Swap: None
DISK USAGE:         3.7 GB / 39 GB (10% used, 35 GB free) | Inodes: 3% used
JOURNAL USAGE:      352.0 MiB

SERVICES:
  shadowsocks-libev:    ACTIVE (PID 431, Restarts: 0, Mem: 7.6 MiB, FDs: 7)
  neko-server-monitor:  ACTIVE (PID 46806, Restarts: 0, Mem: 20.7 MiB, FDs: 5)
  neko-discord-worker:  ACTIVE (PID 50924, Restarts: 0, Mem: 25.3 MiB, FDs: 4)
  neko-traffic-monitor: INACTIVE (Disabled, Rollback Ready)

NETWORK & PROXIES:
  Interface ens5:       UP (IP: 172.26.29.162, MTU: 9001)
  TCP Listener :8388:   LISTENING (Accepting connections)
  UDP Listener :8388:   LISTENING (Relay enabled)
  Upstream Ping:        2.28 ms (0% packet loss to 8.8.8.8)

STATE INTEGRITY:
  discord-state.json:   VALID (0600 root:root, 397 bytes, Status: ONLINE)
  Persistent Msg ID:    1539165666089762837 (Advancing smoothly)
  Orphan Temp Files:    0
=============================================================================
OVERALL STATUS:         ALL SYSTEMS HEALTHY
=============================================================================
```

### 8.2 Configuration Pre-flight Validation (`--check-config`)

Add a `--check-config` argument to `agent/neko_discord_worker.py`:
- Validates environment file presence and permissions (`0600`).
- Validates webhook URL syntax without leaking tokens or sending payloads.
- Validates network interface existence (`ens5`).
- Validates state directory writability (`/var/lib/neko`).
- Exits with `0` on valid config, `1` with clear sanitized error on invalid config.

---

## 9. Failure Modes & Recovery Matrix

| Code | Failure Scenario | Detection Mechanism | Immediate Behavior | Auto-Recovery Mechanism | Operator Action (If Unrecovered) |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **A** | Discord Worker Python exception | Systemd process exit code != 0 | Service exits | Systemd restarts in 5s (`Restart=always`) | Check `journalctl -u neko-discord-worker` |
| **B** | Clean unexpected worker exit | Systemd process exit code == 0 | Service exits | Systemd restarts in 5s (`Restart=always`) | Check `journalctl -u neko-discord-worker` |
| **C** | Discord API Timeout (>5s) | Python `urllib.error.URLError` | Request logged, skipped | Retry next interval (60s status / 30m summary) | None (transient network glitch) |
| **D** | Discord 429 Rate Limit | HTTP 429 response code | Cooldown logged, skipped | Backs off until next standard cycle | Verify single publisher authority |
| **E** | Discord Persistent 4xx (e.g. 404 deleted msg) | HTTP 404 / 400 response code | State cleared | Next cycle creates new persistent message | None (self-healing message ID) |
| **F** | State file corrupt | `json.JSONDecodeError` | Fallback to default state | Re-creates state on next cycle | Check disk health; review logs |
| **G** | State directory unwritable | `PermissionError` / `OSError` | State save skipped, logged | Memory state continues; retried next tick | Verify `/var/lib/neko` permissions |
| **H** | Shadowsocks service failure | Worker TCP & systemd probe | Status -> `DEGRADED` | Worker sends transition alert to Discord | Run `sudo systemctl restart shadowsocks-libev` |
| **I** | Listener 8388 missing | TCP connect to `127.0.0.1:8388` fails | Status -> `DEGRADED` | Worker sends transition alert | Check ss-server configuration |
| **J** | Monitoring Agent failure | Systemd monitor exit | Monitor exits | Systemd restarts in 5s (`Restart=always`) | Check `journalctl -u neko-server-monitor` |
| **K** | Temporary network loss | ICMP ping / DNS probe fail | Status -> `DEGRADED` | Re-checks every 5s; auto-recovers when UP | None (auto-recovers on link return) |
| **L** | Host reboot | Cloud hypervisor reset | Services stopped | Systemd multi-user.target starts all 3 | Run `sudo python3 /opt/neko/neko_ops_status.py` |
| **M** | Low disk space (>90% full) | `statvfs` / df inspection | Warning in ops diagnostics | Systemd journald rotates logs | Prune old backups or unused apt packages |
| **N** | Journal log growth | Systemd disk usage | Journal grows to limit | Bounded at `500M` by `SystemMaxUse` | None (automatically rotated by systemd) |
| **O** | Repeated crash loop | Systemd burst limit reached | Unit marked `failed` | Pauses restarts after 5 tries in 60s | Inspect logs to fix underlying error |

---

## 10. Operations Hardening Matrix & Recommendations

```text
========================================================================================================================
T8 HARDENING CONTROLS EVALUATION MATRIX
========================================================================================================================
CONTROL                     CURRENT STATUS          RISK / IMPACT               RECOMMENDED TARGET      PRIORITY   T8B ACTION
------------------------------------------------------------------------------------------------------------------------
Boot Enablement             Enabled for all 3 svcs  None (Verified boot ready)  Maintain enabled        -          NONE (VERIFIED)
Shadowsocks Recovery        Restart=no (vendor)     Single point of failure     Restart=always drop-in  P1         CREATE_DROPIN
Discord Restart Policy      Restart=on-failure      Clean exit 0 not restarted  Restart=always          P2         UPDATE_UNIT
Restart Backoff             5s default              Storm prevention            5s delay, 5/60s burst   P2         UPDATE_UNIT
Restart Burst Protection    StartLimitBurst=5/10s   Short interval              StartLimitInterval=60s  P2         UPDATE_UNIT
Worker User / Privileges    root + CAP_NET_RAW      Over-privileged if full     Maintain CAP_NET_RAW    -          NONE (VERIFIED)
Service Sandboxing          Strict systemd sandbox  None (Already high grade)   Maintain sandbox        -          NONE (VERIFIED)
Memory Upper Bound          None (Unconstrained)    Runaway leak on 1GB RAM     MemoryMax=128M          P3         UPDATE_UNIT
Task Upper Bound            None (Unconstrained)    Thread exhaustion           TasksMax=16             P3         UPDATE_UNIT
Journal Retention Limit     Unpinned (352MB active) Could grow to 3.9GB (10%)   SystemMaxUse=500M       P2         DROP_IN_CONFIG
State Atomic Write          mkstemp + replace       Temp leak on write fail     Wrap try...finally      P2         UPDATE_SCRIPT
State File Permissions      0600 root:root          None (Verified safe)        Maintain 0600           -          NONE (VERIFIED)
Sanitized Ops Status Tool   None                    Manual inspection needed    neko_ops_status.py      P2         CREATE_TOOL
Config Pre-flight Check     None                    Runtime syntax error risk   --check-config CLI      P2         UPDATE_SCRIPT
Legacy Rollback Retention   Retained (disabled)     None (Rollback preserved)   Keep legacy files       -          NONE (RETAINED)
========================================================================================================================
```

### 10.1 Change Classification Summary

- **P0 FINDINGS**: 0 findings (No active outages, no data corruption, no secret leaks).
- **P1 FINDINGS (Elevated by Owner Review)**:
  1. `shadowsocks-libev.service` `Restart=no` lacks automatic crash recovery. **Target**: Create minimal systemd drop-in `agent/systemd/shadowsocks-libev.service.d/10-neko-recovery.conf` setting `Restart=always`, `RestartSec=5s`, `StartLimitIntervalSec=60s`, `StartLimitBurst=5`.
- **P2 IMPROVEMENTS (Implemented in T8B Candidate)**:
  1. Update `agent/systemd/neko-discord-worker.service` to `Restart=always` with `StartLimitIntervalSec=60s`, `StartLimitBurst=5`, `MemoryMax=128M`, `TasksMax=16`, and `ExecStartPre` config check.
  2. Create journal cap drop-in `agent/systemd/journald.conf.d/10-neko-journal-cap.conf` with `SystemMaxUse=500M`.
  3. Add `try ... finally` exception-safe temporary file cleanup to `save_state_atomic()` in `agent/neko_discord_worker.py`.
  4. Create zero-dependency read-only operator diagnostics utility `agent/neko_ops_status.py`.
  5. Add static `--check-config` pre-flight CLI flag to `agent/neko_discord_worker.py`.
- **DEFERRED / NOT NEEDED**:
  1. `WatchdogSec` + `sd_notify` (Deferred — unnecessary complexity for linear event-loop daemons).
  2. Dedicated non-root Worker user (Deferred — `CAP_NET_RAW` bounding already provides equivalent privilege containment).
  3. Log rate limiting directives (Deferred — log output is naturally low-frequency).

---

## 11. Phase T8B Candidate Deliverables & Authority Hashes

```text
=============================================================================
PHASE T8B LOCAL CANDIDATE AUTHORITY RECORD
=============================================================================
SERVER_CANDIDATE_COMMIT:    3ce6ccdb2d98eb5869ddfdbeb3946431d34eae4a
SERVER_BRANCH:              feature/neko-auth-lite-v1-launcher-backend
ADMIN_DOC_COMMIT:           e810ee8ba07a5f45d05da75aaf1d34c50d139494

CANDIDATE DELIVERABLE HASHES:
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

TEST SUITE EXECUTION:
  Total Tests:              51
  Passing:                  51 (100% Pass)
  Failures / Errors:        0
=============================================================================
```

---

## 12. Phase T8C Production Rollout & Verification Summary

```text
=============================================================================
PHASE T8 PRODUCTION HARDENING VERIFICATION RECORD
=============================================================================
DESIGNED:                   YES
IMPLEMENTED:                YES
DEPLOYED:                   YES
PRODUCTION_VERIFIED:        YES

FINAL PRODUCTION CONTROLS:
  SHADOWSOCKS_RECOVERY:     Restart=always | RestartSec=5s | StartLimit=60s/5 (Drop-in 10-neko-recovery.conf)
  DISCORD_RECOVERY:         Restart=always | RestartSec=5s | StartLimit=60s/5 (neko-discord-worker.service)
  DISCORD_RESOURCE_CAPS:    MemoryMax=128M | TasksMax=16 | CAP_NET_RAW preserved
  JOURNALD_STORAGE_CAP:     SystemMaxUse=500M (Drop-in 10-neko-journal-cap.conf)
  CONFIG_PREFLIGHT_CHECK:   DEPLOYED (ExecStartPre /opt/neko/neko_discord_worker.py --check-config)
  OPERATOR_DIAGNOSTICS:     DEPLOYED (/opt/neko/neko_ops_status.py — 0_HEALTHY)
  STATE_TEMP_CLEANUP:       DEPLOYED (Atomic try...finally unlinking in save_state_atomic)

DEPLOYED ARTIFACT SHA256 HASHES:
  /opt/neko/neko_discord_worker.py:
    86b3bcc378b95ec1831f8abe0cd86da065d5353196b1950244bd4c4e1a33f49c
  /opt/neko/neko_ops_status.py:
    cc66e117de1fad9ce15e2c8b3cd0acf3bba20278c8bfac96d0bd15f87383d7af
  /etc/systemd/system/neko-discord-worker.service:
    3f3fe986dd7f2125df866d2b4c60070cc820f1383ecabb4232a7f45608da8d5b
  /etc/systemd/system/shadowsocks-libev.service.d/10-neko-recovery.conf:
    b1f2612271176cc57581c316d4ecac702d5250a5ff3611a6381edb5a5687f8cb
  /etc/systemd/journald.conf.d/10-neko-journal-cap.conf:
    e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84
=============================================================================
```
