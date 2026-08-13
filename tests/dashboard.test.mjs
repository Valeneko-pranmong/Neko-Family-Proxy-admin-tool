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
import { renderOverview, renderSectionRefreshNotice } from "../standalone/src/sections/render.js";

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
