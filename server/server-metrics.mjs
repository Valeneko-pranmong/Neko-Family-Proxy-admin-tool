import { createHash, timingSafeEqual } from "node:crypto";
import { rpcPost, tableGet } from "./supabase.mjs";

export const STALE_THRESHOLD_MS = 30 * 1000;
export const DEFAULT_SERVER_ID = "japan-vps-1";

// Phase T6B Exact Timestamp Acceptance Boundaries
export const FUTURE_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes future tolerance
export const MAX_INGEST_SAMPLE_AGE_MS = 10 * 60 * 1000; // 10 minutes maximum past age

export const SUPPORTED_HISTORY_RANGES = new Set(["1h", "24h", "7d"]);

export const RANGE_CONFIGS = {
  "1h": {
    durationMs: 60 * 60 * 1000,
    bucketSeconds: 60,
    maxPoints: 60,
  },
  "24h": {
    durationMs: 24 * 60 * 60 * 1000,
    bucketSeconds: 300,
    maxPoints: 288,
  },
  "7d": {
    durationMs: 7 * 24 * 60 * 60 * 1000,
    bucketSeconds: 1800,
    maxPoints: 336,
  },
};

const VALID_SERVICE_STATUSES = new Set(["active", "inactive", "failed", "unknown"]);
const VALID_LISTENER_STATUSES = new Set(["listening", "closed", "error", "unknown"]);
const VALID_PING_STATUSES = new Set(["AVAILABLE", "TIMEOUT", "UNSUPPORTED", "UNKNOWN"]);

const FORBIDDEN_CLIENT_FIELDS = new Set([
  "core_pid",
  "game_pid",
  "v2ray_pid",
  "pso2_pid",
  "tcp_connect_total",
  "tcp_active",
  "tcp_closed_total",
  "udp_event_total",
  "dns_query_total",
  "dns_failure_total",
  "redirect_success_total",
  "redirect_failure_total",
  "client_rx_bytes",
  "client_tx_bytes",
  "client_rx_bps",
  "client_tx_bps",
  "local_socks_port",
  "local_socks_details",
  "destination_ip",
  "destination_host",
  "dns_query",
  "flow",
  "packet",
  "payload",
  "jwt",
  "permit",
  "refresh_token",
  "access_token",
  "password",
  "device",
  "device_id",
  "machine_id",
  "hardware_id",
  "installation_key_hash",
  "fingerprint",
  "internal_secret",
]);

const ALLOWED_INGEST_KEYS = new Set([
  "server_id",
  "observed_at",
  "host_uptime_seconds",
  "shadowsocks_service_status",
  "proxy_service_status", // alias for shadowsocks_service_status
  "shadowsocks_listener_status",
  "ping_ms",
  "upstream_ping_ms",
  "ping_status",
  "upstream_ping_status",
  "packet_loss_percent",
  "upstream_packet_loss_percent",
  "rx_bytes_total",
  "tx_bytes_total",
  "rx_bps",
  "tx_bps",
  "cpu_percent",
  "memory_percent",
]);

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.isSafe = true;
  return error;
}

export function getExpectedIngestSecret() {
  const secret = process.env.SERVER_METRICS_INGEST_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing server environment variable: SERVER_METRICS_INGEST_SECRET");
  }
  if (Buffer.byteLength(secret, "utf8") < 16) {
    throw new Error("SERVER_METRICS_INGEST_SECRET must contain at least 16 bytes");
  }
  return secret;
}

export function verifyIngestAuthorization(authHeader, expectedSecret) {
  if (typeof authHeader !== "string") return false;
  const match = authHeader.trim().match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;
  const suppliedSecret = match[1];
  if (!suppliedSecret || !expectedSecret) return false;

  // Safe constant-time comparison via SHA-256 digests (Mandatory Correction 3)
  const digestExpected = createHash("sha256").update(expectedSecret, "utf8").digest();
  const digestSupplied = createHash("sha256").update(suppliedSecret, "utf8").digest();

  return timingSafeEqual(digestExpected, digestSupplied);
}

