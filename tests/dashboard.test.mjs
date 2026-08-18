import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateTrend,
  classifyLicense,
  countRecentlyOnlineSessions,
  formatAuditEvent,
  isCouponBatchUsable,
  normalizeTrendRange,
  summarizeCurrentSessions,
} from "../server/dashboard.mjs";
import {
  formatBps,
  formatBytes,
  formatRelativeAge,
  formatUptime,
  statusIcon,
} from "../standalone/src/ui/escape.js";
import { statusBadge } from "../standalone/src/ui/table.js";
import { appendLiveServerSample, MAX_LIVE_SAMPLES, segmentHistoryPoints } from "../standalone/src/state.js";
import {
  renderHistoricalServerChart,
  renderLiveServerChart,
  renderOverview,
  renderSectionRefreshNotice,
  renderServerChart,
  renderServerHealth,
  renderSessions,
} from "../standalone/src/sections/render.js";

const now = new Date("2026-08-09T10:00:00.000Z");

test("trend range rejects inherited object property names", () => {
  for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(normalizeTrendRange(value), "14d");
  }
});

test("expired active-status license is not effectively active", () => {
  assert.equal(classifyLicense({
    status: "active",
    valid_from: "2026-07-01T00:00:00.000Z",
    valid_until: "2026-08-09T09:59:59.000Z",
  }, now), "expired");
});

test("future license is scheduled rather than effectively active", () => {
  assert.equal(classifyLicense({
    status: "active",
    valid_from: "2026-08-10T00:00:00.000Z",
    valid_until: "2026-09-10T00:00:00.000Z",
  }, now), "scheduled");
});

test("revoked sessions are excluded and recent status requires a fresh heartbeat", () => {
  assert.deepEqual(summarizeCurrentSessions([
    { revoked_at: null, last_seen_at: "2026-08-09T09:59:00.000Z" },
    { revoked_at: null, last_seen_at: "2026-08-09T09:50:00.000Z" },
    { revoked_at: "2026-08-09T09:59:30.000Z", last_seen_at: "2026-08-09T09:59:30.000Z" },
  ], now), { current: 2, recentlyOnline: 1 });
});

test("recently online excludes sessions whose license is expired, revoked, future, or missing", () => {
  const fresh = "2026-08-09T09:59:00.000Z";
  const sessions = [
    { license_id: "valid", revoked_at: null, last_seen_at: fresh },
    { license_id: "expired", revoked_at: null, last_seen_at: fresh },
    { license_id: "revoked", revoked_at: null, last_seen_at: fresh },
    { license_id: "future", revoked_at: null, last_seen_at: fresh },
    { license_id: "missing", revoked_at: null, last_seen_at: fresh },
  ];
  const licenses = [
    { id: "valid", status: "active", valid_from: "2026-08-01T00:00:00.000Z", valid_until: "2026-09-01T00:00:00.000Z" },
    { id: "expired", status: "active", valid_from: "2026-08-01T00:00:00.000Z", valid_until: "2026-08-09T09:59:59.000Z" },
    { id: "revoked", status: "revoked", valid_from: "2026-08-01T00:00:00.000Z", valid_until: "2026-09-01T00:00:00.000Z" },
    { id: "future", status: "active", valid_from: "2026-08-10T00:00:00.000Z", valid_until: "2026-09-01T00:00:00.000Z" },
  ];
  assert.equal(countRecentlyOnlineSessions(sessions, licenses, now), 1);
});

test("coupons in revoked or expired batches are not usable", () => {
  assert.equal(isCouponBatchUsable({ revoked_at: now.toISOString(), expires_at: null }, now), false);
  assert.equal(isCouponBatchUsable({ revoked_at: null, expires_at: "2026-08-09T09:59:59.000Z" }, now), false);
  assert.equal(isCouponBatchUsable({ revoked_at: null, expires_at: null }, now), true);
  assert.equal(isCouponBatchUsable({ revoked_at: null, expires_at: "2026-08-09T10:00:01.000Z" }, now), true);
});

