export const MAX_LIVE_SAMPLES = 60;

export function appendLiveServerSample(history = [], snapshot = {}, maxSamples = MAX_LIVE_SAMPLES) {
  if (!snapshot || !snapshot.observed_at) return history;
  // If snapshot is stale or host status is UNKNOWN, do not append fake sample to live graph
  if (snapshot.is_stale || snapshot.host_status === "STALE" || snapshot.host_status === "UNKNOWN") {
    return history;
  }
  const observedAt = String(snapshot.observed_at);
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return history;

  // Deduplication check: observed_at must be strictly newer than the last sample's observedAt
  if (history.length > 0) {
    const lastSample = history[history.length - 1];
    const lastMs = Date.parse(lastSample.observedAt);
    if (observedAtMs <= lastMs || observedAt === lastSample.observedAt) {
      return history;
    }
  }

  const sample = {
    observedAt,
    rxBps: Number.isFinite(Number(snapshot.rx_bps)) ? Math.max(0, Number(snapshot.rx_bps)) : 0,
    txBps: Number.isFinite(Number(snapshot.tx_bps)) ? Math.max(0, Number(snapshot.tx_bps)) : 0,
    pingMs: snapshot.ping_ms !== null && snapshot.ping_ms !== undefined && Number.isFinite(Number(snapshot.ping_ms))
      ? Number(snapshot.ping_ms)
      : null,
  };

  const nextHistory = [...history, sample];
  if (nextHistory.length > maxSamples) {
    return nextHistory.slice(nextHistory.length - maxSamples);
  }
  return nextHistory;
}

export const MAX_HISTORICAL_POINTS = 336;

export function segmentHistoryPoints(points = [], bucketSeconds = 60, thresholdFactor = 1.5) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const gapThresholdMs = (Number(bucketSeconds) || 60) * thresholdFactor * 1000;
  const segments = [];
  let currentSegment = [];
  let lastTimeMs = null;

  for (const point of points) {
    if (!point || !point.bucket_start) continue;
    const timeMs = Date.parse(point.bucket_start);
    if (!Number.isFinite(timeMs)) continue;

    if (lastTimeMs !== null && timeMs - lastTimeMs > gapThresholdMs) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    }
    currentSegment.push(point);
    lastTimeMs = timeMs;
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  return segments;
}

export function createStore() {
  const state = {
    active: "overview",
    data: {},
    loading: false,
    refreshing: false,
    error: "",
    overviewRange: "14d",
    serverChartRange: "live",
    serverHistory: {
      range: "1h",
      bucket_seconds: 60,
      available_since: null,
      points: [],
      points_count: 0,
      loading: false,
      error: "",
      lastSuccessAt: null,
    },
    toast: "",
    couponFormOpen: false,
    liveServerHistory: [],
    actionBusyId: null,
  };
  const listeners = new Set();
  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(next) {
      Object.assign(state, next);
      listeners.forEach((listener) => listener(state));
    },
  };
}