export function validateIngestPayload(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("Payload must be a JSON object");
  }

  // Check for forbidden client fields and unknown properties
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_CLIENT_FIELDS.has(key.toLowerCase())) {
      throw validationError(`Forbidden telemetry field rejected: ${key}`, 400);
    }
    if (!ALLOWED_INGEST_KEYS.has(key)) {
      throw validationError(`Unexpected telemetry field: ${key}`, 400);
    }
  }

  const serverId = String(body.server_id || DEFAULT_SERVER_ID).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(serverId)) {
    throw validationError("Invalid server_id");
  }

  const observedAtRaw = String(body.observed_at || "").trim();
  const observedAtMs = Date.parse(observedAtRaw);
  if (!observedAtRaw || !Number.isFinite(observedAtMs)) {
    throw validationError("Invalid observed_at timestamp");
  }

  const nowMs = now.getTime();
  // Exact timestamp window validation (T6B freeze: now - 10m <= observed_at <= now + 2m)
  if (observedAtMs > nowMs + FUTURE_TOLERANCE_MS) {
    throw validationError("observed_at is too far in the future", 400);
  }
  if (observedAtMs < nowMs - MAX_INGEST_SAMPLE_AGE_MS) {
    throw validationError("observed_at is too old", 400);
  }

  const hostUptimeSeconds = Number(body.host_uptime_seconds);
  if (!Number.isInteger(hostUptimeSeconds) || hostUptimeSeconds < 0) {
    throw validationError("Invalid host_uptime_seconds");
  }

  const shadowsocksServiceStatus = String(
    body.shadowsocks_service_status || body.proxy_service_status || "unknown",
  ).trim().toLowerCase();
  if (!VALID_SERVICE_STATUSES.has(shadowsocksServiceStatus)) {
    throw validationError("Invalid shadowsocks_service_status");
  }

  const shadowsocksListenerStatus = String(
    body.shadowsocks_listener_status || "unknown",
  ).trim().toLowerCase();
  if (!VALID_LISTENER_STATUSES.has(shadowsocksListenerStatus)) {
    throw validationError("Invalid shadowsocks_listener_status");
  }

  let pingMs = null;
  const rawPingMs = body.ping_ms ?? body.upstream_ping_ms;
  if (rawPingMs !== null && rawPingMs !== undefined) {
    const num = Number(rawPingMs);
    if (!Number.isFinite(num) || num < 0) {
      throw validationError("Invalid ping_ms");
    }
    pingMs = num;
  }

  const pingStatus = String(
    body.ping_status || body.upstream_ping_status || (pingMs !== null ? "AVAILABLE" : "UNKNOWN"),
  ).trim().toUpperCase();
  if (!VALID_PING_STATUSES.has(pingStatus)) {
    throw validationError("Invalid ping_status");
  }

  let packetLossPercent = null;
  const rawLoss = body.packet_loss_percent ?? body.upstream_packet_loss_percent;
  if (rawLoss !== null && rawLoss !== undefined) {
    const num = Number(rawLoss);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      throw validationError("Invalid packet_loss_percent (must be 0-100)");
    }
    packetLossPercent = num;
  }

  const rxBytesTotal = Number(body.rx_bytes_total);
  if (!Number.isInteger(rxBytesTotal) || rxBytesTotal < 0) {
    throw validationError("Invalid rx_bytes_total (must be non-negative integer)");
  }

  const txBytesTotal = Number(body.tx_bytes_total);
  if (!Number.isInteger(txBytesTotal) || txBytesTotal < 0) {
    throw validationError("Invalid tx_bytes_total (must be non-negative integer)");
  }

  const rxBps = Number(body.rx_bps);
  if (!Number.isFinite(rxBps) || rxBps < 0) {
    throw validationError("Invalid rx_bps (must be non-negative finite number)");
  }

  const txBps = Number(body.tx_bps);
  if (!Number.isFinite(txBps) || txBps < 0) {
    throw validationError("Invalid tx_bps (must be non-negative finite number)");
  }

  let cpuPercent = null;
  if (body.cpu_percent !== null && body.cpu_percent !== undefined) {
    const num = Number(body.cpu_percent);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      throw validationError("Invalid cpu_percent (must be 0-100)");
    }
    cpuPercent = num;
  }

  let memoryPercent = null;
  if (body.memory_percent !== null && body.memory_percent !== undefined) {
    const num = Number(body.memory_percent);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      throw validationError("Invalid memory_percent (must be 0-100)");
    }
    memoryPercent = num;
  }

  return {
    server_id: serverId,
    observed_at: new Date(observedAtMs).toISOString(),
    host_uptime_seconds: hostUptimeSeconds,
    shadowsocks_service_status: shadowsocksServiceStatus,
    shadowsocks_listener_status: shadowsocksListenerStatus,
    ping_ms: pingMs,
    ping_status: pingStatus,
    packet_loss_percent: packetLossPercent,
    rx_bytes_total: rxBytesTotal,
    tx_bytes_total: txBytesTotal,
    rx_bps: rxBps,
    tx_bps: txBps,
    cpu_percent: cpuPercent,
    memory_percent: memoryPercent,
  };
}