test("daily trend buckets use Asia/Bangkok calendar days", () => {
  const trend = aggregateTrend({
    range: "7d",
    now: new Date("2026-08-09T18:00:00.000Z"),
    sessions: [
      { created_at: "2026-08-09T16:59:59.000Z" },
      { created_at: "2026-08-09T17:00:00.000Z" },
    ],
    redemptions: [],
    users: [],
  });
  const august9 = trend.find((point) => point.bucket === "2026-08-08T17:00:00.000Z");
  const august10 = trend.find((point) => point.bucket === "2026-08-09T17:00:00.000Z");
  assert.equal(august9?.sessions, 1);
  assert.equal(august10?.sessions, 1);
});

test("empty trend returns an empty array instead of fabricated zero data", () => {
  assert.deepEqual(aggregateTrend({
    range: "14d",
    now,
    sessions: [],
    redemptions: [],
    users: [],
  }), []);
});

test("dashboard renders trustworthy empty data without leaking dynamic HTML", () => {
  const html = renderOverview({
    stats: {},
    trend: [],
    recent: [{
      title: "<img src=x onerror=alert(1)>",
      detail: "<script>alert(1)</script>",
      time: null,
    }],
    generatedAt: now.toISOString(),
    timezone: "Asia/Bangkok",
  });
  assert.match(html, /ยังไม่มีกิจกรรมในช่วงเวลานี้/);
  assert.match(html, /สมาชิกทั้งหมด/);
  assert.match(html, /Online ล่าสุด/);
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;img src=x/);
});

test("dashboard rejects non-numeric KPI and graph values from HTML attributes", () => {
  const payload = `\"><script>alert(1)</script>`;
  const html = renderOverview({
    stats: { users: payload },
    trend: [{ bucket: now.toISOString(), sessions: payload, redemptions: 1 }],
    range: "14d",
  });
  assert.doesNotMatch(html, /<script>|NaN|undefined/);
  assert.match(html, /<strong>0<\/strong>/);
});

test("coupon batch summaries use complete deterministic pagination", async () => {
  const source = await readFile(new URL("../server/admin.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function getCoupons()");
  const end = source.indexOf("\nasync function getRedemptions()", start);
  const getCouponsSource = source.slice(start, end);
  assert.match(getCouponsSource, /tableGetAll\("coupons"/);
  assert.match(getCouponsSource, /tableGetAll\("coupon_batches"/);
  assert.doesNotMatch(getCouponsSource, /limit:\s*"5000"/);
  assert.match(getCouponsSource, /order:\s*"created_at\.desc,id\.desc"/);
});

test("stale section refresh notice exposes progress and escapes errors", () => {
  assert.match(renderSectionRefreshNotice({ refreshing: true }), /กำลังอัปเดต/);
  const error = renderSectionRefreshNotice({ error: `<img src=x onerror=alert(1)>` });
  assert.match(error, /อัปเดตไม่สำเร็จ/);
  assert.doesNotMatch(error, /<img/);
  assert.match(error, /&lt;img/);
});

test("audit formatter recognizes effective Backend event names and safe metadata", () => {
  const cases = [
    ["admin_session_revoked", { session_id: "session-1" }, "ยุติ Launcher session", "red"],
    ["admin_license_revoked", { license_id: "license-1" }, "ยกเลิก License", "red"],
    ["admin_license_extended", { license_id: "license-1", days_added: 30 }, "ต่ออายุ License", "blue"],
    [
      "admin_user_status_changed",
      { target_user_id: "user-1", previous_status: "active", new_status: "banned" },
      "เปลี่ยนสถานะสมาชิก",
      "red",
    ],
    [
      "admin_user_status_changed",
      { target_user_id: "user-1", previous_status: "suspended", new_status: "active" },
      "เปลี่ยนสถานะสมาชิก",
      "green",
    ],
  ];

  for (const [eventType, metadata, title, tone] of cases) {
    const event = formatAuditEvent({
      id: `event-${eventType}`,
      event_type: eventType,
      metadata: { ...metadata, internal_secret: "must-not-render" },
      created_at: now.toISOString(),
    });
    assert.equal(event.title, title);
    assert.equal(event.tone, tone);
    for (const [field, value] of Object.entries(metadata)) {
      assert.match(event.detail, new RegExp(`${field.replaceAll("_", " ")}: ${value}`));
    }
    assert.doesNotMatch(event.detail, /internal_secret|must-not-render/);
  }
});

test("stale API 401 cannot clear a newer authenticated session", async () => {
  const source = await readFile(new URL("../standalone/src/main.js", import.meta.url), "utf8");
  const catchStart = source.indexOf("} catch (error) {", source.indexOf("async function load"));
  const unauthorized = source.indexOf("await handleUnauthorized(error)", catchStart);
  const staleGuard = source.indexOf("requestId !== loadRequestId", catchStart);
  assert.ok(catchStart >= 0 && unauthorized >= 0 && staleGuard >= 0);
  assert.ok(
    staleGuard < unauthorized,
    "stale responses must be discarded before a 401 can clear the active session",
  );
});

test("standalone build output uses repository-normalized LF line endings", async () => {
  const bundle = await readFile(
    new URL("../standalone/dist/neko-control.html", import.meta.url),
    "utf8",
  );
  assert.equal(bundle.includes(String.fromCharCode(13)), false);
});

// -----------------------------------------------------------------------------
// Phase T5 Polish & Visualization Tests
// -----------------------------------------------------------------------------

test("formatBps formats rates accurately across bps, Kbps, Mbps, and Gbps", () => {
  assert.equal(formatBps(0), "0 bps");
  assert.equal(formatBps(null), "0 bps");
  assert.equal(formatBps(500), "500 bps");
  assert.equal(formatBps(1500), "1.5 Kbps");
  assert.equal(formatBps(12500000), "12.50 Mbps");
  assert.equal(formatBps(2400000000), "2.40 Gbps");
});

test("formatBytes formats byte totals accurately across B, KB, MB, GB, and TB", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(null), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024 * 1024), "1.00 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), "2.50 GB");
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1024 * 4), "4.00 TB");
});

