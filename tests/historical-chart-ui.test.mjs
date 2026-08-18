import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createStore, segmentHistoryPoints } from "../standalone/src/state.js";
import {
  renderHistoricalServerChart,
  renderLiveServerChart,
  renderServerChart,
} from "../standalone/src/sections/render.js";
import { formatHistoryBucket } from "../standalone/src/ui/escape.js";

test("store initial state contains serverChartRange and serverHistory defaults", () => {
  const store = createStore();
  assert.equal(store.state.serverChartRange, "live");
  assert.deepEqual(store.state.serverHistory, {
    range: "1h",
    bucket_seconds: 60,
    available_since: null,
    points: [],
    points_count: 0,
    loading: false,
    error: "",
    lastSuccessAt: null,
  });
});

test("segmentHistoryPoints handles empty or non-array points safely", () => {
  assert.deepEqual(segmentHistoryPoints([]), []);
  assert.deepEqual(segmentHistoryPoints(null), []);
  assert.deepEqual(segmentHistoryPoints(undefined), []);
});

test("segmentHistoryPoints splits correctly across variable bucket intervals", () => {
  // 24H range: bucket = 300s (5min), gap threshold = 450s (7.5min)
  const bucketSeconds = 300;
  const points24h = [
    { bucket_start: "2026-08-18T00:00:00.000Z" },
    { bucket_start: "2026-08-18T00:05:00.000Z" }, // +300s -> same segment
    { bucket_start: "2026-08-18T00:10:00.000Z" }, // +300s -> same segment
    { bucket_start: "2026-08-18T00:30:00.000Z" }, // +20m (>7.5m) -> gap!
    { bucket_start: "2026-08-18T00:35:00.000Z" }, // +300s -> same segment
  ];
  const segments = segmentHistoryPoints(points24h, bucketSeconds, 1.5);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 3);
  assert.equal(segments[1].length, 2);
});

test("async race protection: older in-flight request does not overwrite newer selected range", async () => {
  // Simulation of main.js fetchServerMetricsHistory monotonic request ID and range guard
  let historyRequestId = 0;
  let historyRequestInFlight = false;
  const store = createStore();

  async function mockFetchServerMetricsHistory(range, mockLatencyMs, mockResponse) {
    if (range === "live") return;
    const requestId = ++historyRequestId;
    historyRequestInFlight = true;

    store.patch({
      serverHistory: {
        ...store.state.serverHistory,
        loading: true,
        error: "",
      },
    });

    // Simulate async API call with latency
    await new Promise((resolve) => setTimeout(resolve, mockLatencyMs));

    // GUARD: check if superseded
    if (requestId !== historyRequestId || store.state.serverChartRange !== range) {
      return "DISCARDED_STALE";
    }

    store.patch({
      serverHistory: {
        range: mockResponse.range || range,
        bucket_seconds: mockResponse.bucket_seconds || 60,
        available_since: mockResponse.available_since || null,
        points: mockResponse.points || [],
        points_count: (mockResponse.points || []).length,
        loading: false,
        error: "",
        lastSuccessAt: new Date().toISOString(),
      },
    });
    return "APPLIED";
  }

  // User clicks 1H (slow response: 50ms)
  store.patch({ serverChartRange: "1h" });
  const p1 = mockFetchServerMetricsHistory("1h", 50, {
    range: "1h",
    points: [{ bucket_start: "2026-08-18T10:00:00.000Z", rx_bps_avg: 1000 }],
  });

  // 5ms later, user rapidly clicks 7D (fast response: 10ms)
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.patch({ serverChartRange: "7d" });
  const p2 = mockFetchServerMetricsHistory("7d", 10, {
    range: "7d",
    points: [{ bucket_start: "2026-08-18T00:00:00.000Z", rx_bps_avg: 9999 }],
  });

  const [res1, res2] = await Promise.all([p1, p2]);

  assert.equal(res2, "APPLIED");
  assert.equal(res1, "DISCARDED_STALE");
  // Final store must contain 7D data, not overwritten by the delayed 1H
  assert.equal(store.state.serverChartRange, "7d");
  assert.equal(store.state.serverHistory.range, "7d");
  assert.equal(store.state.serverHistory.points[0].rx_bps_avg, 9999);
});

test("async race protection: late historical response does not overwrite Live mode", async () => {
  let historyRequestId = 0;
  const store = createStore();

  async function mockFetchServerMetricsHistory(range, mockLatencyMs, mockResponse) {
    if (range === "live") return;
    const requestId = ++historyRequestId;

    store.patch({
      serverHistory: { ...store.state.serverHistory, loading: true },
    });

    await new Promise((resolve) => setTimeout(resolve, mockLatencyMs));

    if (requestId !== historyRequestId || store.state.serverChartRange !== range) {
      return "DISCARDED_STALE";
    }

    store.patch({
      serverHistory: {
        ...mockResponse,
        loading: false,
      },
    });
    return "APPLIED";
  }

  // User switches to 1h
  store.patch({ serverChartRange: "1h" });
  const fetchPromise = mockFetchServerMetricsHistory("1h", 30, {
    range: "1h",
    points: [{ bucket_start: "2026-08-18T10:00:00.000Z", rx_bps_avg: 1000 }],
  });

  // User immediately switches back to Live before 1h completes
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.patch({ serverChartRange: "live" });

  const result = await fetchPromise;
  assert.equal(result, "DISCARDED_STALE");
  assert.equal(store.state.serverChartRange, "live");
});

test("formatHistoryBucket handles all range representations in Asia/Bangkok time", () => {
  const ts = "2026-08-18T05:30:00.000Z"; // 12:30 PM Bangkok
  const formatted1h = formatHistoryBucket(ts, "1h");
  const formatted24h = formatHistoryBucket(ts, "24h");
  const formatted7d = formatHistoryBucket(ts, "7d");

  assert.match(formatted1h, /12:30/);
  assert.match(formatted24h, /12:30/);
  assert.match(formatted7d, /18/);
  assert.match(formatted7d, /ส\.ค\./);
});

test("standalone compiled HTML contains zero ingestion secret keys or private server tokens", async () => {
  const html = await readFile(new URL("../standalone/dist/neko-control.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /SERVER_METRICS_INGEST_SECRET/);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(html, /service_role/);
  assert.doesNotMatch(html, /ADMIN_SESSION_SECRET/);
});
