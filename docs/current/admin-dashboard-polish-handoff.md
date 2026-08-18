# Phase T5 Admin Dashboard Polish & Live Visualization Handoff

## Overview
Phase T5 focused on improving the visual coherence, accessibility, operational hierarchy, and statistical honesty of the Neko Family Proxy Admin Dashboard (**Neko Control Room**).

This phase strictly maintained the **T4B Server Monitoring Authority** and **Session Plane Authority** without altering backend persistence schemas, server agent sources, or client privacy boundaries.

---

## 1. Information Hierarchy & UI Architecture

The overview screen is restructured into a clear operational hierarchy:

1. **Infrastructure Header / Banner**:
   - Connection status (`เชื่อมต่อ Admin API แล้ว · Auto-polling 5s`), current Bangkok timezone (UTC+7), and manual refresh button.
2. **Primary Server Health (Japan VPS)**:
   - Panel eyebrow: `INFRASTRUCTURE AUTHORITY`
   - Host Status badge (`● ONLINE`, `▲ DEGRADED`, `◷ STALE`, `○ UNKNOWN`) with relative observation age (`formatRelativeAge`).
   - Prominent Stale warning chip (`◷ ข้อมูลค้าง (>30s)`) if snapshot exceeds 30 seconds.
   - **Primary KPI Grid (6 cards)**:
     1. **Host Status**: Status badge + latest observation relative age.
     2. **VPS → Upstream**: Upstream latency in ms + Loss % + Probe status (`AVAILABLE` / `TIMEOUT`). Ping target label strictly `VPS → Upstream`.
     3. **Packet Loss**: Percentage + Probe status.
     4. **VPS Download (RX)**: Current rate (`bps`, `Kbps`, `Mbps`, `Gbps`) + Total host RX (`formatBytes`).
     5. **VPS Upload (TX)**: Current rate (`bps`, `Kbps`, `Mbps`, `Gbps`) + Total host TX (`formatBytes`).
     6. **Active Users (Session Authority)**: Online count (fresh heartbeats <= 120s) + Entitled count.
   - **Secondary Server Details Bar**:
     - `Host Uptime`: Formatted uptime (e.g. `3d 12h`, `5h 31m`, `42s`).
     - `Shadowsocks Daemon`: Systemd unit status (`● active`, `■ failed`, `○ unknown`).
     - `Shadowsocks Listener`: TCP socket probe (`● listening`, `■ closed`, `○ unknown`).
     - `Server ID`: `japan-vps-1`.
     - `Last Observation`: Time + age.
3. **Live Network Activity Chart**:
   - Subtitle: `Live — Since Dashboard Opened`
   - Rolling buffer of VPS Download & Upload speeds accumulated in browser memory.
4. **Member & Entitlement KPIs**:
   - Total Members, Active Licenses, Active Sessions, Online Sessions, Recognized Installations, Usable Coupons.
5. **Historical Launcher Activity**:
   - Trend chart for Session creations and Coupon redemptions across 24h, 7d, 14d, 30d buckets.
6. **Operational Summary & Audit Log**.

---

## 2. Status Model & Presentation

T5 strictly respects authoritative T4B server states and accessibility guidelines:

| State | Glyph | Visual Tone | Meaning |
| :--- | :---: | :--- | :--- |
| **ONLINE** | `●` | Emerald Green (`#287b5b`) | Snapshot fresh (<= 30s) and Shadowsocks service/listener active. |
| **DEGRADED** | `▲` | Amber (`#8b5c0a`) | Snapshot fresh, but Shadowsocks daemon or TCP listener reported an issue. |
| **STALE** | `◷` | Orange/Amber (`#8b5c0a`) | Snapshot older than 30s (`age_seconds > 30`). |
| **UNKNOWN** | `○` | Slate/Neutral (`#665c6b`) | No authoritative snapshot available in database. |

> [!IMPORTANT]
> **No Frontend OFFLINE Inference**: The frontend never derives `OFFLINE` from stale snapshots, missing data, or ping timeouts. `STALE` remains `STALE`.