test("formatUptime formats seconds to days, hours, and minutes cleanly", () => {
  assert.equal(formatUptime(0), "—");
  assert.equal(formatUptime(null), "—");
  assert.equal(formatUptime(45), "45s");
  assert.equal(formatUptime(125), "2m 5s");
  assert.equal(formatUptime(3600 * 5 + 60 * 31), "5h 31m");
  assert.equal(formatUptime(86400 * 3 + 3600 * 12), "3d 12h");
});

test("formatRelativeAge formats observation age accurately and handles zero and invalid", () => {
  assert.equal(formatRelativeAge(null), "—");
  assert.equal(formatRelativeAge(undefined), "—");
  assert.equal(formatRelativeAge(0), "เมื่อสักครู่");
  assert.equal(formatRelativeAge(8), "8s ที่แล้ว");
  assert.equal(formatRelativeAge(75), "1m 15s ที่แล้ว");
});

test("statusBadge renders accessible glyphs and text for ONLINE, DEGRADED, STALE, and UNKNOWN", () => {
  assert.match(statusBadge("online"), /status-online/);
  assert.match(statusBadge("online"), /●/);
  assert.match(statusBadge("online"), /online/);

  assert.match(statusBadge("degraded"), /status-degraded/);
  assert.match(statusBadge("degraded"), /▲/);
  assert.match(statusBadge("degraded"), /degraded/);

  assert.match(statusBadge("stale"), /status-stale/);
  assert.match(statusBadge("stale"), /◷/);
  assert.match(statusBadge("stale"), /stale/);

  assert.match(statusBadge("unknown"), /status-unknown/);
  assert.match(statusBadge("unknown"), /○/);
  assert.match(statusBadge("unknown"), /unknown/);
});

test("renderServerHealth presents authoritative host states without inferring OFFLINE", () => {
  const onlineHtml = renderServerHealth({
    host_status: "ONLINE",
    is_stale: false,
    ping_ms: 12.4,
    ping_status: "AVAILABLE",
    ping_target_label: "VPS → Upstream",
    packet_loss_percent: 0.0,
    rx_bps: 12500000,
    tx_bps: 25000000,
    rx_bytes_total: 1073741824,
    tx_bytes_total: 2147483648,
    uptime_seconds: 86400 * 3,
    age_seconds: 5,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    server_id: "japan-vps-1",
  });
  assert.match(onlineHtml, /ONLINE/);
  assert.doesNotMatch(onlineHtml, /status-offline/);

  const staleHtml = renderServerHealth({
    host_status: "STALE",
    is_stale: true,
    age_seconds: 45,
    ping_ms: 12.0,
    ping_status: "AVAILABLE",
  });
  assert.match(staleHtml, /STALE/);
  assert.match(staleHtml, /ข้อมูลค้าง \(>30s\)/);
  assert.doesNotMatch(staleHtml, /status-offline/);
});

