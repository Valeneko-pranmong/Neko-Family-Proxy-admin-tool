import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1";
process.env.SUPABASE_SECRET_KEY ||= "test-secret";
process.env.ACCOUNT_RECOVERY_HMAC_SECRET ||= "test-recovery-hmac-secret-that-is-long-enough";
process.env.SERVER_METRICS_INGEST_SECRET ||= "test-server-metrics-ingest-secret-32-bytes";

const {
  computeServerFreshness,
  DEFAULT_SERVER_ID,
  STALE_THRESHOLD_MS,
  FUTURE_TOLERANCE_MS,
  MAX_INGEST_SAMPLE_AGE_MS,
  RANGE_CONFIGS,
  validateIngestPayload,
  verifyIngestAuthorization,
} = await import("../server/server-metrics.mjs");

const now = new Date("2026-08-18T12:00:00.000Z");
const testSecret = "super-secret-ingest-token-123456789";

test("ingest authentication verifies Bearer secret in constant time via digest", () => {
  assert.equal(
    verifyIngestAuthorization(`Bearer ${testSecret}`, testSecret),
    true,
  );
  assert.equal(
    verifyIngestAuthorization(`bearer ${testSecret}`, testSecret),
    true,
  );
  assert.equal(
    verifyIngestAuthorization("Bearer wrong-secret", testSecret),
    false,
  );
  assert.equal(
    verifyIngestAuthorization("", testSecret),
    false,
  );
  assert.equal(
    verifyIngestAuthorization("Basic user:pass", testSecret),
    false,
  );
  assert.equal(
    verifyIngestAuthorization(null, testSecret),
    false,
  );
});

test("validateIngestPayload normalizes valid VPS metrics payload", () => {
  const payload = {
    server_id: "japan-vps-1",
    observed_at: "2026-08-18T11:59:58.000Z",
    host_uptime_seconds: 86400,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    upstream_ping_ms: 12.4,
    upstream_ping_status: "AVAILABLE",
    upstream_packet_loss_percent: 0.0,
    rx_bytes_total: 1000000,
    tx_bytes_total: 2000000,
    rx_bps: 15000.5,
    tx_bps: 25000.0,
    cpu_percent: 15.2,
    memory_percent: 42.1,
  };

  const sanitized = validateIngestPayload(payload, now);
  assert.equal(sanitized.server_id, "japan-vps-1");
  assert.equal(sanitized.observed_at, "2026-08-18T11:59:58.000Z");
  assert.equal(sanitized.host_uptime_seconds, 86400);
  assert.equal(sanitized.shadowsocks_service_status, "active");
  assert.equal(sanitized.shadowsocks_listener_status, "listening");
  assert.equal(sanitized.ping_ms, 12.4);
  assert.equal(sanitized.ping_status, "AVAILABLE");
  assert.equal(sanitized.packet_loss_percent, 0.0);
  assert.equal(sanitized.rx_bytes_total, 1000000);
  assert.equal(sanitized.tx_bytes_total, 2000000);
  assert.equal(sanitized.rx_bps, 15000.5);
  assert.equal(sanitized.tx_bps, 25000.0);
});

test("validateIngestPayload enforces exact timestamp boundaries (now - 10m to now + 2m)", () => {
  const baseValid = {
    server_id: "japan-vps-1",
    host_uptime_seconds: 100,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    rx_bytes_total: 100,
    tx_bytes_total: 100,
    rx_bps: 100,
    tx_bps: 100,
  };

  // 1. Within future tolerance (now + 1 minute) -> ACCEPTED
  const futureAccepted = validateIngestPayload(
    { ...baseValid, observed_at: "2026-08-18T12:01:00.000Z" },
    now,
  );
  assert.equal(futureAccepted.observed_at, "2026-08-18T12:01:00.000Z");

  // 2. Beyond future tolerance (now + 3 minutes) -> REJECTED 400
  assert.throws(
    () => validateIngestPayload({ ...baseValid, observed_at: "2026-08-18T12:03:00.000Z" }, now),
    (err) => err.status === 400 && /future/.test(err.message),
  );

  // 3. Within past tolerance (now - 8 minutes) -> ACCEPTED
  const pastAccepted = validateIngestPayload(
    { ...baseValid, observed_at: "2026-08-18T11:52:00.000Z" },
    now,
  );
  assert.equal(pastAccepted.observed_at, "2026-08-18T11:52:00.000Z");

  // 4. Beyond past tolerance (now - 12 minutes) -> REJECTED 400
  assert.throws(
    () => validateIngestPayload({ ...baseValid, observed_at: "2026-08-18T11:48:00.000Z" }, now),
    (err) => err.status === 400 && /old/.test(err.message),
  );
});