export function computeServerFreshness(snapshot, now = new Date()) {
  if (!snapshot || !snapshot.observed_at) {
    return {
      server_id: DEFAULT_SERVER_ID,
      host_status: "UNKNOWN",
      is_stale: false,
      observed_at: null,
      age_seconds: null,
      uptime_seconds: 0,
      shadowsocks_service_status: "unknown",
      shadowsocks_listener_status: "unknown",
      ping_ms: null,
      ping_status: "UNKNOWN",
      ping_target_label: "VPS → Upstream",
      packet_loss_percent: null,
      rx_bytes_total: 0,
      tx_bytes_total: 0,
      rx_bps: 0,
      tx_bps: 0,
      cpu_percent: null,
      memory_percent: null,
    };
  }

  const nowMs = now.getTime();
  const observedAtMs = Date.parse(snapshot.observed_at);
  const ageMs = Number.isFinite(observedAtMs) ? Math.max(0, nowMs - observedAtMs) : Infinity;
  const isStale = ageMs > STALE_THRESHOLD_MS;

  // Authoritative host status derivation (Mandatory Correction 2)
  let hostStatus;
  if (!Number.isFinite(observedAtMs)) {
    hostStatus = "UNKNOWN";
  } else if (isStale) {
    hostStatus = "STALE";
  } else if (
    snapshot.shadowsocks_service_status === "active" &&
    snapshot.shadowsocks_listener_status === "listening"
  ) {
    hostStatus = "ONLINE";
  } else {
    hostStatus = "DEGRADED";
  }

  return {
    server_id: snapshot.server_id || DEFAULT_SERVER_ID,
    host_status: hostStatus,
    is_stale: isStale,
    observed_at: snapshot.observed_at,
    age_seconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    uptime_seconds: Number(snapshot.host_uptime_seconds || snapshot.uptime_seconds || 0),
    shadowsocks_service_status: snapshot.shadowsocks_service_status || "unknown",
    shadowsocks_listener_status: snapshot.shadowsocks_listener_status || "unknown",
    ping_ms: snapshot.ping_ms !== null && snapshot.ping_ms !== undefined ? Number(snapshot.ping_ms) : null,
    ping_status: snapshot.ping_status || "UNKNOWN",
    ping_target_label: "VPS → Upstream",
    packet_loss_percent:
      snapshot.packet_loss_percent !== null && snapshot.packet_loss_percent !== undefined
        ? Number(snapshot.packet_loss_percent)
        : null,
    rx_bytes_total: Number(snapshot.rx_bytes_total || 0),
    tx_bytes_total: Number(snapshot.tx_bytes_total || 0),
    rx_bps: Number(snapshot.rx_bps || 0),
    tx_bps: Number(snapshot.tx_bps || 0),
    cpu_percent: snapshot.cpu_percent !== null && snapshot.cpu_percent !== undefined ? Number(snapshot.cpu_percent) : null,
    memory_percent:
      snapshot.memory_percent !== null && snapshot.memory_percent !== undefined
        ? Number(snapshot.memory_percent)
        : null,
  };
}