test("renderServerHealth displays strictly VPS → Upstream and handles unavailable probe metrics", () => {
  const html = renderServerHealth({
    host_status: "ONLINE",
    ping_ms: null,
    ping_status: "TIMEOUT",
    ping_target_label: "VPS → Upstream",
    packet_loss_percent: 100.0,
  });
  assert.match(html, /VPS → Upstream/);
  assert.match(html, /Timeout/);
  assert.match(html, /100%/);
  assert.doesNotMatch(html, /PSO2 JP/);
  assert.doesNotMatch(html, /Thailand → Japan/);
});

test("renderServerHealth displays explicit aggregate RX/TX labels and uptime", () => {
  const html = renderServerHealth({
    host_status: "ONLINE",
    rx_bps: 5000000,
    tx_bps: 10000000,
    rx_bytes_total: 52428800,
    tx_bytes_total: 104857600,
    uptime_seconds: 3600 * 5 + 60 * 31,
  });
  assert.match(html, /VPS Download \(RX\)/);
  assert.match(html, /VPS Upload \(TX\)/);
  assert.match(html, /5.00 Mbps/);
  assert.match(html, /10.00 Mbps/);
  assert.match(html, /50.00 MB/);
  assert.match(html, /100.00 MB/);
  assert.match(html, /Host Uptime/);
  assert.match(html, /5h 31m/);
});

test("appendLiveServerSample appends first fresh snapshot and deduplicates by observed_at", () => {
  const sample1 = {
    observed_at: "2026-08-18T10:00:00.000Z",
    rx_bps: 1500000,
    tx_bps: 3000000,
    host_status: "ONLINE",
    is_stale: false,
  };

  const history1 = appendLiveServerSample([], sample1, 60);
  assert.equal(history1.length, 1);
  assert.equal(history1[0].observedAt, "2026-08-18T10:00:00.000Z");
  assert.equal(history1[0].rxBps, 1500000);

  // Duplicate poll with same observed_at must be ignored
  const history2 = appendLiveServerSample(history1, sample1, 60);
  assert.equal(history2.length, 1);

  // New sample with newer observed_at is appended
  const sample2 = {
    observed_at: "2026-08-18T10:00:05.000Z",
    rx_bps: 2000000,
    tx_bps: 4000000,
    host_status: "ONLINE",
    is_stale: false,
  };
  const history3 = appendLiveServerSample(history2, sample2, 60);
  assert.equal(history3.length, 2);
  assert.equal(history3[1].observedAt, "2026-08-18T10:00:05.000Z");
});

test("appendLiveServerSample bounds live history to MAX_LIVE_SAMPLES (60) dropping oldest", () => {
  let history = [];
  for (let i = 1; i <= 65; i++) {
    const timestamp = new Date(Date.parse("2026-08-18T10:00:00.000Z") + i * 5000).toISOString();
    history = appendLiveServerSample(history, {
      observed_at: timestamp,
      rx_bps: i * 1000,
      tx_bps: i * 2000,
      host_status: "ONLINE",
      is_stale: false,
    }, 60);
  }

  assert.equal(history.length, 60);
  // Oldest remaining point is sample 6 (since 1-5 dropped)
  assert.equal(history[0].observedAt, new Date(Date.parse("2026-08-18T10:00:00.000Z") + 6 * 5000).toISOString());
  assert.equal(history[59].observedAt, new Date(Date.parse("2026-08-18T10:00:00.000Z") + 65 * 5000).toISOString());
});

