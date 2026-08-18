# NEKO FAMILY PROXY — WEEKLY MAINTENANCE AUTOMATION & SEGA PROBE AUTHORITY (PHASE T9)

```text
DOCUMENT:               docs/current/weekly-maintenance-automation-handoff.md
STATUS:                 AUTHORITATIVE SPECIFICATION & DESIGN RECORD (CLOSED & DEPLOYED)
CLASSIFICATION:         OPERATIONAL AUTOMATION & DISCOVERY SPECIFICATION
PHASE:                  T9 (Weekly Maintenance Automation & SEGA Probe Discovery — COMPLETE)
PREVIOUS_PHASE:         T8 (Production Operations & Health Hardening — CLOSED & DEPLOYED)
CURRENT_PHASE:          T9 (Weekly Maintenance Lifecycle — CLOSED & VERIFIED IN PRODUCTION)
SUCCESSOR_PHASE:        NONE / OWNER-DIRECTED NEXT PHASE
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
PRODUCTION_TARGET:      AWS Lightsail Japan VPS (ap-northeast-1 / 18.178.140.8)
SERVER_AUTHORITY:       8832429a7546ab57dd8ac3a48b40b93387cb9f19
PRODUCTION_PROOF:       docs/current/weekly-maintenance-automation-production-proof.md
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Phase T9 Scope Succession

### Phase T9 Scope Clarification & Succession:
```text
T9_LEGACY_RETIREMENT_IDEA = DEFERRED
T9_CURRENT_AUTHORITY      = WEEKLY_MAINTENANCE_AUTOMATION_AND_SEGA_PROBE_DISCOVERY
```
The original concept of retiring legacy components in T9 has been **DEFERRED** by architectural direction. The current authoritative scope for **Phase T9** is:
1. **Automated Weekly Host Maintenance**: Deterministic systemd timer on AWS Lightsail JP executing weekly orderly reboots every Tuesday at 02:00 Asia/Bangkok with zero randomized jitter.
2. **Discord Maintenance State**: Single-publisher in-place status edit to `🛠️ กำลังซ่อมบำรุง` before host reboot, with natural post-boot recovery back to real health (`ONLINE`/`DEGRADED`) on the SAME persistent message.
3. **Missing-ID Safety Guardrail**: Bounded duplicate message protection — no blind POSTs when state ID is absent.
4. **SEGA Probe Authority Discovery**: Read-only empirical inspection of legacy configuration and routing targets to determine truthful probe labeling without client telemetry.

---

## 2. SEGA Probe Authority & Production Infrastructure Authority

### 2.1 Explicit Supersession of Legacy V1 Artifacts
```text
=============================================================================
HISTORICAL V1 REPOSITORY CLASSIFICATION
=============================================================================
DIRECTORY:                            D:\Github\proxy project JP - AES
CLASSIFICATION:                       HISTORICAL V1 SOURCE
STATUS:                               SUPERSEDED / NON-AUTHORITATIVE
CURRENT_PRODUCTION_AUTHORITY:         NO
SEGA_PROBE_AUTHORITY:                 NO
ROUTING_AUTHORITY:                    NO
PROXY/CIPHER_AUTHORITY:               NO
USE_FOR_T9_DECISIONS:                 NO