test("validateIngestPayload rejects invalid fields with safe 400 errors", () => {
  const baseValid = {
    server_id: "japan-vps-1",
    observed_at: "2026-08-18T11:59:58.000Z",
    host_uptime_seconds: 100,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    rx_bytes_total: 100,
    tx_bytes_total: 100,
    rx_bps: 100,
    tx_bps: 100,
  };

  // Negative rx_bytes
  assert.throws(
    () => validateIngestPayload({ ...baseValid, rx_bytes_total: -1 }, now),
    (err) => err.status === 400 && /rx_bytes_total/.test(err.message),
  );

  // Negative tx_bps
  assert.throws(
    () => validateIngestPayload({ ...baseValid, tx_bps: -50 }, now),
    (err) => err.status === 400 && /tx_bps/.test(err.message),
  );

  // Packet loss > 100
  assert.throws(
    () => validateIngestPayload({ ...baseValid, packet_loss_percent: 105 }, now),
    (err) => err.status === 400 && /packet_loss_percent/.test(err.message),
  );

  // Invalid service status enum
  assert.throws(
    () => validateIngestPayload({ ...baseValid, shadowsocks_service_status: "crashed_invalid" }, now),
    (err) => err.status === 400 && /shadowsocks_service_status/.test(err.message),
  );
});

test("computeServerFreshness returns UNKNOWN for empty snapshot", () => {
  const freshness = computeServerFreshness(null, now);
  assert.equal(freshness.host_status, "UNKNOWN");
  assert.equal(freshness.is_stale, false);
  assert.equal(freshness.observed_at, null);
  assert.equal(freshness.ping_status, "UNKNOWN");
});

test("computeServerFreshness returns ONLINE for fresh active snapshot (<= 30s)", () => {
  const snapshot = {
    server_id: "japan-vps-1",
    observed_at: "2026-08-18T11:59:45.000Z", // 15s ago
    host_uptime_seconds: 50000,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    ping_ms: 12.0,
    ping_status: "AVAILABLE",
    packet_loss_percent: 0.0,
    rx_bytes_total: 5000,
    tx_bytes_total: 8000,
    rx_bps: 1000,
    tx_bps: 2000,
  };

  const freshness = computeServerFreshness(snapshot, now);
  assert.equal(freshness.host_status, "ONLINE");
  assert.equal(freshness.is_stale, false);
  assert.equal(freshness.age_seconds, 15);
});

test("computeServerFreshness returns DEGRADED when host is fresh but Shadowsocks service or listener is down", () => {
  const snapshot = {
    server_id: "japan-vps-1",
    observed_at: "2026-08-18T11:59:50.000Z", // 10s ago
    host_uptime_seconds: 50000,
    shadowsocks_service_status: "failed",
    shadowsocks_listener_status: "closed",
    ping_ms: 12.0,
    ping_status: "AVAILABLE",
  };

  const freshness = computeServerFreshness(snapshot, now);
  assert.equal(freshness.host_status, "DEGRADED");
  assert.equal(freshness.is_stale, false);
});

test("computeServerFreshness returns STALE when snapshot age exceeds 30 seconds", () => {
  const snapshot = {
    server_id: "japan-vps-1",
    observed_at: "2026-08-18T11:59:10.000Z", // 50s ago (> 30s)
    host_uptime_seconds: 50000,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
  };

  const freshness = computeServerFreshness(snapshot, now);
  assert.equal(freshness.host_status, "STALE");
  assert.equal(freshness.is_stale, true);
  assert.equal(freshness.age_seconds, 50);
});

test("ping timeout or packet loss does not mark host offline or degraded", () => {
  const snapshot = {
    server_id: "japan-vps-1",
    observed_at: "2026-08-18T11:59:55.000Z", // 5s ago
    host_uptime_seconds: 50000,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    ping_ms: null,
    ping_status: "TIMEOUT",
    packet_loss_percent: 100.0,
  };

  const freshness = computeServerFreshness(snapshot, now);
  assert.equal(freshness.host_status, "ONLINE");
  assert.equal(freshness.ping_status, "TIMEOUT");
  assert.equal(freshness.packet_loss_percent, 100.0);
});

test("RANGE_CONFIGS defines exact bucket resolution and point bounds", () => {
  assert.equal(RANGE_CONFIGS["1h"].bucketSeconds, 60);
  assert.equal(RANGE_CONFIGS["1h"].maxPoints, 60);
  assert.equal(RANGE_CONFIGS["24h"].bucketSeconds, 300);
  assert.equal(RANGE_CONFIGS["24h"].maxPoints, 288);
  assert.equal(RANGE_CONFIGS["7d"].bucketSeconds, 1800);
  assert.equal(RANGE_CONFIGS["7d"].maxPoints, 336);
});