test("appendLiveServerSample does not create fake zero samples on STALE or UNKNOWN snapshots", () => {
  const existingHistory = [
    { observedAt: "2026-08-18T10:00:00.000Z", rxBps: 5000000, txBps: 8000000, pingMs: 12.0 },
  ];

  // Stale snapshot
  const staleSample = {
    observed_at: "2026-08-18T10:00:45.000Z",
    host_status: "STALE",
    is_stale: true,
    rx_bps: 0,
    tx_bps: 0,
  };
  const historyAfterStale = appendLiveServerSample(existingHistory, staleSample, 60);
  assert.equal(historyAfterStale.length, 1);
  assert.equal(historyAfterStale[0].rxBps, 5000000);

  // UNKNOWN snapshot
  const unknownSample = {
    observed_at: "2026-08-18T10:01:00.000Z",
    host_status: "UNKNOWN",
    is_stale: false,
  };
  const historyAfterUnknown = appendLiveServerSample(historyAfterStale, unknownSample, 60);
  assert.equal(historyAfterUnknown.length, 1);
});

test("renderLiveServerChart renders empty state without fabricating historical data", () => {
  const html = renderLiveServerChart([], { host_status: "ONLINE", is_stale: false });
  assert.match(html, /Live Network Activity/);
  assert.match(html, /Live — Since Dashboard Opened/);
  assert.match(html, /ยังไม่มีข้อมูล Live Network Activity ในเซสชันนี้/);
  assert.match(html, /ไม่สร้างประวัติย้อนหลังจำลอง/);
  assert.doesNotMatch(html, /<polyline/);
});

test("renderLiveServerChart renders live polylines and points when fresh samples exist", () => {
  const history = [
    { observedAt: "2026-08-18T10:00:00.000Z", rxBps: 10000000, txBps: 5000000, pingMs: 12.0 },
    { observedAt: "2026-08-18T10:00:05.000Z", rxBps: 20000000, txBps: 15000000, pingMs: 12.2 },
  ];
  const html = renderLiveServerChart(history, { host_status: "ONLINE", is_stale: false });
  assert.match(html, /Live Network Activity/);
  assert.match(html, /<polyline/);
  assert.match(html, /10.00 Mbps/);
  assert.match(html, /20.00 Mbps/);
});

test("renderSessions enforces Online <=120s, Offline >120s, Revoked, and does not invent Idle", () => {
  const mockNowMs = Date.parse("2026-08-18T12:00:00.000Z");
  const sessions = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      username: "alice",
      created_at: "2026-08-18T11:00:00.000Z",
      last_seen_at: "2026-08-18T11:59:30.000Z", // 30s ago (<=120s) -> Online
      revoked_at: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      username: "bob",
      created_at: "2026-08-18T10:00:00.000Z",
      last_seen_at: "2026-08-18T11:55:00.000Z", // 5m ago (>120s) -> Offline
      revoked_at: null,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      username: "charlie",
      created_at: "2026-08-18T09:00:00.000Z",
      last_seen_at: "2026-08-18T09:30:00.000Z",
      revoked_at: "2026-08-18T09:35:00.000Z", // Revoked
    },
  ];

  const html = renderSessions(sessions, null, mockNowMs);
  assert.match(html, /status-online/);
  assert.match(html, /Online/);
  assert.match(html, /status-offline/);
  assert.match(html, /Offline/);
  assert.match(html, /status-revoked/);
  assert.match(html, /Revoked/);
  assert.doesNotMatch(html, /Idle/);
});

test("renderSessions prevents double-click duplicate revoke by applying disabled busy state", () => {
  const busyId = "11111111-1111-4111-8111-111111111111";
  const sessions = [
    {
      id: busyId,
      username: "alice",
      created_at: "2026-08-18T11:00:00.000Z",
      last_seen_at: "2026-08-18T11:59:30.000Z",
      revoked_at: null,
    },
  ];
  const html = renderSessions(sessions, busyId);
  assert.match(html, /disabled/);
  assert.match(html, /กำลังดำเนินการ…/);
});