GOVERNANCE RULE:
Do NOT use D:\Github\proxy project JP - AES to determine current proxy protocol,
cipher, Japan VPS configuration, SEGA endpoints, PSO2 routing, or Discord probe
targets. Historical inspection is non-authoritative and excluded from T9 decisions.
=============================================================================
```

### 2.2 Current Production Authority Hierarchy & Active Config
Current production authority derives exclusively from:
1. `D:\Github\NekoProxyCore` (Client Core data plane & NetFilter driver)
2. `D:\Github\Neko-Family-Proxy` (Backend / VPS agent daemons)
3. Active production AWS Lightsail Japan configuration (`18.178.140.8`)
4. Authoritative architecture documentation and production proof records

```text
=============================================================================
ACTIVE PRODUCTION INFRASTRUCTURE AUTHORITY
=============================================================================
CURRENT_PROXY_PROTOCOL:               SHADOWSOCKS
CURRENT_PROXY_IMPLEMENTATION:         shadowsocks-libev (shadowsocks-libev.service)
CURRENT_PROXY_PORT:                   8388
CURRENT_PROXY_CIPHER:                 aes-128-gcm
SOURCE:                               AWS LIGHTSAIL ACTIVE CONFIG
SECRET_VALUE_PRINTED:                 NO
=============================================================================
```

### 2.3 SEGA Probe Authority Freeze & Honest Metric Labeling
```text
=============================================================================
PROBE AUTHORITY & DISPLAY LABEL MATRIX
=============================================================================
SEGA_ENDPOINT_AUTHORITY:              NOT_FOUND (Routing is strictly ProcessMode on pso2.exe)
SEGA_PROBE_AUTHORITY:                 BLOCKED_PENDING_AUTHORITY
SEGA_PROBE_METHOD:                    BLOCKED_PENDING_AUTHORITY
CURRENT_PING_TARGET:                  1.1.1.1
CURRENT_DISPLAY_LABEL:                Ping (Proxy VPS → Upstream)
FINAL_DISPLAY_LABEL:                  Ping (Proxy VPS → Upstream)
PING_LABEL_FALSE_CLAIM:               NO
CORE_SOURCE_CHANGED:                  NO
CLIENT_TELEMETRY_ADDED:               NO
=============================================================================
```

> [!IMPORTANT]
> **Why Probe Renaming is Blocked**:
> - `NekoProxyCore` intercepts traffic by process name (`pso2.exe`) at the L3/L4 driver level without static SEGA endpoint definitions.
> - The production VPS maintains a strict privacy boundary (zero per-user destination logging, zero packet payload captures).
> - Relabeling the current `1.1.1.1` probe to `Core → SEGA Server` or `Proxy VPS → SEGA Server` without measuring an actual SEGA server would be a false claim.
> - Therefore, the label **`Ping (Proxy VPS → Upstream)`** is preserved as-is, probing `1.1.1.1`. Weekly maintenance automation is fully decoupled and proceeds immediately.

---

## 3. Weekly Maintenance Architecture & Semantics

### 3.1 Schedule & Timing Authority
- **Day**: Every Tuesday
- **Time**: 02:00 (02:00:00)
- **Timezone**: `Asia/Bangkok` (Thailand UTC+7)
- **Recurrence**: Weekly
- **Systemd OnCalendar**: `Tue *-*-* 02:00:00 Asia/Bangkok`
- **Timer Accuracy**: `AccuracySec=1s`
- **Randomized Jitter**: `RandomizedDelaySec=0`
- **Missed Window Policy**: `Persistent=false` (If the VPS is offline at Tuesday 02:00, the missed run is **SKIPPED**; no catch-up reboot occurs upon later boot).

### 3.2 Maintenance Execution Lifecycle

```text
Every Tuesday 02:00 Asia/Bangkok (neko-weekly-maintenance.timer fires)
                           │
                           ▼
          neko-weekly-maintenance.service starts
                           │
                           ▼
          neko_weekly_maintenance.py --execute
                           │
    ┌──────────────────────┴──────────────────────┐
    │ 1. STOP WORKER                             │
    │    systemctl stop neko-discord-worker       │
    │    confirm inactive                         │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────┴──────────────────────┐
    │ 2. PUBLISH MAINTENANCE STATUS               │
    │    Load /var/lib/neko/discord-state.json    │
    │    status_message_id PRESENT:               │
    │      ├─ PATCH 2xx -> Edited in place        │
    │      ├─ PATCH 404 -> POST 1 replacement     │
    │      └─ Fail -> Bounded retry -> continue   │
    │    status_message_id ABSENT:                │
    │      └─ Log MISSING -> Do NOT blindly POST  │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────┴──────────────────────┐
    │ 3. ORDERLY HOST REBOOT                      │
    │    systemctl reboot                         │
    └──────────────────────┬──────────────────────┘
                           │
                           ▼
                    VPS Normal Boot
                           │
    ┌──────────────────────┴──────────────────────┐
    │ 4. POST-BOOT SERVICE RECOVERY               │
    │    - shadowsocks-libev.service starts       │
    │    - neko-server-monitor.service starts     │
    │    - neko-discord-worker.service starts     │
    └──────────────────────┬──────────────────────┘
                           │
                           ▼
       Discord Worker loads status_message_id
       Evaluates REAL service health (~5s delay)
       Edits SAME message to ONLINE / DEGRADED
