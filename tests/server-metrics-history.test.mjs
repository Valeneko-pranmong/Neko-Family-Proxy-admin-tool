import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1";
process.env.SUPABASE_SECRET_KEY ||= "test-secret";
process.env.ACCOUNT_RECOVERY_HMAC_SECRET ||= "test-recovery-hmac-secret-that-is-long-enough";
process.env.SERVER_METRICS_INGEST_SECRET ||= "test-server-metrics-ingest-secret-32-bytes";

const {
  ingestServerMetrics,
  queryServerMetricsHistory,
  pruneServerMetricsHistory,
  RANGE_CONFIGS,
  validateIngestPayload,
} = await import("../server/server-metrics.mjs");

const testSecret = "test-server-metrics-ingest-secret-32-bytes";
const authHeader = `Bearer ${testSecret}`;
const now = new Date("2026-08-18T12:00:00.000Z");

test("RANGE_CONFIGS enforces exact point bounds for 1h, 24h, and 7d", () => {
  assert.equal(RANGE_CONFIGS["1h"].bucketSeconds, 60);
  assert.equal(RANGE_CONFIGS["1h"].maxPoints, 60);

  assert.equal(RANGE_CONFIGS["24h"].bucketSeconds, 300);
  assert.equal(RANGE_CONFIGS["24h"].maxPoints, 288);

  assert.equal(RANGE_CONFIGS["7d"].bucketSeconds, 1800);
  assert.equal(RANGE_CONFIGS["7d"].maxPoints, 336);
});

test("validateIngestPayload rejects timestamps outside [now - 10m, now + 2m]", () => {
  const base = {
    server_id: "japan-vps-1",
    host_uptime_seconds: 100,
    shadowsocks_service_status: "active",
    shadowsocks_listener_status: "listening",
    rx_bytes_total: 1000,
    tx_bytes_total: 1000,
    rx_bps: 100,
    tx_bps: 100,
  };

  // Valid within future tolerance: +1m50s
  const validFuture = validateIngestPayload(
    { ...base, observed_at: new Date(now.getTime() + 110000).toISOString() },
    now,
  );
  assert.ok(validFuture.observed_at);

  // Invalid future: +2m10s -> throws 400
  assert.throws(
    () => validateIngestPayload({ ...base, observed_at: new Date(now.getTime() + 130000).toISOString() }, now),
    (err) => err.status === 400 && /future/.test(err.message),
  );

  // Valid within past tolerance: -9m30s
  const validPast = validateIngestPayload(
    { ...base, observed_at: new Date(now.getTime() - 570000).toISOString() },
    now,
  );
  assert.ok(validPast.observed_at);

  // Invalid past: -10m30s -> throws 400
  assert.throws(
    () => validateIngestPayload({ ...base, observed_at: new Date(now.getTime() - 630000).toISOString() }, now),
    (err) => err.status === 400 && /old/.test(err.message),
  );
});

test("queryServerMetricsHistory rejects unsupported ranges", async () => {
  await assert.rejects(
    () => queryServerMetricsHistory({ range: "30d" }),
    (err) => err.status === 400 && /Invalid range/.test(err.message),
  );

  await assert.rejects(
    () => queryServerMetricsHistory({ range: "12h" }),
    (err) => err.status === 400 && /Invalid range/.test(err.message),
  );

  await assert.rejects(
    () => queryServerMetricsHistory({ range: "" }),
    (err) => err.status === 400 && /Invalid range/.test(err.message),
  );
});

test("queryServerMetricsHistory rejects invalid server_id", async () => {
  await assert.rejects(
    () => queryServerMetricsHistory({ serverId: "INVALID/ID!", range: "1h" }),
    (err) => err.status === 400 && /Invalid server_id/.test(err.message),
  );
});