test("renderSessions strictly respects privacy boundaries and excludes client hardware/PID telemetry", () => {
  const sessions = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      username: "secret_user",
      created_at: "2026-08-18T11:00:00.000Z",
      last_seen_at: "2026-08-18T11:59:30.000Z",
      revoked_at: null,
      device_name: "MY-SECRET-PC",
      machine_id: "HW-12345",
      core_pid: 9999,
      game_pid: 8888,
      client_rx_bps: 123456,
    },
  ];
  const html = renderSessions(sessions);
  assert.doesNotMatch(html, /MY-SECRET-PC/);
  assert.doesNotMatch(html, /HW-12345/);
  assert.doesNotMatch(html, /9999/);
  assert.doesNotMatch(html, /8888/);
  assert.doesNotMatch(html, /123456/);
  assert.match(html, /secret_user/);
});

test("renderServerChart renders range tabs for LIVE, 1H, 24H, 7D", () => {
  const html = renderServerChart({ range: "live", liveHistory: [], history: {} });
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-range="live"/);
  assert.match(html, /data-range="1h"/);
  assert.match(html, /data-range="24h"/);
  assert.match(html, /data-range="7d"/);
  assert.match(html, /is-selected.*data-range="live"/);
});

test("renderServerChart preserves T5 Live authority on LIVE mode", () => {
  const liveHistory = [
    { observedAt: "2026-08-18T10:00:00.000Z", rxBps: 12000000, txBps: 6000000 },
  ];
  const html = renderServerChart({ range: "live", liveHistory, history: {} });
  assert.match(html, /Live Network Activity/);
  assert.match(html, /Live — Since Dashboard Opened/);
  assert.match(html, /12.00 Mbps/);
  assert.match(html, /6.00 Mbps/);
});

test("renderHistoricalServerChart renders 1H, 24H, 7D titles and metadata", () => {
  const h1 = renderHistoricalServerChart("1h", { points: [] });
  assert.match(h1, /Historical Network Activity — Last 1 Hour/);
  assert.match(h1, /ข้อมูล aggregate ทุก 1 นาที \(สูงสุด 60 จุด\)/);

  const h24 = renderHistoricalServerChart("24h", { points: [] });
  assert.match(h24, /Historical Network Activity — Last 24 Hours/);
  assert.match(h24, /ข้อมูล aggregate ทุก 5 นาที \(สูงสุด 288 จุด\)/);

  const h7d = renderHistoricalServerChart("7d", { points: [] });
  assert.match(h7d, /Historical Network Activity — Last 7 Days/);
  assert.match(h7d, /ข้อมูล aggregate ทุก 30 นาที \(สูงสุด 336 จุด\)/);
});

test("renderHistoricalServerChart displays available_since notice when present", () => {
  const html = renderHistoricalServerChart("1h", {
    available_since: "2026-08-18T11:30:00.000Z",
    points: [],
  });
  assert.match(html, /มีข้อมูลตั้งแต่/);
});

test("renderHistoricalServerChart renders loading state when points empty and loading true", () => {
  const html = renderHistoricalServerChart("1h", { loading: true, points: [] });
  assert.match(html, /กำลังโหลดข้อมูลประวัติย้อนหลัง \(1H\)…/);
});

test("renderHistoricalServerChart renders isolated error state when points empty and error present", () => {
  const html = renderHistoricalServerChart("1h", { error: "Network timeout", points: [] });
  assert.match(html, /ข้อมูลประวัติย้อนหลังไม่พร้อมใช้งานชั่วคราว/);
  assert.match(html, /Network timeout/);
});

test("renderHistoricalServerChart renders stale warning when points exist and refresh error present", () => {
  const points = [
    { bucket_start: "2026-08-18T11:00:00.000Z", rx_bps_avg: 5000000, tx_bps_avg: 2000000, sample_count: 12 },
  ];
  const html = renderHistoricalServerChart("1h", { error: "500 Internal Error", points });
  assert.match(html, /ข้อมูลประวัติย้อนหลังอาจไม่อัปเดต/);
  assert.match(html, /500 Internal Error/);
  assert.match(html, /<svg/);
});

test("renderHistoricalServerChart renders empty state without fabricating fake zeros", () => {
  const html = renderHistoricalServerChart("1h", { points: [] });
  assert.match(html, /ยังไม่มีข้อมูลประวัติย้อนหลังในช่วงเวลานี้/);
  assert.match(html, /ระบบจะไม่สร้างข้อมูลจำลองหรือเส้นศูนย์แทนข้อมูลจริง/);
  assert.doesNotMatch(html, /<polyline/);
});