---

## 3. Network Unit & Rate Semantics

Source inspection of `neko_server_agent.py` confirmed:
- `rx_bps` and `tx_bps` calculate `(delta_bytes / elapsed_seconds) * 8.0` (true **bits per second**).
- `rx_bytes_total` and `tx_bytes_total` are cumulative interface **bytes**.

Formatting rules:
- **Speed Rates**: Formatted in decimal bits/sec (`bps`, `Kbps`, `Mbps`, `Gbps`).
- **Data Totals**: Formatted in binary bytes (`B`, `KB`, `MB`, `GB`, `TB`).
- **Rates Authority**: Server snapshot rates are used directly; the frontend never recalculates conflicting authoritative rates.

---

## 4. Live Rolling Graph Contract

Because `public.server_metrics_latest` stores only `LATEST_ONLY` snapshots, T5 implements an honest **browser-local rolling live history**:

- **Graph Mode**: `BROWSER_LOCAL_ROLLING`
- **Graph Label**: `Live Network Activity` (Sublabel: `Live — Since Dashboard Opened`)
- **Sample Identity**: `observed_at` (Deduplication prevents appending duplicate points from jittery polls).
- **Buffer Bound**: 60 samples maximum (`MAX_LIVE_SAMPLES = 60`).
- **Polling Cadence**: 5000 ms (5 seconds).
- **Window Size**: 60 samples × 5s = **~5 minutes** of real-time activity.
- **Deduplication**: If incoming snapshot `observed_at` is identical or older than the last point, it is ignored (`DUPLICATE_OBSERVED_AT_APPENDED = NO`).
- **Error & Stale Handling**: If API fails or snapshot becomes `STALE` or `UNKNOWN`, no fake zero points are appended (`API_ERROR_CREATES_ZERO_SAMPLE = NO`, `STALE_CREATES_ZERO_SAMPLE = NO`).
- **Page Reload**: Graph buffer resets on page reload; no pre-load history is fabricated.

---

## 5. Polling & Visibility Controller

- **Cadence**: 5 seconds (`POLL_CADENCE_MS = 5000`).
- **Concurrency Guard**: `MAX_CONCURRENT_OVERVIEW_POLLS = 1` (skips tick if a previous poll request is still in flight).
- **Page Visibility**:
  - When tab is hidden: Polling pauses to save bandwidth and prevent unobserved background state churn.
  - When tab becomes visible: Immediately polls the latest authoritative snapshot without backfilling or interpolating missed samples (`HIDDEN_PERIOD_BACKFILL = NO`).

---

## 6. Session Management & Table UX

- **Session Status Semantics**:
  - **Online**: Unrevoked session with fresh heartbeat within 120s (`● Online`).
  - **Offline**: Unrevoked session with heartbeat older than 120s (`■ Offline`).
  - **Revoked**: `revoked_at` timestamp present (`■ Revoked`).
  - *No "Idle" authority invented.*
- **Affordances**:
  - Truncated Session ID and License ID with one-click copy affordance (`data-copy`).
- **Revoke Safety**:
  - Confirmation prompt before dispatch.
  - Button state switches to `กำลังดำเนินการ…` and is disabled while in-flight (`DUPLICATE_REVOKE_REQUEST_FROM_DOUBLE_CLICK = PREVENTED`).
- **Privacy Boundary**:
  - Excludes device hardware IDs, machine identifiers, Core PID, Game PID, and client-side traffic.

---

## 7. Test & Build Verification Summary

| Gate | Status | Details |
| :--- | :---: | :--- |
| **Test Suite** | **PASS** | 71 tests passing (0 failures, 0 skipped) |
| **Standalone Web Build** | **PASS** | `standalone/dist/neko-control.html` (73,355 bytes) |
| **Privacy Check** | **PASS** | No secrets (`SERVER_METRICS_INGEST_SECRET`, `SUPABASE_SECRET_KEY`) in client bundle |
| **Diff Check** | **PASS** | Clean LF line endings and whitespace |
