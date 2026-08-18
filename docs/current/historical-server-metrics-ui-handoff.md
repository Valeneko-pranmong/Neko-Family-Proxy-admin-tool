# NEKO FAMILY PROXY — HISTORICAL SERVER METRICS UI HANDOFF (PHASE T6C)

```text
DOCUMENT:               docs/current/historical-server-metrics-ui-handoff.md
STATUS:                 COMPLETED_LOCAL_CANDIDATE (T6C UI Implemented & Verified Locally)
CLASSIFICATION:         OPERATIONAL HANDOFF & UI AUTHORITY
PHASE:                  T6C (Admin Dashboard Historical Charts UI)
PREVIOUS_PHASE:         T6B (Historical Server Metrics Persistence & Admin History API)
NEXT_PHASE:             T6D (Production Migration Apply, Cron Retention & Remote Deployment)
PRIMARY_TEAM:           TEAM_WEB
SUPPORT_TEAM:           TEAM_COORDINATION
TEAM_CORE:              NO ACTION (Frozen at Phase T2)
TEAM_LAUNCHER:          NO ACTION (Frozen at Phase T3)
DATE:                   2026-08-18
```

---

## 1. Executive Summary & Production Status Clarification

> [!IMPORTANT]
> **Production State Warning**:
> **History implemented locally $\neq$ History deployed to production.**
> Phase T6C completes the full frontend chart UI, range switching, gap visualization, and race condition protections locally. However, historical metrics on the live production Admin Dashboard will only become active after **Phase T6D** executes the database migration `20260818120000_server_monitoring_history.sql`, configures the retention pruning job, and deploys the updated Admin Web code to Vercel.