```

---

## 4. Source-Controlled Artifacts

### 4.1 Maintenance Controller (`agent/neko_weekly_maintenance.py`)
- **Location**: `agent/neko_weekly_maintenance.py` (0755 root:root on VPS)
- **CLI Options**:
  - `--check-config`: Validates environment credentials and state file accessibility without logging secrets.
  - `--dry-run`: Performs full pre-flight verification without stopping services, sending Discord HTTP requests, or rebooting host.
  - `--publish-only`: Updates Discord maintenance status embed without stopping worker or rebooting host.
    > [!NOTE]
    > **`--publish-only` Semantics**: Classified as a **DIAGNOSTIC / MANUAL SHORT-LIVED OPERATION** (not a persistent manual maintenance mode). If executed while `neko-discord-worker.service` is active, the normal worker will naturally overwrite the status on its next ~60s cycle.
  - `--execute`: Complete automated production maintenance run (worker stop -> confirm inactive -> publish maintenance embed -> systemctl reboot).
- **Missing-ID Safety**:
  ```python
  if not msg_id:
      _safe_log("MAINTENANCE_STATUS_ID_MISSING", action="SKIP_BLIND_POST")
      return False
  ```
  Prevents duplicate status message creation if the state file was reset while the Discord message is still live.
- **Discord Failure Policy**:
  `REBOOT_CONTINUES_AFTER_BOUNDED_DISCORD_FAILURE = YES`
  Bounded 1-retry limit prevents host maintenance from hanging indefinitely if Discord API is degraded.

### 4.2 Systemd Service (`agent/systemd/neko-weekly-maintenance.service`)
```ini
[Unit]
Description=Neko Family Proxy — Weekly VPS Maintenance Controller
Documentation=https://github.com/Valeneko-pranmong/Neko-Family-Proxy-admin-tool
After=network.target

[Service]
Type=oneshot
EnvironmentFile=-/etc/neko/discord.env
ExecStart=/usr/bin/python3 /opt/neko/neko_weekly_maintenance.py --execute
TimeoutStartSec=60s
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=/var/lib/neko

[Install]
WantedBy=multi-user.target
```

### 4.3 Systemd Timer (`agent/systemd/neko-weekly-maintenance.timer`)
```ini
[Unit]
Description=Neko Family Proxy — Weekly VPS Maintenance Timer (Tuesday 02:00 Asia/Bangkok)
Documentation=https://github.com/Valeneko-pranmong/Neko-Family-Proxy-admin-tool

[Timer]
OnCalendar=Tue *-*-* 02:00:00 Asia/Bangkok
Persistent=false
AccuracySec=1s
RandomizedDelaySec=0
Unit=neko-weekly-maintenance.service

[Install]
WantedBy=timers.target
```

### 4.4 Frozen Artifact SHA256 Hashes (Phase T9A Authority)
```text
=============================================================================
FROZEN T9A CANDIDATE SHA256 MATRIX
=============================================================================
1. Maintenance Controller:
   Path:      agent/neko_weekly_maintenance.py
   SHA256:    4a68faacd28c7b166d2c4906048328d59f18235da9f11562f61f8067e64273ce

2. Maintenance Systemd Service:
   Path:      agent/systemd/neko-weekly-maintenance.service
   SHA256:    32d40bfa2945ceb68ec80ee201a9d0ec10c89aa45ad3827cf9a8e5997fc0a4d7

3. Maintenance Systemd Timer:
   Path:      agent/systemd/neko-weekly-maintenance.timer
   SHA256:    1d43df76b4218df1034f70efd1c9402b8b7725415b6d7b0bf8e12a1932ec1ac8

4. Maintenance Test Suite:
   Path:      agent/tests/test_weekly_maintenance.py
   SHA256:    70d95a9f6558eaab3d3f28af94c03a8ed1ab34d228b5a4a7860e871b02eb370e
=============================================================================
```

---

## 5. Discord Maintenance Message Specification

```text
=============================================================================
DISCORD MAINTENANCE EMBED FORMAT
=============================================================================
TITLE:        🛠️ NEKO PROXY — กำลังซ่อมบำรุง
COLOR:        0xE67E22 (Amber / Maintenance Orange)
FIELDS:
  • Status:   **🛠️ MAINTENANCE** (inline=True)
  • Reason:   การบำรุงรักษาประจำสัปดาห์ (inline=True)
  • Schedule: ทุกวันอังคาร เวลา 02:00 น. (เวลาไทย) (inline=False)
  • Action:   ระบบกำลังรีสตาร์ตและจะกลับมาให้บริการอัตโนมัติ (inline=False)
