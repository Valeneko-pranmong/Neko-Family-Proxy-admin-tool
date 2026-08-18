import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1";
process.env.SUPABASE_SECRET_KEY ||= "test-secret";
process.env.ACCOUNT_RECOVERY_HMAC_SECRET ||= "test-recovery-hmac-secret-that-is-long-enough";
process.env.SERVER_METRICS_INGEST_SECRET ||= "test-server-metrics-ingest-secret-32-bytes";

const { validateIngestPayload } = await import("../server/server-metrics.mjs");
const { renderSessions } = await import("../standalone/src/sections/render.js");

const now = new Date("2026-08-18T12:00:00.000Z");

const FORBIDDEN_CLIENT_FIELDS = [
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
  "destination_ip",
  "destination_host",
  "dns_query",
  "jwt",
  "permit",
  "refresh_token",
  "access_token",
  "device",
  "device_id",
  "machine_id",
  "hardware_id",
  "installation_key_hash",
];

test("server ingest API strictly rejects every forbidden client telemetry field", () => {
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

  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    const maliciousPayload = { ...baseValid, [field]: 12345 };
    assert.throws(
      () => validateIngestPayload(maliciousPayload, now),
      (err) => err.status === 400 && (err.message.includes("Forbidden") || err.message.includes("Unexpected")),
      `Ingest must reject client telemetry field: ${field}`,
    );
  }
});

test("session view strictly excludes device and client hardware identifiers", () => {
  const sampleSessions = [
    {
      id: "77777777-7777-4777-8777-777777777777",
      user_id: "22222222-2222-4222-8222-222222222222",
      username: "alice",
      license_id: "66666666-6666-4666-8666-666666666666",
      created_at: "2026-08-18T10:00:00.000Z",
      last_seen_at: "2026-08-18T11:59:30.000Z",
      revoked_at: null,
      device: "DESKTOP-SECRET-MACHINE", // should not be rendered
      device_id: "SECRET-HW-ID",
    },
  ];

  const html = renderSessions(sampleSessions);
  assert.doesNotMatch(html, /DESKTOP-SECRET-MACHINE/);
  assert.doesNotMatch(html, /SECRET-HW-ID/);
  assert.match(html, /alice/);
  assert.match(html, /77777777/);
});

test("standalone client bundle never contains server ingest secret or private credentials", async () => {
  const bundle = await readFile(
    new URL("../standalone/dist/neko-control.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(bundle, /SERVER_METRICS_INGEST_SECRET/);
  assert.doesNotMatch(bundle, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(bundle, /ACCOUNT_RECOVERY_HMAC_SECRET/);
});