export async function ingestServerMetrics(body, authHeader, now = new Date()) {
  const expectedSecret = getExpectedIngestSecret();
  if (!verifyIngestAuthorization(authHeader, expectedSecret)) {
    throw validationError("Invalid or missing ingest authorization", 401);
  }

  const sanitized = validateIngestPayload(body, now);

  try {
    // Primary Atomic Ingest RPC (Phase T6B Authority)
    const result = await rpcPost("store_server_metrics_sample", {
      p_server_id: sanitized.server_id,
      p_observed_at: sanitized.observed_at,
      p_host_uptime_seconds: sanitized.host_uptime_seconds,
      p_shadowsocks_service_status: sanitized.shadowsocks_service_status,
      p_shadowsocks_listener_status: sanitized.shadowsocks_listener_status,
      p_ping_ms: sanitized.ping_ms,
      p_ping_status: sanitized.ping_status,
      p_packet_loss_percent: sanitized.packet_loss_percent,
      p_rx_bytes_total: sanitized.rx_bytes_total,
      p_tx_bytes_total: sanitized.tx_bytes_total,
      p_rx_bps: sanitized.rx_bps,
      p_tx_bps: sanitized.tx_bps,
      p_cpu_percent: sanitized.cpu_percent,
      p_memory_percent: sanitized.memory_percent,
    });

    return {
      ok: true,
      accepted: Boolean(result?.latest_updated),
      server_id: sanitized.server_id,
      observed_at: sanitized.observed_at,
      history_inserted: Boolean(result?.history_inserted),
      latest_updated: Boolean(result?.latest_updated),
      is_idempotent_retry: Boolean(result?.is_idempotent_retry),
    };
  } catch (error) {
    const message = String(error?.supabaseMessage || error?.message || "");
    if (message.includes("sample_conflict")) {
      throw validationError("Conflicting duplicate sample rejected", 409);
    }
    if (message.includes("future_timestamp_rejected")) {
      throw validationError("observed_at is too far in the future", 400);
    }
    if (message.includes("sample_too_old")) {
      throw validationError("observed_at is too old", 400);
    }
    throw error;
  }
}

export async function getLatestServerSnapshot(serverId = DEFAULT_SERVER_ID, now = new Date()) {
  const rows = await tableGet("server_metrics_latest", {
    server_id: `eq.${serverId}`,
    limit: "1",
  });
  const snapshot = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return computeServerFreshness(snapshot, now);
}

export async function queryServerMetricsHistory({
  serverId = DEFAULT_SERVER_ID,
  range = "1h",
  now = new Date(),
} = {}) {
  const normalizedServerId = String(serverId || DEFAULT_SERVER_ID).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(normalizedServerId)) {
    throw validationError("Invalid server_id", 400);
  }

  const normalizedRange = String(range || "").trim().toLowerCase();
  if (!SUPPORTED_HISTORY_RANGES.has(normalizedRange)) {
    throw validationError("Invalid range parameter. Expected 1h, 24h, or 7d.", 400);
  }

  const config = RANGE_CONFIGS[normalizedRange];
  const nowIso = now.toISOString();

  // Call PostgreSQL RPC for query-time downsampling
  const rpcResult = await rpcPost("query_server_metrics_history", {
    p_server_id: normalizedServerId,
    p_range: normalizedRange,
    p_now: nowIso,
  });

  if (rpcResult && typeof rpcResult === "object" && Array.isArray(rpcResult.points)) {
    return {
      ok: true,
      server_id: normalizedServerId,
      range: normalizedRange,
      bucket_seconds: config.bucketSeconds,
      window_start: rpcResult.window_start || new Date(now.getTime() - config.durationMs).toISOString(),
      window_end: rpcResult.window_end || nowIso,
      available_since: rpcResult.available_since || null,
      points_count: rpcResult.points.length,
      points: rpcResult.points.slice(0, config.maxPoints),
    };
  }

  return {
    ok: true,
    server_id: normalizedServerId,
    range: normalizedRange,
    bucket_seconds: config.bucketSeconds,
    window_start: new Date(now.getTime() - config.durationMs).toISOString(),
    window_end: nowIso,
    available_since: null,
    points_count: 0,
    points: [],
  };
}

export async function pruneServerMetricsHistory(retentionDays = 7) {
  const deletedCount = await rpcPost("prune_server_metrics_history", {
    p_retention_days: retentionDays,
  });
  return {
    ok: true,
    deleted_count: Number(deletedCount || 0),
    retention_days: retentionDays,
  };
}