FOOTER:       ระบบจะกลับมาให้บริการอัตโนมัติหลังการรีสตาร์ต | AWS Lightsail JP
TIMESTAMP:    Current UTC ISO-8601
ALLOWED:      {"parse": []} (No mass mentions)
PRIVACY:      ZERO Active Users, ZERO user sessions, ZERO client telemetry
=============================================================================
```

---

## 6. Deterministic Verification Evidence

### 6.1 Unit Test Suite (`agent/tests/test_weekly_maintenance.py`)
All 62 unit tests pass deterministically:
```text
Ran 62 tests in 1.116s
OK
```

**Verified Test Cases**:
1. `test_build_maintenance_payload_structure`: Verifies title, color, Thai fields, and footer.
2. `test_payload_strict_privacy_invariants`: Confirms absence of active users, user IDs, session data, or credentials.
3. `test_status_id_present_patch_success`: In-place PATCH of existing `status_message_id`.
4. `test_status_id_present_patch_404_controlled_replacement`: Controlled POST ?wait=true and atomic state update on 404.
5. `test_status_id_absent_does_not_blindly_post`: Zero network POST calls when `status_message_id` is missing (`BLIND_POST_ON_MISSING_STATE_ID = NO`).
6. `test_reboot_continues_after_bounded_discord_failure`: Host reboot command is issued even if Discord timeout/error occurs.
7. `test_execution_order_worker_stop_before_publish_and_reboot`: Exact sequential ordering: worker stop -> confirm inactive -> Discord publish -> systemctl reboot.
8. `test_dry_run_never_invokes_real_mutations`: `--dry-run` performs zero process stops, zero Discord requests, and zero reboots.
9. `test_timer_semantics`: Confirms `OnCalendar=Tue *-*-* 02:00:00 Asia/Bangkok`, `Persistent=false`, `AccuracySec=1s`.
10. `test_service_semantics`: Confirms `Type=oneshot`, `ExecStart`, `TimeoutStartSec=60s`.
11. `test_worker_edits_same_message_with_real_health`: Validates worker naturally recovers from maintenance state by publishing real health.

---

## 7. Operator Runbook & Verification (For Future Phase T9B Rollout)

### 7.1 Pre-Deployment Dry-Run
```bash
sudo /usr/bin/python3 /opt/neko/neko_weekly_maintenance.py --check-config
sudo /usr/bin/python3 /opt/neko/neko_weekly_maintenance.py --dry-run
```

### 7.2 Systemd Timer Verification
```bash
# Verify calendar schedule syntax
systemd-analyze calendar "Tue *-*-* 02:00:00 Asia/Bangkok"

# Check active timer status & next scheduled trigger
systemctl list-timers neko-weekly-maintenance.timer
```

### 7.3 Post-Reboot Health Verification
```bash
sudo systemctl is-active shadowsocks-libev.service
sudo systemctl is-active neko-server-monitor.service
sudo systemctl is-active neko-discord-worker.service
sudo /opt/neko/neko_ops_status.py
```

### 7.4 Rollback / Disable Maintenance Timer
```bash
sudo systemctl disable --now neko-weekly-maintenance.timer
```

---

## 8. Architectural Invariants Matrix

```text
PRODUCTION_CHANGED                             = NO
LOCAL_REBOOT_TRIGGERED                         = NO
PUSH_PERFORMED                                 = NO
MAINTENANCE_IN_STATUS_STATE_MACHINE            = NO
POST_BOOT_NORMAL_STATUS                        = REAL_HEALTH
MISSED_MAINTENANCE_WINDOW                      = SKIP
REBOOT_CONTINUES_AFTER_BOUNDED_DISCORD_FAILURE = YES
BLIND_POST_ON_MISSING_STATE_ID                 = NO
DUPLICATE_STATUS_MESSAGE_RISK                  = BOUNDED
PING_LABEL_FALSE_CLAIM                         = NO
ACTIVE_USERS_TRACKING                          = ZERO
CLIENT_TELEMETRY_ADDED                         = NO
```
