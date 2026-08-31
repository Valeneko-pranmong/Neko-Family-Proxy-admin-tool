import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1";
process.env.SUPABASE_SECRET_KEY ||= "test-secret";
process.env.ACCOUNT_RECOVERY_HMAC_SECRET ||= "test-recovery-hmac-secret-that-is-long-enough";
process.env.SERVER_METRICS_INGEST_SECRET ||= "test-server-metrics-ingest-secret-32-bytes";

const {
  classifyServerLoad,
  summarizePublicProxyStatus,
} = await import("../server/public-proxy-status.mjs");

const online = {
  server_id: "japan-vps-1",
  host_status: "ONLINE",
  observed_at: "2026-08-30T12:00:00.000Z",
  age_seconds: 5,
  rx_bps: 1_000_000,
  tx_bps: 500_000,
  cpu_percent: 20,
  memory_percent: 30,
};

test("classifyServerLoad uses one canonical four-level scale", () => {
  const base = { hostStatus: "ONLINE", capacityBps: 100_000_000, cpuPercent: 0, memoryPercent: 0 };
  assert.equal(classifyServerLoad({ ...base, avgRxBps: 10_000_000 }), "light");
  assert.equal(classifyServerLoad({ ...base, avgRxBps: 40_000_000 }), "moderate");
  assert.equal(classifyServerLoad({ ...base, avgRxBps: 75_000_000 }), "heavy");
  assert.equal(classifyServerLoad({ ...base, avgRxBps: 95_000_000 }), "full");
  assert.equal(classifyServerLoad({ ...base, hostStatus: "STALE", avgRxBps: 95_000_000 }), "unknown");
});

test("CPU or memory pressure can raise the shared load level", () => {
  assert.equal(classifyServerLoad({ hostStatus: "ONLINE", avgRxBps: 0, avgTxBps: 0, cpuPercent: 72, memoryPercent: 10 }), "heavy");
  assert.equal(classifyServerLoad({ hostStatus: "ONLINE", avgRxBps: 0, avgTxBps: 0, cpuPercent: null, memoryPercent: 94 }), "full");
});

test("summarizePublicProxyStatus returns only sanitized aggregate client fields", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const history = {
    points: [
      { bucket_start: "2026-08-30T11:31:00.000Z", rx_bps_avg: 30_000_000, tx_bps_avg: 10_000_000 },
      { bucket_start: "2026-08-30T11:45:00.000Z", rx_bps_avg: 40_000_000, tx_bps_avg: 20_000_000 },
      { bucket_start: "2026-08-30T11:59:00.000Z", rx_bps_avg: 50_000_000, tx_bps_avg: 30_000_000 },
      { bucket_start: "2026-08-30T11:20:00.000Z", rx_bps_avg: 99_000_000, tx_bps_avg: 99_000_000 },
    ],
  };
  const result = summarizePublicProxyStatus({ latest: online, history, now, capacityBps: 100_000_000 });
  assert.equal(result.status, "ONLINE");
  assert.equal(result.load_level, "moderate");
  assert.equal(result.average_30m.rx_bps, 40_000_000);
  assert.equal(result.average_30m.tx_bps, 20_000_000);
  assert.equal(result.average_30m.sample_count, 3);
  assert.ok(!("cpu_percent" in result));
  assert.ok(!("memory_percent" in result));
  assert.deepEqual(Object.keys(result).sort(), ["age_seconds", "average_30m", "load_level", "observed_at", "server_id", "status"].sort());
});