test("segmentHistoryPoints splits continuous points across gaps (>1.5x bucket_seconds)", () => {
  const bucketSeconds = 60;
  const points = [
    { bucket_start: "2026-08-18T11:00:00.000Z" },
    { bucket_start: "2026-08-18T11:01:00.000Z" }, // 60s gap (normal)
    { bucket_start: "2026-08-18T11:02:00.000Z" }, // 60s gap (normal)
    { bucket_start: "2026-08-18T11:10:00.000Z" }, // 8min gap (>90s) -> gap!
    { bucket_start: "2026-08-18T11:11:00.000Z" }, // 60s gap (normal)
  ];
  const segments = segmentHistoryPoints(points, bucketSeconds, 1.5);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 3);
  assert.equal(segments[1].length, 2);
});

test("renderHistoricalServerChart renders separate polylines across time gaps", () => {
  const points = [
    { bucket_start: "2026-08-18T11:00:00.000Z", rx_bps_avg: 1000000, tx_bps_avg: 500000, sample_count: 12 },
    { bucket_start: "2026-08-18T11:01:00.000Z", rx_bps_avg: 2000000, tx_bps_avg: 1000000, sample_count: 12 },
    // 10 minute outage gap
    { bucket_start: "2026-08-18T11:11:00.000Z", rx_bps_avg: 3000000, tx_bps_avg: 1500000, sample_count: 12 },
    { bucket_start: "2026-08-18T11:12:00.000Z", rx_bps_avg: 4000000, tx_bps_avg: 2000000, sample_count: 12 },
  ];
  const html = renderHistoricalServerChart("1h", { points, bucket_seconds: 60 });
  // There should be 2 rx polylines and 2 tx polylines (total 4 polylines)
  const polylineMatches = html.match(/<polyline/g) || [];
  assert.equal(polylineMatches.length, 4);
});

test("renderHistoricalServerChart renders service failure markers when degradation occurs", () => {
  const points = [
    { bucket_start: "2026-08-18T11:00:00.000Z", rx_bps_avg: 1000000, tx_bps_avg: 500000, sample_count: 12, had_service_failure: false, had_listener_failure: false },
    { bucket_start: "2026-08-18T11:01:00.000Z", rx_bps_avg: 500000, tx_bps_avg: 200000, sample_count: 12, had_service_failure: true, had_listener_failure: true },
  ];
  const html = renderHistoricalServerChart("1h", { points, bucket_seconds: 60 });
  assert.match(html, /degradation-marker/);
  assert.match(html, /มี Service\/Listener ขัดข้องในช่วงเวลา/);
  assert.match(html, /Shadowsocks Service\/Listener Degraded/);
});

test("renderHistoricalServerChart strictly labels ping as VPS → Upstream and preserves null pings", () => {
  const points = [
    { bucket_start: "2026-08-18T11:00:00.000Z", rx_bps_avg: 1000000, tx_bps_avg: 500000, ping_ms_avg: 12.4, sample_count: 12 },
    { bucket_start: "2026-08-18T11:01:00.000Z", rx_bps_avg: 2000000, tx_bps_avg: 1000000, ping_ms_avg: null, sample_count: 12 },
  ];
  const html = renderHistoricalServerChart("1h", { points, bucket_seconds: 60 });
  assert.match(html, /VPS → Upstream/);
  assert.doesNotMatch(html, /PSO2 JP/);
  assert.doesNotMatch(html, /Thailand → Japan/);
});

test("renderOverview integrates renderServerChart with historical state and server health", () => {
  const html = renderOverview({
    stats: { users: 10, activeLicenses: 5, activeSessions: 3, onlineSessionCount: 2 },
    server: { host_status: "ONLINE", rx_bps: 1000000, tx_bps: 500000, uptime_seconds: 3600 },
    serverChartRange: "1h",
    serverHistory: { points: [], loading: false },
  });
  assert.match(html, /ONLINE/);
  assert.match(html, /Historical Network Activity — Last 1 Hour/);
  assert.match(html, /data-range="1h"/);
});
