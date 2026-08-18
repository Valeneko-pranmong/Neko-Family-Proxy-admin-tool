# Server Monitoring Data Plane — Implementation Handoff (T4B)

## 1. Overview & Data Flow

Phase **T4B** implements the end-to-end data plane for Japan VPS server infrastructure monitoring, decoupling it entirely from Client telemetry and Launcher session authority.

```text
[Japan VPS Server Agent]
   │ (Push: HTTP POST /api/server/metrics/ingest every 5s with Bearer Secret)
   ▼
[Backend Ingest API (Vercel Node.js Serverless)]
   │ (Constant-time SHA-256 digest timingSafeEqual auth + Strict validation)
   ▼
[Supabase RPC: launcher.upsert_server_metrics_latest]
   │ (Atomic upsert with replay / out-of-order write rejection)
   ▼
[Persisted Latest Snapshot: public.server_metrics_latest]
   │
   ├────────────────────────────────────────┬────────────────────────────────────────┐
   ▼                                        ▼                                        ▼
[Admin API: /api/server/metrics]    [Admin API: /api/admin?resource=overview]    [Admin Web Dashboard]
   (Live status derivation)            (Server snapshot + Session authority)        (Health panel + KPI cards)
```

In parallel, Session Authority is maintained independently:

```text
[Launcher Heartbeats (30s push cadence)]
   │
   ▼
[launcher_sessions (DB)]
   │
   ▼
[Admin Overview: onlineSessionCount (<=120s) & entitledActiveUserCount (<=120s + Active License)]
```

---

## 2. Mandatory Architectural Corrections Applied

1. **Database Migration Authority**:
   - Migration placed exclusively in `D:\Github\Neko-Family-Proxy\supabase\migrations\20260818090000_server_monitoring_latest_snapshot.sql`.
   - Admin Web repo (`Neko-Family-Proxy-admin-tool`) contains NO database migrations.

2. **Authoritative Host States (V1)**:
   - `ONLINE`: Fresh snapshot ($\le 30\text{s}$), systemd service `active`, socket listener `listening`.
   - `DEGRADED`: Fresh snapshot ($\le 30\text{s}$), but service $\ne$ `active` or listener $\ne$ `listening`.
   - `STALE`: Snapshot age $> 30\text{s}$.
   - `UNKNOWN`: No snapshot or uninitialized.
   - `OFFLINE`: Reserved / not emitted in V1 (requires independent backend-side prober).

3. **Safe Ingest Secret Verification**:
   - Pre-hashes both expected and supplied secret strings using `crypto.createHash('sha256')` before `crypto.timingSafeEqual(digestA, digestB)`.
   - Prevents timing attacks and length leaks. Never logs raw secrets or Authorization headers.

4. **Zero Hardcoded Configuration**:
   - All runtime variables are config/environment-driven: `SERVER_ID`, `INGEST_URL`, `SERVER_METRICS_INGEST_SECRET`, `UPSTREAM_MONITOR_TARGET`, `NETWORK_INTERFACE`, `SHADOWSOCKS_SYSTEMD_UNIT`, `SHADOWSOCKS_LOCAL_HOST`, `SHADOWSOCKS_LOCAL_PORT`.

5. **Privacy Boundary Invariants**:
   - Ingest API and backend strictly reject forbidden client telemetry (`core_pid`, `client_rx_bytes`, `tcp_active`, `device_id`, etc.).
   - `LAUNCHER_SOURCE_CHANGED = NO`, `CORE_SOURCE_CHANGED = NO`.

---

## 3. Japan VPS Monitoring Agent Deployment Guide

### Files
- Script: `agent/neko_server_agent.py` (Python 3.8+ standard library, zero external pip dependencies).
- Systemd Unit: `agent/neko-server-monitor.service`.
- Environment Template: `agent/server-agent.env.example`.

### VPS Setup Instructions
```bash
# 1. Copy agent directory to VPS
sudo mkdir -p /opt/neko-server-monitor
sudo cp neko_server_agent.py /opt/neko-server-monitor/
sudo cp server-agent.env.example /etc/neko-server-monitor.env
sudo chmod 600 /etc/neko-server-monitor.env

# 2. Configure /etc/neko-server-monitor.env
# INGEST_URL=https://<your-admin-domain>/api/server/metrics/ingest
# SERVER_METRICS_INGEST_SECRET=<secret-min-32-chars>
# UPSTREAM_MONITOR_TARGET=1.1.1.1
# SHADOWSOCKS_SYSTEMD_UNIT=shadowsocks-rust.service
# SHADOWSOCKS_LOCAL_PORT=8388

# 3. Install and start systemd service
sudo cp neko-server-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neko-server-monitor.service

# 4. Verify agent status and logs
sudo systemctl status neko-server-monitor.service
sudo journalctl -u neko-server-monitor.service -f
```

