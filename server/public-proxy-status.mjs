import {
  DEFAULT_SERVER_ID,
  getLatestServerSnapshot,
  queryServerMetricsHistory,
} from "./server-metrics.mjs";

export const DEFAULT_NETWORK_CAPACITY_BPS = 100_000_000;
export const PUBLIC_AVERAGE_WINDOW_MS = 30 * 60 * 1000;

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function optionalPercent(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function classifyServerLoad({
  hostStatus,
  avgRxBps = 0,
  avgTxBps = 0,
  cpuPercent = null,
  memoryPercent = null,
  capacityBps = DEFAULT_NETWORK_CAPACITY_BPS,
} = {}) {
  if (String(hostStatus || "").toUpperCase() !== "ONLINE") return "unknown";

  const capacity = finiteNonNegative(capacityBps, DEFAULT_NETWORK_CAPACITY_BPS)
    || DEFAULT_NETWORK_CAPACITY_BPS;
  const networkUtil = Math.min(
    100,
    (Math.max(finiteNonNegative(avgRxBps), finiteNonNegative(avgTxBps)) / capacity) * 100,
  );
  const cpu = optionalPercent(cpuPercent);
  const memory = optionalPercent(memoryPercent);
  const score = Math.max(networkUtil, cpu ?? 0, memory ?? 0);

  if (score >= 90) return "full";
  if (score >= 70) return "heavy";
  if (score >= 35) return "moderate";
  return "light";
}

function averageHistory(points, field) {
  const values = points
    .map((point) => Number(point?.[field]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizePublicProxyStatus({
  latest,
  history,
  now = new Date(),
  capacityBps = DEFAULT_NETWORK_CAPACITY_BPS,
} = {}) {
  const current = latest || {};
  const nowMs = now.getTime();
  const cutoff = nowMs - PUBLIC_AVERAGE_WINDOW_MS;
  const sourcePoints = Array.isArray(history?.points) ? history.points : [];
  const points = sourcePoints.filter((point) => {
    const timestamp = Date.parse(point?.bucket_start || "");
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs + 120_000;
  });

  const historyRx = averageHistory(points, "rx_bps_avg");
  const historyTx = averageHistory(points, "tx_bps_avg");
  const avgRxBps = historyRx ?? finiteNonNegative(current.rx_bps);
  const avgTxBps = historyTx ?? finiteNonNegative(current.tx_bps);
  const hostStatus = String(current.host_status || "UNKNOWN").toUpperCase();

  const loadLevel = classifyServerLoad({
    hostStatus,
    avgRxBps,
    avgTxBps,
    cpuPercent: current.cpu_percent,
    memoryPercent: current.memory_percent,
    capacityBps,
  });

  let coveredMinutes = 0;
  if (points.length > 0) {
    const times = points
      .map((point) => Date.parse(point.bucket_start || ""))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (times.length > 1) {
      coveredMinutes = Math.min(30, Math.max(1, Math.round((times.at(-1) - times[0]) / 60_000) + 1));
    } else {
      coveredMinutes = 1;
    }
  }

  return {
    server_id: String(current.server_id || DEFAULT_SERVER_ID),
    status: hostStatus,
    load_level: loadLevel,
    average_30m: {
      rx_bps: Math.round(avgRxBps),
      tx_bps: Math.round(avgTxBps),
      sample_count: points.length,
      covered_minutes: coveredMinutes,
    },
    observed_at: current.observed_at || null,
    age_seconds: Number.isFinite(Number(current.age_seconds)) ? Number(current.age_seconds) : null,
  };
}

function configuredCapacityBps() {
  const configured = Number(process.env.SERVER_NETWORK_CAPACITY_BPS || DEFAULT_NETWORK_CAPACITY_BPS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_NETWORK_CAPACITY_BPS;
}

export async function getPublicProxyStatus(serverId = DEFAULT_SERVER_ID, now = new Date()) {
  const [latest, history] = await Promise.all([
    getLatestServerSnapshot(serverId, now),
    queryServerMetricsHistory({ serverId, range: "1h", now }),
  ]);
  return summarizePublicProxyStatus({
    latest,
    history,
    now,
    capacityBps: configuredCapacityBps(),
  });
}