```text
+---------------------------------------------------------------------------------------------------+
|                                      PHASE STATUS SUMMARY                                         |
+---------------------------------------------------------------------------------------------------+
|  Phase T6A: Architecture & Contract Design         | COMPLETED & FROZEN (Commit 7168bf65...)     |
|  Phase T6B: Persistence & Admin History API        | COMPLETED LOCALLY (Candidate for T6D)        |
|  Phase T6C: Admin Dashboard Historical Charts UI   | COMPLETED LOCALLY (Candidate for T6D)        |
|  Phase T6D: Supabase Migration & Production Proof  | FINAL DEPLOYMENT (Next in Queue)             |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Implemented UI Architecture & Features

### 2.1 Range Controls & Data Authorities
The Server Network Activity panel now provides a segmented range switcher:

| Range | Authority | Time Resolution | Max Points | Description |
| :--- | :--- | :--- | :--- | :--- |
| **LIVE** | Browser Memory Rolling Buffer | 5-second snapshot | 60 points (~5 min) | Real-time session graph, resets on page reload |
| **1H** | Server History API (`GET /api/server/metrics/history?range=1h`) | 60-second bucket (`date_bin`) | 60 points | Last 1 Hour aggregated traffic |
| **24H** | Server History API (`GET /api/server/metrics/history?range=24h`) | 300-second bucket (`date_bin`) | 288 points | Last 24 Hours aggregated traffic |
| **7D** | Server History API (`GET /api/server/metrics/history?range=7d`) | 1800-second bucket (`date_bin`) | 336 points | Last 7 Days aggregated traffic |

### 2.2 Async Race Condition Protections
To protect against network latency races during rapid switching between `Live`, `1H`, `24H`, and `7D`:
1. **Monotonic Request Identification (`historyRequestId`)**:
   - Every history fetch assigns an incrementing request ID.
   - When a fetch completes, if `requestId !== historyRequestId`, the late response is safely discarded.
2. **Selected Range Guard (`store.state.serverChartRange !== range`)**:
   - If the user selects another range while an API request is in-flight, the returned data cannot overwrite the currently selected range.
3. **Live Navigation Guard**:
   - If the user navigates back to `LIVE` while a historical query is in flight, the historical response is discarded and cannot overwrite the browser's live rolling buffer.
4. **Single In-Flight Concurrency (`historyRequestInFlight`)**:
   - At most 1 historical API request is allowed in flight simultaneously (`MAX_CONCURRENT_HISTORY_REQUESTS = 1`).

### 2.3 Refresh Cadence & Tab Visibility Rules
- **Cadence**: Historical metrics refresh every **30 seconds** (`HISTORY_REFRESH_CADENCE = 30 seconds`).
- **Active Tab Check**: History polling only executes when the active tab is `overview`.
- **Visibility Check**: When `document.visibilityState !== 'visible'`, historical polling is completely suspended (`HISTORY_POLL_WHILE_HIDDEN = NO`).
- **Visibility Resume**: When returning to the dashboard (`visibilitychange` $\rightarrow$ `visible`), an immediate refresh is dispatched for the selected historical range.

### 2.4 Gap & Outage Visualization
- **Strict Gap Preservation**: If the time gap between consecutive buckets exceeds $1.5 \times \text{bucket\_seconds}$ (`next.bucket_start - prev.bucket_start > 1.5 * bucket_seconds`), the SVG polyline is split into disjoint segments.
- **Zero Fake Zeroes**: Outages and unobserved periods are rendered as visual breaks in the line graph, never as fabricated 0 bps data (`SYNTHETIC_HISTORICAL_POINTS = NO`, `EMPTY_HISTORY_FAKE_ZERO = NO`).

### 2.5 Service Degradation Visual Markers
- For any aggregate bucket where `had_service_failure = true` or `had_listener_failure = true`:
  - A prominent red warning glyph (`degradation-marker`) is rendered on the bucket coordinate.
  - The tooltip explicitly indicates: `⚠️ Shadowsocks Service/Listener Degraded`.
  - The chart legend highlights: `มี Service/Listener ขัดข้องในช่วงเวลา`.

### 2.6 Partial History & State Isolation
- **Available Since Badge**: When the database contains partial history (e.g. newly deployed server or truncated history), the panel displays: `มีข้อมูลตั้งแต่ [timestamp]`.
- **Empty State**: Explicitly informs the administrator: `ยังไม่มีข้อมูลประวัติย้อนหลังในช่วงเวลานี้ (ระบบจะไม่สร้างข้อมูลจำลองหรือเส้นศูนย์แทนข้อมูลจริง)`.
- **Error Isolation**: If the History API fails or times out:
  - If no points exist, an isolated error notice is displayed in the chart area.
  - If previous points exist, the graph remains visible and a stale warning banner is displayed.
  - Top-level VPS Infrastructure Health (`ONLINE`, `DEGRADED`, `STALE`, `UNKNOWN`) is completely decoupled and unaffected (`HISTORY_OVERRIDES_CURRENT_HOST_STATE = NO`).

---

## 3. Privacy & Secret Invariants

| Guardrail | Status | Verification Mechanism |
| :--- | :--- | :--- |
| **Zero Client Hardware Telemetry** | ENFORCED | No `core_pid`, `game_pid`, `machine_id`, `device_name` in HTML/SVG |
| **Zero Ingestion Secret in Frontend** | ENFORCED | Verified via static string audit in `tests/historical-chart-ui.test.mjs` |
| **Cumulative Counters Not Averaged** | ENFORCED | Historical graph charts strictly average and peak RX/TX bitrates |
| **No PSO2 Target Leaks in Graph** | ENFORCED | Latency is strictly labeled as `VPS → Upstream` |

---

## 4. Test Verification Summary

All automated test suites across the repository pass completely (`97 / 97 PASS`):

```text
> npm run build:standalone; npm test

Built D:\Github\Neko-Family-Proxy-admin-tool\standalone\dist\neko-control.html (89341 bytes)
ℹ tests 97
ℹ suites 0
ℹ pass 97
ℹ fail 0
ℹ duration_ms ~2900ms
```

### Coverage Highlights:
- Segmented range switching (`LIVE`, `1H`, `24H`, `7D`)
- T5 browser-local live buffer preservation
- Gap splitting at $1.5 \times \text{bucket\_seconds}$
- Degradation marker rendering on service/listener failure
- Async race condition protections (stale response discard, live navigation discard)
- Bounded payload point validation
- Zero secret leak audit in standalone bundle

---

## 5. Phase T6D Deployment Checklist

To deploy the historical server metrics feature to production:
1. [ ] **Supabase Migration**: Apply `supabase/migrations/20260818120000_server_monitoring_history.sql` to live Supabase production.
2. [ ] **Retention Setup**: Schedule `launcher.prune_server_metrics_history(7)` (hourly via `pg_cron` or Backend RPC scheduled trigger).
3. [ ] **Deploy Admin Web**: Deploy updated Vercel Serverless API and standalone client.
4. [ ] **Remote Verification**: Verify that the Japan VPS daemon feeds historical metrics continuously and the Admin Dashboard displays `1H`, `24H`, and `7D` aggregate graphs.