---

## 4. Verification & Test Summary

- Automated Test Matrix (`tests/*.test.mjs`): **55 / 55 PASS**
  - Ingest authentication & timingSafeEqual digest verification: PASS
  - VPS payload validation & bounds checking: PASS
  - Replay / out-of-order write rejection: PASS
  - Freshness calculation & status derivation (`ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN`): PASS
  - Ping probe timeout isolation: PASS
  - Agent monotonic rate calculations & reboot counter reset safety: PASS
  - Privacy boundary regression test: PASS
  - Admin overview & server metrics read APIs: PASS
- Standalone HTML UI Build (`scripts/build-standalone.mjs`): **SUCCESS (59,530 bytes)**

---

## 5. Production Deployment & Live Verification Evidence (T4B Closure)

### 5.1 Authority Commit Identifiers & Infrastructure Targets
- **Backend/Database Authority**: `bc34b5b1e70228f3c007ba077e72d3650602bd34` (`origin/feature/neko-auth-lite-v1-launcher-backend`)
- **Admin/Monitoring Authority**: `2aac10282bb9af9d6bba62585bddab55f7e263d2` (`origin/main`)
- **Supabase Target**: `miikoutrnxsunbndecqh` (Migration `20260818090000_server_monitoring_latest_snapshot.sql` applied successfully)
- **Vercel Production Project**: `neko-control-room` (`https://neko-control-room.vercel.app`)
- **Japan VPS Infrastructure**: Ubuntu 22.04 LTS (`ens5`, Shadowsocks `shadowsocks-libev.service` listening on `0.0.0.0:8388`)

### 5.2 Production Configuration & Authentication Boundary Proof
- **Dedicated Ingest Secret**: Provisioned in `/etc/neko/server-agent.env` (`mode 600`, `root:root`) and configured in Vercel Production environment.
- **Local Secret Storage**: `D:\Github\docs\Server\.env` (NTFS ACL restricted, strictly untracked by Git).
- **Authentication Boundary Verification**:
  - Unauthenticated Ingest (`POST /api/server/metrics/ingest` without Authorization): **HTTP 401 Unauthorized (`DENIED`)**
  - Invalid Bearer (`POST /api/server/metrics/ingest` with wrong token): **HTTP 401 Unauthorized (`DENIED`)**
  - Valid Secret (`POST /api/server/metrics/ingest` with valid Bearer + `{}`): **HTTP 400 Bad Request (Validation failure, authentication passed)**

### 5.3 Live VPS Ingest & Snapshot Monotonicity
- **Sample Cadence**: 5 seconds.
- **Ingest Progression**: Verified consecutive samples with strictly advancing timestamps (`observed_at_1 < observed_at_2 < observed_at_3`).
- **Telemetry Invariants**:
  - `rx_bytes_total` / `tx_bytes_total`: Positive, monotonically tracking interface totals.
  - `rx_bps` / `tx_bps`: Non-negative live transfer rates.
  - `host_uptime_seconds`: Verified host uptime in seconds.
  - `shadowsocks_service_status`: `active` (systemd authority).
  - `shadowsocks_listener_status`: `listening` (TCP probe on `0.0.0.0:8388`).
  - `ping_status`: `AVAILABLE` (~1.7ms latency to `1.1.1.1`, label: `VPS → Upstream`).

### 5.4 Operational Failure Isolation & Recovery Proof
- **Process Isolation**: When stopping `neko-server-monitor.service`, `shadowsocks-libev.service` remained active and continued listening on port 8388 without interruption.
- **Stale State Transition**: After waiting $> 30\text{s}$ with agent stopped, dashboard status transitioned to `STALE` (did NOT declare server `OFFLINE`).
- **Live Recovery**: Upon starting `neko-server-monitor.service`, new `observed_at` snapshots immediately resumed and status transitioned from `STALE` back to `ONLINE`.

### 5.5 Privacy & Security Invariant Audit
- **Zero Client Telemetry**: Verified complete absence of client identifiers, process PIDs (`core_pid`, `game_pid`, `v2ray_pid`), packet flows, and client network counters.
- **Active User Authority**: Derived exclusively from `public.launcher_sessions` ($\le 120\text{s}$ freshness) and independent of VPS socket counts.
- **Secret Audit**: Zero credentials or Authorization headers in agent logs, Vercel logs, or Git history.
